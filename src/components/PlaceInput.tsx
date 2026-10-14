'use client';

import { useEffect, useState } from 'react';
import type { Place } from '@/types/commute';
import { searchVenues } from '@/lib/campus/venue-resolver';

type Props = {
  id: string;
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  onUseLocation?: () => void;
  locating?: boolean;
};

/** Search box for any Singapore address/place (OneMap) or NUS room/building (NUSMods venues). */
export function PlaceInput({ id, label, placeholder, value, onChange, onUseLocation, locating }: Props) {
  const [query, setQuery] = useState(value?.label ?? '');
  const [results, setResults] = useState<Place[]>([]);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);

  // Reflect places chosen elsewhere (map pin, GPS, timetable) in the text box.
  useEffect(() => {
    setQuery(value?.label ?? '');
    setOpen(false);
  }, [value]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults([]);
      setMessage('');
      return;
    }
    const venues: Place[] = searchVenues(q, 4).map((v) => ({
      kind: 'venue',
      label: v.venueCode,
      detail: `NUS · ${v.roomName || v.buildingCode}`,
      venueCode: v.venueCode,
      lat: v.lat,
      lon: v.lon,
    }));
    setResults(venues);

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/location/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        const places: Place[] = (data.results ?? []).map((r: { label: string; address: string; lat: number; lon: number }) => ({
          kind: 'search',
          label: r.label,
          detail: r.address !== r.label ? r.address : undefined,
          lat: r.lat,
          lon: r.lon,
        }));
        setResults([...venues, ...places]);
        setMessage(res.ok ? (venues.length || places.length ? '' : 'No matching place in Singapore') : 'Address search unavailable — NUS venues still searchable');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setMessage('Address search unavailable');
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  return (
    <div className="place-input">
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input
          id={id}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={(e) => e.target.select()}
        />
        {value && (
          <button className="icon-button" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange(null)}>
            ×
          </button>
        )}
        {onUseLocation && (
          <button className="icon-button" onClick={onUseLocation} disabled={locating} title="Use my current location" aria-label="Use my current location">
            {locating ? '…' : '◎'}
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="suggestions" role="listbox">
          {results.map((r) => (
            <button
              key={`${r.kind}-${r.label}-${r.lat}-${r.lon}`}
              className="suggestion"
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
            >
              <span>{r.label}</span>
              {r.detail && <span className="muted"> · {r.detail}</span>}
            </button>
          ))}
        </div>
      )}
      {open && message && <p className="muted">{message}</p>}
      {value && !open && value.detail && <p className="muted">{value.detail}</p>}
    </div>
  );
}
