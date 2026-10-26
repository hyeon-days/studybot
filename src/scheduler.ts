import type { Client } from 'discord.js';
import { buildLeaderboardEmbed } from './leaderboard.js';
import type { Schedule, Store } from './store.js';
import { kstMidnight, kstParts, renderTemplate, WEEKDAYS } from './time.js';

const TICK_MS = 20_000;
/** 봇 재시작 등으로 예정 시각을 놓쳤을 때 이 시간 안이면 늦게라도 보낸다. */
export const GRACE_MS = 10 * 60_000;

/** 오늘(KST) 이 알림이 예정된 시각. 오늘이 지정 요일이 아니면 null. */
export const scheduledInstant = (s: Pick<Schedule, 'time' | 'days'>, now: Date) => {
  const p = kstParts(now);
  if (!s.days.includes(WEEKDAYS[p.weekday])) return null;
  const [hour, minute] = s.time.split(':').map(Number);
  return kstMidnight(p.year, p.month, p.day) + (hour * 60 + minute) * 60_000;
};

export const isDue = (s: Schedule, now: Date) => {
  if (!s.enabled || !s.channelId) return false;
  const at = scheduledInstant(s, now);
  if (at === null) return false;
  const t = now.getTime();
  return t >= at && t - at <= GRACE_MS && at >= s.activeSince && (s.lastFiredAt ?? 0) < at;
};

/** 앞으로 실제로 게시될 가장 가까운 시각(epoch ms). 8일 안에 없으면 null. */
export const nextRun = (s: Schedule, now: Date) => {
  for (let i = 0; i < 8; i++) {
    const at = scheduledInstant(s, new Date(now.getTime() + i * 24 * 60 * 60_000));
    if (at !== null && at > now.getTime() && at >= s.activeSince && (s.lastFiredAt ?? 0) < at) return at;
  }
  return null;
};

export const postSchedule = async (client: Client, store: Store, s: Schedule, now = new Date()) => {
  if (!s.channelId) throw new Error('게시할 채널이 지정되지 않았습니다.');
  const channel = await client.channels.fetch(s.channelId).catch(() => null);
  if (!channel || !channel.isSendable()) throw new Error('채널을 찾을 수 없거나 메시지를 보낼 수 없습니다.');

  if (s.kind === 'leaderboard') {
    await channel.send({ embeds: [buildLeaderboardEmbed(store, s.guildId, s.period ?? 'today', now, s.content)] });
  } else {
    await channel.send({
      content: renderTemplate(s.content, now),
      allowedMentions: { parse: ['users', 'roles', 'everyone'] },
    });
  }
};

export const startScheduler = (client: Client, store: Store) => {
  const tick = async () => {
    const now = new Date();
    for (const s of store.enabledSchedules()) {
      if (!isDue(s, now)) continue;
      // 전송 전에 먼저 기록해 두어, 전송이 느리거나 실패해도 중복 게시되지 않게 한다.
      store.markFired(s.id, scheduledInstant(s, now)!);
      try {
        await postSchedule(client, store, s, now);
        console.log(`[scheduler] '${s.name}' 게시 완료 (guild ${s.guildId})`);
      } catch (error) {
        console.error(`[scheduler] '${s.name}' 게시 실패 (guild ${s.guildId})`, error);
      }
    }
  };
  void tick();
  return setInterval(() => void tick(), TICK_MS);
};
