// 모든 시간 계산은 KST(UTC+9, 서머타임 없음) 기준이다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
export const ALL_DAYS = '월화수목금토일';

export type Period = 'today' | 'yesterday' | 'week' | 'lastweek' | 'month' | 'all';

export const PERIOD_LABELS: Record<Period, string> = {
  today: '오늘',
  yesterday: '어제',
  week: '이번 주',
  lastweek: '지난 주',
  month: '이번 달',
  all: '전체',
};

export interface KstParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export const kstParts = (date: Date): KstParts => {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
    weekday: k.getUTCDay(),
  };
};

/** KST 기준 해당 날짜 00:00의 epoch ms. day가 범위를 넘으면 Date.UTC가 알아서 넘겨준다. */
export const kstMidnight = (year: number, month: number, day: number) =>
  Date.UTC(year, month - 1, day) - KST_OFFSET_MS;

const pad = (n: number) => String(n).padStart(2, '0');

/** YY/MM/DD */
export const formatShortDate = (date: Date) => {
  const p = kstParts(date);
  return `${pad(p.year % 100)}/${pad(p.month)}/${pad(p.day)}`;
};

/** "10:00", "1000", "10시", "10시 30분", "9:5" 등을 "HH:mm"으로 정규화한다. */
export const parseTime = (input: string): string | null => {
  const s = input.trim().replace(/\s+/g, '');
  const match =
    s.match(/^(\d{1,2}):(\d{1,2})$/) ??
    s.match(/^(\d{2})(\d{2})$/) ??
    s.match(/^(\d{1,2})시(?:(\d{1,2})분)?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
};

/** "매일", "평일", "주말", "월수금", "월,화,수" 등을 "월화수목금토일" 순서의 문자열로 정규화한다. */
export const parseDays = (input: string): string | null => {
  const s = input
    .trim()
    .replace(/요일/g, '')
    .replace(/[\s,·/]/g, '');
  if (s === '' || s === '매일') return ALL_DAYS;
  if (s === '평일') return '월화수목금';
  if (s === '주말') return '토일';
  const chars = new Set(s);
  if ([...chars].some(c => !ALL_DAYS.includes(c))) return null;
  return [...ALL_DAYS].filter(c => chars.has(c)).join('');
};

export const formatDays = (days: string) => {
  if (days === ALL_DAYS) return '매일';
  if (days === '월화수목금') return '평일';
  if (days === '토일') return '주말';
  return days;
};

export const formatDuration = (ms: number) => {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}분`;
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
};

export interface PeriodRange {
  start: number;
  end: number;
  label: string;
}

export const periodRange = (period: Period, now: Date): PeriodRange => {
  const p = kstParts(now);
  const today = kstMidnight(p.year, p.month, p.day);
  const md = (ms: number) => {
    const q = kstParts(new Date(ms));
    return `${pad(q.month)}/${pad(q.day)}`;
  };

  switch (period) {
    case 'today':
      return { start: today, end: today + DAY_MS, label: `오늘(${formatShortDate(now)})` };
    case 'yesterday':
      return {
        start: today - DAY_MS,
        end: today,
        label: `어제(${formatShortDate(new Date(today - DAY_MS))})`,
      };
    case 'week':
    case 'lastweek': {
      // 한 주는 월요일 00:00에 시작한다.
      const thisMonday = today - ((p.weekday + 6) % 7) * DAY_MS;
      const start = period === 'week' ? thisMonday : thisMonday - 7 * DAY_MS;
      const end = start + 7 * DAY_MS;
      return { start, end, label: `${PERIOD_LABELS[period]}(${md(start)}~${md(end - DAY_MS)})` };
    }
    case 'month':
      return {
        start: kstMidnight(p.year, p.month, 1),
        end: kstMidnight(p.year, p.month + 1, 1),
        label: `${p.year}년 ${p.month}월`,
      };
    case 'all':
      return { start: 0, end: Number.MAX_SAFE_INTEGER, label: '전체' };
  }
};

/** 문구 안의 {날짜}, {요일} 등을 실제 값으로 바꾼다. */
export const renderTemplate = (text: string, now: Date, extra: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    날짜: formatShortDate(now),
    요일: WEEKDAYS[kstParts(now).weekday],
    ...extra,
  };
  return text.replace(/\{([^{}]+)\}/g, (whole, key: string) => values[key] ?? whole);
};
