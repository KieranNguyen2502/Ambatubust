import { describe, expect, it } from 'vitest';
import { lessonsFromModule, nextOccurrence, parseIcs, parseNusmodsShareUrl, parseTimetableInput } from './parsers';

describe('parseNusmodsShareUrl', () => {
  it('parses module codes and class numbers from a real share link', () => {
    expect(parseNusmodsShareUrl('https://nusmods.com/timetable/sem-1/share?CS2103T=LEC:G26,TUT:03&CS2101=SEC:01&hidden=CS2101')).toEqual({
      semester: 1,
      modules: [
        { moduleCode: 'CS2103T', classNos: { Lecture: ['G26'], Tutorial: ['03'] } },
        { moduleCode: 'CS2101', classNos: { 'Sectional Teaching': ['01'] } },
      ],
    });
  });

  it('keeps TA-format modules without class selections', () => {
    expect(parseNusmodsShareUrl('https://nusmods.com/timetable/sem-2/share?CS4243=LAB:(2|TUE|1600|1800|AS6-0421|3_4)&ta=CS4243')).toEqual({
      semester: 2,
      modules: [{ moduleCode: 'CS4243', classNos: {} }],
    });
  });

  it('rejects invalid and non-NUSMods links', () => {
    expect(parseNusmodsShareUrl('not a url')).toBeNull();
    expect(parseNusmodsShareUrl('https://example.com/share?CS2103T=LEC:1')).toBeNull();
    expect(parseNusmodsShareUrl('https://nusmods.com/timetable/sem-1/share')).toBeNull();
  });
});

describe('parseTimetableInput', () => {
  it('accepts a module code list', () => {
    expect(parseTimetableInput('cs2103t, CS2101 cs2103t')?.modules.map((m) => m.moduleCode)).toEqual(['CS2103T', 'CS2101']);
  });
  it('rejects empty or malformed input', () => {
    expect(parseTimetableInput('')).toBeNull();
    expect(parseTimetableInput('hello world')).toBeNull();
  });
});

describe('lessonsFromModule', () => {
  const mod = {
    moduleCode: 'CS2103T',
    title: 'Software Engineering',
    semesterData: [
      {
        semester: 1,
        timetable: [
          { classNo: 'G26', lessonType: 'Lecture', day: 'Friday', startTime: '1400', endTime: '1500', venue: 'COM1-0210', weeks: [1, 2] },
          { classNo: 'G27', lessonType: 'Lecture', day: 'Friday', startTime: '1500', endTime: '1600', venue: 'COM1-0210', weeks: [1, 2] },
        ],
      },
    ],
  };
  it('filters to the selected classes', () => {
    const lessons = lessonsFromModule(mod, 1, { Lecture: ['G26'] });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ classNo: 'G26', startTime: '14:00', endTime: '15:00', rawVenue: 'COM1-0210', dayOfWeek: 'Friday' });
  });
  it('returns an empty timetable when the module is not offered that semester', () => {
    expect(lessonsFromModule(mod, 2)).toEqual([]);
  });
});

describe('nextOccurrence', () => {
  const lesson = { dayOfWeek: 'Wednesday' as const, startTime: '10:00', endTime: '12:00' };
  it('finds a later class on the same day in Singapore time', () => {
    const now = new Date('2026-10-14T00:30:00Z'); // Wed 08:30 SGT
    const r = nextOccurrence(lesson, now);
    expect(r.start.toISOString()).toBe('2026-10-14T02:00:00.000Z');
    expect(r.inProgress).toBe(false);
  });
  it('flags a class already in progress', () => {
    const r = nextOccurrence(lesson, new Date('2026-10-14T03:00:00Z')); // Wed 11:00 SGT
    expect(r.inProgress).toBe(true);
    expect(r.start.toISOString()).toBe('2026-10-14T02:00:00.000Z');
  });
  it('rolls over to next week once the class has ended', () => {
    const r = nextOccurrence(lesson, new Date('2026-10-14T05:00:00Z')); // Wed 13:00 SGT
    expect(r.start.toISOString()).toBe('2026-10-21T02:00:00.000Z');
  });
  it('uses the Singapore date even when UTC is still the previous day', () => {
    const r = nextOccurrence({ dayOfWeek: 'Thursday', startTime: '07:00', endTime: '08:00' }, new Date('2026-10-14T16:30:00Z')); // Thu 00:30 SGT
    expect(r.start.toISOString()).toBe('2026-10-14T23:00:00.000Z');
  });
});

describe('parseIcs', () => {
  it('parses a minimal event as Singapore time', () => {
    const [lesson] = parseIcs('BEGIN:VEVENT\nDTSTART:20261014T100000\nDTEND:20261014T120000\nSUMMARY:CS2103T Lecture\nLOCATION:COM1-0212\nEND:VEVENT');
    expect(lesson).toMatchObject({ moduleCode: 'CS2103T', rawVenue: 'COM1-0212', dayOfWeek: 'Wednesday', startTime: '10:00', endTime: '12:00' });
  });
  it('converts UTC times, handles CRLF, TZID params, folding and escapes', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261013T170000Z',
      'DTEND;TZID=Asia/Singapore:20261014T030000',
      'SUMMARY:MA1521 Tut',
      ' orial',
      'LOCATION:S17-0405\\, Science',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [lesson] = parseIcs(ics);
    expect(lesson).toMatchObject({ dayOfWeek: 'Wednesday', startTime: '01:00', endTime: '03:00', moduleTitle: 'MA1521 Tutorial', rawVenue: 'S17-0405, Science' });
  });
  it('skips all-day and malformed events', () => {
    expect(parseIcs('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261014\nDTEND;VALUE=DATE:20261015\nEND:VEVENT')).toEqual([]);
    expect(parseIcs('garbage')).toEqual([]);
  });
});
