import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import type { XpService } from '../../../packages/core/src/xp.js';
import type { XpPeriod } from '../../../packages/core/src/xp-config.js';
import { pointsGuide, pointsNavigation } from './points-card.js';

const noMentions = { parse: [] as never[], users: [], roles: [], repliedUser: false };
const safe = (value: string) => value.replace(/([\\`*_~|>[\]])/g, '\\$1').replace(/@/g, '@\u200b');
export async function showPoints(interaction: ChatInputCommandInteraction | ButtonInteraction, xp: XpService) {
  // Keep the acknowledgement before any remote database query.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const buttonId = interaction.isButton() ? interaction.customId : null;
  const slash = interaction.isChatInputCommand() ? interaction : null;
  const rules = buttonId === 'xp:rules' || (slash?.commandName === 'points' && slash.options.getSubcommand() === 'rules');
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
    await interaction.editReply({ embeds: [{ color: 0xa78bfa, title: '✨ My Evo Points', description: `**Level ${summary.level} · ${summary.lifetimeXp} points**\n${summary.nextLevelXp === null ? 'You’ve reached the highest level for now.' : `${summary.nextLevelXp - summary.lifetimeXp} more points to your next level.`}\n\n🏆 This week: ${summary.ranks.weekly ? `#${summary.ranks.weekly}` : 'Not on the board yet'}\n📅 This month: ${summary.ranks.monthly ? `#${summary.ranks.monthly}` : 'Not on the board yet'}\n✨ All time: ${summary.ranks.all_time ? `#${summary.ranks.all_time}` : 'Not on the board yet'}\n\n${summary.enabled ? 'Thanks for being part of the community.' : 'Evo Points aren’t being awarded yet. Stay tuned!'}` }], ...pointsNavigation(), allowedMentions: noMentions });
    return;
  }
  const buttonPeriod = buttonId === 'xp:leaderboard:weekly' ? 'weekly' : buttonId === 'xp:leaderboard:monthly' ? 'monthly' : null;
  const page = slash?.options.getInteger('page') ?? 1;
  if (buttonPeriod || slash?.commandName === 'leaderboard') {
    const period = buttonPeriod ?? (slash!.options.getString('period') ?? 'weekly') as XpPeriod;
    const board = await xp.leaderboard(period, page);
    const title = { weekly: '🏆 Weekly Evo Points Board', monthly: '📅 Monthly Evo Points Board', all_time: '✨ All-Time Evo Points Board' }[period];
    await interaction.editReply({ embeds: [{ color: 0xa78bfa, title, description: board.entries.length ? board.entries.map(row => `**#${row.rank}** <@${row.user_id}> — **${row.xp} points**`).join('\n') : 'No points on this board yet. Every community starts somewhere—check back as members begin earning Evo Points!', footer: { text: `${board.timezone} · Page ${page}${period === 'weekly' ? ' · Weeks start on Monday' : ''}` } }], ...pointsNavigation(), allowedMentions: noMentions });
    return;
  }
  if (slash?.commandName !== 'points' || slash.options.getSubcommand() !== 'history') return;
  const rows = await xp.history(interaction.user.id, page);
  await interaction.editReply({ embeds: [{ color: 0xa78bfa, title: `Your Evo Points history · page ${page}`, description: rows.length ? rows.map(row => `**${Number(row.amount) > 0 ? '+' : ''}${row.amount} points** · ${safe(String(row.reason))}\n${new Date(row.occurred_at as string).toISOString().slice(0, 10)}`).join('\n\n').slice(0, 3900) : 'No points to look back on just yet. Your contributions will show up here once you start earning Evo Points.' }], ...pointsNavigation(), allowedMentions: noMentions });
}
