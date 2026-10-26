import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import type { XpService } from '../../../packages/core/src/xp.js';
import type { XpPeriod } from '../../../packages/core/src/xp-config.js';
import { pointsGuide, pointsNavigation, pointsPaused } from './points-card.js';

const noMentions = { parse: [] as never[], users: [], roles: [], repliedUser: false };
const safe = (value: string) => value.replace(/([\\`*_~|>[\]])/g, '\\$1').replace(/@/g, '@\u200b');
const publicCooldowns = new Map<string, number>();
function rankAppearance(rank: number | null) {
  if (rank === 1) return { color: 0xf6c453, badge: '🥇' };
  if (rank === 2) return { color: 0xc0c8d6, badge: '🥈' };
  if (rank === 3) return { color: 0xd99559, badge: '🥉' };
  return { color: rank ? 0xa78bfa : 0x8891a5, badge: rank ? '🏆' : '✨' };
}
export async function showPoints(interaction: ChatInputCommandInteraction | ButtonInteraction, xp: XpService, options: { channelId?: string } = {}) {
  const buttonId = interaction.isButton() ? interaction.customId : null;
  const slash = interaction.isChatInputCommand() ? interaction : null;
  const rules = buttonId === 'xp:rules' || (slash?.commandName === 'points' && slash.options.getSubcommand() === 'rules');
  const wantsPublic = !!options.channelId && !!interaction.guildId && interaction.channelId === options.channelId
    && !!slash && (rules || ['rank', 'leaderboard'].includes(slash.commandName));
  const key = `${interaction.guildId}:${interaction.channelId}`;
  const now = Date.now();
  const next = publicCooldowns.get(key) ?? 0;
  const coolingDown = wantsPublic && next > now;
  const publicReply = wantsPublic && !coolingDown;
  if (publicReply) {
    for (const [id, expiry] of publicCooldowns) if (expiry <= now) publicCooldowns.delete(id);
    publicCooldowns.set(key, now + 60000);
  }
  // Acknowledge before any remote database query. Buttons and history always stay private.
  await interaction.deferReply(publicReply ? {} : { flags: MessageFlags.Ephemeral });
  const delivery = { allowedMentions: noMentions, ...(coolingDown ? { content: `Public posts share a 60-second cooldown (${Math.ceil((next - now) / 1000)}s remaining). Here’s your private result. The buttons below always query privately without this cooldown.` } : {}) };
  if (rules) {
    const revision = await xp.current();
    await interaction.editReply({ ...pointsGuide(revision.body, {
      avatarUrl: interaction.user.displayAvatarURL({ size: 256, extension: 'png' }),
      guildIconUrl: interaction.guild?.iconURL({ size: 128, extension: 'png' }) ?? undefined,
    }), ...delivery });
    return;
  }
  if (buttonId === 'xp:rank' || slash?.commandName === 'rank') {
    const summary = await xp.summary(interaction.user.id);
    const rank = (value: number | null) => value ? `${rankAppearance(value).badge} **#${value}**` : 'Unranked';
    const appearance = rankAppearance(summary.ranks.all_time);
    const avatar = interaction.user.displayAvatarURL({ size: 256, extension: 'png' });
    await interaction.editReply({ embeds: [{
      color: appearance.color,
      author: { name: publicReply ? `${interaction.user.username ?? interaction.user.id} · Evo Points` : 'My Evo Points', icon_url: avatar },
      title: summary.ranks.all_time ? `${appearance.badge} #${summary.ranks.all_time} · Overall Rank` : '✨ Unranked · Overall Rank',
      thumbnail: { url: avatar },
      description: `✨ **${summary.lifetimeXp} total points**${summary.ranks.all_time ? '' : '\nEarn your first points to join the rankings.'}`,
      fields: [
        { name: '🏆 This week', value: rank(summary.ranks.weekly), inline: true },
        { name: '📅 This month', value: rank(summary.ranks.monthly), inline: true },
        { name: '✨ Overall', value: rank(summary.ranks.all_time), inline: true },
      ],
      footer: { text: summary.enabled ? `${summary.timezone} · Equal points share a rank` : pointsPaused },
    }], ...pointsNavigation(), ...delivery });
    return;
  }
  const buttonPeriod = buttonId === 'xp:leaderboard:weekly' ? 'weekly' : buttonId === 'xp:leaderboard:monthly' ? 'monthly' : null;
  const page = slash?.options.getInteger('page') ?? 1;
  if (buttonPeriod || slash?.commandName === 'leaderboard') {
    const period = buttonPeriod ?? (slash!.options.getString('period') ?? 'weekly') as XpPeriod;
    const board = await xp.leaderboard(period, page);
    const title = { weekly: '🏆 Weekly Evo Points Board', monthly: '📅 Monthly Evo Points Board', all_time: '✨ All-Time Evo Points Board' }[period];
    await interaction.editReply({ embeds: [{ color: 0xa78bfa, title, description: `${board.enabled === false ? `${pointsPaused}\n\n` : ''}${board.entries.length ? board.entries.map(row => `**#${row.rank}** <@${row.user_id}> — **${row.xp} points**`).join('\n') : board.enabled === false ? 'There are no recorded points for this period.' : 'No points on this board yet. Every community starts somewhere—check back as members begin earning Evo Points!'}`, footer: { text: `${board.timezone} · Page ${page}${period === 'weekly' ? ' · Mon 00:00 → next Mon 00:00' : period === 'monthly' ? ' · 1st 00:00 → next month 1st 00:00' : ''}` } }], ...pointsNavigation(), ...delivery });
    return;
  }
  if (slash?.commandName !== 'points' || slash.options.getSubcommand() !== 'history') return;
  const rows = await xp.history(interaction.user.id, page);
  await interaction.editReply({ embeds: [{ color: 0xa78bfa, title: `Your Evo Points history · page ${page}`, description: rows.length ? rows.map(row => `**${Number(row.amount) > 0 ? '+' : ''}${row.amount} points** · ${safe(String(row.reason))}\n${new Date(row.occurred_at as string).toISOString().slice(0, 10)}`).join('\n\n').slice(0, 3900) : 'No points to look back on just yet. Your contributions will show up here once you start earning Evo Points.' }], ...pointsNavigation(), ...delivery });
}
