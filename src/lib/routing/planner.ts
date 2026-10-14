// Deterministic conversion of transit itineraries into route comparisons.
// Uncertainty follows ARCHITECTURE.md §6: per-leg ranges, ride/walk deltas combined by root-sum-of-squares,
// plus an explicit 60 s navigation buffer per transfer added to the latest arrival.
import type { LegMode, NeutralTag, PlannedRoute, Provenance, RouteLeg } from '@/types/commute';
import type { OneMapItinerary, OneMapLeg } from '@/lib/adapters/onemap';
import { decodePolyline } from '@/lib/routing/polyline';

export const TRANSFER_BUFFER_SECONDS = 60;

function legMode(mode: string): LegMode {
  if (mode === 'WALK') return 'WALK';
  if (mode === 'BUS') return 'BUS';
  if (mode === 'SUBWAY' || mode === 'RAIL' || mode === 'TRAM') return 'RAIL';
  return 'OTHER';
}

/** Lower/upper deviation (seconds) of a single leg's duration. */
function legDelta(mode: LegMode, seconds: number, stops: number): [number, number] {
  if (mode === 'WALK') return [0.1 * seconds, 0.15 * seconds];
  if (mode === 'RAIL') return [0.05 * seconds, 0.05 * seconds + 60];
  if (mode === 'BUS') return [0.1 * seconds, 0.2 * seconds + 15 * stops];
  if (mode === 'NUS_SHUTTLE') return [0.1 * seconds, 0.25 * seconds + 20 * stops];
  return [0.1 * seconds, 0.25 * seconds];
}

const coordsOf = (p?: { lat?: number; lon?: number }): [number, number] | null =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? [p.lon as number, p.lat as number] : null;

function legPath(leg: OneMapLeg): [number, number][] {
  if (leg.legGeometry?.points) {
    try {
      const path = decodePolyline(leg.legGeometry.points);
      if (path.length >= 2) return path;
    } catch {
      // Fall through to a straight line between the leg's endpoints.
    }
  }
  const from = coordsOf(leg.from);
  const to = coordsOf(leg.to);
  return from && to ? [from, to] : [];
}

export function toLeg(leg: OneMapLeg): RouteLeg {
  const mode = legMode(leg.mode);
  const path = legPath(leg);
  const fromCoords = coordsOf(leg.from) ?? path[0] ?? [0, 0];
  const toCoords = coordsOf(leg.to) ?? path[path.length - 1] ?? fromCoords;
  return {
    fromCoords,
    toCoords,
    path,
    mode,
    service: mode === 'WALK' ? undefined : leg.route || undefined,
    fromName: leg.from?.name ?? 'Unknown',
    fromStopCode: leg.from?.stopCode,
    toName: leg.to?.name ?? 'Unknown',
    toStopCode: leg.to?.stopCode,
    departureIso: new Date(leg.startTime).toISOString(),
    arrivalIso: new Date(leg.endTime).toISOString(),
    durationSeconds: Math.round(leg.duration),
    distanceMeters: Math.round(leg.distance),
    stopCount: mode === 'BUS' || mode === 'RAIL' ? (leg.intermediateStops?.length ?? 0) + 1 : undefined,
  };
}

export function serviceLabel(leg: RouteLeg): string {
  if (leg.mode === 'BUS') return `Bus ${leg.service ?? '?'}`;
  if (leg.mode === 'RAIL') return `MRT/LRT ${leg.service ?? ''}`.trim();
  if (leg.mode === 'NUS_SHUTTLE') return `ISB ${leg.service ?? ''}`.trim();
  return leg.service ?? leg.mode;
}

/** A wait before a vehicle, with how far the real wait may fall below / above the estimate (seconds). */
export type WaitEstimate = { seconds: number; low: number; high: number };

export type RouteDraft = {
  index: number;
  legs: RouteLeg[];
  waits: WaitEstimate[];
  departureMs: number;
  arrivalMs: number;
  arriveBy: Date | null; // late-arrival flags are only computed in "Arrive by" mode
  provenance: Provenance[];
  warnings: string[];
  crowding: string;
};

/** Totals, arrival range and late flags for any sequence of legs (public transport, ISB and walking). */
export function assembleRoute(d: RouteDraft): PlannedRoute {
  const transitLegs = d.legs.filter((l) => l.mode !== 'WALK');
  const transfers = Math.max(0, transitLegs.length - 1);

  let sqLow = 0;
  let sqHigh = 0;
  for (const leg of d.legs) {
    const [low, high] = legDelta(leg.mode, leg.durationSeconds, leg.stopCount ?? 0);
    sqLow += low * low;
    sqHigh += high * high;
  }
  // Waits add linearly (connection risk); rides and walks combine by root-sum-of-squares.
  const waitLow = d.waits.reduce((s, w) => s + w.low, 0);
  const waitHigh = d.waits.reduce((s, w) => s + w.high, 0);
  const transferBufferSeconds = transfers * TRANSFER_BUFFER_SECONDS;
  const earliest = d.arrivalMs - (waitLow + Math.sqrt(sqLow)) * 1000;
  const latest = d.arrivalMs + (waitHigh + Math.sqrt(sqHigh) + transferBufferSeconds) * 1000;

  const arriveByMs = d.arriveBy?.getTime() ?? Infinity;
  const arrivesAfterClassStart = d.arrivalMs > arriveByMs;
  const mayArriveAfterClassStart = !arrivesAfterClassStart && latest > arriveByMs;

  const warnings = [...d.provenance.flatMap((p) => (p.warningMessage ? [p.warningMessage] : [])), ...d.warnings];
  if (arrivesAfterClassStart) warnings.unshift('Scheduled arrival is after your arrive-by time');
  else if (mayArriveAfterClassStart) warnings.unshift('May arrive after your arrive-by time (latest estimate)');

  const walkLegs = d.legs.filter((l) => l.mode === 'WALK');
  const labels = transitLegs.map(serviceLabel);
  return {
    id: `route-${d.index}`,
    summary: labels.length ? labels.join(' → ') : 'Walk only',
    tags: [],
    departureIso: new Date(d.departureMs).toISOString(),
    arrivalIso: new Date(d.arrivalMs).toISOString(),
    arrivalRange: { earliestIso: new Date(earliest).toISOString(), latestIso: new Date(latest).toISOString() },
    durationSeconds: Math.round((d.arrivalMs - d.departureMs) / 1000),
    walkSeconds: walkLegs.reduce((s, l) => s + l.durationSeconds, 0),
    walkMeters: walkLegs.reduce((s, l) => s + l.distanceMeters, 0),
    waitSeconds: d.waits.reduce((s, w) => s + w.seconds, 0),
    rideSeconds: transitLegs.reduce((s, l) => s + l.durationSeconds, 0),
    transferBufferSeconds,
    transfers,
    publicServices: transitLegs.filter((l) => l.mode !== 'NUS_SHUTTLE').map(serviceLabel),
    nusShuttles: transitLegs.filter((l) => l.mode === 'NUS_SHUTTLE').map(serviceLabel),
    legs: d.legs,
    crowding: d.crowding,
    arrivesAfterClassStart,
    mayArriveAfterClassStart,
    provenance: d.provenance,
    warnings,
  };
}

/** Gaps between consecutive OneMap legs are waiting time (OneMap schedules the first leg to start on time). */
export function oneMapWaits(legs: OneMapLeg[]): WaitEstimate[] {
  return legs.slice(1).flatMap((leg, i) => {
    const gap = Math.round((leg.startTime - legs[i].endTime) / 1000);
    return gap > 0 ? [{ seconds: gap, low: 0, high: 0 }] : [];
  });
}

export function itineraryToRoute(
  it: OneMapItinerary,
  index: number,
  arriveBy: Date | null,
  provenance: Provenance,
  extraWarnings: string[] = ['No NUS shuttle (ISB) leg on this route'],
): PlannedRoute {
  return assembleRoute({
    index,
    legs: it.legs.map(toLeg),
    waits: oneMapWaits(it.legs),
    departureMs: it.startTime,
    arrivalMs: it.endTime,
    arriveBy,
    provenance: [provenance],
    warnings: [...extraWarnings, 'Live arrival data unavailable — Using scheduled timetable'],
    crowding: 'Crowding information unavailable',
  });
}

/**
 * Drops itineraries that use the same service sequence. In "Arrive by" mode it keeps the latest departure
 * that still arrives on time; otherwise it keeps the earliest arrival.
 */
export function dedupeItineraries(itineraries: OneMapItinerary[], arriveBy: Date | null): OneMapItinerary[] {
  const key = (it: OneMapItinerary) =>
    it.legs.filter((l) => l.mode !== 'WALK').map((l) => `${l.mode}:${l.route}`).join('>') || 'WALK';
  const byKey = new Map<string, OneMapItinerary>();
  for (const it of itineraries) {
    const existing = byKey.get(key(it));
    if (!existing) {
      byKey.set(key(it), it);
      continue;
    }
    let better: boolean;
    if (!arriveBy) {
      better = it.endTime < existing.endTime;
    } else {
      const onTime = it.endTime <= arriveBy.getTime();
      const existingOnTime = existing.endTime <= arriveBy.getTime();
      better = onTime && existingOnTime ? it.startTime > existing.startTime : onTime || (!existingOnTime && it.endTime < existing.endTime);
    }
    if (better) byKey.set(key(it), it);
  }
  return Array.from(byKey.values()).sort((a, b) => a.startTime - b.startTime);
}

/** Adds neutral, factual tags. A tag is only applied when routes actually differ on that metric. */
export function applyNeutralTags(routes: PlannedRoute[]): PlannedRoute[] {
  if (routes.length < 2) return routes;
  const tag = (label: NeutralTag, metric: (r: PlannedRoute) => number) => {
    const values = routes.map(metric);
    const min = Math.min(...values);
    if (values.every((v) => v === min)) return;
    routes.forEach((r, i) => values[i] === min && r.tags.push(label));
  };
  tag('Fastest by estimate', (r) => r.durationSeconds);
  tag('Fewest transfers', (r) => r.transfers);
  tag('Least walking', (r) => r.walkSeconds);
  return routes;
}
