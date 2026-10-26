import type { Guild, VoiceState } from 'discord.js';
import type { Store } from './store.js';

export interface PresentMember {
  userId: string;
  channelId: string;
  displayName: string;
}

/** 실제 음성채널 상태(present)에 맞춰 열린 세션을 정리한다. 봇 시작이나 추적 채널 변경 후 호출한다. */
export const syncSessions = (store: Store, guildId: string, present: PresentMember[], now: number) => {
  const tracked = new Set(store.trackedChannels(guildId));
  const presentByUser = new Map(present.filter(p => tracked.has(p.channelId)).map(p => [p.userId, p]));

  for (const open of store.openSessions(guildId)) {
    if (presentByUser.get(open.userId)?.channelId !== open.channelId) {
      store.closeSession(guildId, open.userId, now);
    }
  }

  const stillOpen = new Set(store.openSessions(guildId).map(o => o.userId));
  for (const p of presentByUser.values()) {
    store.upsertMember(guildId, p.userId, p.displayName);
    if (!stillOpen.has(p.userId)) store.openSession(guildId, p.userId, p.channelId, now);
  }
};

/** 음성채널 이동 한 건을 반영한다. */
export const applyVoiceMove = (
  store: Store,
  guildId: string,
  userId: string,
  displayName: string,
  fromChannelId: string | null,
  toChannelId: string | null,
  now: number,
) => {
  if (fromChannelId === toChannelId) return;
  if (fromChannelId && store.isTracked(guildId, fromChannelId)) store.closeSession(guildId, userId, now);
  if (toChannelId && store.isTracked(guildId, toChannelId)) {
    store.upsertMember(guildId, userId, displayName);
    store.openSession(guildId, userId, toChannelId, now);
  }
};

export const handleVoiceStateUpdate = (store: Store, oldState: VoiceState, newState: VoiceState) => {
  const member = newState.member ?? oldState.member;
  if (member?.user.bot) return;
  applyVoiceMove(
    store,
    newState.guild.id,
    newState.id,
    member?.displayName ?? newState.id,
    oldState.channelId,
    newState.channelId,
    Date.now(),
  );
};

export const presentMembers = (guild: Guild): PresentMember[] =>
  [...guild.voiceStates.cache.values()]
    .filter(vs => vs.channelId && !vs.member?.user.bot)
    .map(vs => ({ userId: vs.id, channelId: vs.channelId!, displayName: vs.member?.displayName ?? vs.id }));

export const syncGuildSessions = (store: Store, guild: Guild) =>
  syncSessions(store, guild.id, presentMembers(guild), Date.now());
