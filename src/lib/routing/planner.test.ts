import { describe, expect, it } from 'vitest';
import type { OneMapItinerary } from '@/lib/adapters/onemap';
import { planCommute } from './plan-commute';
import { applyNeutralTags, itineraryToRoute, TRANSFER_BUFFER_SECONDS } from './planner';
import { resolveVenue } from '@/lib/campus/venue-resolver';

const t = (iso: string) => new Date(iso).getTime();
const provenance = { source: 'test', status: 'SCHEDULED' as const, fetchedAt: '2026-10-14T00:00:00Z' };
const origin = { lat: 1.315, lon: 103.765 };
const dest = { lat: 1.2949, lon: 103.7737 };

function itinerary(startIso: string, legs: [string, string | undefined, number][]): OneMapItinerary {
  let cursor = t(startIso);
  const built = legs.map(([mode, route, seconds], i) => {
    const leg = { mode, route, startTime: cursor, endTime: cursor + seconds * 1000, duration: seconds, distance: seconds, from: { name: `P${i}` }, to: { name: `P${i + 1}` }, intermediateStops: [] };
    cursor += seconds * 1000;
    return leg;
  });
  const walk = legs.filter((l) => l[0] === 'WALK').reduce((s, l) => s + l[2], 0);
  return { duration: (cursor - t(startIso)) / 1000, startTime: t(startIso), endTime: cursor, walkTime: walk, transitTime: (cursor - t(startIso)) / 1000 - walk, waitingTime: 0, walkDistance: walk, transfers: Math.max(0, legs.filter((l) => l[0] !== 'WALK').length - 1), legs: built };
}

describe('itineraryToRoute', () => {
  const classStart = new Date('2026-10-14T02:00:00Z'); // 10:00 SGT

  it('keeps walking, riding and transfer buffer separate and widens the range', () => {
    const it0 = itinerary('2026-10-14T01:20:00Z', [['WALK', undefined, 300], ['BUS', '96', 900], ['SUBWAY', 'CC', 600], ['WALK', undefined, 300]]);
    const r = itineraryToRoute(it0, 0, classStart, provenance);
    expect(r.transfers).toBe(1);
    expect(r.transferBufferSeconds).toBe(TRANSFER_BUFFER_SECONDS);
    expect(r.walkSeconds).toBe(600);
    expect(r.publicServices).toEqual(['Bus 96', 'MRT/LRT CC']);
    expect(t(r.arrivalRange.earliestIso)).toBeLessThan(t(r.arrivalIso));
    expect(t(r.arrivalRange.latestIso)).toBeGreaterThan(t(r.arrivalIso) + TRANSFER_BUFFER_SECONDS * 1000);
    expect(r.crowding).toBe('Crowding information unavailable');
    expect(r.provenance[0].status).toBe('SCHEDULED');
  });

  it('flags scheduled arrivals after class start', () => {
    const late = itineraryToRoute(itinerary('2026-10-14T01:50:00Z', [['BUS', '96', 1200]]), 0, classStart, provenance);
    expect(late.arrivesAfterClassStart).toBe(true);
    expect(late.warnings[0]).toBe('Scheduled arrival is after your arrive-by time');
  });

  it('flags routes whose latest estimate is after class start', () => {
    const tight = itineraryToRoute(itinerary('2026-10-14T01:39:00Z', [['BUS', '96', 1200]]), 0, classStart, provenance);
    expect(tight.arrivesAfterClassStart).toBe(false);
    expect(tight.mayArriveAfterClassStart).toBe(true);
  });
});

describe('applyNeutralTags', () => {
  const classStart = new Date('2026-10-14T02:00:00Z');
  it('tags only metrics on which routes differ, never "best"', () => {
    const a = itineraryToRoute(itinerary('2026-10-14T01:00:00Z', [['WALK', undefined, 600], ['BUS', '96', 600]]), 0, classStart, provenance);
    const b = itineraryToRoute(itinerary('2026-10-14T01:00:00Z', [['WALK', undefined, 60], ['BUS', '95', 900], ['BUS', '151', 600]]), 1, classStart, provenance);
    applyNeutralTags([a, b]);
    expect(a.tags).toEqual(['Fastest by estimate', 'Fewest transfers']);
    expect(b.tags).toEqual(['Least walking']);
  });
});

describe('planCommute', () => {
  const now = new Date('2026-10-14T00:00:00Z'); // 08:00 SGT
  const classStart = new Date('2026-10-14T02:00:00Z'); // 10:00 SGT

  it('probes then re-queries so itineraries land just before class', async () => {
    const calls: Date[] = [];
    const router = async (_o: unknown, _d: unknown, departAt: Date) => {
      calls.push(departAt);
      return [itinerary(departAt.toISOString(), [['WALK', undefined, 120], ['BUS', '96', 1080]])];
    };
    const plan = await planCommute(origin, dest, 'ARRIVE_BY', classStart, { shuttle: null, now, router });
    expect(calls.map((d) => d.toISOString())).toEqual(['2026-10-14T00:30:00.000Z', '2026-10-14T01:30:00.000Z']);
    expect(plan.status).toBe('SCHEDULED');
    expect(plan.routes[0].arrivalIso).toBe('2026-10-14T01:50:00.000Z');
    expect(plan.arriveByPassed).toBe(false);
  });

  it('never departs in the past and flags a class already in progress', async () => {
    const calls: Date[] = [];
    const router = async (_o: unknown, _d: unknown, departAt: Date) => {
      calls.push(departAt);
      return [itinerary(departAt.toISOString(), [['BUS', '96', 1200]])];
    };
    const plan = await planCommute(origin, dest, 'ARRIVE_BY', new Date('2026-10-13T23:30:00Z'), { shuttle: null, now, router });
    expect(calls[0].toISOString()).toBe(now.toISOString());
    expect(plan.arriveByPassed).toBe(true);
    expect(plan.routes[0].arrivesAfterClassStart).toBe(true);
  });

  it('reports an unavailable route instead of inventing one when routing fails', async () => {
    const router = async () => {
      throw new Error('OneMap routing failed (504)');
    };
    const plan = await planCommute(origin, dest, 'ARRIVE_BY', classStart, { shuttle: null, now, router });
    expect(plan.routes).toEqual([]);
    expect(plan.status).toBe('UNAVAILABLE');
    expect(plan.warnings[0]).toMatch(/^This route could not be calculated/);
  });

  it('labels the recorded snapshot clearly in demo mode', async () => {
    const router = async () => {
      throw new Error('timeout');
    };
    const plan = await planCommute(origin, dest, 'ARRIVE_BY', classStart, { shuttle: null, now, router, demoFallback: true });
    expect(plan.status).toBe('CACHED');
    expect(plan.routes.length).toBeGreaterThan(0);
    expect(plan.routes.every((r) => r.warnings.some((w) => w.startsWith('DEMO SNAPSHOT')))).toBe(true);
  });

  it('reports no route found', async () => {
    const plan = await planCommute(origin, dest, 'ARRIVE_BY', classStart, { shuttle: null, now, router: async () => [] });
    expect(plan.routes).toEqual([]);
    expect(plan.warnings[0]).toMatch(/could not be calculated/);
  });
});

describe('resolveVenue', () => {
  it('resolves rooms to NUSMods coordinates', () => {
    expect(resolveVenue('com1-0212')).toMatchObject({ status: 'RESOLVED', venueCode: 'COM1-0212', buildingCode: 'COM1' });
    expect(resolveVenue('LT17').status).toBe('RESOLVED');
  });
  it('distinguishes online and unknown venues', () => {
    expect(resolveVenue('E-Learn_C').status).toBe('ONLINE');
    expect(resolveVenue('XYZ-9999').status).toBe('UNKNOWN');
    expect(resolveVenue('').status).toBe('UNKNOWN');
  });
});

describe('depart modes', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  const router = (calls: Date[]) => async (_o: unknown, _d: unknown, departAt: Date) => {
    calls.push(departAt);
    return [itinerary(departAt.toISOString(), [['BUS', '96', 1200]])];
  };

  it('Leave now queries once from the current time with no late flags', async () => {
    const calls: Date[] = [];
    const plan = await planCommute(origin, dest, 'NOW', new Date('2000-01-01T00:00:00Z'), { shuttle: null, now, router: router(calls) });
    expect(calls.map((d) => d.toISOString())).toEqual([now.toISOString()]);
    expect(plan.targetIso).toBe(now.toISOString());
    expect(plan.arriveByPassed).toBe(false);
    expect(plan.routes[0].arrivesAfterClassStart).toBe(false);
    expect(plan.routes[0].mayArriveAfterClassStart).toBe(false);
  });

  it('Depart at queries once at the chosen time', async () => {
    const calls: Date[] = [];
    await planCommute(origin, dest, 'DEPART_AT', new Date('2026-10-14T03:00:00Z'), { shuttle: null, now, router: router(calls) });
    expect(calls.map((d) => d.toISOString())).toEqual(['2026-10-14T03:00:00.000Z']);
  });
});

describe('route geometry', () => {
  it('decodes OneMap leg geometry into [lon, lat] paths and uses stop coordinates', async () => {
    const { decodePolyline } = await import('./polyline');
    // Reference example from Google's polyline algorithm documentation.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);

    const it0 = itinerary('2026-10-14T01:00:00Z', [['BUS', '96', 600]]);
    it0.legs[0].from = { name: 'CLEMENTI INT', stopCode: '17009', lat: 1.3149, lon: 103.7641 };
    it0.legs[0].to = { name: 'IT', stopCode: '16189', lat: 1.2973, lon: 103.7725 };
    const leg = itineraryToRoute(it0, 0, null, provenance).legs[0];
    expect(leg.fromCoords).toEqual([103.7641, 1.3149]);
    expect(leg.path).toEqual([
      [103.7641, 1.3149],
      [103.7725, 1.2973],
    ]);
  });

  it('the recorded snapshot carries real geometry for every leg', async () => {
    const plan = await planCommute(origin, dest, 'NOW', new Date(), { shuttle: null, router: async () => Promise.reject(new Error('down')), demoFallback: true });
    for (const route of plan.routes) for (const leg of route.legs) expect(leg.path.length).toBeGreaterThan(1);
  });
});

describe('searchVenues', () => {
  it('finds NUS rooms by code prefix and by name', async () => {
    const { searchVenues } = await import('@/lib/campus/venue-resolver');
    expect(searchVenues('LT17')[0].venueCode).toBe('LT17');
    expect(searchVenues('com1-02').every((v) => v.venueCode.startsWith('COM1-02'))).toBe(true);
    expect(searchVenues('lecture theatre 27').map((v) => v.venueCode)).toContain('LT27');
    expect(searchVenues('x')).toEqual([]);
  });
});

describe('arrive-by filtering', () => {
  it('merges probe and refined itineraries and hides late ones when on-time options exist', async () => {
    const now = new Date('2026-10-14T00:00:00Z');
    const classStart = new Date('2026-10-14T02:00:00Z'); // 10:00 SGT
    let call = 0;
    const router = async (_o: unknown, _d: unknown, departAt: Date) => {
      call++;
      // probe (08:30): an early on-time trip; refined: one on time, one late
      return call === 1
        ? [itinerary(departAt.toISOString(), [['BUS', '95', 1200]])]
        : [itinerary('2026-10-14T01:35:00Z', [['BUS', '96', 1200]]), itinerary('2026-10-14T01:50:00Z', [['BUS', '183', 1200]])];
    };
    const plan = await planCommute(origin, dest, 'ARRIVE_BY', classStart, { shuttle: null, now, router });
    expect(plan.routes.map((r) => r.summary).sort()).toEqual(['Bus 95', 'Bus 96']);
    expect(plan.warnings).toContain('1 option scheduled to arrive after your arrive-by time is hidden');
  });
});

describe('dominates', () => {
  it('requires being no worse on time, walking and transfers, and better on one', async () => {
    const { dominates } = await import('./plan-commute');
    const mk = (start: string, legs: [string, string | undefined, number][]) => itineraryToRoute(itinerary(start, legs), 0, null, provenance);
    const busOnly = mk('2026-10-14T01:00:00Z', [['WALK', undefined, 600], ['BUS', '96', 900]]);
    const slowerMoreWalk = mk('2026-10-14T01:00:00Z', [['WALK', undefined, 900], ['BUS', '96', 900], ['BUS', '95', 300]]);
    const lessWalk = mk('2026-10-14T01:00:00Z', [['WALK', undefined, 60], ['BUS', '96', 900], ['BUS', '95', 900]]);
    expect(dominates(busOnly, slowerMoreWalk, false)).toBe(true);
    expect(dominates(busOnly, lessWalk, false)).toBe(false); // lessWalk walks less, so it stays
    expect(dominates(busOnly, busOnly, false)).toBe(false);
  });
});
