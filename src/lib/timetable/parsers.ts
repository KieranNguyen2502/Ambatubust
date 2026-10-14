import type { DayOfWeek, Lesson } from '@/types/commute';
import { fromSgt, sgtParts } from '@/lib/time';

const DAYS: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MODULE_CODE = /^[A-Z]{2,4}\d{4}[A-Z]{0,4}$/;

// From NUSMods website/src/utils/timetables/lessonId.ts (LESSON_TYPE_ABBREV).
export const LESSON_ABBREV_TYPE: Record<string, string> = {
  DLEC: 'Design Lecture',
  LAB: 'Laboratory',
  LEC: 'Lecture',
  PLAB: 'Packaged Laboratory',
  PLEC: 'Packaged Lecture',
  PTUT: 'Packaged Tutorial',
  REC: 'Recitation',
  SEC: 'Sectional Teaching',
  SEM: 'Seminar-Style Module Class',
  TUT: 'Tutorial',
  TUT2: 'Tutorial Type 2',
  TUT3: 'Tutorial Type 3',
  WS: 'Workshop',
};

export type ModuleSelection = { moduleCode: string; classNos: Record<string, string[]> }; // lessonType -> classNos
export type TimetableImport = { semester: number | null; modules: ModuleSelection[] };

/**
 * Parses an NUSMods share link, e.g.
 * `https://nusmods.com/timetable/sem-1/share?CS2103T=LEC:G26,TUT:03&CS2101=SEC:01`.
 * TA-format lesson configs (`LAB:(…)`) are kept as module codes without class selections.
 */
export function parseNusmodsShareUrl(value: string): TimetableImport | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)nusmods\.com$/.test(url.hostname)) return null;

  const semMatch = url.pathname.match(/sem-(\d)/);
  const modules: ModuleSelection[] = [];
  url.searchParams.forEach((config, key) => {
    const moduleCode = key.toUpperCase();
    if (!MODULE_CODE.test(moduleCode)) return; // skips `hidden`, `ta`, unknown keys
    const classNos: Record<string, string[]> = {};
    if (!config.includes('(')) {
      for (const part of config.split(',')) {
        const [abbr, classNo] = part.split(':');
        const lessonType = LESSON_ABBREV_TYPE[abbr];
        if (lessonType && classNo) (classNos[lessonType] ??= []).push(classNo);
      }
    }
    const existing = modules.find((m) => m.moduleCode === moduleCode);
    if (existing) Object.assign(existing.classNos, classNos);
    else modules.push({ moduleCode, classNos });
  });
  if (!modules.length) return null;
  return { semester: semMatch ? Number(semMatch[1]) : null, modules };
}

/** Accepts a share link or a list of module codes ("CS2103T, CS2101"). */
export function parseTimetableInput(value: string): TimetableImport | null {
  const fromUrl = parseNusmodsShareUrl(value);
  if (fromUrl) return fromUrl;
  const codes = value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if (!codes.length || !codes.every((c) => MODULE_CODE.test(c))) return null;
  return { semester: null, modules: Array.from(new Set(codes)).map((moduleCode) => ({ moduleCode, classNos: {} })) };
}

type NusmodsLesson = { classNo: string; lessonType: string; day: string; startTime: string; endTime: string; venue: string; weeks: unknown };
type NusmodsModule = { moduleCode: string; title?: string; semesterData?: { semester: number; timetable?: NusmodsLesson[] }[] };

const hhmm = (v: string) => `${v.slice(0, 2)}:${v.slice(2, 4)}`;

/** Lessons of one module in one semester, optionally filtered to the classes chosen in a share link. */
export function lessonsFromModule(mod: NusmodsModule, semester: number, classNos: Record<string, string[]> = {}): Lesson[] {
  const timetable = mod.semesterData?.find((s) => s.semester === semester)?.timetable ?? [];
  const filtered = Object.keys(classNos).length
    ? timetable.filter((l) => classNos[l.lessonType]?.includes(l.classNo))
    : timetable;
  return filtered
    .filter((l) => DAYS.includes(l.day as DayOfWeek))
    .map((l, i) => ({
      id: `${mod.moduleCode}-${l.lessonType}-${l.classNo}-${l.day}-${l.startTime}-${i}`,
      moduleCode: mod.moduleCode,
      moduleTitle: mod.title,
      lessonType: l.lessonType,
      classNo: l.classNo,
      dayOfWeek: l.day as DayOfWeek,
      startTime: hhmm(l.startTime),
      endTime: hhmm(l.endTime),
      weeks: Array.isArray(l.weeks) ? (l.weeks as number[]) : [],
      rawVenue: l.venue || 'Unknown',
    }));
}

/**
 * Next start of a weekly lesson at or after `now` (Singapore time). Returns the current occurrence
 * while the class is in progress. Teaching weeks / recess are not checked.
 */
export function nextOccurrence(lesson: Pick<Lesson, 'dayOfWeek' | 'startTime' | 'endTime'>, now: Date): { start: Date; end: Date; inProgress: boolean } {
  const p = sgtParts(now);
  const [sh, sm] = lesson.startTime.split(':').map(Number);
  const [eh, em] = lesson.endTime.split(':').map(Number);
  const targetDay = DAYS.indexOf(lesson.dayOfWeek);
  for (let offset = 0; offset <= 7; offset++) {
    if ((p.weekday + offset) % 7 !== targetDay) continue;
    const start = fromSgt(p.year, p.month, p.day + offset, sh, sm);
    const end = fromSgt(p.year, p.month, p.day + offset, eh, em);
    if (end.getTime() > now.getTime()) return { start, end, inProgress: start.getTime() <= now.getTime() };
  }
  const start = fromSgt(p.year, p.month, p.day + 7, sh, sm);
  return { start, end: fromSgt(p.year, p.month, p.day + 7, eh, em), inProgress: false };
}

/** Parses VEVENTs from an .ics file. Floating and TZID times are treated as Singapore time; `Z` times are converted. */
export function parseIcs(text: string): Lesson[] {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const blocks = unfolded.split('BEGIN:VEVENT').slice(1).map((b) => b.split('END:VEVENT')[0]);
  return blocks.flatMap((block, index) => {
    const get = (key: string) => block.match(new RegExp(`(?:^|\\n)${key}(?:;[^:\\n]*)?:([^\\n]*)`))?.[1]?.trim();
    const start = parseIcsDate(get('DTSTART'));
    const end = parseIcsDate(get('DTEND'));
    if (!start || !end) return [];
    const s = sgtParts(start);
    const e = sgtParts(end);
    const pad = (n: number) => String(n).padStart(2, '0');
    const summary = unescapeIcs(get('SUMMARY') ?? '');
    return [
      {
        id: `ics-${index}`,
        moduleCode: summary.split(' ')[0] || 'UNKNOWN',
        moduleTitle: summary || undefined,
        lessonType: 'Calendar event',
        classNo: '',
        dayOfWeek: DAYS[s.weekday],
        startTime: `${pad(s.hours)}:${pad(s.minutes)}`,
        endTime: `${pad(e.hours)}:${pad(e.minutes)}`,
        weeks: [],
        rawVenue: unescapeIcs(get('LOCATION') ?? '') || 'Unknown',
      },
    ];
  });
}

/** `20261014T100000` (SGT), `20261014T020000Z` (UTC). Date-only (all-day) values are rejected. */
function parseIcsDate(value?: string): Date | null {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  const date = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)) : fromSgt(+y, +mo, +d, +h, +mi);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unescapeIcs(value: string): string {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}
