import { beforeEach, describe, expect, it } from 'vitest';
import { rankRows } from '../src/leaderboard.js';
import { Store } from '../src/store.js';
import { applyVoiceMove, syncSessions } from '../src/voice.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
  store.addTrackedChannel('g', 'study');
});

describe('기본 알림', () => {
  it('처음 한 번만 만들고, 지운 기본 알림은 되살리지 않는다', () => {
    expect(store.seedDefaults('g', 0)).toBe(true);
    expect(store.listSchedules('g').map(s => s.name)).toEqual(['목표', '진행체크', '오늘랭킹']);
    store.deleteSchedule(store.getSchedule('g', '목표')!.id);
    expect(store.seedDefaults('g', 0)).toBe(false);
    expect(store.getSchedule('g', '목표')).toBeNull();
  });
});

describe('알림 수정', () => {
  it('지정한 항목만 바꾼다', () => {
    store.seedDefaults('g', 0);
    const s = store.getSchedule('g', '목표')!;
    const updated = store.updateSchedule(s.id, { channelId: 'ch', time: undefined, enabled: false })!;
    expect(updated).toMatchObject({ channelId: 'ch', time: '10:00', enabled: false });
  });
});

describe('음성채널 체류 시간', () => {
  it('추적 채널에 들어갔다 나간 시간만 센다', () => {
    applyVoiceMove(store, 'g', 'a', '철수', null, 'study', 0, );
    applyVoiceMove(store, 'g', 'a', '철수', 'study', 'lounge', 2 * HOUR);
    applyVoiceMove(store, 'g', 'a', '철수', 'lounge', null, 5 * HOUR);
    expect(store.leaderboard('g', 0, 10 * HOUR, 10 * HOUR)).toEqual([{ userId: 'a', name: '철수', ms: 2 * HOUR }]);
  });

  it('기간 경계에 걸친 세션은 겹친 부분만 센다', () => {
    applyVoiceMove(store, 'g', 'a', '철수', null, 'study', 23 * HOUR);
    applyVoiceMove(store, 'g', 'a', '철수', 'study', null, 26 * HOUR);
    expect(store.leaderboard('g', 24 * HOUR, 48 * HOUR, 30 * HOUR)[0].ms).toBe(2 * HOUR);
  });

  it('진행 중인 세션은 지금까지 센다', () => {
    applyVoiceMove(store, 'g', 'a', '철수', null, 'study', 0);
    expect(store.leaderboard('g', 0, 24 * HOUR, 90 * MIN)[0].ms).toBe(90 * MIN);
  });

  it('비정상 종료 후에는 마지막 heartbeat까지만 인정한다', () => {
    applyVoiceMove(store, 'g', 'a', '철수', null, 'study', 0);
    store.heartbeat(30 * MIN);
    expect(store.closeStaleSessions()).toBe(1);
    expect(store.leaderboard('g', 0, 24 * HOUR, 10 * HOUR)[0].ms).toBe(30 * MIN);
  });

  it('시작 시 이미 채널에 있던 사람은 세션을 열고, 없는 사람은 닫는다', () => {
    applyVoiceMove(store, 'g', 'gone', '영희', null, 'study', 0);
    syncSessions(store, 'g', [{ userId: 'a', channelId: 'study', displayName: '철수' }, { userId: 'b', channelId: 'lounge', displayName: '민수' }], HOUR);
    expect(store.openSessions('g')).toEqual([{ userId: 'a', channelId: 'study' }]);
    expect(store.leaderboard('g', 0, 24 * HOUR, 2 * HOUR).map(r => [r.userId, r.ms])).toEqual([
      ['gone', HOUR],
      ['a', HOUR],
    ]);
  });

  it('추적 채널을 제거하면 그 채널의 열린 세션을 닫는다', () => {
    applyVoiceMove(store, 'g', 'a', '철수', null, 'study', 0);
    store.removeTrackedChannel('g', 'study', HOUR);
    expect(store.openSessions('g')).toEqual([]);
    expect(store.leaderboard('g', 0, 24 * HOUR, 5 * HOUR)[0].ms).toBe(HOUR);
  });

  it('다른 서버 기록은 섞이지 않는다', () => {
    store.addTrackedChannel('other', 'x');
    applyVoiceMove(store, 'other', 'a', '철수', null, 'x', 0);
    expect(store.leaderboard('g', 0, 24 * HOUR, HOUR)).toEqual([]);
  });
});

describe('rankRows', () => {
  it('분 단위 동점은 같은 순위, 1분 미만은 제외', () => {
    const ranked = rankRows([
      { userId: 'a', name: 'A', ms: 3 * HOUR },
      { userId: 'b', name: 'B', ms: HOUR + 10_000 },
      { userId: 'c', name: 'C', ms: HOUR + 50_000 },
      { userId: 'd', name: 'D', ms: 30 * MIN },
      { userId: 'e', name: 'E', ms: 30_000 },
    ]);
    expect(ranked.map(r => [r.name, r.rank])).toEqual([
      ['A', 1],
      ['C', 2],
      ['B', 2],
      ['D', 4],
    ]);
  });
});
