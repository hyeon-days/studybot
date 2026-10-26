import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  escapeMarkdown,
  type Guild,
  type Interaction,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandStringOption,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { buildLeaderboardEmbed, rankRows } from './leaderboard.js';
import { nextRun, postSchedule } from './scheduler.js';
import type { Schedule, Store } from './store.js';
import {
  formatDays,
  formatDuration,
  type Period,
  PERIOD_LABELS,
  periodRange,
  parseDays,
  parseTime,
} from './time.js';
import { syncGuildSessions } from './voice.js';

const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;
const VOICE_CHANNEL_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice] as const;
const PERIOD_CHOICES = (Object.entries(PERIOD_LABELS) as [Period, string][]).map(([value, name]) => ({ name, value }));
const DEFAULT_LEADERBOARD_TITLE = '{기간} 공부시간 순위';
const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const nameOption = (o: SlashCommandStringOption) =>
  o.setName('이름').setDescription('알림 이름').setRequired(true).setAutocomplete(true);

const alarmCommand = new SlashCommandBuilder()
  .setName('알림')
  .setDescription('정기 메시지와 리더보드 자동 게시를 관리합니다')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(s => s.setName('목록').setDescription('등록된 알림을 모두 봅니다'))
  .addSubcommand(s =>
    s
      .setName('추가')
      .setDescription('새 정기 메시지를 추가합니다 (문구는 다음 창에서 입력)')
      .addStringOption(o =>
        o.setName('이름').setDescription('알림을 구분할 이름 (예: 목표)').setRequired(true).setMaxLength(32),
      )
      .addStringOption(o => o.setName('시간').setDescription('KST 게시 시각 (예: 10:00, 18시)').setRequired(true))
      .addChannelOption(o =>
        o
          .setName('채널')
          .setDescription('게시할 채널')
          .addChannelTypes(...TEXT_CHANNEL_TYPES)
          .setRequired(true),
      )
      .addStringOption(o => o.setName('요일').setDescription('매일 / 평일 / 주말 / 월수금 (기본: 매일)')),
  )
  .addSubcommand(s =>
    s
      .setName('리더보드추가')
      .setDescription('공부시간 리더보드를 정해진 시각에 자동으로 올립니다')
      .addStringOption(o =>
        o.setName('이름').setDescription('알림을 구분할 이름 (예: 주간랭킹)').setRequired(true).setMaxLength(32),
      )
      .addStringOption(o => o.setName('시간').setDescription('KST 게시 시각 (예: 23:59)').setRequired(true))
      .addChannelOption(o =>
        o
          .setName('채널')
          .setDescription('게시할 채널')
          .addChannelTypes(...TEXT_CHANNEL_TYPES)
          .setRequired(true),
      )
      .addStringOption(o =>
        o
          .setName('기간')
          .setDescription('집계 기간')
          .setRequired(true)
          .addChoices(...PERIOD_CHOICES),
      )
      .addStringOption(o => o.setName('요일').setDescription('매일 / 평일 / 주말 / 일 (기본: 매일)')),
  )
  .addSubcommand(s =>
    s
      .setName('수정')
      .setDescription('알림의 시간, 채널, 요일, 기간을 바꿉니다 (입력한 항목만 변경)')
      .addStringOption(nameOption)
      .addStringOption(o => o.setName('시간').setDescription('KST 게시 시각 (예: 10:00)'))
      .addChannelOption(o =>
        o
          .setName('채널')
          .setDescription('게시할 채널')
          .addChannelTypes(...TEXT_CHANNEL_TYPES),
      )
      .addStringOption(o => o.setName('요일').setDescription('매일 / 평일 / 주말 / 월수금'))
      .addStringOption(o =>
        o
          .setName('기간')
          .setDescription('리더보드 집계 기간 (리더보드 알림만)')
          .addChoices(...PERIOD_CHOICES),
      ),
  )
  .addSubcommand(s => s.setName('문구').setDescription('알림 문구(리더보드는 제목)를 바꿉니다').addStringOption(nameOption))
  .addSubcommand(s => s.setName('켜기').setDescription('꺼 둔 알림을 다시 켭니다').addStringOption(nameOption))
  .addSubcommand(s => s.setName('끄기').setDescription('알림을 지우지 않고 잠시 멈춥니다').addStringOption(nameOption))
  .addSubcommand(s => s.setName('삭제').setDescription('알림을 삭제합니다').addStringOption(nameOption))
  .addSubcommand(s =>
    s.setName('지금보내기').setDescription('설정된 채널에 지금 바로 한 번 보내 봅니다').addStringOption(nameOption),
  );

const studyChannelCommand = new SlashCommandBuilder()
  .setName('공부채널')
  .setDescription('공부시간을 잴 음성채널을 관리합니다')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(s =>
    s
      .setName('추가')
      .setDescription('이 음성채널에 머문 시간을 공부시간으로 셉니다')
      .addChannelOption(o =>
        o
          .setName('채널')
          .setDescription('음성채널')
          .addChannelTypes(...VOICE_CHANNEL_TYPES)
          .setRequired(true),
      ),
  )
  .addSubcommand(s =>
    s
      .setName('제거')
      .setDescription('이 음성채널은 더 이상 세지 않습니다 (기존 기록은 유지)')
      .addChannelOption(o =>
        o
          .setName('채널')
          .setDescription('음성채널')
          .addChannelTypes(...VOICE_CHANNEL_TYPES)
          .setRequired(true),
      ),
  )
  .addSubcommand(s => s.setName('목록').setDescription('공부시간을 재고 있는 음성채널을 봅니다'));

const leaderboardCommand = new SlashCommandBuilder()
  .setName('리더보드')
  .setDescription('공부시간 순위를 봅니다')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(o => o.setName('기간').setDescription('집계 기간 (기본: 오늘)').addChoices(...PERIOD_CHOICES));

const myTimeCommand = new SlashCommandBuilder()
  .setName('내공부시간')
  .setDescription('내 공부시간과 순위를 봅니다 (나에게만 보임)')
  .setContexts(InteractionContextType.Guild);

export const commandDefinitions = [alarmCommand, studyChannelCommand, leaderboardCommand, myTimeCommand].map(c =>
  c.toJSON(),
);

// ---------- 공통 ----------

interface Context {
  client: Client;
  store: Store;
}

const oneLine = (text: string, max = 60) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const describeSchedule = (s: Schedule, now: Date) => {
  const kind = s.kind === 'leaderboard' ? `리더보드(${PERIOD_LABELS[s.period ?? 'today']})` : '메시지';
  const channel = s.channelId ? `<#${s.channelId}>` : '**채널 미지정**';
  const status = s.enabled ? '켜짐' : '꺼짐';
  const next = s.enabled && s.channelId ? nextRun(s, now) : null;
  const nextText = next ? ` · 다음 <t:${Math.floor(next / 1000)}:R>` : '';
  return (
    `**${escapeMarkdown(s.name)}** · ${kind} · ${formatDays(s.days)} ${s.time} · ${channel} · ${status}${nextText}\n` +
    `> ${escapeMarkdown(oneLine(s.content))}`
  );
};

const botPermissionWarning = (guild: Guild, channelId: string, voice = false) => {
  const channel = guild.channels.cache.get(channelId);
  const me = guild.members.me;
  if (!channel || !me) return '';
  const perms = channel.permissionsFor(me);
  const needed: [bigint, string][] = voice
    ? [[PermissionFlagsBits.ViewChannel, '채널 보기']]
    : [
        [PermissionFlagsBits.ViewChannel, '채널 보기'],
        [PermissionFlagsBits.SendMessages, '메시지 보내기'],
        [PermissionFlagsBits.EmbedLinks, '링크 첨부'],
      ];
  const missing = needed.filter(([flag]) => !perms?.has(flag)).map(([, label]) => label);
  return missing.length > 0 ? `\n주의: 봇에게 <#${channelId}>의 '${missing.join(', ')}' 권한이 없습니다.` : '';
};

const contentModal = (customId: string, schedule: { kind: Schedule['kind']; content?: string }) => {
  const isLeaderboard = schedule.kind === 'leaderboard';
  const input = new TextInputBuilder()
    .setCustomId('content')
    .setLabel(isLeaderboard ? '리더보드 제목' : '보낼 문구')
    .setStyle(isLeaderboard ? TextInputStyle.Short : TextInputStyle.Paragraph)
    .setMaxLength(isLeaderboard ? 200 : 1800)
    .setRequired(true)
    .setPlaceholder(isLeaderboard ? '{기간} 공부시간 순위' : '{날짜} → 26/10/27, {요일} → 화. 역할 멘션은 <@&역할ID>');
  if (schedule.content) input.setValue(schedule.content);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(isLeaderboard ? '리더보드 제목' : '알림 문구')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
};

const findSchedule = async (interaction: ChatInputCommandInteraction, store: Store) => {
  const name = interaction.options.getString('이름', true);
  const schedule = store.getSchedule(interaction.guildId!, name);
  if (!schedule) {
    await interaction.reply({ content: `'${name}' 알림이 없습니다. \`/알림 목록\`으로 이름을 확인하세요.`, ...EPHEMERAL });
  }
  return schedule;
};

const readTimeAndDays = async (interaction: ChatInputCommandInteraction, required: boolean) => {
  const rawTime = interaction.options.getString('시간', required);
  const rawDays = interaction.options.getString('요일');
  const time = rawTime === null ? undefined : parseTime(rawTime);
  const days = rawDays === null ? undefined : parseDays(rawDays);
  if (time === null) {
    await interaction.reply({ content: `시간 형식을 알 수 없습니다: '${rawTime}'. 예: 10:00, 1800, 18시`, ...EPHEMERAL });
    return null;
  }
  if (days === null) {
    await interaction.reply({ content: `요일 형식을 알 수 없습니다: '${rawDays}'. 예: 매일, 평일, 주말, 월수금`, ...EPHEMERAL });
    return null;
  }
  return { time, days };
};

const validateNewName = async (interaction: ChatInputCommandInteraction, store: Store, name: string) => {
  if (name.includes('|')) {
    await interaction.reply({ content: "이름에는 '|' 문자를 쓸 수 없습니다.", ...EPHEMERAL });
    return false;
  }
  if (store.getSchedule(interaction.guildId!, name)) {
    await interaction.reply({ content: `'${name}' 이름의 알림이 이미 있습니다.`, ...EPHEMERAL });
    return false;
  }
  return true;
};

// ---------- /알림 ----------

const handleAlarm = async (interaction: ChatInputCommandInteraction, { client, store }: Context) => {
  const guildId = interaction.guildId!;
  const guild = interaction.guild!;
  const sub = interaction.options.getSubcommand();
  const now = new Date();

  switch (sub) {
    case '목록': {
      const schedules = store.listSchedules(guildId);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('알림 목록 (KST)')
        .setDescription(
          schedules.length > 0
            ? schedules.map(s => describeSchedule(s, now)).join('\n\n').slice(0, 4000)
            : '등록된 알림이 없습니다. `/알림 추가`로 만들어 보세요.',
        )
        .setFooter({ text: '문구의 {날짜}는 YY/MM/DD, {요일}은 월~일로 바뀝니다' });
      await interaction.reply({ embeds: [embed], ...EPHEMERAL });
      return;
    }

    case '추가': {
      const name = interaction.options.getString('이름', true).trim();
      const channel = interaction.options.getChannel('채널', true);
      const parsed = await readTimeAndDays(interaction, true);
      if (!parsed || !(await validateNewName(interaction, store, name))) return;
      // 문구는 모달에서 받는다. 모달 제출 때 필요한 값은 customId에 실어 보낸다(최대 100자).
      const customId = `alarm-add|${channel.id}|${parsed.time}|${parsed.days}|${name}`;
      await interaction.showModal(contentModal(customId, { kind: 'message', content: '[{날짜}] ' }));
      return;
    }

    case '리더보드추가': {
      const name = interaction.options.getString('이름', true).trim();
      const channel = interaction.options.getChannel('채널', true);
      const period = interaction.options.getString('기간', true) as Period;
      const parsed = await readTimeAndDays(interaction, true);
      if (!parsed || !(await validateNewName(interaction, store, name))) return;
      const schedule = store.addSchedule({
        guildId,
        name,
        kind: 'leaderboard',
        channelId: channel.id,
        time: parsed.time!,
        days: parsed.days,
        content: DEFAULT_LEADERBOARD_TITLE,
        period,
        activeSince: now.getTime(),
      });
      await interaction.reply({
        content:
          `리더보드 알림을 추가했습니다.\n${describeSchedule(schedule, now)}` +
          botPermissionWarning(guild, channel.id) +
          (store.trackedChannels(guildId).length === 0
            ? '\n아직 공부시간을 재는 음성채널이 없습니다. `/공부채널 추가`로 지정하세요.'
            : ''),
        ...EPHEMERAL,
      });
      return;
    }

    case '수정': {
      const schedule = await findSchedule(interaction, store);
      if (!schedule) return;
      const parsed = await readTimeAndDays(interaction, false);
      if (!parsed) return;
      const channel = interaction.options.getChannel('채널');
      const period = interaction.options.getString('기간') as Period | null;
      if (period && schedule.kind !== 'leaderboard') {
        await interaction.reply({ content: '기간은 리더보드 알림에서만 바꿀 수 있습니다.', ...EPHEMERAL });
        return;
      }
      if (!parsed.time && !parsed.days && !channel && !period) {
        await interaction.reply({ content: '바꿀 항목(시간, 채널, 요일, 기간)을 하나 이상 입력하세요.', ...EPHEMERAL });
        return;
      }
      const updated = store.updateSchedule(schedule.id, {
        time: parsed.time,
        days: parsed.days,
        channelId: channel?.id,
        period: period ?? undefined,
        // 시간이나 요일을 바꾸면 지금 이후의 예정 시각부터 적용한다.
        activeSince: parsed.time || parsed.days ? now.getTime() : undefined,
      })!;
      await interaction.reply({
        content: `수정했습니다.\n${describeSchedule(updated, now)}` + (channel ? botPermissionWarning(guild, channel.id) : ''),
        ...EPHEMERAL,
      });
      return;
    }

    case '문구': {
      const schedule = await findSchedule(interaction, store);
      if (!schedule) return;
      await interaction.showModal(contentModal(`alarm-text|${schedule.id}`, schedule));
      return;
    }

    case '켜기':
    case '끄기': {
      const schedule = await findSchedule(interaction, store);
      if (!schedule) return;
      const enabled = sub === '켜기';
      const updated = store.updateSchedule(schedule.id, {
        enabled,
        activeSince: enabled ? now.getTime() : undefined,
      })!;
      const warning = enabled && !updated.channelId ? '\n채널이 지정되지 않아 아직 게시되지 않습니다. `/알림 수정`으로 채널을 지정하세요.' : '';
      await interaction.reply({ content: `${enabled ? '켰' : '껐'}습니다.\n${describeSchedule(updated, now)}${warning}`, ...EPHEMERAL });
      return;
    }

    case '삭제': {
      const schedule = await findSchedule(interaction, store);
      if (!schedule) return;
      store.deleteSchedule(schedule.id);
      await interaction.reply({ content: `'${schedule.name}' 알림을 삭제했습니다.`, ...EPHEMERAL });
      return;
    }

    case '지금보내기': {
      const schedule = await findSchedule(interaction, store);
      if (!schedule) return;
      if (!schedule.channelId) {
        await interaction.reply({ content: '채널이 지정되지 않았습니다. `/알림 수정`으로 채널을 먼저 지정하세요.', ...EPHEMERAL });
        return;
      }
      await interaction.deferReply(EPHEMERAL);
      try {
        await postSchedule(client, store, schedule, now);
        await interaction.editReply(`<#${schedule.channelId}>에 보냈습니다. (정기 게시 일정에는 영향 없음)`);
      } catch (error) {
        await interaction.editReply(
          `보내지 못했습니다: ${(error as Error).message}` + botPermissionWarning(guild, schedule.channelId),
        );
      }
      return;
    }
  }
};

const handleAlarmModal = async (interaction: ModalSubmitInteraction, { store }: Context) => {
  const guildId = interaction.guildId!;
  const content = interaction.fields.getTextInputValue('content').trim();
  const now = new Date();
  const [action, ...parts] = interaction.customId.split('|');

  if (action === 'alarm-add') {
    const [channelId, time, days, ...nameParts] = parts;
    const name = nameParts.join('|');
    if (store.getSchedule(guildId, name)) {
      await interaction.reply({ content: `'${name}' 이름의 알림이 이미 있습니다.`, ...EPHEMERAL });
      return;
    }
    const schedule = store.addSchedule({
      guildId,
      name,
      kind: 'message',
      channelId,
      time,
      days,
      content,
      activeSince: now.getTime(),
    });
    await interaction.reply({
      content: `알림을 추가했습니다.\n${describeSchedule(schedule, now)}` + botPermissionWarning(interaction.guild!, channelId),
      ...EPHEMERAL,
    });
    return;
  }

  if (action === 'alarm-text') {
    const schedule = store.getScheduleById(Number(parts[0]));
    if (!schedule || schedule.guildId !== guildId) {
      await interaction.reply({ content: '알림을 찾을 수 없습니다. 그 사이 삭제되었을 수 있습니다.', ...EPHEMERAL });
      return;
    }
    const updated = store.updateSchedule(schedule.id, { content })!;
    await interaction.reply({ content: `문구를 바꿨습니다.\n${describeSchedule(updated, now)}`, ...EPHEMERAL });
  }
};

// ---------- /공부채널 ----------

const handleStudyChannel = async (interaction: ChatInputCommandInteraction, { store }: Context) => {
  const guild = interaction.guild!;
  const sub = interaction.options.getSubcommand();
  const now = Date.now();

  if (sub === '목록') {
    const channels = store.trackedChannels(guild.id);
    await interaction.reply({
      content:
        channels.length > 0
          ? `공부시간을 재는 음성채널: ${channels.map(id => `<#${id}>`).join(', ')}`
          : '아직 지정된 음성채널이 없습니다. `/공부채널 추가`로 지정하세요.',
      ...EPHEMERAL,
    });
    return;
  }

  const channel = interaction.options.getChannel('채널', true);
  if (sub === '추가') {
    const added = store.addTrackedChannel(guild.id, channel.id);
    // 이미 채널에 있던 사람은 지금부터 센다.
    syncGuildSessions(store, guild);
    await interaction.reply({
      content: (added ? `<#${channel.id}>의 체류 시간을 이제부터 셉니다.` : `<#${channel.id}>는 이미 추가되어 있습니다.`) +
        botPermissionWarning(guild, channel.id, true),
      ...EPHEMERAL,
    });
    return;
  }

  if (sub === '제거') {
    const removed = store.removeTrackedChannel(guild.id, channel.id, now);
    await interaction.reply({
      content: removed
        ? `<#${channel.id}>는 더 이상 세지 않습니다. 지금까지의 기록은 리더보드에 남습니다.`
        : `<#${channel.id}>는 추적 중인 채널이 아닙니다.`,
      ...EPHEMERAL,
    });
  }
};

// ---------- /리더보드, /내공부시간 ----------

const handleLeaderboard = async (interaction: ChatInputCommandInteraction, { store }: Context) => {
  const period = (interaction.options.getString('기간') ?? 'today') as Period;
  await interaction.reply({ embeds: [buildLeaderboardEmbed(store, interaction.guildId!, period, new Date())] });
};

const handleMyTime = async (interaction: ChatInputCommandInteraction, { store }: Context) => {
  const now = new Date();
  const lines = (['today', 'week', 'month', 'all'] as Period[]).map(period => {
    const range = periodRange(period, now);
    const ranked = rankRows(store.leaderboard(interaction.guildId!, range.start, range.end, now.getTime()));
    const mine = ranked.find(r => r.userId === interaction.user.id);
    return mine
      ? `**${PERIOD_LABELS[period]}**  ${formatDuration(mine.ms)}  (${ranked.length}명 중 ${mine.rank}위)`
      : `**${PERIOD_LABELS[period]}**  기록 없음`;
  });
  await interaction.reply({ content: lines.join('\n'), ...EPHEMERAL });
};

// ---------- 라우팅 ----------

const handleAutocomplete = async (interaction: AutocompleteInteraction, { store }: Context) => {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = store
    .listSchedules(interaction.guildId!)
    .filter(s => s.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map(s => ({ name: `${s.name} (${s.time})`, value: s.name }));
  await interaction.respond(choices);
};

const chatHandlers: Record<string, (i: ChatInputCommandInteraction, ctx: Context) => Promise<void>> = {
  알림: handleAlarm,
  공부채널: handleStudyChannel,
  리더보드: handleLeaderboard,
  내공부시간: handleMyTime,
};

export const handleInteraction = async (interaction: Interaction, ctx: Context) => {
  if (!interaction.inCachedGuild()) return;
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction, ctx);
    } else if (interaction.isChatInputCommand()) {
      await chatHandlers[interaction.commandName]?.(interaction, ctx);
    } else if (interaction.isModalSubmit() && interaction.customId.startsWith('alarm-')) {
      await handleAlarmModal(interaction, ctx);
    }
  } catch (error) {
    console.error('[interaction] 처리 중 오류', error);
    if (interaction.isRepliable()) {
      const message = { content: '처리 중 오류가 발생했습니다. 봇 로그를 확인해 주세요.', ...EPHEMERAL };
      if (interaction.deferred || interaction.replied) await interaction.followUp(message).catch(() => {});
      else await interaction.reply(message).catch(() => {});
    }
  }
};
