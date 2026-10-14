import { describe, expect, it } from 'vitest';
import snapshot from '@/data/nus-isb-network.json';
import type { IsbArrival, IsbLine, IsbNetwork, IsbStopArrivals } from '@/lib/adapters/shuttle';
import type { OneMapItinerary } from '@/lib/adapters/onemap';
import { isbRide, isbWait, slicePath } from './isb';
import { planCommute } from './plan-commute';

const network: IsbNetwork = {
  stops: snapshot.stops,
  lines: snapshot.lines as IsbLine[],
  segmentMinutes: snapshot.segmentMinutes,
  source: 'LIVE',
  fetchedAt: '2026-10-14T08:00:00.000Z',
};
const line = (code: string) => network.lines.find((l) => l.line === code)!;
const stop = (code: string) => network.stops.find((s) => s.code === code)!;
const minutesOf = (l: string, keys: number[]) => keys.reduce((s, k) => s + network.segmentMinutes[`${l}|${k}`], 0);

const NOW = new Date('2026-10-14T08:00:00.000Z'); // 16:00 SGT
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();
const arrival = (l: string, min: number, ridership: number | null = null): IsbArrival => ({ line: l, etaIso: at(min), plate: 'PX1', ridership, capacity: ridership === null ? null : 88 });

describe('isbRide', () => {
  it('sums learned segment times along a line in travel order', () => {
    const ride = isbRide(network, line('A1'), 'KR-MRT', 'YIH')!; // A1 seq 6 → 10
    expect(ride.stopCount).toBe(4);
    expect(ride.seconds).toBe(minutesOf('A1', [7, 8, 9, 10]) * 60);
    expect(ride.path.length).toBeGreaterThan(2);
  });

  it('wraps past the terminal on loop lines', () => {
    const ride = isbRide(network, line('A1'), 'CLB', 'LT13')!; // CLB → KRB → LT13
    expect(ride.stopCount).toBe(2);
    expect(ride.seconds).toBe(minutesOf('A1', [12, 1]) * 60);
  });

  it('does not run open lines backwards', () => {
    expect(isbRide(network, line('K'), 'S17', 'PGP')).toBeNull(); // K ends at PGPR, PGP is its first stop
    expect(isbRide(network, line('A1'), 'KR-MRT', 'COM3')).toBeNull(); // not on A1
  });

  it('slices the route geometry between arc positions', () => {
    const path = slicePath(line('A1'), 0, 500);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[0]).toEqual(line('A1').path[0]);
  });
});

describe('isbWait', () => {
  const reach = NOW.getTime() + 3 * 60_000;

  it('uses the live countdown when the stop is reached before the bus', () => {
    const w = isbWait([arrival('D1', 5), arrival('D1', 14)], 'D1', reach)!;
    expect(w).toMatchObject({ seconds: 120, low: 60, high: 120, status: 'LIVE' });
  });

  it('extends the upper bound to the next bus when the connection is tight', () => {
    const w = isbWait([arrival('D1', 3.5), arrival('D1', 12)], 'D1', reach)!;
    expect(w.seconds).toBe(30);
    expect(w.high).toBe(9 * 60 - 30);
  });

  it('estimates from the current headway beyond the live horizon, labelled ESTIMATED', () => {
    const w = isbWait([arrival('D1', 2), arrival('D1', 12)], 'D1', NOW.getTime() + 60 * 60_000)!;
    expect(w).toMatchObject({ seconds: 300, low: 300, high: 300, status: 'ESTIMATED' });
  });

  it('returns null rather than inventing a wait when no bus is reported', () => {
    expect(isbWait([arrival('A1', 2)], 'D1', reach)).toBeNull();
    expect(isbWait([arrival('D1', 2)], 'D1', NOW.getTime() + 60 * 60_000)).toBeNull(); // one bus: no headway
  });
});

describe('planCommute with NUS shuttles', () => {
  const utown = stop('UTOWN');
  const com3 = stop('COM3');
  const origin = { lat: utown.lat + 0.0005, lon: utown.lon }; // ~55 m from UTown stop
  const destination = { lat: com3.lat, lon: com3.lon + 0.0004 };
  const shuttleWith = (byStop: Record<string, IsbArrival[]>, fail = false) => ({
    getNetwork: async () => network,
    getArrivals: async (code: string): Promise<IsbStopArrivals> => {
      if (fail) throw new Error('proxy down');
      return { stopCode: code, lastUpdated: NOW.toISOString(), arrivals: byStop[code] ?? [] };
    },
  });

  it('builds a campus-only shuttle trip with live wait, reported ridership and provenance', async () => {
    const plan = await planCommute(origin, destination, 'NOW', NOW, {
      now: NOW,
      router: async () => [],
      shuttle: shuttleWith({ UTOWN: [arrival('D1', 5, 24), arrival('D1', 14)] }),
    });
    expect(plan.routes).toHaveLength(1);
    const r = plan.routes[0];
    expect(r.nusShuttles).toEqual(['ISB D1']);
    expect(r.legs.map((l) => l.mode)).toEqual(['WALK', 'NUS_SHUTTLE', 'WALK']);
    expect(r.legs[1].departureIso).toBe(at(5));
    expect(r.legs[1].durationSeconds).toBe(minutesOf('D1', [8, 9, 10, 11, 12, 13]) * 60);
    expect(r.provenance.some((p) => p.status === 'LIVE')).toBe(true);
    expect(r.crowding).toContain('24/88 riders reported');
    expect(r.warnings.some((w) => w.startsWith('ISB D1 wait from live countdown'))).toBe(true);
    expect(plan.status).toBe('LIVE');
  });

  it('does not offer a shuttle that has no reported buses', async () => {
    const plan = await planCommute(origin, destination, 'NOW', NOW, { now: NOW, router: async () => [], shuttle: shuttleWith({ UTOWN: [] }) });
    expect(plan.routes).toEqual([]);
    expect(plan.warnings[0]).toMatch(/could not be calculated/);
  });

  it('stitches a shuttle onto a public transport trip when it shortens the walk', async () => {
    const kr = stop('KR-MRT');
    const start = NOW.getTime();
    const it: OneMapItinerary = {
      duration: 2400,
      startTime: start,
      endTime: start + 2400_000,
      walkTime: 1500,
      transitTime: 900,
      waitingTime: 0,
      walkDistance: 1800,
      transfers: 0,
      legs: [
        { mode: 'BUS', route: '96', startTime: start, endTime: start + 900_000, duration: 900, distance: 4000, from: { name: 'Clementi Int', lat: 1.3149, lon: 103.7641 }, to: { name: 'Kent Ridge Stn', lat: kr.lat, lon: kr.lon } },
        { mode: 'WALK', startTime: start + 900_000, endTime: start + 2400_000, duration: 1500, distance: 1800, from: { name: 'Kent Ridge Stn', lat: kr.lat, lon: kr.lon }, to: { name: 'Destination', lat: destination.lat, lon: destination.lon } },
      ],
    };
    const plan = await planCommute({ lat: 1.3149, lon: 103.7641 }, destination, 'NOW', NOW, {
      now: NOW,
      router: async () => [it],
      shuttle: shuttleWith({ 'KR-MRT': [arrival('D2', 17), arrival('D2', 26)] }),
    });
    const hybrid = plan.routes.find((r) => r.nusShuttles.length)!;
    expect(hybrid.publicServices).toEqual(['Bus 96']);
    expect(hybrid.nusShuttles).toEqual(['ISB D2']);
    expect(hybrid.walkSeconds).toBeLessThan(1500);
    expect(hybrid.transfers).toBe(1);
    expect(hybrid.provenance.map((p) => p.status)).toEqual(['SCHEDULED', 'LIVE']);
    expect(plan.routes.find((r) => !r.nusShuttles.length)).toBeDefined(); // the original trip stays as an option
  });

  it('keeps public transport routes and says so when the shuttle proxy is down', async () => {
    const kr = stop('KR-MRT');
    const it: OneMapItinerary = {
      duration: 600, startTime: NOW.getTime(), endTime: NOW.getTime() + 600_000, walkTime: 0, transitTime: 600, waitingTime: 0, walkDistance: 0, transfers: 0,
      legs: [{ mode: 'BUS', route: '96', startTime: NOW.getTime(), endTime: NOW.getTime() + 600_000, duration: 600, distance: 3000, from: { name: 'A', lat: 1.3149, lon: 103.7641 }, to: { name: 'Kent Ridge Stn', lat: kr.lat, lon: kr.lon } }],
    };
    const plan = await planCommute(origin, destination, 'NOW', NOW, { now: NOW, router: async () => [it], shuttle: shuttleWith({}, true) });
    expect(plan.routes).toHaveLength(1);
    expect(plan.warnings).toContain('NUS shuttle live data unavailable — routes without the shuttle are shown');
  });
});

describe('arrive-by with campus-only shuttle trips', () => {
  it('starts later so the trip lands just before the target', async () => {
    const kr = stop('KR-MRT');
    const utown = stop('UTOWN');
    const arriveBy = new Date(NOW.getTime() + 40 * 60_000);
    const plan = await planCommute({ lat: kr.lat + 0.0005, lon: kr.lon }, { lat: utown.lat, lon: utown.lon + 0.0004 }, 'ARRIVE_BY', arriveBy, {
      now: NOW,
      router: async () => [],
      shuttle: {
        getNetwork: async () => network,
        getArrivals: async (code: string) => ({ stopCode: code, lastUpdated: NOW.toISOString(), arrivals: code === 'KR-MRT' ? [arrival('D2', 2), arrival('D2', 11)] : [] }),
      },
    });
    expect(plan.routes).toHaveLength(1);
    const r = plan.routes[0];
    expect(new Date(r.departureIso).getTime()).toBeGreaterThan(NOW.getTime()); // not "leave now"
    expect(r.arrivesAfterClassStart).toBe(false);
    expect(arriveBy.getTime() - new Date(r.arrivalIso).getTime()).toBeLessThanOrEqual(15 * 60_000);
  });
});

describe('gateway hubs and shuttle-first ordering', () => {
  const utown = stop('UTOWN');
  const destination = { lat: utown.lat, lon: utown.lon + 0.0004 };
  const clementi = { lat: 1.3119, lon: 103.767 };
  const everyLine = (code: string): IsbStopArrivals => ({
    stopCode: code,
    lastUpdated: NOW.toISOString(),
    arrivals: network.lines.flatMap((l) => [arrival(l.line, 30), arrival(l.line, 39)]),
  });
  // A bus straight to wherever OneMap is asked to go; the trip to the class itself ends with a long walk.
  const router = async (o: { lat: number; lon: number }, d: { lat: number; lon: number }, departAt: Date): Promise<OneMapItinerary[]> => {
    const toClass = d.lat === destination.lat && d.lon === destination.lon;
    const t0 = departAt.getTime();
    const busEnd = t0 + 15 * 60_000;
    const legs: OneMapItinerary['legs'] = [
      { mode: 'BUS', route: toClass ? '96' : '999', startTime: t0, endTime: busEnd, duration: 900, distance: 4000, from: { name: 'Start', lat: o.lat, lon: o.lon }, to: { name: toClass ? 'Far stop' : 'Gateway', lat: toClass ? 1.3 : d.lat, lon: toClass ? 103.79 : d.lon } },
    ];
    if (toClass) legs.push({ mode: 'WALK', startTime: busEnd, endTime: busEnd + 20 * 60_000, duration: 1200, distance: 1500, from: { name: 'Far stop', lat: 1.3, lon: 103.79 }, to: { name: 'Destination', lat: d.lat, lon: d.lon } });
    const end = legs[legs.length - 1].endTime;
    return [{ duration: (end - t0) / 1000, startTime: t0, endTime: end, walkTime: toClass ? 1200 : 0, transitTime: 900, waitingTime: 0, walkDistance: toClass ? 1500 : 0, transfers: 0, legs }];
  };

  it('routes to a gateway hub on purpose and continues by shuttle', async () => {
    const asked: string[] = [];
    const plan = await planCommute(clementi, destination, 'NOW', NOW, {
      now: NOW,
      router: async (o, d, t) => {
        asked.push(`${d.lat},${d.lon}`);
        return router(o, d, t);
      },
      shuttle: { getNetwork: async () => network, getArrivals: async (code) => everyLine(code) },
    });
    expect(asked.length).toBeGreaterThan(1); // main query + gateway queries
    const viaGateway = plan.routes.find((r) => r.publicServices.includes('Bus 999') && r.nusShuttles.length);
    expect(viaGateway).toBeDefined();
    expect(viaGateway!.legs.some((l) => l.mode === 'NUS_SHUTTLE')).toBe(true);
  });

  it('lists routes with the NUS shuttle before the others, even if they arrive later', async () => {
    const plan = await planCommute(clementi, destination, 'NOW', NOW, {
      now: NOW,
      router,
      shuttle: { getNetwork: async () => network, getArrivals: async (code) => everyLine(code) },
    });
    const firstWithout = plan.routes.findIndex((r) => !r.nusShuttles.length);
    const lastWith = plan.routes.map((r) => r.nusShuttles.length > 0).lastIndexOf(true);
    expect(lastWith).toBeGreaterThanOrEqual(0);
    expect(firstWithout).toBeGreaterThan(lastWith);
    expect(plan.routes.some((r) => !r.nusShuttles.length)).toBe(true); // bus-only routes are still shown
    expect(plan.routes.flatMap((r) => r.tags).every((t) => !/best|recommend|optimal/i.test(t))).toBe(true);
  });
});
