import { Client, Events, GatewayIntentBits, type Guild } from 'discord.js';
import { commandDefinitions, handleInteraction } from './commands.js';
import { startScheduler } from './scheduler.js';
import { Store } from './store.js';
import { handleVoiceStateUpdate, syncGuildSessions } from './voice.js';

const HEARTBEAT_MS = 60_000;

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN이 없습니다. .env 파일을 확인하세요.');
  process.exit(1);
}

const store = new Store(process.env.DB_PATH || 'data/bot.sqlite');
// 이전 실행이 비정상 종료됐다면 열린 세션을 마지막 확인 시각까지만 인정한다.
const staleClosed = store.closeStaleSessions();
if (staleClosed > 0) console.log(`[voice] 이전 실행에서 닫히지 않은 세션 ${staleClosed}개를 정리했습니다.`);

// 메시지 내용이나 멤버 목록은 읽지 않으므로 특권(privileged) 인텐트가 필요 없다.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const ctx = { client, store };

const setupGuild = async (guild: Guild) => {
  if (store.seedDefaults(guild.id, Date.now())) console.log(`[setup] ${guild.name}: 기본 알림을 만들었습니다.`);
  // 길드 단위로 등록하면 명령어 변경이 즉시 반영된다.
  await guild.commands.set(commandDefinitions);
  syncGuildSessions(store, guild);
  console.log(`[setup] ${guild.name} (${guild.id}) 준비 완료`);
};

client.once(Events.ClientReady, async c => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
  for (const guild of c.guilds.cache.values()) {
    await setupGuild(guild).catch(error => console.error(`[setup] ${guild.name} 실패`, error));
  }
  startScheduler(client, store);
  setInterval(() => store.heartbeat(Date.now()), HEARTBEAT_MS);
});

client.on(Events.GuildCreate, guild => {
  setupGuild(guild).catch(error => console.error(`[setup] ${guild.name} 실패`, error));
});
client.on(Events.VoiceStateUpdate, (oldState, newState) => handleVoiceStateUpdate(store, oldState, newState));
client.on(Events.InteractionCreate, interaction => void handleInteraction(interaction, ctx));

const shutdown = () => {
  store.closeAllSessions(Date.now());
  store.close();
  void client.destroy().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(token);
