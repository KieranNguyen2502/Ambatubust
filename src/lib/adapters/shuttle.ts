// NUS Internal Shuttle Bus (ISB) data via the team's `nus-transit-cache` proxy (NUS_SHUTTLE_API_BASE_URL).
// Classification: unofficial. The proxy sits in front of a community NUS shuttle web app, which reads the
// NUS shuttle backend. There is no public NUS API and no live GPS feed:
// - stop arrival countdowns are upstream data (treated as LIVE),
// - bus positions are dead-reckoned estimates with an `errorBoundM` (always shown as estimated),
// - segment times are medians the proxy learned from observed countdowns.
// Everything falls back to the bundled snapshot in src/data/nus-isb-network.json.
import { env } from '@/lib/config/env';
import snapshot from '@/data/nus-isb-network.json';

export type IsbStop = { code: string; name: string; lat: number; lon: number };
export type IsbLine = { line: string; lengthM: number; closed: boolean; stops: { code: string; arcM: number }[]; path: [number, number][] };
export type IsbNetwork = {
  stops: IsbStop[];
  lines: IsbLine[];
  segmentMinutes: Record<string, number>; // "A1|k" = median minutes from stop seq k-1 to seq k
  source: 'LIVE' | 'CACHED';
  fetchedAt: string;
};
export type IsbArrival = { line: string; etaIso: string; plate: string | null; ridership: number | null; capacity: number | null };
export type IsbStopArrivals = { stopCode: string; lastUpdated: string; arrivals: IsbArrival[] };
export type IsbBus = {
  line: string;
  plate: string;
  lat: number;
  lon: number;
  bearing: number;
  errorBoundM: number;
  anchorStop: string;
  anchorEtaMin: number;
  ridership: number | null;
  capacity: number | null;
};

const TIMEOUT_MS = 2500;
const base = () => env.shuttleBaseUrl.replace(/\/$/, '');

/**
 * `revalidate: 0` bypasses the Next.js data cache. Live countdowns and positions must not use it: on the first
 * request after the window expires Next serves the stale copy while refreshing in the background.
 * The proxy already caches upstream (5–15 s).
 */
async function getJson(path: string, revalidate: number) {
  if (!env.shuttleBaseUrl) throw new Error('NUS shuttle API is not configured (set NUS_SHUTTLE_API_BASE_URL)');
  const init = revalidate > 0 ? { next: { revalidate } } : { cache: 'no-store' as const };
  const res = await fetch(`${base()}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  if (!res.ok) throw new Error(`NUS shuttle request failed (${res.status})`);
  return res.json();
}

const snapshotNetwork = (): IsbNetwork => ({
  stops: snapshot.stops,
  lines: snapshot.lines as IsbLine[],
  segmentMinutes: snapshot.segmentMinutes,
  source: 'CACHED',
  fetchedAt: snapshot.retrievedAt,
});

/** Stops, line geometry and learned segment times. Never throws: falls back to the bundled snapshot. */
export async function getIsbNetwork(): Promise<IsbNetwork> {
  try {
    const [stops, routes, debug] = await Promise.all([
      getJson('/api/transit/stops', 3600),
      getJson('/api/transit/routes', 3600),
      getJson('/api/transit/debug', 300).catch(() => null),
    ]);
    type StopFeature = { properties: { name: string; LongName?: string; caption?: string; latitude: number; longitude: number } };
    type RouteFeature = { properties: { route: string; length_m: number; closed: boolean; stops: { code: string; arc_m: number }[] }; geometry: { coordinates: [number, number][] } };
    const segmentMinutes: Record<string, number> = { ...snapshot.segmentMinutes };
    for (const [key, value] of Object.entries((debug?.learnedTau ?? {}) as Record<string, { median?: number }>)) {
      if (typeof value.median === 'number' && Number.isFinite(value.median)) segmentMinutes[key] = value.median;
    }
    return {
      stops: (stops.features as StopFeature[]).map((f) => ({
        code: f.properties.name,
        name: f.properties.LongName || f.properties.caption || f.properties.name,
        lat: f.properties.latitude,
        lon: f.properties.longitude,
      })),
      lines: (routes.features as RouteFeature[]).map((f) => ({
        line: f.properties.route,
        lengthM: f.properties.length_m,
        closed: f.properties.closed,
        stops: f.properties.stops.map((s) => ({ code: s.code, arcM: s.arc_m })),
        path: f.geometry.coordinates,
      })),
      segmentMinutes,
      source: 'LIVE',
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return snapshotNetwork();
  }
}

type RawTiming = {
  name: string;
  arrivalTime?: string;
  nextArrivalTime?: string;
  arrivalTime_veh_plate?: string;
  nextArrivalTime_veh_plate?: string;
  arrivalTime_ridership?: number;
  arrivalTime_capacity?: number;
  nextArrivalTime_ridership?: number;
  nextArrivalTime_capacity?: number;
};

/**
 * Upcoming buses at a stop. Countdowns are whole minutes relative to `lastUpdated`
 * (the `_ts` fields upstream are trip timestamps, not arrival times, so they are ignored).
 */
export async function getShuttleArrivals(stopCode: string): Promise<IsbStopArrivals> {
  const json = await getJson(`/api/stop/${encodeURIComponent(stopCode)}`, 0);
  const etas = json?.etas;
  if (!etas || !Array.isArray(etas.timings)) throw new Error('NUS shuttle returned no arrival data');
  const updated = new Date(etas.lastUpdated);
  if (Number.isNaN(updated.getTime())) throw new Error('NUS shuttle returned an invalid timestamp');

  const arrivals: IsbArrival[] = [];
  for (const t of etas.timings as RawTiming[]) {
    const entries = [
      [t.arrivalTime, t.arrivalTime_veh_plate, t.arrivalTime_ridership, t.arrivalTime_capacity],
      [t.nextArrivalTime, t.nextArrivalTime_veh_plate, t.nextArrivalTime_ridership, t.nextArrivalTime_capacity],
    ] as const;
    for (const [minutes, plate, ridership, capacity] of entries) {
      if (!/^\d+$/.test(String(minutes ?? ''))) continue; // "-" means no bus reported
      arrivals.push({
        line: t.name,
        etaIso: new Date(updated.getTime() + Number(minutes) * 60_000).toISOString(),
        plate: plate || null,
        ridership: typeof ridership === 'number' ? ridership : null,
        capacity: typeof capacity === 'number' ? capacity : null,
      });
    }
  }
  arrivals.sort((a, b) => a.etaIso.localeCompare(b.etaIso));
  return { stopCode: etas.busStopName ?? stopCode, lastUpdated: updated.toISOString(), arrivals };
}

/** Dead-reckoned bus positions. These are estimates, not GPS. */
export async function getShuttleBuses(): Promise<{ asOf: string; stale: boolean; buses: IsbBus[] }> {
  const json = await getJson('/api/transit/buses', 0);
  type RawBus = { route: string; plate: string; lat: number; lng: number; bearing: number; errorBoundM: number; anchorStop: string; anchorEtaMin: number; occupancy?: { ridership: number | null; capacity: number | null } };
  return {
    asOf: json.asOf,
    stale: Boolean(json.stale),
    buses: ((json.buses ?? []) as RawBus[])
      .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng))
      .map((b) => ({
        line: b.route,
        plate: b.plate,
        lat: b.lat,
        lon: b.lng,
        bearing: b.bearing,
        errorBoundM: b.errorBoundM,
        anchorStop: b.anchorStop,
        anchorEtaMin: b.anchorEtaMin,
        ridership: b.occupancy?.ridership ?? null,
        capacity: b.occupancy?.capacity ?? null,
      })),
  };
}
