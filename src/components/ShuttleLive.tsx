'use client';

import { useEffect, useState } from 'react';
import type { PlannedRoute } from '@/types/commute';
import type { LiveBus } from '@/components/map-style';
import { formatSgtTime } from '@/lib/time';

type Arrival = { line: string; etaIso: string; plate: string | null; ridership: number | null; capacity: number | null };
type Bus = { line: string; plate: string; lat: number; lon: number; errorBoundM: number; anchorStop: string; anchorEtaMin: number };

const REFRESH_MS = 20_000;

/**
 * Live NUS shuttle countdowns at the route's boarding stop, plus estimated bus positions for the line.
 * Data is unofficial (team proxy over a community NUS shuttle app); positions are dead-reckoned, not GPS.
 */
export function ShuttleLive({ route, onBuses }: { route: PlannedRoute; onBuses: (buses: LiveBus[]) => void }) {
  const leg = route.legs.find((l) => l.mode === 'NUS_SHUTTLE' && l.fromStopCode);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [positionsNote, setPositionsNote] = useState('');

  const stop = leg?.fromStopCode;
  const line = leg?.service;

  useEffect(() => {
    if (!stop || !line) {
      onBuses([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const [etaRes, busRes] = await Promise.allSettled([
        fetch(`/api/transport/arrivals?network=shuttle&stop=${encodeURIComponent(stop)}&service=${encodeURIComponent(line)}`).then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error);
          return data;
        }),
        fetch(`/api/transport/shuttle-buses?line=${encodeURIComponent(line)}`).then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error);
          return data;
        }),
      ]);
      if (cancelled) return;
      if (etaRes.status === 'fulfilled') {
        setArrivals(etaRes.value.arrivals ?? []);
        setFetchedAt(etaRes.value.provenance?.fetchedAt ?? null);
        setError('');
      } else {
        setError('Live arrival data unavailable');
      }
      if (busRes.status === 'fulfilled') {
        const buses = (busRes.value.buses ?? []) as Bus[];
        onBuses(buses.map((b) => ({ kind: 'ISB' as const, serviceNo: b.line, lat: b.lat, lon: b.lon, minutes: null, errorBoundM: b.errorBoundM })));
        setPositionsNote(buses.length ? `${buses.length} ${line} bus${buses.length === 1 ? '' : 'es'} on the map (estimated positions)` : '');
      } else {
        onBuses([]);
        setPositionsNote('Shuttle positions unavailable');
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      onBuses([]);
    };
  }, [stop, line, onBuses]);

  if (!leg) return null;
  const minutesUntil = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));

  return (
    <div className="live shuttle">
      <p className="live-title">
        <span className="live-dot" aria-hidden /> NUS shuttle at {leg.fromName} · ISB {line}
      </p>
      {error && <p className="warning">{error}</p>}
      {!error && fetchedAt && arrivals.length === 0 && <p className="muted">No ISB {line} reported at this stop right now — it may not be running.</p>}
      {arrivals.length > 0 && (
        <ul>
          {arrivals.map((a, i) => (
            <li key={i}>
              <strong>{minutesUntil(a.etaIso)} min</strong> <span className="muted">({formatSgtTime(a.etaIso)})</span> ·{' '}
              {a.ridership !== null && a.capacity !== null ? `${a.ridership}/${a.capacity} riders reported` : 'Crowding information unavailable'}
            </li>
          ))}
        </ul>
      )}
      {positionsNote && <p className="muted">{positionsNote}</p>}
      {fetchedAt && (
        <p className="muted">
          Unofficial NUS shuttle feed via nus-transit-cache · countdown updated {formatSgtTime(fetchedAt)} · refreshes every 20 s
        </p>
      )}
    </div>
  );
}
