import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { LeaderboardRow, Store } from './store.js';
import { formatDuration, type Period, periodRange, renderTemplate } from './time.js';

const MAX_ROWS = 30;

export interface RankedRow extends LeaderboardRow {
  rank: number;
}

/** 분 단위로 같은 사람은 같은 순위(1, 2, 2, 4 ...). 1분 미만은 제외한다. */
export const rankRows = (rows: LeaderboardRow[]): RankedRow[] => {
  const counted = rows.filter(r => r.ms >= 60_000).sort((a, b) => b.ms - a.ms);
  let previousMinutes = -1;
  let previousRank = 0;
  return counted.map((row, index) => {
    const minutes = Math.floor(row.ms / 60_000);
    const rank = minutes === previousMinutes ? previousRank : index + 1;
    previousMinutes = minutes;
    previousRank = rank;
    return { ...row, rank };
  });
};

export const formatLeaderboardLines = (rows: RankedRow[]) =>
  rows.slice(0, MAX_ROWS).map(r => `**${r.rank}위**  ${escapeMarkdown(r.name)}  ·  ${formatDuration(r.ms)}`);

export const buildLeaderboardEmbed = (
  store: Store,
  guildId: string,
  period: Period,
  now: Date,
  titleTemplate = '{기간} 공부시간 순위',
) => {
  const range = periodRange(period, now);
  const ranked = rankRows(store.leaderboard(guildId, range.start, range.end, now.getTime()));
  const lines = formatLeaderboardLines(ranked);
  const extra = ranked.length > MAX_ROWS ? `\n외 ${ranked.length - MAX_ROWS}명` : '';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(renderTemplate(titleTemplate, now, { 기간: range.label }).slice(0, 256))
    .setDescription(lines.length > 0 ? lines.join('\n') + extra : '아직 기록이 없습니다.')
    .setFooter({ text: '지정된 음성채널에 머문 시간 기준 · KST' })
    .setTimestamp(now);
};
