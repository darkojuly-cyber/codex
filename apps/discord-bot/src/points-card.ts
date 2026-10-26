import { ButtonStyle, ComponentType, type APIActionRowComponent, type APIButtonComponent, type APIEmbed } from 'discord.js';
import type { XpConfig, XpEvent, XpRule } from '../../../packages/core/src/xp-config.js';
import { discordImage, type WelcomeAppearance } from '../../../packages/core/src/welcome-card.js';

export const evoPointsTitle = '✨ Evo Points — A little recognition for being part of it';
export const evoPointsIntro = 'Good conversations, creative ideas, and helpful people make EvoMeme worth coming back to. Evo Points celebrate the members who keep this community active and welcoming.';
export const evoPointsFooter = '✨ Stay tuned for future reward updates.';
export const pointsButtonIds = ['xp:rules', 'xp:rank', 'xp:leaderboard:weekly', 'xp:leaderboard:monthly'] as const;

export function pointsNavigation(): { components: APIActionRowComponent<APIButtonComponent>[] } {
  return { components: [{ type: ComponentType.ActionRow, components: [
    { type: ComponentType.Button, style: ButtonStyle.Primary, label: 'My Points', emoji: { name: '✨' }, custom_id: 'xp:rank' },
    { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Weekly Board', emoji: { name: '🏆' }, custom_id: 'xp:leaderboard:weekly' },
    { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Monthly Board', emoji: { name: '📅' }, custom_id: 'xp:leaderboard:monthly' },
  ] }] };
}

export function pointsGuide(config: XpConfig, appearance: WelcomeAppearance = {}, now = new Date()) {
  const eligible = (rule: XpRule) => rule.enabled && (!rule.startsAt || now >= new Date(rule.startsAt))
    && (!rule.endsAt || now < new Date(rule.endsAt))
    && (!config.enabled || !['first_message','chat','official_discussion'].includes(rule.event) || (config.excludedCategoryIds !== undefined ? rule.event !== 'official_discussion' : rule.channels.length > 0));
  const rule = (event: XpEvent) => config.rules.find(r => r.event === event && eligible(r));
  const cap = (r: XpRule) => r.dailyCap ? ` · up to ${r.dailyCap}/day` : '';
  const lines: string[] = [];
  const first = rule('first_message');
  if (first) lines.push(`· First meaningful message: **${first.points} points**, once per member.`);
  const chat = rule('chat');
  if (chat) lines.push(`· Eligible chat: **${chat.points} points**${cap(chat)}.`);
  const creation = rule('creation');
  if (creation) lines.push(`· Reviewed creations or creative tips: **${creation.points} points**${cap(creation)}.`);
  const issue = rule('confirmed_issue');
  if (issue) lines.push(`· Confirmed, unique bug reports or suggestions: **${issue.points} points**${cap(issue)}.`);
  const featured = rule('featured');
  if (featured) lines.push(`· Team-selected contributions: **${featured.points} points** per selected contribution${cap(featured)}.`);
  const boost = rule('boost_first');
  const continuous = rule('boost_30d');
  if (boost && continuous) lines.push(`· Server Boost: **${boost.points} points** for your first qualifying Boost, plus **${continuous.points} points** for every full **30 days** of continuous support. Rewards are calculated per member.`);
  else if (boost) lines.push(`· Server Boost: **${boost.points} points** for your first qualifying Boost. Rewards are calculated per member.`);
  else if (continuous) lines.push(`· Server Boost: **${continuous.points} points** for every full **30 days** of continuous support. Rewards are calculated per member.`);
  // These only appear if an operator explicitly enables extra reward categories later.
  const discussion = rule('official_discussion');
  if (discussion) lines.push(`· Official discussions: **${discussion.points} points**${cap(discussion)}.`);
  const event = rule('event');
  if (event) lines.push(`· Reviewed community activities: **${event.points} points**${cap(event)}.`);
  const icon = discordImage(appearance.guildIconUrl);
  const avatar = discordImage(appearance.avatarUrl);
  const embed: APIEmbed = {
    color: 0xa78bfa,
    author: { name: config.enabled ? 'EVOMEME COMMUNITY' : 'PREVIEW · Evo Points aren’t being awarded yet', ...(icon ? { icon_url: icon } : {}) },
    title: evoPointsTitle,
    description: `${evoPointsIntro}\n\n**Ways to earn**\n${lines.length ? lines.join('\n') : 'Earning opportunities are being prepared. Check back for the community’s published rewards.'}\n\nCheck your progress and meet the community's top contributors below.`,
    ...(avatar ? { thumbnail: { url: avatar } } : {}),
    footer: { text: evoPointsFooter },
  };
  return { embeds: [embed], ...pointsNavigation() };
}
