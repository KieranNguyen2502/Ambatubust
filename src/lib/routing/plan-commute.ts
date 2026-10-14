import type { GeoPoint, PlanResponse, PlannedRoute, Provenance, TimeMode } from '@/types/commute';
import { routeOneMap, type OneMapItinerary } from '@/lib/adapters/onemap';
import { getIsbNetwork, getShuttleArrivals, type IsbNetwork, type IsbStopArrivals } from '@/lib/adapters/shuttle';
import { applyNeutralTags, assembleRoute, dedupeItineraries, itineraryToRoute } from '@/lib/routing/planner';
import { boardingStopCodes, buildShuttleOptions, gatewaySources, gatewayStops, originSource, transferSources } from '@/lib/routing/hybrid';
import snapshot from '@/data/fixtures/onemap-snapshot.json';

const PROBE_LEAD_MS = 90 * 60 * 1000; // "Arrive by": first query departs 90 min before the target
const ARRIVAL_MARGIN_MS = 10 * 60 * 1000; // second query aims to arrive ~10 min early
const MAX_SHUTTLE_ROUTES = 4;
const MAX_OTHER_ROUTES = 4;
const GATEWAY_EXTRA_MARGIN_MS = 15 * 60 * 1000; // allow for the shuttle part when timing a gateway query

type Router = typeof routeOneMap;
type Shuttle = { getNetwork: () => Promise<IsbNetwork>; getArrivals: (stopCode: string) => Promise<IsbStopArrivals> };
type Base = Pick<PlanResponse, 'timeMode' | 'targetIso' | 'arriveByPassed'>;
type Options = { now?: Date; demoFallback?: boolean; router?: Router; shuttle?: Shuttle | null };

const defaultShuttle: Shuttle = { getNetwork: getIsbNetwork, getArrivals: getShuttleArrivals };

/**
 * Public transport comes from OneMap. NOW / DEPART_AT: one query departing at the target (never in the past).
 * ARRIVE_BY: OneMap ignores `arriveBy`, so we pick the departure time ourselves:
 *   1. Probe departing 90 min before the target to learn the typical trip duration.
 *   2. Re-query departing (target − shortest duration − 10 min) so itineraries land just before it.
 * NUS shuttle legs are then stitched on where they help (see hybrid.ts), and campus-only shuttle trips are added.
 */
export async function planCommute(
  origin: GeoPoint,
  destination: GeoPoint,
  timeMode: TimeMode,
  target: Date,
  options: Options = {},
): Promise<PlanResponse> {
  const now = options.now ?? new Date();
  const router = options.router ?? routeOneMap;
  const shuttle = options.shuttle === undefined ? defaultShuttle : options.shuttle;
  const arriveBy = timeMode === 'ARRIVE_BY' ? target : null;
  const notBeforeNow = (ms: number) => new Date(Math.max(ms, now.getTime()));
  const base: Base = {
    timeMode,
    targetIso: (timeMode === 'NOW' ? now : target).toISOString(),
    arriveByPassed: Boolean(arriveBy && now.getTime() >= arriveBy.getTime()),
  };

  const [publicResult, network] = await Promise.all([
    planPublicTransport(router, origin, destination, timeMode, target, now, arriveBy, notBeforeNow).then(
      (itineraries) => ({ itineraries, error: null as string | null }),
      (error) => ({ itineraries: [] as OneMapItinerary[], error: error instanceof Error ? error.message : 'Unknown error' }),
    ),
    shuttle ? shuttle.getNetwork().catch(() => null) : Promise.resolve(null),
  ]);
  const fetchedAt = new Date().toISOString();
  const oneMapProvenance: Provenance = { source: 'OneMap PT routing (LTA GTFS schedule)', status: 'SCHEDULED', fetchedAt };
  const itineraries = dedupeItineraries(publicResult.itineraries, arriveBy);

  const routes: PlannedRoute[] = itineraries.map((it, i) => itineraryToRoute(it, i, arriveBy, oneMapProvenance));
  const warnings: string[] = [];
  if (publicResult.error) warnings.push(`Public transport routing unavailable (${publicResult.error})`);

  if (shuttle && network) {
    const shuttleRoutes = await planShuttleRoutes(shuttle, router, network, origin, destination, itineraries, oneMapProvenance, timeMode, target, now, arriveBy, notBeforeNow, warnings);
    routes.push(...shuttleRoutes);
  } else if (shuttle) {
    warnings.push('NUS shuttle data unavailable — routes without the shuttle are shown');
  }

  if (!routes.length) {
    if (publicResult.error && options.demoFallback) return snapshotResponse(base, publicResult.error);
    return {
      ...base,
      routes: [],
      status: publicResult.error ? 'UNAVAILABLE' : 'SCHEDULED',
      fetchedAt,
      warnings: [
        publicResult.error
          ? `This route could not be calculated — public transport routing unavailable (${publicResult.error})`
          : 'This route could not be calculated — no public transport or NUS shuttle option found',
        ...warnings.filter((w) => !w.startsWith('Public transport routing unavailable')),
      ],
    };
  }

  // "Arrive by": when some routes make it on time, hide the ones scheduled to arrive late.
  let candidates = routes;
  if (arriveBy && !base.arriveByPassed && routes.some((r) => !r.arrivesAfterClassStart)) {
    candidates = routes.filter((r) => !r.arrivesAfterClassStart);
    const hidden = routes.length - candidates.length;
    if (hidden) warnings.push(`${hidden} option${hidden === 1 ? '' : 's'} scheduled to arrive after your arrive-by time ${hidden === 1 ? 'is' : 'are'} hidden`);
  }

  // Drop shuttle routes that another route beats on every count, so the shuttle-first list never leads with
  // an option that is later, walks more and transfers more. Routes without the shuttle are never removed here.
  const beforeDominance = candidates.length;
  candidates = candidates.filter((r) => !r.nusShuttles.length || !candidates.some((other) => other !== r && dominates(other, r, Boolean(arriveBy))));
  const dominated = beforeDominance - candidates.length;
  if (dominated) {
    warnings.push(`${dominated} NUS shuttle option${dominated === 1 ? '' : 's'} hidden: another route is no slower, walks no more and has no more transfers`);
  }

  // Routes that use the NUS shuttle are listed first (and get their own quota so they are never crowded out);
  // within each group, routes are in arrival order. The client can re-sort.
  const byArrival = (a: PlannedRoute, b: PlannedRoute) => a.arrivalIso.localeCompare(b.arrivalIso) || a.departureIso.localeCompare(b.departureIso);
  const withShuttle = candidates.filter((r) => r.nusShuttles.length).sort(byArrival).slice(0, MAX_SHUTTLE_ROUTES);
  const without = candidates.filter((r) => !r.nusShuttles.length).sort(byArrival).slice(0, MAX_OTHER_ROUTES);
  const ordered = [...withShuttle, ...without].map((r, i) => ({ ...r, id: `route-${i}`, tags: [] }));
  applyNeutralTags(ordered);

  if (itineraries.length) warnings.push('Public transport legs use the scheduled timetable');
  if (base.arriveByPassed) warnings.unshift('Your arrive-by time has already passed — showing the next available departures');
  const anyLive = ordered.some((r) => r.provenance.some((p) => p.status === 'LIVE'));
  return { ...base, routes: ordered, status: anyLive ? 'LIVE' : 'SCHEDULED', fetchedAt, warnings };
}

/**
 * `a` is at least as good as `b` on time, walking and transfers, and strictly better on one of them.
 * Time means arrival (earlier is better), or in "Arrive by" mode departure (later is better).
 */
export function dominates(a: PlannedRoute, b: PlannedRoute, arriveByMode: boolean): boolean {
  const time = (r: PlannedRoute) => (arriveByMode ? -new Date(r.departureIso).getTime() : new Date(r.arrivalIso).getTime());
  const metrics = (r: PlannedRoute) => [time(r), r.walkSeconds, r.transfers];
  const [ma, mb] = [metrics(a), metrics(b)];
  return ma.every((v, i) => v <= mb[i]) && ma.some((v, i) => v < mb[i]);
}

async function planPublicTransport(
  router: Router,
  origin: GeoPoint,
  destination: GeoPoint,
  timeMode: TimeMode,
  target: Date,
  now: Date,
  arriveBy: Date | null,
  notBeforeNow: (ms: number) => Date,
): Promise<OneMapItinerary[]> {
  if (!arriveBy) return router(origin, destination, notBeforeNow(timeMode === 'NOW' ? now.getTime() : target.getTime()));

  const probeDeparture = notBeforeNow(arriveBy.getTime() - PROBE_LEAD_MS);
  const probe = await router(origin, destination, probeDeparture);
  if (!probe.length) return probe;
  const shortest = Math.min(...probe.map((it) => it.duration)) * 1000;
  const refinedDeparture = notBeforeNow(arriveBy.getTime() - shortest - ARRIVAL_MARGIN_MS);
  if (Math.abs(refinedDeparture.getTime() - probeDeparture.getTime()) <= 5 * 60 * 1000) return probe;
  try {
    // Keep both: the probe has earlier on-time trips, the refined query has the latest ones.
    return [...probe, ...(await router(origin, destination, refinedDeparture))];
  } catch {
    return probe; // still real scheduled itineraries
  }
}

async function planShuttleRoutes(
  shuttle: Shuttle,
  router: Router,
  network: IsbNetwork,
  origin: GeoPoint,
  destination: GeoPoint,
  itineraries: OneMapItinerary[],
  oneMapProvenance: Provenance,
  timeMode: TimeMode,
  target: Date,
  now: Date,
  arriveBy: Date | null,
  notBeforeNow: (ms: number) => Date,
  warnings: string[],
): Promise<PlannedRoute[]> {
  const startMs = (timeMode === 'NOW' ? now : arriveBy ? notBeforeNow(arriveBy.getTime() - PROBE_LEAD_MS) : notBeforeNow(target.getTime())).getTime();
  const sources = [originSource(origin, startMs), ...transferSources(itineraries, oneMapProvenance)];

  // Gateway hubs: ask OneMap for trips that end where the shuttle can take over (e.g. Kent Ridge MRT, UTown).
  const gateways = gatewayStops(network, origin, destination);
  if (gateways.length) {
    const shortestMs = itineraries.length ? Math.min(...itineraries.map((it) => it.duration)) * 1000 : 45 * 60 * 1000;
    const departAt = arriveBy
      ? notBeforeNow(arriveBy.getTime() - shortestMs - ARRIVAL_MARGIN_MS - GATEWAY_EXTRA_MARGIN_MS)
      : notBeforeNow(timeMode === 'NOW' ? now.getTime() : target.getTime());
    const results = await Promise.allSettled(gateways.map((g) => router(origin, { lat: g.lat, lon: g.lon }, departAt)));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') sources.push(...gatewaySources(dedupeItineraries(r.value, null).slice(0, 2), gateways[i], oneMapProvenance));
    });
  }

  const codes = boardingStopCodes(network, sources, destination);
  if (!codes.length) return [];

  const results = await Promise.allSettled(codes.map((code) => shuttle.getArrivals(code)));
  const arrivals = new Map(codes.map((code, i) => [code, results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<IsbStopArrivals>).value : null]));
  if ([...arrivals.values()].every((a) => a === null)) {
    warnings.push('NUS shuttle live data unavailable — routes without the shuttle are shown');
    return [];
  }

  let drafts = buildShuttleOptions(network, sources, destination, arrivals, arriveBy);

  // "Arrive by" for campus-only shuttle trips: re-plan the walk-to-stop start so the trip lands just before the target.
  if (arriveBy) {
    const campusOnly = drafts.filter((d) => !d.legs.some((l) => l.mode !== 'WALK' && l.mode !== 'NUS_SHUTTLE'));
    if (campusOnly.length) {
      const fastest = Math.min(...campusOnly.map((d) => d.arrivalMs - d.departureMs));
      const lateStart = notBeforeNow(arriveBy.getTime() - fastest - ARRIVAL_MARGIN_MS).getTime();
      const refined = buildShuttleOptions(network, [originSource(origin, lateStart)], destination, arrivals, arriveBy);
      drafts = [...drafts.filter((d) => !campusOnly.includes(d)), ...refined];
    }
  }
  return drafts.map((d, i) => assembleRoute({ ...d, index: 100 + i }));
}

/** Recorded real OneMap response, shown only in demo mode and labelled as not being the user's trip. */
function snapshotResponse(base: Base, reason: string): PlanResponse {
  const label = `DEMO SNAPSHOT — recorded ${snapshot.recordedAt.slice(0, 10)} for Clementi → COM1 (10:30 class), not your trip`;
  const provenance: Provenance = { source: 'Recorded OneMap response', status: 'CACHED', fetchedAt: snapshot.recordedAt, warningMessage: label };
  const its = snapshot.plan.itineraries as unknown as OneMapItinerary[];
  // Late-arrival flags are judged against the snapshot's own reference class, not the user's.
  const referenceClassStart = new Date(snapshot.referenceClassStart);
  const routes = applyNeutralTags(its.map((it, i) => itineraryToRoute(it, i, referenceClassStart, provenance)));
  return {
    ...base,
    routes,
    status: 'CACHED',
    fetchedAt: snapshot.recordedAt,
    warnings: [`Live public routing unavailable (${reason})`, label],
  };
}
