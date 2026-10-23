import { MessageFlags, type ChatInputCommandInteraction, type ButtonInteraction } from 'discord.js';
import type { Config } from '../../../packages/core/src/config.js';
import { welcomeCard } from '../../../packages/core/src/welcome-card.js';

export async function showWelcome(interaction: ChatInputCommandInteraction | ButtonInteraction, loadConfig: () => Promise<Config>) {
  // Acknowledge before database I/O: Discord expires initial responses after 3s.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const c = await loadConfig();
  await interaction.editReply({ ...welcomeCard(c.persona.welcome.replaceAll('{user}', interaction.user.username), {
    avatarUrl: interaction.user.displayAvatarURL({ size: 256, extension: 'png' }),
    guildIconUrl: interaction.guild?.iconURL({ size: 128, extension: 'png' }) ?? undefined,
  }),
    allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } });
}

export function providerErrorDetails(error: unknown) {
  const value = error as { code?: unknown; status?: unknown } | null;
  const code = value?.code;
  return {
    providerCode: typeof code === 'number' && Number.isSafeInteger(code) ? code
      : typeof code === 'string' && (/^[A-Z0-9]{5}$/.test(code) || /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)$/.test(code)) ? code : undefined,
    httpStatus: typeof value?.status === 'number' && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599 ? value.status : undefined,
  };
}
