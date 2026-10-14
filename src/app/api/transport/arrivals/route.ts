import { NextResponse } from 'next/server';
import { getBusArrivals } from '@/lib/adapters/lta';
import { getShuttleArrivals } from '@/lib/adapters/shuttle';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const network = params.get('network') === 'shuttle' ? 'shuttle' : 'lta';
  const stop = params.get('stop')?.trim() ?? '';

  if (network === 'lta' && !/^\d{5}$/.test(stop)) {
    return NextResponse.json({ arrivals: [], error: 'stop must be a 5-digit LTA bus stop code' }, { status: 400 });
  }
  if (network === 'shuttle' && !stop) {
    return NextResponse.json({ arrivals: [], error: 'stop is required' }, { status: 400 });
  }

  const source = network === 'shuttle' ? 'NUS shuttle via nus-transit-cache (unofficial)' : 'LTA DataMall v3';
  try {
    if (network === 'shuttle') {
      const data = await getShuttleArrivals(stop);
      const line = params.get('service');
      const arrivals = line ? data.arrivals.filter((a) => a.line === line) : data.arrivals;
      return NextResponse.json({ arrivals, provenance: { source, status: 'LIVE', fetchedAt: data.lastUpdated } });
    }
    const arrivals = await getBusArrivals(stop, params.get('service') ?? undefined);
    return NextResponse.json({ arrivals, provenance: { source, status: 'LIVE', fetchedAt: new Date().toISOString() } });
  } catch (error) {
    return NextResponse.json(
      {
        arrivals: [],
        error: error instanceof Error ? error.message : 'Live arrival data unavailable',
        provenance: { source, status: 'UNAVAILABLE', fetchedAt: null, warningMessage: 'Live arrival data unavailable' },
      },
      { status: 503 },
    );
  }
}
