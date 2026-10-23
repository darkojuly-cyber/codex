import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import type { XpService } from '../../../packages/core/src/xp.js';
import type { XpPeriod } from '../../../packages/core/src/xp-config.js';

const noMentions = { parse: [] as never[], users: [], roles: [], repliedUser: false };
const safe = (value: string) => value.replace(/([\\`*_~|>[\]])/g, '\\$1').replace(/@/g, '@\u200b');
export async function showPoints(interaction: ChatInputCommandInteraction | ButtonInteraction, xp: XpService) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (interaction.isButton() || (interaction.commandName === 'points' && interaction.options.getSubcommand() === 'rules')) {
    const revision = await xp.current();
    const c = revision.body;
    const lines = c.rules.map(rule => `**${safe(rule.label)}** — ${rule.points} XP · ${rule.enabled ? 'enabled' : 'disabled'}\nDaily cap: ${rule.dailyCap || 'none'} · Cooldown: ${rule.cooldownSeconds}s${rule.channels.length ? ` · Channels: ${rule.channels.map(id => `<#${id}>`).join(', ')}` : ''}${rule.startsAt ? `\nStarts: ${rule.startsAt}` : ''}${rule.endsAt ? ` · Ends: ${rule.endsAt}` : ''}`);
    const chunks: string[] = [];
    let chunk = '';
    for (const line of lines) { if ((chunk + line).length > 3400) { chunks.push(chunk); chunk = ''; } chunk += `${line}\n\n`; }
    if (chunk) chunks.push(chunk);
    const requestedPage = interaction.isButton() ? 1 : interaction.options.getInteger('page') ?? 1;
    const pageIndex = Math.min(Math.max(0, requestedPage - 1), Math.max(0, chunks.length - 1));
    await interaction.editReply({ embeds: chunks.length ? [chunks[pageIndex]].map((description) => ({ color: 0xa78bfa, title: `XP Rules · v${revision.version} · ${pageIndex + 1}/${chunks.length}`, description: `${`**Scoring ${c.enabled ? 'enabled' : 'disabled — proposed values do not award XP'}.**\nTimezone: ${c.timezone} · Minimum meaningful characters: ${c.minimumCharacters}\nFirst message, official discussion and chat do not stack. Duplicate messages do not earn XP.\n\n`}${description}`, footer: { text: `Published ${new Date(revision.published_at!).toISOString()} · /points rules page:N for more · Boost is per user. No cash value.` } })) : [{ title: 'XP Rules', description: 'No scoring rules have been published.', color: 0xa78bfa }], allowedMentions: noMentions });
    return;
  }
  if (interaction.commandName === 'rank') {
    const summary = await xp.summary(interaction.user.id);
    await interaction.editReply({ embeds: [{ color: 0xa78bfa, title: 'Your community XP', description: `**Level ${summary.level} · ${summary.lifetimeXp} XP**\n${summary.nextLevelXp === null ? 'Highest configured level reached.' : `${summary.nextLevelXp - summary.lifetimeXp} XP to the next level.`}\n\nWeekly: ${summary.ranks.weekly ?? 'Unranked'} · Monthly: ${summary.ranks.monthly ?? 'Unranked'} · All time: ${summary.ranks.all_time ?? 'Unranked'}\n\n${summary.enabled ? 'Thanks for being part of the community.' : 'Scoring is currently disabled.'}` }], allowedMentions: noMentions });
    return;
  }
  const page = interaction.options.getInteger('page') ?? 1;
  if (interaction.commandName === 'leaderboard') {
    const period = (interaction.options.getString('period') ?? 'weekly') as XpPeriod;
    const board = await xp.leaderboard(period, page);
    await interaction.editReply({ embeds: [{ color: 0xa78bfa, title: `XP Leaderboard · ${period.replace('_', ' ')} · page ${page}`, description: board.entries.length ? board.entries.map(row => `**#${row.rank}** <@${row.user_id}> — ${row.xp} XP`).join('\n') : 'No entries in this period yet.', footer: { text: `Calendar periods · ${board.timezone} · Week starts Monday` } }], allowedMentions: noMentions });
    return;
  }
  const rows = await xp.history(interaction.user.id, page);
  await interaction.editReply({ embeds: [{ color: 0xa78bfa, title: `Your XP history · page ${page}`, description: rows.length ? rows.map(row => `**${Number(row.amount) > 0 ? '+' : ''}${row.amount} XP** · ${safe(String(row.reason))}\n${new Date(row.occurred_at as string).toISOString().slice(0, 10)} · rule v${row.rule_version}`).join('\n\n').slice(0, 3900) : 'No XP entries yet.' }], allowedMentions: noMentions });
}
