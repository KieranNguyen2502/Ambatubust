import { NextResponse } from 'next/server';
import { getShuttleBuses } from '@/lib/adapters/shuttle';

/** Estimated NUS shuttle positions (dead reckoning by the proxy, not GPS). Optional `?line=A1` filter. */
export async function GET(request: Request) {
  const line = new URL(request.url).searchParams.get('line');
  try {
    const data = await getShuttleBuses();
    const buses = line ? data.buses.filter((b) => b.line === line) : data.buses;
    return NextResponse.json({
      buses,
      provenance: {
        source: 'NUS shuttle via nus-transit-cache (unofficial)',
        status: data.stale ? 'CACHED' : 'ESTIMATED',
        fetchedAt: data.asOf,
        warningMessage: 'Bus positions are estimated from arrival countdowns, not live GPS',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { buses: [], error: error instanceof Error ? error.message : 'NUS shuttle data unavailable', provenance: { status: 'UNAVAILABLE', fetchedAt: null } },
      { status: 503 },
    );
  }
}
