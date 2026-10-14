// Stitches NUS shuttle (ISB) legs onto public-transport itineraries, or builds campus-only shuttle trips.
// A trip may be: [public transport legs] → walk to ISB stop → wait → ISB ride → walk to destination.
import type { GeoPoint, Provenance, RouteLeg } from '@/types/commute';
import type { IsbArrival, IsbNetwork, IsbStop } from '@/lib/adapters/shuttle';
import type { OneMapItinerary } from '@/lib/adapters/onemap';
import { distanceMeters, estimateWalk, isbRide, isbWait, nearbyStops } from '@/lib/routing/isb';
import { oneMapWaits, toLeg, type RouteDraft, type WaitEstimate } from '@/lib/routing/planner';
import { formatSgtTime } from '@/lib/time';

export const BOARD_RADIUS_M = 400;
export const ALIGHT_RADIUS_M = 500;

/**
 * ISB stops where public transport meets the shuttle network (ARCHITECTURE.md §5 gateway hubs):
 * Kent Ridge MRT (CC24), UTown (Clementi Rd / Dover Rd buses), Clementi Rd bus corridor (IT, Central Library),
 * AYE bus stops at University Health Centre, and Botanic Gardens MRT (line P).
 */
export const GATEWAY_STOP_CODES = ['KR-MRT', 'KR-MRT-OPP', 'UTOWN', 'IT', 'CLB', 'UHC', 'UHC-OPP', 'BG-MRT'];

/** Where and when a traveller could start walking to a shuttle stop. */
export type ShuttleSource = {
  point: GeoPoint;
  pointName: string;
  atMs: number;
  departureMs: number;
  prefixLegs: RouteLeg[];
  prefixWaits: WaitEstimate[];
  prefixProvenance: Provenance[];
  baseline?: { arrivalMs: number; walkSeconds: number }; // the public-transport-only trip it would replace
};

export function originSource(origin: GeoPoint, departMs: number): ShuttleSource {
  return { point: origin, pointName: 'Start', atMs: departMs, departureMs: departMs, prefixLegs: [], prefixWaits: [], prefixProvenance: [] };
}

/** Every point where an itinerary's bus/train drops you off is a possible transfer to an ISB. */
export function transferSources(itineraries: OneMapItinerary[], provenance: Provenance): ShuttleSource[] {
  return itineraries.flatMap((it) =>
    it.legs.flatMap((leg, i) => {
      if (leg.mode === 'WALK' || !Number.isFinite(leg.to?.lat) || !Number.isFinite(leg.to?.lon)) return [];
      const prefix = it.legs.slice(0, i + 1);
      return [
        {
          point: { lat: leg.to.lat as number, lon: leg.to.lon as number },
          pointName: leg.to.name,
          atMs: leg.endTime,
          departureMs: it.startTime,
          prefixLegs: prefix.map(toLeg),
          prefixWaits: oneMapWaits(prefix),
          prefixProvenance: [provenance],
          baseline: { arrivalMs: it.endTime, walkSeconds: it.walkTime },
        },
      ];
    }),
  );
}

/**
 * A public-transport trip that ends at a gateway stop (queried on purpose so the shuttle can take over).
 * No baseline: these exist only to reach the shuttle, so they are never filtered out as "not useful".
 */
export function gatewaySources(itineraries: OneMapItinerary[], gateway: IsbStop, provenance: Provenance): ShuttleSource[] {
  return itineraries.map((it) => ({
    point: { lat: gateway.lat, lon: gateway.lon },
    pointName: gateway.name,
    atMs: it.endTime,
    departureMs: it.startTime,
    prefixLegs: it.legs.map(toLeg),
    prefixWaits: oneMapWaits(it.legs),
    prefixProvenance: [provenance],
  }));
}

/**
 * Gateway stops worth routing to: they have an ISB ride to a stop near the destination, are not already
 * walkable from the start or the destination, and are the closest such hubs to the start.
 */
export function gatewayStops(network: IsbNetwork, origin: GeoPoint, destination: GeoPoint, limit = 2): IsbStop[] {
  const alight = nearbyStops(network, destination, ALIGHT_RADIUS_M, 3);
  if (!alight.length) return [];
  return GATEWAY_STOP_CODES.map((code) => network.stops.find((s) => s.code === code))
    .filter((s): s is IsbStop => Boolean(s))
    .filter((s) => distanceMeters(origin, s) > BOARD_RADIUS_M && distanceMeters(destination, s) > ALIGHT_RADIUS_M)
    .filter((s) => alight.some((a) => a.code !== s.code && network.lines.some((line) => isbRide(network, line, s.code, a.code))))
    .sort((a, b) => distanceMeters(origin, a) - distanceMeters(origin, b))
    .slice(0, limit);
}

/** ISB stops worth fetching live countdowns for. */
export function boardingStopCodes(network: IsbNetwork, sources: ShuttleSource[], destination: GeoPoint, limit = 8): string[] {
  if (!nearbyStops(network, destination, ALIGHT_RADIUS_M).length) return [];
  const codes = new Map<string, number>();
  for (const s of sources) {
    for (const stop of nearbyStops(network, s.point, BOARD_RADIUS_M, 3)) codes.set(stop.code, Math.min(codes.get(stop.code) ?? Infinity, stop.meters));
  }
  return Array.from(codes.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([code]) => code);
}

function walkLeg(fromName: string, from: GeoPoint, toName: string, to: GeoPoint, startMs: number, toStopCode?: string): RouteLeg {
  const walk = estimateWalk(from, to);
  return {
    mode: 'WALK',
    fromName,
    toName,
    toStopCode,
    departureIso: new Date(startMs).toISOString(),
    arrivalIso: new Date(startMs + walk.seconds * 1000).toISOString(),
    durationSeconds: walk.seconds,
    distanceMeters: walk.meters,
    fromCoords: [from.lon, from.lat],
    toCoords: [to.lon, to.lat],
    path: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
  };
}

type Option = { draft: Omit<RouteDraft, 'index'>; key: string };

/**
 * Best (earliest-arriving) ISB continuation for each source. Lines with no reported buses at the
 * boarding stop are skipped rather than guessed.
 */
export function buildShuttleOptions(
  network: IsbNetwork,
  sources: ShuttleSource[],
  destination: GeoPoint,
  arrivalsByStop: Map<string, { lastUpdated: string; arrivals: IsbArrival[] } | null>,
  arriveBy: Date | null,
): Omit<RouteDraft, 'index'>[] {
  const alightStops = nearbyStops(network, destination, ALIGHT_RADIUS_M, 3);
  if (!alightStops.length) return [];
  const options = new Map<string, Option>();

  for (const source of sources) {
    let best: (Option & { arrivalMs: number; walkSeconds: number }) | null = null;
    for (const board of nearbyStops(network, source.point, BOARD_RADIUS_M, 3)) {
      const live = arrivalsByStop.get(board.code);
      if (!live) continue;
      for (const alight of alightStops) {
        if (alight.code === board.code) continue;
        for (const line of network.lines) {
          const ride = isbRide(network, line, board.code, alight.code);
          if (!ride) continue;
          const candidate = buildOption(network, source, board, alight, ride, live, destination, arriveBy);
          if (candidate && (!best || candidate.arrivalMs < best.arrivalMs)) best = candidate;
        }
      }
    }
    if (!best) continue;
    // Shuttle variants are kept unless they are both later and involve more walking than the trip they extend.
    if (source.baseline && best.arrivalMs > source.baseline.arrivalMs && best.walkSeconds >= source.baseline.walkSeconds) continue;
    const existing = options.get(best.key);
    if (!existing || best.draft.arrivalMs < existing.draft.arrivalMs) options.set(best.key, best);
  }
  return Array.from(options.values()).map((o) => o.draft);
}

function buildOption(
  network: IsbNetwork,
  source: ShuttleSource,
  board: IsbStop,
  alight: IsbStop,
  ride: NonNullable<ReturnType<typeof isbRide>>,
  live: { lastUpdated: string; arrivals: IsbArrival[] },
  destination: GeoPoint,
  arriveBy: Date | null,
) {
  const toStop = walkLeg(source.pointName, source.point, board.name, board, source.atMs, board.code);
  const reachMs = new Date(toStop.arrivalIso).getTime();
  const wait = isbWait(live.arrivals, ride.line, reachMs);
  if (!wait) return null;

  const boardMs = reachMs + wait.seconds * 1000;
  const alightMs = boardMs + ride.seconds * 1000;
  const shuttle: RouteLeg = {
    mode: 'NUS_SHUTTLE',
    service: ride.line,
    fromName: board.name,
    fromStopCode: board.code,
    toName: alight.name,
    toStopCode: alight.code,
    departureIso: new Date(boardMs).toISOString(),
    arrivalIso: new Date(alightMs).toISOString(),
    durationSeconds: ride.seconds,
    distanceMeters: ride.meters,
    stopCount: ride.stopCount,
    fromCoords: [board.lon, board.lat],
    toCoords: [alight.lon, alight.lat],
    path: ride.path.length >= 2 ? ride.path : [[board.lon, board.lat], [alight.lon, alight.lat]],
  };
  const toDestination = walkLeg(alight.name, alight, 'Destination', destination, alightMs);
  const arrivalMs = new Date(toDestination.arrivalIso).getTime();
  const legs = [...source.prefixLegs, toStop, shuttle, toDestination].filter((l) => l.mode !== 'WALK' || l.durationSeconds > 0);
  const walkSeconds = legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.durationSeconds, 0);

  const isbProvenance: Provenance = {
    source: `NUS shuttle via nus-transit-cache (unofficial)${network.source === 'CACHED' ? ' + bundled network snapshot' : ''}`,
    status: wait.status,
    fetchedAt: live.lastUpdated,
  };
  const warnings = [
    wait.status === 'LIVE'
      ? `ISB ${ride.line} wait from live countdown at ${board.name} (updated ${formatSgtTime(live.lastUpdated)})`
      : `ISB ${ride.line} wait ${wait.note} — no live countdown that far ahead`,
    'ISB ride time uses median observed stop-to-stop times, not a published timetable',
    'Walks to and from shuttle stops are estimated from straight-line distance',
  ];
  if (ride.estimatedSegments) warnings.push(`Part of the ISB ${ride.line} ride time is estimated from distance`);
  if (network.source === 'CACHED') warnings.push(`NUS shuttle stops and routes from a bundled snapshot (${network.fetchedAt.slice(0, 10)})`);
  if (source.prefixLegs.some((l) => l.mode !== 'WALK')) warnings.push('Public transport part uses the scheduled timetable');

  const ridership = wait.bus?.ridership;
  const capacity = wait.bus?.capacity;
  const crowding = [
    ...(source.prefixLegs.some((l) => l.mode !== 'WALK') ? ['Public transport: Crowding information unavailable'] : []),
    typeof ridership === 'number' && typeof capacity === 'number'
      ? `ISB ${ride.line}: ${ridership}/${capacity} riders reported on the bus due ${formatSgtTime(new Date(boardMs).toISOString())} (unofficial NUS shuttle feed)`
      : `ISB ${ride.line}: Crowding information unavailable`,
  ].join(' · ');

  const prefixKey = source.prefixLegs.filter((l) => l.mode !== 'WALK').map((l) => `${l.mode}:${l.service}`).join('>');
  return {
    key: `${prefixKey}|ISB:${ride.line}:${board.code}>${alight.code}`,
    arrivalMs,
    walkSeconds,
    draft: {
      legs,
      waits: [...source.prefixWaits, { seconds: wait.seconds, low: wait.low, high: wait.high }],
      departureMs: source.departureMs,
      arrivalMs,
      arriveBy,
      provenance: [...source.prefixProvenance, isbProvenance],
      warnings,
      crowding,
    },
  };
}
