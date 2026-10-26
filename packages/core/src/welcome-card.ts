import { ButtonStyle, ComponentType, type APIActionRowComponent, type APIButtonComponent, type APIEmbed } from 'discord.js';

export type WelcomeAppearance = { avatarUrl?: string; guildIconUrl?: string };

export function discordImage(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) ? value : undefined;
  } catch { return undefined; }
}

// Shared by the public automatic welcome and the private /welcome fallback.
export function welcomeCard(body: string, appearance: WelcomeAppearance = {}) {
  const avatar = discordImage(appearance.avatarUrl);
  const icon = discordImage(appearance.guildIconUrl);
  const embed: APIEmbed = {
    color: 0xa78bfa,
    author: { name: 'EVOMEME  /  COMMUNITY', ...(icon ? { icon_url: icon } : {}) },
    title: 'Welcome to EvoMeme 👾',
    description: body,
    ...(avatar ? { thumbnail: { url: avatar } } : {}),
    fields: [
      { name: '🎲 Surprise Me!', value: 'Start with a little chaos.', inline: true },
      { name: '🪄 Explore EvoMeme', value: 'See what you can make.', inline: true },
      { name: '🎫 Get Support', value: 'We’re here if you get stuck.', inline: true },
    ],
    footer: { text: 'Anything can be a game.' },
  };
  const row: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      { type: ComponentType.Button, style: ButtonStyle.Primary, label: 'Surprise Me!', emoji: { name: '🎲' }, custom_id: 'idea:another' },
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Explore EvoMeme', emoji: { name: '🪄' }, custom_id: 'links:current' },
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Get Support', emoji: { name: '🎫' }, custom_id: 'ticket:new' },
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Evo Points', emoji: { name: '✨' }, custom_id: 'xp:rules' },
    ],
  };
  return { embeds: [embed], components: [row] };
}
