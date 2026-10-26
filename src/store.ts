import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ALL_DAYS, type Period } from './time.js';

export type ScheduleKind = 'message' | 'leaderboard';

export interface Schedule {
  id: number;
  guildId: string;
  name: string;
  kind: ScheduleKind;
  channelId: string | null;
  time: string;
  days: string;
  content: string;
  period: Period | null;
  enabled: boolean;
  /** 이 시각 이전에 예정된 게시는 건너뛴다. 생성, 시간 변경, 다시 켜기 때 갱신된다. */
  activeSince: number;
  lastFiredAt: number | null;
}

export interface NewSchedule {
  guildId: string;
  name: string;
  kind: ScheduleKind;
  channelId: string | null;
  time: string;
  days?: string;
  content: string;
  period?: Period | null;
  activeSince: number;
}

export type SchedulePatch = Partial<
  Pick<Schedule, 'channelId' | 'time' | 'days' | 'content' | 'period' | 'enabled' | 'activeSince'>
>;

export interface LeaderboardRow {
  userId: string;
  name: string;
  ms: number;
}

export interface OpenSession {
  userId: string;
  channelId: string;
}

interface ScheduleRow {
  id: number;
  guild_id: string;
  name: string;
  kind: ScheduleKind;
  channel_id: string | null;
  time: string;
  days: string;
  content: string;
  period: Period | null;
  enabled: number;
  active_since: number;
  last_fired_at: number | null;
}

const toSchedule = (r: ScheduleRow): Schedule => ({
  id: r.id,
  guildId: r.guild_id,
  name: r.name,
  kind: r.kind,
  channelId: r.channel_id,
  time: r.time,
  days: r.days,
  content: r.content,
  period: r.period,
  enabled: r.enabled === 1,
  activeSince: r.active_since,
  lastFiredAt: r.last_fired_at,
});

const PATCH_COLUMNS: Record<keyof SchedulePatch, string> = {
  channelId: 'channel_id',
  time: 'time',
  days: 'days',
  content: 'content',
  period: 'period',
  enabled: 'enabled',
  activeSince: 'active_since',
};

export class Store {
  readonly db: Database.Database;

  constructor(file = ':memory:') {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guilds (
        guild_id TEXT PRIMARY KEY,
        seeded INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'message',
        channel_id TEXT,
        time TEXT NOT NULL,
        days TEXT NOT NULL DEFAULT '${ALL_DAYS}',
        content TEXT NOT NULL,
        period TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        active_since INTEGER NOT NULL DEFAULT 0,
        last_fired_at INTEGER,
        UNIQUE (guild_id, name)
      );
      CREATE TABLE IF NOT EXISTS tracked_channels (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS members (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS voice_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS voice_sessions_guild ON voice_sessions (guild_id, started_at);
      CREATE INDEX IF NOT EXISTS voice_sessions_open ON voice_sessions (ended_at) WHERE ended_at IS NULL;
    `);
  }

  close() {
    this.db.close();
  }

  // ---------- 서버 기본값 ----------

  /** 처음 들어온 서버에만 기본 알림을 만든다. 사용자가 지운 기본 알림은 다시 만들지 않는다. */
  seedDefaults(guildId: string, now: number) {
    const row = this.db.prepare('SELECT seeded FROM guilds WHERE guild_id = ?').get(guildId) as
      | { seeded: number }
      | undefined;
    if (row?.seeded) return false;

    this.db.transaction(() => {
      const defaults: NewSchedule[] = [
        {
          guildId,
          name: '목표',
          kind: 'message',
          channelId: null,
          time: '10:00',
          content: '[{날짜}] 오늘의 목표를 설정해주세요!',
          activeSince: now,
        },
        {
          guildId,
          name: '진행체크',
          kind: 'message',
          channelId: null,
          time: '18:00',
          content: '[{날짜}] 진행 상황을 체크해주세요!',
          activeSince: now,
        },
        {
          guildId,
          name: '오늘랭킹',
          kind: 'leaderboard',
          channelId: null,
          time: '23:59',
          content: '{기간} 공부시간 순위',
          period: 'today',
          activeSince: now,
        },
      ];
      for (const s of defaults) {
        if (!this.getSchedule(guildId, s.name)) this.addSchedule(s);
      }
      this.db
        .prepare('INSERT INTO guilds (guild_id, seeded) VALUES (?, 1) ON CONFLICT (guild_id) DO UPDATE SET seeded = 1')
        .run(guildId);
    })();
    return true;
  }

  // ---------- 알림(정기 게시) ----------

  listSchedules(guildId: string) {
    const rows = this.db
      .prepare('SELECT * FROM schedules WHERE guild_id = ? ORDER BY time, name')
      .all(guildId) as ScheduleRow[];
    return rows.map(toSchedule);
  }

  enabledSchedules() {
    const rows = this.db
      .prepare('SELECT * FROM schedules WHERE enabled = 1 AND channel_id IS NOT NULL')
      .all() as ScheduleRow[];
    return rows.map(toSchedule);
  }

  getSchedule(guildId: string, name: string) {
    const row = this.db.prepare('SELECT * FROM schedules WHERE guild_id = ? AND name = ?').get(guildId, name) as
      | ScheduleRow
      | undefined;
    return row ? toSchedule(row) : null;
  }

  getScheduleById(id: number) {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
    return row ? toSchedule(row) : null;
  }

  addSchedule(s: NewSchedule) {
    const result = this.db
      .prepare(
        `INSERT INTO schedules (guild_id, name, kind, channel_id, time, days, content, period, active_since)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.guildId, s.name, s.kind, s.channelId, s.time, s.days ?? ALL_DAYS, s.content, s.period ?? null, s.activeSince);
    return this.getScheduleById(Number(result.lastInsertRowid))!;
  }

  updateSchedule(id: number, patch: SchedulePatch) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof SchedulePatch, unknown][];
    if (entries.length > 0) {
      const sets = entries.map(([k]) => `${PATCH_COLUMNS[k]} = ?`).join(', ');
      const values = entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v));
      this.db.prepare(`UPDATE schedules SET ${sets} WHERE id = ?`).run(...values, id);
    }
    return this.getScheduleById(id);
  }

  markFired(id: number, at: number) {
    this.db.prepare('UPDATE schedules SET last_fired_at = ? WHERE id = ?').run(at, id);
  }

  deleteSchedule(id: number) {
    return this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
  }

  // ---------- 추적 음성채널 ----------

  trackedChannels(guildId: string) {
    const rows = this.db.prepare('SELECT channel_id FROM tracked_channels WHERE guild_id = ?').all(guildId) as {
      channel_id: string;
    }[];
    return rows.map(r => r.channel_id);
  }

  isTracked(guildId: string, channelId: string) {
    return !!this.db
      .prepare('SELECT 1 FROM tracked_channels WHERE guild_id = ? AND channel_id = ?')
      .get(guildId, channelId);
  }

  addTrackedChannel(guildId: string, channelId: string) {
    return (
      this.db
        .prepare('INSERT OR IGNORE INTO tracked_channels (guild_id, channel_id) VALUES (?, ?)')
        .run(guildId, channelId).changes > 0
    );
  }

  removeTrackedChannel(guildId: string, channelId: string, now: number) {
    return this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE voice_sessions SET ended_at = ? WHERE guild_id = ? AND channel_id = ? AND ended_at IS NULL',
        )
        .run(now, guildId, channelId);
      return (
        this.db
          .prepare('DELETE FROM tracked_channels WHERE guild_id = ? AND channel_id = ?')
          .run(guildId, channelId).changes > 0
      );
    })();
  }

  // ---------- 음성채널 체류 기록 ----------

  upsertMember(guildId: string, userId: string, displayName: string) {
    this.db
      .prepare(
        `INSERT INTO members (guild_id, user_id, display_name) VALUES (?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET display_name = excluded.display_name`,
      )
      .run(guildId, userId, displayName);
  }

  openSession(guildId: string, userId: string, channelId: string, now: number) {
    this.db.transaction(() => {
      this.closeSession(guildId, userId, now);
      this.db
        .prepare(
          `INSERT INTO voice_sessions (guild_id, user_id, channel_id, started_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(guildId, userId, channelId, now, now);
    })();
  }

  closeSession(guildId: string, userId: string, now: number) {
    this.db
      .prepare('UPDATE voice_sessions SET ended_at = ? WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL')
      .run(now, guildId, userId);
  }

  openSessions(guildId: string): OpenSession[] {
    return this.db
      .prepare(
        'SELECT user_id AS userId, channel_id AS channelId FROM voice_sessions WHERE guild_id = ? AND ended_at IS NULL',
      )
      .all(guildId) as OpenSession[];
  }

  /** 봇이 살아 있는 동안 주기적으로 호출해, 비정상 종료 시 마지막 확인 시각까지만 인정되도록 한다. */
  heartbeat(now: number) {
    this.db.prepare('UPDATE voice_sessions SET last_seen_at = ? WHERE ended_at IS NULL').run(now);
  }

  /** 시작 시 호출: 이전 실행에서 닫히지 않은 세션을 마지막 heartbeat 시각으로 닫는다. */
  closeStaleSessions() {
    return this.db.prepare('UPDATE voice_sessions SET ended_at = last_seen_at WHERE ended_at IS NULL').run().changes;
  }

  /** 정상 종료 시 호출. */
  closeAllSessions(now: number) {
    this.db.prepare('UPDATE voice_sessions SET ended_at = ? WHERE ended_at IS NULL').run(now);
  }

  /** [start, end) 구간과 겹치는 체류 시간을 사람별로 합산한다. 진행 중인 세션은 now까지 계산한다. */
  leaderboard(guildId: string, start: number, end: number, now: number): LeaderboardRow[] {
    return this.db
      .prepare(
        `SELECT s.user_id AS userId,
                COALESCE(m.display_name, s.user_id) AS name,
                SUM(MAX(0, MIN(COALESCE(s.ended_at, @now), @end) - MAX(s.started_at, @start))) AS ms
         FROM voice_sessions s
         LEFT JOIN members m ON m.guild_id = s.guild_id AND m.user_id = s.user_id
         WHERE s.guild_id = @guildId
           AND s.started_at < @end
           AND COALESCE(s.ended_at, @now) > @start
         GROUP BY s.user_id
         HAVING ms > 0
         ORDER BY ms DESC`,
      )
      .all({ guildId, start, end, now }) as LeaderboardRow[];
  }
}
