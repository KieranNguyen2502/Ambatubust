'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoPoint, Lesson, Place, PlanResponse, TimeMode } from '@/types/commute';
import type { LiveBus } from '@/components/map-style';
import { PlaceInput } from '@/components/PlaceInput';
import { RouteCard } from '@/components/RouteCard';
import { resolveVenue } from '@/lib/campus/venue-resolver';
import { formatSgtDateTime, parseSgtLocalInput, toSgtLocalInput } from '@/lib/time';
import { lessonsFromModule, nextOccurrence, parseIcs, parseTimetableInput } from '@/lib/timetable/parsers';

// MapLibre needs the browser (WebGL), so the map is client-only.
const CommuteMap = dynamic(() => import('@/components/CommuteMap'), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

const TIME_MODES: { mode: TimeMode; label: string }[] = [
  { mode: 'NOW', label: 'Leave now' },
  { mode: 'DEPART_AT', label: 'Depart at' },
  { mode: 'ARRIVE_BY', label: 'Arrive by' },
];

async function readJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

const coordsLabel = (p: GeoPoint) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

export default function Page() {
  // Start and destination
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [userLocation, setUserLocation] = useState<(GeoPoint & { accuracy: number }) | null>(null);
  const watchId = useRef<number | null>(null);

  // Time
  const [timeMode, setTimeMode] = useState<TimeMode>('NOW');
  const [timeInput, setTimeInput] = useState('');

  // Optional timetable
  const [timetableInput, setTimetableInput] = useState('');
  const [semester, setSemester] = useState(1);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [timetableStatus, setTimetableStatus] = useState('');
  const [timetableErrors, setTimetableErrors] = useState<string[]>([]);
  const [loadingTimetable, setLoadingTimetable] = useState(false);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);

  // Results
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planError, setPlanError] = useState('');
  const [planning, setPlanning] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [liveBuses, setLiveBuses] = useState<{ LTA: LiveBus[]; ISB: LiveBus[] }>({ LTA: [], ISB: [] });
  const onLtaBuses = useCallback((buses: LiveBus[]) => setLiveBuses((prev) => ({ ...prev, LTA: buses })), []);
  const onIsbBuses = useCallback((buses: LiveBus[]) => setLiveBuses((prev) => ({ ...prev, ISB: buses })), []);
  const mapBuses = useMemo(() => [...liveBuses.LTA, ...liveBuses.ISB], [liveBuses]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sortMode, setSortMode] = useState<'SHUTTLE_FIRST' | 'ARRIVAL'>('SHUTTLE_FIRST');

  // Default "Depart at / Arrive by" time is set on the client so server and client markup match.
  useEffect(() => {
    const nextHour = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000);
    setTimeInput((current) => current || toSgtLocalInput(nextHour));
  }, []);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
  }, []);

  /** Map clicks and pin drags: place a pin immediately, then replace its label with the nearest address. */
  const pick = useCallback((role: 'origin' | 'destination', point: GeoPoint) => {
    const set = role === 'origin' ? setOrigin : setDestination;
    const pin: Place = { kind: 'pin', label: 'Pinned location', detail: coordsLabel(point), ...point };
    set(pin);
    fetch(`/api/location/reverse?lat=${point.lat}&lon=${point.lon}`)
      .then(readJson)
      .then((data) => {
        if (!data.place) return;
        set((current) =>
          current && current.kind === 'pin' && current.lat === point.lat && current.lon === point.lon
            ? { ...current, label: data.place.label, detail: data.place.detail || coordsLabel(point) }
            : current,
        );
      })
      .catch(() => undefined);
  }, []);

  function locateMe() {
    if (!('geolocation' in navigator)) {
      setLocationError('This browser cannot share its location');
      return;
    }
    setLocating(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setOrigin({ kind: 'gps', label: 'Your location', detail: `±${Math.round(pos.coords.accuracy)} m · ${coordsLabel(point)}`, ...point });
        setUserLocation({ ...point, accuracy: pos.coords.accuracy });
        setLocating(false);
        // Keep the blue dot live without re-planning on every movement.
        if (watchId.current === null) {
          watchId.current = navigator.geolocation.watchPosition(
            (p) => setUserLocation({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
            () => undefined,
            { enableHighAccuracy: true, maximumAge: 10_000 },
          );
        }
      },
      (err) => {
        setLocating(false);
        setLocationError(err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Could not get your location');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  // ---- Timetable (optional) ----
  const upcoming = useMemo(() => {
    const now = new Date();
    return lessons
      .map((lesson) => ({ lesson, ...nextOccurrence(lesson, now) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [lessons]);

  async function loadTimetable() {
    const parsed = parseTimetableInput(timetableInput);
    if (!parsed) {
      setTimetableErrors(['Paste an NUSMods share link (nusmods.com → Share/Sync) or module codes such as "CS2103T, CS2101"']);
      return;
    }
    const sem = parsed.semester ?? semester;
    if (parsed.semester) setSemester(parsed.semester);
    setLoadingTimetable(true);
    setTimetableErrors([]);
    setTimetableStatus('Loading from NUSMods…');
    const results = await Promise.all(
      parsed.modules.map(async ({ moduleCode, classNos }) => {
        try {
          const res = await fetch(`/api/nusmods/module/${encodeURIComponent(moduleCode)}`);
          const data = await readJson(res);
          if (!res.ok) return { error: `${moduleCode}: ${data.error ?? 'unavailable'}` };
          const moduleLessons = lessonsFromModule(data, sem, classNos);
          return moduleLessons.length ? { lessons: moduleLessons } : { error: `${moduleCode}: no lessons in semester ${sem}` };
        } catch {
          return { error: `${moduleCode}: NUSMods is unavailable` };
        }
      }),
    );
    const loaded = results.flatMap((r) => r.lessons ?? []);
    setLessons(loaded);
    setSelectedLessonId(null);
    setTimetableErrors(results.flatMap((r) => (r.error ? [r.error] : [])));
    setTimetableStatus(loaded.length ? `${loaded.length} lessons loaded from NUSMods (semester ${sem})` : '');
    setLoadingTimetable(false);
  }

  async function importIcs(file: File) {
    try {
      const parsed = parseIcs(await file.text());
      setLessons(parsed);
      setSelectedLessonId(null);
      setTimetableErrors(parsed.length ? [] : [`${file.name}: no timed events found — is this a valid .ics file?`]);
      setTimetableStatus(parsed.length ? `${parsed.length} events imported from ${file.name}` : '');
    } catch {
      setTimetableErrors([`${file.name} could not be read`]);
    }
  }

  function selectLesson(lesson: Lesson, start: Date) {
    setSelectedLessonId(lesson.id);
    setTimeMode('ARRIVE_BY');
    setTimeInput(toSgtLocalInput(start));
    const venue = resolveVenue(lesson.rawVenue);
    if (venue.status === 'RESOLVED') {
      setDestination({ kind: 'venue', label: venue.venueCode, detail: `NUS · ${venue.roomName || venue.buildingCode}`, venueCode: venue.venueCode, lat: venue.lat, lon: venue.lon });
      setTimetableErrors([]);
    } else {
      setTimetableErrors([
        venue.status === 'ONLINE'
          ? `${lesson.moduleCode} ${lesson.lessonType} is online — no commute needed`
          : `Unknown building for venue "${lesson.rawVenue}" — set the destination by searching or clicking the map`,
      ]);
    }
  }

  // ---- Planning: re-plans automatically whenever the trip changes ----
  const target = timeMode === 'NOW' ? null : parseSgtLocalInput(timeInput);
  const blocker = !origin
    ? 'Choose a start point: search, use your location, or click the map'
    : !destination
      ? 'Choose a destination: search a place or NUS venue, or click the map'
      : timeMode !== 'NOW' && !target
        ? 'Enter a valid date and time'
        : null;

  const tripKey = origin && destination && !blocker ? JSON.stringify([origin.lat, origin.lon, destination.lat, destination.lon, timeMode, target?.toISOString() ?? null, refreshKey]) : null;

  useEffect(() => {
    if (!tripKey) {
      setPlan(null);
      setPlanError('');
      return;
    }
    const [olat, olon, dlat, dlon, mode, time] = JSON.parse(tripKey);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPlanning(true);
      setPlanError('');
      try {
        const res = await fetch('/api/routes/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ origin: { lat: olat, lon: olon }, destination: { lat: dlat, lon: dlon }, timeMode: mode, time }),
          signal: controller.signal,
        });
        const data = await readJson(res);
        if (!res.ok) {
          setPlan(null);
          setPlanError(data.error ?? 'This route could not be calculated');
        } else {
          setPlan(data as PlanResponse);
          setSelectedRouteId((data as PlanResponse).routes[0]?.id ?? null);
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        setPlanError('Could not reach the planner — check your connection');
      }
      setPlanning(false);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tripKey]);

  const routes = plan?.routes ?? [];
  const shuttleRoutes = routes.filter((r) => r.nusShuttles.length);
  const otherRoutes = routes.filter((r) => !r.nusShuttles.length);
  const byArrival = [...routes].sort((a, b) => a.arrivalIso.localeCompare(b.arrivalIso));
  const groups =
    sortMode === 'SHUTTLE_FIRST'
      ? [
          { title: `Includes NUS shuttle (${shuttleRoutes.length})`, routes: shuttleRoutes, empty: 'No NUS shuttle option shown for this trip (see notes above)' },
          { title: `Public transport and walking (${otherRoutes.length})`, routes: otherRoutes, empty: '' },
        ]
      : [{ title: '', routes: byArrival, empty: '' }];

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>NUS Commute Planner</h1>
          <p className="muted">Transparent route comparisons — you decide which trade-off suits you.</p>
        </header>

        <section className="panel">
          <PlaceInput
            id="origin"
            label="From"
            placeholder="Address, postal code or place"
            value={origin}
            onChange={setOrigin}
            onUseLocation={locateMe}
            locating={locating}
          />
          {locationError && <p className="warning">{locationError}</p>}
          <div className="swap-row">
            <button
              className="link-button"
              onClick={() => {
                setOrigin(destination);
                setDestination(origin);
              }}
              disabled={!origin && !destination}
            >
              ⇅ Swap
            </button>
            <span className="muted">or click the map to drop pins</span>
          </div>
          <PlaceInput id="destination" label="To" placeholder="NUS venue (e.g. COM1-0212, LT17) or any place" value={destination} onChange={setDestination} />

          <div className="segmented" role="radiogroup" aria-label="Departure time">
            {TIME_MODES.map(({ mode, label }) => (
              <button key={mode} role="radio" aria-checked={timeMode === mode} className={timeMode === mode ? 'active' : ''} onClick={() => setTimeMode(mode)}>
                {label}
              </button>
            ))}
          </div>
          {timeMode !== 'NOW' && (
            <>
              <label htmlFor="time">{timeMode === 'ARRIVE_BY' ? 'Arrive by' : 'Depart at'} (Singapore time)</label>
              <input id="time" type="datetime-local" value={timeInput} onChange={(e) => setTimeInput(e.target.value)} />
            </>
          )}

          <details className="timetable">
            <summary>Plan for a class (NUSMods link or .ics)</summary>
            <label htmlFor="timetable">NUSMods share link or module codes</label>
            <input
              id="timetable"
              value={timetableInput}
              onChange={(e) => setTimetableInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadTimetable()}
              placeholder="https://nusmods.com/timetable/sem-1/share?…"
            />
            <div className="row">
              <select value={semester} onChange={(e) => setSemester(Number(e.target.value))} aria-label="Semester">
                <option value={1}>Semester 1</option>
                <option value={2}>Semester 2</option>
                <option value={3}>Special Term I</option>
                <option value={4}>Special Term II</option>
              </select>
              <button className="button" onClick={loadTimetable} disabled={loadingTimetable}>
                {loadingTimetable ? 'Loading…' : 'Load'}
              </button>
            </div>
            <label className="file">
              or import an .ics file
              <input type="file" accept=".ics,text/calendar" onChange={(e) => e.target.files?.[0] && importIcs(e.target.files[0])} />
            </label>
            {timetableStatus && <p className="muted">{timetableStatus}</p>}
            {timetableErrors.map((err) => (
              <p className="warning" key={err}>
                {err}
              </p>
            ))}
            {upcoming.length > 0 && (
              <>
                <p className="muted">Pick a class to route there in time. Next weekly occurrence; teaching weeks and recess are not checked.</p>
                <div className="lessons">
                  {upcoming.map(({ lesson, start, inProgress }) => (
                    <button key={lesson.id} className={`lesson ${selectedLessonId === lesson.id ? 'selected' : ''}`} onClick={() => selectLesson(lesson, start)}>
                      <strong>
                        {lesson.moduleCode} {lesson.lessonType} {lesson.classNo}
                      </strong>
                      <span>
                        {formatSgtDateTime(start.toISOString())} · {lesson.rawVenue}
                      </span>
                      {inProgress && <span className="tag">In progress</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </details>
        </section>

        <section className="results" aria-live="polite">
          <div className="results-head">
            <h2>Routes</h2>
            {tripKey && (
              <button className="link-button" onClick={() => setRefreshKey((k) => k + 1)} disabled={planning}>
                {planning ? 'Updating…' : '↻ Refresh'}
              </button>
            )}
          </div>
          {blocker && <p className="muted">{blocker}</p>}
          {planError && <p className="warning strong">{planError}</p>}
          {plan && (
            <>
              <p className="muted">
                {plan.timeMode === 'ARRIVE_BY' ? 'Arrive by' : 'Departing'} {formatSgtDateTime(plan.targetIso)} · timetable fetched{' '}
                {formatSgtDateTime(plan.fetchedAt)}
              </p>
              {plan.warnings.map((w) => (
                <p className={routes.length ? 'warning' : 'warning strong'} key={w}>
                  {w}
                </p>
              ))}
              {routes.length > 1 && (
                <div className="segmented small" role="radiogroup" aria-label="Sort routes">
                  <button role="radio" aria-checked={sortMode === 'SHUTTLE_FIRST'} className={sortMode === 'SHUTTLE_FIRST' ? 'active' : ''} onClick={() => setSortMode('SHUTTLE_FIRST')}>
                    NUS shuttle routes first
                  </button>
                  <button role="radio" aria-checked={sortMode === 'ARRIVAL'} className={sortMode === 'ARRIVAL' ? 'active' : ''} onClick={() => setSortMode('ARRIVAL')}>
                    Earliest arrival
                  </button>
                </div>
              )}
              {groups.map((group) => (
                <div key={group.title || 'all'}>
                  {group.title && <h3 className="group-title">{group.title}</h3>}
                  {group.routes.length === 0 && group.empty && <p className="muted">{group.empty}</p>}
                  {group.routes.map((route) => (
                    <RouteCard
                      key={route.id}
                      route={route}
                      selected={route.id === selectedRouteId}
                      onSelect={() => setSelectedRouteId(route.id)}
                      onLtaBuses={onLtaBuses}
                      onIsbBuses={onIsbBuses}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </section>
      </aside>

      <main className="map-pane">
        <CommuteMap
          origin={origin}
          destination={destination}
          routes={routes}
          selectedRouteId={selectedRouteId}
          userLocation={userLocation}
          liveBuses={mapBuses}
          onPick={pick}
          onSelectRoute={setSelectedRouteId}
        />
        <div className="legend" aria-hidden>
          <span style={{ color: '#2563eb' }}>━ Bus</span>
          <span style={{ color: '#9333ea' }}>━ MRT/LRT</span>
          <span style={{ color: '#ea580c' }}>━ NUS shuttle</span>
          <span style={{ color: '#475569' }}>┅ Walk</span>
          <span>
            <span className="bus-dot inline">96</span> live bus
          </span>
          <span>
            <span className="bus-dot isb inline">≈D1</span> estimated shuttle
          </span>
        </div>
      </main>
    </div>
  );
}
