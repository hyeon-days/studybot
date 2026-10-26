import { describe, expect, it } from 'vitest';
import { GRACE_MS, isDue, nextRun } from '../src/scheduler.js';
import type { Schedule } from '../src/store.js';

const at = (iso: string) => new Date(iso);
// 2026-10-27(화) 10:00 KST = 01:00Z
const TEN = Date.parse('2026-10-27T01:00:00Z');

const base: Schedule = {
  id: 1,
  guildId: 'g',
  name: '목표',
  kind: 'message',
  channelId: 'c',
  time: '10:00',
  days: '월화수목금토일',
  content: 'x',
  period: null,
  enabled: true,
  activeSince: 0,
  lastFiredAt: null,
};

describe('isDue', () => {
  it('예정 시각 전에는 보내지 않는다', () => {
    expect(isDue(base, at('2026-10-27T00:59:30Z'))).toBe(false);
  });
  it('예정 시각이 되면 보낸다', () => {
    expect(isDue(base, at('2026-10-27T01:00:10Z'))).toBe(true);
  });
  it('유예 시간이 지나면 건너뛴다', () => {
    expect(isDue(base, new Date(TEN + GRACE_MS + 1000))).toBe(false);
  });
  it('오늘 이미 보냈으면 다시 보내지 않는다', () => {
    expect(isDue({ ...base, lastFiredAt: TEN }, at('2026-10-27T01:01:00Z'))).toBe(false);
  });
  it('어제 보낸 기록은 오늘 게시를 막지 않는다', () => {
    expect(isDue({ ...base, lastFiredAt: TEN - 86_400_000 }, at('2026-10-27T01:01:00Z'))).toBe(true);
  });
  it('예정 시각 이후에 만들거나 시간을 바꾼 알림은 내일부터 보낸다', () => {
    expect(isDue({ ...base, activeSince: TEN + 60_000 }, at('2026-10-27T01:02:00Z'))).toBe(false);
  });
  it('지정 요일이 아니면 보내지 않는다 (화요일에 평일만→true, 주말만→false)', () => {
    expect(isDue({ ...base, days: '월화수목금' }, at('2026-10-27T01:00:10Z'))).toBe(true);
    expect(isDue({ ...base, days: '토일' }, at('2026-10-27T01:00:10Z'))).toBe(false);
  });
  it('꺼져 있거나 채널이 없으면 보내지 않는다', () => {
    expect(isDue({ ...base, enabled: false }, at('2026-10-27T01:00:10Z'))).toBe(false);
    expect(isDue({ ...base, channelId: null }, at('2026-10-27T01:00:10Z'))).toBe(false);
  });
});

describe('nextRun', () => {
  it('오늘 시각이 지났으면 다음 해당 요일을 알려준다', () => {
    // 화 11:00 KST, 월수금만 → 수 10:00
    expect(nextRun({ ...base, days: '월수금' }, at('2026-10-27T02:00:00Z'))).toBe(TEN + 86_400_000);
  });
});
