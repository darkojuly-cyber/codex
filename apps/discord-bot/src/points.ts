import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import type { XpService } from '../../../packages/core/src/xp.js';
import type { XpPeriod } from '../../../packages/core/src/xp-config.js';
import { pointsGuide, pointsNavigation, pointsPaused } from './points-card.js';

const noMentions = { parse: [] as never[], users: [], roles: [], repliedUser: false };
const safe = (value: string) => value.replace(/([\\`*_~|>[\]])/g, '\\$1').replace(/@/g, '@\u200b');
const publicCooldowns = new Map<string, number>();
export async function showPoints(interaction: ChatInputCommandInteraction | ButtonInteraction, xp: XpService, options: { channelId?: string } = {}) {
  const buttonId = interaction.isButton() ? interaction.customId : null;
  const slash = interaction.isChatInputCommand() ? interaction : null;
  const rules = buttonId === 'xp:rules' || (slash?.commandName === 'points' && slash.options.getSubcommand() === 'rules');
  const publicReply = !!options.channelId && !!interaction.guildId && interaction.channelId === options.channelId
    && !!slash && (rules || ['rank', 'leaderboard'].includes(slash.commandName));
  const key = `${interaction.guildId}:${interaction.channelId}`;
  const now = Date.now();
  const next = publicCooldowns.get(key) ?? 0;
  const coolingDown = publicReply && next > now;
  if (publicReply && !coolingDown) {
    for (const [id, expiry] of publicCooldowns) if (expiry <= now) publicCooldowns.delete(id);
    publicCooldowns.set(key, now + 60000);
  }
  // Acknowledge before any remote database query. Buttons and history always stay private.
  await interaction.deferReply(publicReply && !coolingDown ? {} : { flags: MessageFlags.Ephemeral });
  if (coolingDown) {
    await interaction.editReply({ content: `A public points card was just shared. Try again in ${Math.ceil((next - now) / 1000)} seconds, or use the private buttons below.`, ...pointsNavigation(), allowedMentions: noMentions });
    return;
  }
  if (rules) {
    const revision = await xp.current();
    await interaction.editReply({ ...pointsGuide(revision.body, {
      avatarUrl: interaction.user.displayAvatarURL({ size: 256, extension: 'png' }),
      guildIconUrl: interaction.guild?.iconURL({ size: 128, extension: 'png' }) ?? undefined,
    }), allowedMentions: noMentions });
    return;
  }
  if (buttonId === 'xp:rank' || slash?.commandName === 'rank') {
    const summary = await xp.summary(interaction.user.id);
    await interaction.editReply({ embeds: [{ color: 0xa78bfa, title: publicReply ? `✨ ${safe(interaction.user.username ?? interaction.user.id)} · Evo Points` : '✨ My Evo Points', description: `**${summary.lifetimeXp} points**\n\n🏆 This week: ${summary.ranks.weekly ? `#${summary.ranks.weekly}` : 'Not on the board yet'}\n📅 This month: ${summary.ranks.monthly ? `#${summary.ranks.monthly}` : 'Not on the board yet'}\n✨ All time: ${summary.ranks.all_time ? `#${summary.ranks.all_time}` : 'Not on the board yet'}\n\n${summary.enabled ? 'Thanks for being part of the community.' : pointsPaused}` }], ...pointsNavigation(), allowedMentions: noMentions });
    return;
  }
  const buttonPeriod = buttonId === 'xp:leaderboard:weekly' ? 'weekly' : buttonId === 'xp:leaderboard:monthly' ? 'monthly' : null;
  const page = slash?.options.getInteger('page') ?? 1;
  if (buttonPeriod || slash?.commandName === 'leaderboard') {
    const period = buttonPeriod ?? (slash!.options.getString('period') ?? 'weekly') as XpPeriod;
    const board = await xp.leaderboard(period, page);
    const title = { weekly: '🏆 Weekly Evo Points Board', monthly: '📅 Monthly Evo Points Board', all_time: '✨ All-Time Evo Points Board' }[period];
    await interaction.editReply({ embeds: [{ color: 0xa78bfa, title, description: `${board.enabled === false ? `${pointsPaused}\n\n` : ''}${board.entries.length ? board.entries.map(row => `**#${row.rank}** <@${row.user_id}> — **${row.xp} points**`).join('\n') : board.enabled === false ? 'There are no recorded points for this period.' : 'No points on this board yet. Every community starts somewhere—check back as members begin earning Evo Points!'}`, footer: { text: `${board.timezone} · Page ${page}${period === 'weekly' ? ' · Weeks start on Monday' : ''}` } }], ...pointsNavigation(), allowedMentions: noMentions });
    return;
  }
  if (slash?.commandName !== 'points' || slash.options.getSubcommand() !== 'history') return;
  const rows = await xp.history(interaction.user.id, page);
  await interaction.editReply({ embeds: [{ color: 0xa78bfa, title: `Your Evo Points history · page ${page}`, description: rows.length ? rows.map(row => `**${Number(row.amount) > 0 ? '+' : ''}${row.amount} points** · ${safe(String(row.reason))}\n${new Date(row.occurred_at as string).toISOString().slice(0, 10)}`).join('\n\n').slice(0, 3900) : 'No points to look back on just yet. Your contributions will show up here once you start earning Evo Points.' }], ...pointsNavigation(), allowedMentions: noMentions });
}
