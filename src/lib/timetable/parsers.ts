import type { Lesson } from '@/types/commute';

export function parseNusmodsUrl(value: string): { moduleCode: string; lessons: string[] } | null {
  try { const url = new URL(value); const moduleCode = url.searchParams.get('moduleCode') ?? url.pathname.match(/module\/([A-Z0-9]+)/i)?.[1]; if (!moduleCode) return null; return { moduleCode: moduleCode.toUpperCase(), lessons: url.searchParams.getAll('lesson') }; } catch { return null; }
}

export function parseIcs(text: string): Lesson[] {
  const blocks = text.split('BEGIN:VEVENT').slice(1).map((b) => b.split('END:VEVENT')[0]);
  return blocks.flatMap((block, index) => { const get = (key: string) => block.match(new RegExp(`\\n${key}[^:]*:(.*)`))?.[1]?.trim(); const start = get('DTSTART'); const end = get('DTEND'); if (!start || !end) return []; const time = (v: string) => `${v.slice(9, 11)}:${v.slice(11, 13)}`; const day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(`${vDate(start)}T${time(start)}:00+08:00`).getDay()]; return [{ id: `ics-${index}`, moduleCode: get('SUMMARY')?.split(' ')[0] ?? 'UNKNOWN', lessonType: 'ICS', classNo: '1', dayOfWeek: day, startTime: time(start), endTime: time(end), weeks: [], rawVenue: get('LOCATION') ?? 'Unknown', resolvedBuildingId: null }]; });
}
function vDate(v: string) { return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`; }
