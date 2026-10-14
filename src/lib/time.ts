// All commute times are Singapore time (UTC+8, no DST). These helpers never depend on the
// server's or browser's local timezone, so results are identical on Vercel (UTC) and locally.
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

export const SGT_TIME_ZONE = 'Asia/Singapore';

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar fields of an instant as seen on a Singapore wall clock. */
export function sgtParts(date: Date) {
  const shifted = new Date(date.getTime() + SGT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
  };
}

/** Builds an instant from Singapore wall-clock fields. */
export function fromSgt(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) - SGT_OFFSET_MS);
}

/** Parses a `<input type="datetime-local">` value ("YYYY-MM-DDTHH:MM") as Singapore time. */
export function parseSgtLocalInput(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const date = fromSgt(+m[1], +m[2], +m[3], +m[4], +m[5]);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats an instant as a `<input type="datetime-local">` value in Singapore time. */
export function toSgtLocalInput(date: Date): string {
  const p = sgtParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hours)}:${pad(p.minutes)}`;
}

/** OneMap routing expects `date=MM-DD-YYYY` and `time=HH:MM:SS` in Singapore time. */
export function toOneMapDateTime(date: Date): { date: string; time: string } {
  const p = sgtParts(date);
  return { date: `${pad(p.month)}-${pad(p.day)}-${p.year}`, time: `${pad(p.hours)}:${pad(p.minutes)}:00` };
}

export function formatSgtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', { timeZone: SGT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatSgtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    timeZone: SGT_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function minutes(seconds: number): number {
  return Math.round(seconds / 60);
}
