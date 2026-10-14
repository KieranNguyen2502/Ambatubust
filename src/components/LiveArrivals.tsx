'use client';

import { useEffect, useState } from 'react';
import type { PlannedRoute } from '@/types/commute';
import type { LiveBus } from '@/components/map-style';
import { formatSgtTime } from '@/lib/time';

type Arrival = { serviceNo: string; estimatedArrival: string | null; load: 'SEA' | 'SDA' | 'LSD' | null; monitored: boolean; lat: number | null; lon: number | null };

const LOAD_LABEL = { SEA: 'Seats available', SDA: 'Standing available', LSD: 'Limited standing' } as const;
const REFRESH_MS = 30_000;

/** Live LTA arrivals at the first bus stop of a route. These are the next buses right now, not a prediction. */
export function LiveArrivals({ route, onBuses }: { route: PlannedRoute; onBuses: (buses: LiveBus[]) => void }) {
  const leg = route.legs.find((l) => l.mode === 'BUS' && l.fromStopCode && /^\d{5}$/.test(l.fromStopCode));
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState('');

  const stop = leg?.fromStopCode;
  const service = leg?.service;

  useEffect(() => {
    if (!stop || !service) {
      onBuses([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await fetch(`/api/transport/arrivals?stop=${stop}&service=${encodeURIComponent(service)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error);
        const list = (data.arrivals ?? []) as Arrival[];
        setArrivals(list);
        setFetchedAt(data.provenance?.fetchedAt ?? new Date().toISOString());
        setError('');
        onBuses(
          list
            .filter((a) => a.lat !== null && a.lon !== null && a.estimatedArrival)
            .map((a) => ({ kind: 'LTA' as const, serviceNo: a.serviceNo, lat: a.lat!, lon: a.lon!, minutes: minutesUntil(a.estimatedArrival!) })),
        );
      } catch {
        if (cancelled) return;
        setError('Live arrival data unavailable');
        onBuses([]);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      onBuses([]);
    };
  }, [stop, service, onBuses]);

  if (!leg) return <p className="muted">Live arrivals: no public bus leg on this route.</p>;

  const minutesToDeparture = (new Date(leg.departureIso).getTime() - Date.now()) / 60_000;
  return (
    <div className="live">
      <p className="live-title">
        <span className="live-dot" aria-hidden /> Live at {leg.fromName} ({leg.fromStopCode}) · Bus {leg.service}
      </p>
      {error && <p className="warning">{error}</p>}
      {!error && arrivals.length === 0 && fetchedAt && <p className="muted">No upcoming bus {leg.service} reported by LTA right now.</p>}
      {arrivals.length > 0 && (
        <ul>
          {arrivals.map((a, i) => (
            <li key={i}>
              <strong>{a.estimatedArrival ? `${minutesUntil(a.estimatedArrival)} min` : '—'}</strong>{' '}
              <span className="muted">({a.estimatedArrival ? formatSgtTime(a.estimatedArrival) : 'no estimate'})</span> ·{' '}
              {a.load ? `${LOAD_LABEL[a.load]} (${a.load})` : 'Crowding information unavailable'} ·{' '}
              <span className="muted">{a.monitored ? 'live GPS' : 'from schedule'}</span>
            </li>
          ))}
        </ul>
      )}
      {minutesToDeparture > 30 && <p className="muted">Your planned departure is later; these are the buses arriving now.</p>}
      {fetchedAt && <p className="muted">LTA DataMall · updated {formatSgtTime(fetchedAt)} · refreshes every 30 s</p>}
    </div>
  );
}

function minutesUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}
