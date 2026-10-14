// LTA DataMall v3 (official, Land Transport Authority). Singapore Open Data Licence; key stays server-side.
import { env } from '@/lib/config/env';

export type LtaLoad = 'SEA' | 'SDA' | 'LSD';
export type LtaArrival = {
  serviceNo: string;
  estimatedArrival: string | null;
  load: LtaLoad | null;
  monitored: boolean; // true = LTA is GPS-tracking this bus; false = estimate from schedule
  vehicleType: string | null;
  lat: number | null; // live bus position, only when monitored
  lon: number | null;
};

type LtaBus = { EstimatedArrival?: string; Load?: string; Monitored?: number | string; Type?: string; Latitude?: string; Longitude?: string };
type LtaService = { ServiceNo: string; NextBus?: LtaBus; NextBus2?: LtaBus; NextBus3?: LtaBus };

const LOADS: LtaLoad[] = ['SEA', 'SDA', 'LSD'];

export async function getBusArrivals(stopCode: string, serviceNo?: string): Promise<LtaArrival[]> {
  if (!env.ltaKey) throw new Error('LTA DataMall is not configured (set LTA_ACCOUNT_KEY)');
  const qs = new URLSearchParams({ BusStopCode: stopCode });
  if (serviceNo) qs.set('ServiceNo', serviceNo);
  const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?${qs}`, {
    headers: { AccountKey: env.ltaKey, accept: 'application/json' },
    signal: AbortSignal.timeout(4000),
    cache: 'no-store', // live arrivals: never serve a stale cached copy
  });
  if (!res.ok) throw new Error(`LTA request failed (${res.status})`);
  const json = await res.json();
  return ((json.Services ?? []) as LtaService[]).flatMap((s) =>
    [s.NextBus, s.NextBus2, s.NextBus3]
      .filter((b): b is LtaBus => Boolean(b?.EstimatedArrival))
      .map((b) => {
        const lat = Number(b.Latitude);
        const lon = Number(b.Longitude);
        const hasPosition = Number(b.Monitored) === 1 && lat > 1 && lon > 103;
        return {
          serviceNo: s.ServiceNo,
          estimatedArrival: b.EstimatedArrival || null,
          load: LOADS.includes(b.Load as LtaLoad) ? (b.Load as LtaLoad) : null,
          // DataMall v3 returns Monitored as a number (0/1); Number() also tolerates the string form.
          monitored: Number(b.Monitored) === 1,
          vehicleType: b.Type || null,
          lat: hasPosition ? lat : null,
          lon: hasPosition ? lon : null,
        };
      }),
  );
}
