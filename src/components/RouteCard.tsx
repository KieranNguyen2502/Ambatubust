import type { PlannedRoute, RouteLeg } from '@/types/commute';
import { formatSgtDateTime, formatSgtTime, minutes } from '@/lib/time';
import { MODE_COLORS, type LiveBus } from '@/components/map-style';
import { LiveArrivals } from '@/components/LiveArrivals';
import { ShuttleLive } from '@/components/ShuttleLive';

const MODE_LABEL: Record<RouteLeg['mode'], string> = {
  WALK: 'Walk',
  BUS: 'Bus',
  RAIL: 'MRT/LRT',
  NUS_SHUTTLE: 'NUS shuttle',
  OTHER: 'Transit',
};

function legTitle(leg: RouteLeg) {
  if (leg.mode === 'WALK') return `Walk to ${leg.toName}`;
  return `${MODE_LABEL[leg.mode]} ${leg.service ?? ''} · ${leg.fromName} → ${leg.toName}`;
}

type Props = {
  route: PlannedRoute;
  selected: boolean;
  onSelect: () => void;
  onLtaBuses: (buses: LiveBus[]) => void;
  onIsbBuses: (buses: LiveBus[]) => void;
};

export function RouteCard({ route, selected, onSelect, onLtaBuses, onIsbBuses }: Props) {
  const hasBus = route.legs.some((l) => l.mode === 'BUS');
  const hasShuttle = route.legs.some((l) => l.mode === 'NUS_SHUTTLE');
  const earliest = formatSgtTime(route.arrivalRange.earliestIso);
  const latest = formatSgtTime(route.arrivalRange.latestIso);
  const urgent = route.warnings.filter((w) => w.startsWith('DEMO SNAPSHOT') || w.includes('arrive-by'));

  return (
    <article className={`card route ${selected ? 'selected' : ''}`}>
      <button className="route-summary" onClick={onSelect} aria-expanded={selected}>
        <span className="route-head">
          <span>
            <strong>
              {formatSgtTime(route.departureIso)} → {formatSgtTime(route.arrivalIso)}
            </strong>{' '}
            <span className="muted">({minutes(route.durationSeconds)} min)</span>
          </span>
          <span className="muted">
            arrive {earliest}–{latest}
          </span>
        </span>
        <span className="leg-strip" aria-hidden>
          {route.legs.map((leg, i) => (
            <span
              key={i}
              className={`leg-chip ${leg.mode === 'WALK' ? 'walk' : ''}`}
              style={{ flexGrow: Math.max(leg.durationSeconds, 60), background: leg.mode === 'WALK' ? undefined : MODE_COLORS[leg.mode] }}
            >
              {leg.mode === 'WALK' ? `${minutes(leg.durationSeconds)}′` : leg.service}
            </span>
          ))}
        </span>
        <span className="route-meta">
          {route.summary} · {minutes(route.walkSeconds)} min walk · {route.transfers} transfer{route.transfers === 1 ? '' : 's'}
        </span>
        {route.tags.length > 0 && (
          <span>
            {route.tags.map((tag) => (
              <span className="pill" key={tag}>
                {tag}
              </span>
            ))}
          </span>
        )}
        {urgent.map((w) => (
          <span className="warning strong block" key={w}>
            {w}
          </span>
        ))}
      </button>

      {selected && (
        <div className="route-details">
          <div className="metric">
            <span>
              <strong>{minutes(route.walkSeconds)}m</strong>Walk ({route.walkMeters} m)
            </span>
            <span>
              <strong>{minutes(route.waitSeconds)}m</strong>Wait
            </span>
            <span>
              <strong>{minutes(route.rideSeconds)}m</strong>Ride
            </span>
            <span>
              <strong>{route.transfers}</strong>
              Transfers{route.transfers > 0 && ` (+${minutes(route.transferBufferSeconds)}m buffer in range)`}
            </span>
          </div>

          <ol className="legs">
            {route.legs.map((leg, i) => (
              <li key={i} style={{ borderColor: MODE_COLORS[leg.mode] }}>
                <span className="muted">
                  {formatSgtTime(leg.departureIso)}–{formatSgtTime(leg.arrivalIso)}
                </span>{' '}
                {legTitle(leg)}{' '}
                <span className="muted">
                  ({minutes(leg.durationSeconds)} min, {leg.distanceMeters} m{leg.stopCount ? `, ${leg.stopCount} stops` : ''})
                </span>
              </li>
            ))}
          </ol>

          {hasBus && <LiveArrivals route={route} onBuses={onLtaBuses} />}
          {hasShuttle && <ShuttleLive route={route} onBuses={onIsbBuses} />}
          {!hasBus && !hasShuttle && <p className="muted">No live arrival data for this route&apos;s legs (MRT/LRT timings are scheduled).</p>}

          <dl className="facts">
            <dt>Public transport</dt>
            <dd>{route.publicServices.length ? route.publicServices.join(', ') : 'None'}</dd>
            <dt>NUS shuttle</dt>
            <dd>{route.nusShuttles.length ? route.nusShuttles.join(', ') : 'Not included'}</dd>
            <dt>Crowding (planned trip)</dt>
            <dd>{route.crowding}</dd>
            <dt>Timetable data</dt>
            <dd>
              {route.provenance.map((p) => (
                <span key={p.source}>
                  {p.source} · <span className={`status status-${p.status.toLowerCase()}`}>{p.status}</span>
                  {p.fetchedAt && ` · ${formatSgtDateTime(p.fetchedAt)}`}
                </span>
              ))}
            </dd>
          </dl>

          {route.warnings
            .filter((w) => !urgent.includes(w))
            .map((w) => (
              <p className="warning" key={w}>
                {w}
              </p>
            ))}
        </div>
      )}
    </article>
  );
}
