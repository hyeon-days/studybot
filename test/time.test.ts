import { describe, expect, it } from 'vitest';
import { formatDuration, kstMidnight, parseDays, parseTime, periodRange, renderTemplate } from '../src/time.js';

// 2026-10-27(화) 09:30 KST
const NOW = new Date('2026-10-27T00:30:00Z');

describe('parseTime', () => {
  it.each([
    ['10:00', '10:00'],
    ['9:5', '09:05'],
    ['1800', '18:00'],
    ['18시', '18:00'],
    ['18시 30분', '18:30'],
    ['24:00', null],
    ['10:60', null],
    ['아침', null],
  ])('%s → %s', (input, expected) => expect(parseTime(input)).toBe(expected));
});

describe('parseDays', () => {
  it.each([
    ['매일', '월화수목금토일'],
    ['평일', '월화수목금'],
    ['주말', '토일'],
    ['금수월', '월수금'],
    ['월요일, 일요일', '월일'],
    ['월화X', null],
  ])('%s → %s', (input, expected) => expect(parseDays(input)).toBe(expected));
});

describe('renderTemplate', () => {
  it('날짜와 요일을 KST 기준으로 채운다', () => {
    expect(renderTemplate('[{날짜}] {요일}요일 목표!', NOW)).toBe('[26/10/27] 화요일 목표!');
  });
  it('모르는 자리표시자는 그대로 둔다', () => {
    expect(renderTemplate('{뭔가} <@&123>', NOW)).toBe('{뭔가} <@&123>');
  });
  it('UTC로는 전날이어도 KST 날짜를 쓴다', () => {
    expect(renderTemplate('{날짜}', new Date('2026-10-26T15:30:00Z'))).toBe('26/10/27');
  });
});

describe('periodRange', () => {
  it('오늘은 KST 자정부터 다음 자정까지', () => {
    const r = periodRange('today', NOW);
    expect(r.start).toBe(Date.parse('2026-10-26T15:00:00Z'));
    expect(r.end - r.start).toBe(86_400_000);
  });
  it('이번 주는 월요일 시작', () => {
    const r = periodRange('week', NOW);
    expect(r.start).toBe(kstMidnight(2026, 10, 26));
    expect(r.label).toBe('이번 주(10/26~11/01)');
  });
  it('일요일에도 같은 주(월~일)로 묶인다', () => {
    const sunday = new Date('2026-11-01T10:00:00Z');
    expect(periodRange('week', sunday).start).toBe(kstMidnight(2026, 10, 26));
  });
  it('이번 달은 12월에서 해를 넘긴다', () => {
    const r = periodRange('month', new Date('2026-12-15T00:00:00Z'));
    expect(r.end).toBe(kstMidnight(2027, 1, 1));
  });
});

describe('formatDuration', () => {
  it.each([
    [59_000, '0분'],
    [5 * 60_000, '5분'],
    [2 * 3_600_000, '2시간'],
    [3 * 3_600_000 + 20 * 60_000, '3시간 20분'],
  ])('%d → %s', (ms, expected) => expect(formatDuration(ms)).toBe(expected));
});
