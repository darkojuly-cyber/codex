import {
  Client, GatewayIntentBits, MessageFlags, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  type Interaction, type ChatInputCommandInteraction, type ButtonInteraction,
} from 'discord.js';
import { runtime } from '../../../packages/core/src/runtime.js';
import { AppError, ctas } from '../../../packages/core/src/config.js';
import { readEnv } from '../../../packages/core/src/env.js';
import { showWelcome, providerErrorDetails } from './welcome.js';
import { automaticWelcome } from './automatic-welcome.js';
import { scoreGuildMessage } from './message-scope.js';
import { showPoints, pointsUiVersion } from './points.js';
import { pointsButtonIds } from './points-card.js';
import { DiscordTransport } from '../../../packages/core/src/transport.js';

const preflight = readEnv();
if (preflight.APP_MODE !== 'discord') throw new Error('Use the local Console simulator in mock mode. Gateway requires APP_MODE=discord.');
if (preflight.DISCORD_WRITES_ENABLED !== 'true') throw new Error('Bot interaction writes disabled. Complete sandbox review and explicitly enable DISCORD_WRITES_ENABLED.');
const { env, service, db } = await runtime();
const startedAt = new Date();
const intents = [GatewayIntentBits.Guilds];
if (env.GUILD_MEMBERS_INTENT === 'true') intents.push(GatewayIntentBits.GuildMembers);
if (env.MESSAGE_CONTENT_INTENT === 'true') intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
const client = new Client({ intents });
const noMentions = { parse: [] as never[], users: [], roles: [], repliedUser: false };

function ideaButtons(seedId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('idea:another').setLabel('Try Another Idea').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`prompt:${seedId}`).setLabel('Generate Game Prompt').setStyle(ButtonStyle.Primary),
  );
}
async function showIdea(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const seed = await service.idea(interaction.user.id);
  await interaction.editReply({ content: `**${seed.title}**\n${seed.seed_text}\n\nWhat if we made this a game?`, components: [ideaButtons(String(seed.id))], allowedMentions: noMentions });
}
async function ticketModal(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  const c = (await service.current()).body;
  if (!c.enabled.tickets || !c.channels.ticketCategory) throw new AppError(409, 'TICKETS_PENDING_APPROVAL');
  const modal = new ModalBuilder().setCustomId('ticket:create').setTitle('Private support request');
  const fields = [
    new TextInputBuilder().setCustomId('category').setLabel('Bug / Creation Help / Account / Other').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30),
    new TextInputBuilder().setCustomId('summary').setLabel('Summary').setStyle(TextInputStyle.Short).setMinLength(5).setMaxLength(120).setRequired(true),
    new TextInputBuilder().setCustomId('description').setLabel('Details, environment and steps to reproduce').setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(3000).setRequired(true),
  ];
  modal.addComponents(...fields.map(field => new ActionRowBuilder<TextInputBuilder>().addComponents(field)));
  await interaction.showModal(modal);
}
async function handle(interaction: Interaction) {
  if (interaction.guildId !== env.DISCORD_GUILD_ID) return;
  if (interaction.isChatInputCommand()) {
    if (['points', 'rank', 'leaderboard'].includes(interaction.commandName)) return showPoints(interaction, service.xp, { channelId: env.EVO_POINTS_CHANNEL_ID });
    if (interaction.commandName === 'idea') return showIdea(interaction);
    if (interaction.commandName === 'welcome') return showWelcome(interaction, async () => (await service.current()).body);
    if (interaction.commandName === 'ticket') return ticketModal(interaction);
  }
  if (interaction.isButton()) {
    if (pointsButtonIds.some(id => id === interaction.customId)) return showPoints(interaction, service.xp, { channelId: env.EVO_POINTS_CHANNEL_ID });
    if (interaction.customId === 'idea:another') return showIdea(interaction);
    if (interaction.customId === 'ticket:new') return ticketModal(interaction);
    if (interaction.customId === 'links:current') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { body: c } = await service.current();
      const links = ctas(c);
      return interaction.editReply({ content: links.length ? 'Keep cooking! Here are the currently available links.' : 'Anything can be a game. Product links are coming soon; try /idea in the meantime!',
        components: links.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...links.map(link => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(link.label).setURL(link.url)))] : [], allowedMentions: noMentions });
    }
    if (interaction.customId.startsWith('prompt:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const id = interaction.customId.slice(7);
      if (!/^[a-f\d-]{36}$/.test(id)) throw new AppError(400, 'INVALID_SEED');
      const prompt = await service.prompt(interaction.user.id, id);
      const text = String(prompt.generated_prompt).replaceAll('```', "'''");
      // Full prompt stays below Discord's 2000-character message limit through a text attachment.
      await interaction.editReply({ content: 'Your playable game prompt is ready. Open the text file to select and copy the full prompt, then use Explore EvoMeme for current product links.',
        files: [{ attachment: Buffer.from(text), name: 'mimo-game-prompt.txt' }], allowedMentions: noMentions,
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('links:current').setLabel('Explore EvoMeme').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('idea:another').setLabel('Try Another Idea').setStyle(ButtonStyle.Secondary))] });
      return;
    }
  }
  if (interaction.isModalSubmit() && interaction.customId === 'ticket:create') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ticket = await service.createTicket(interaction.user.id, interaction.id, {
      category: interaction.fields.getTextInputValue('category'), summary: interaction.fields.getTextInputValue('summary'), description: interaction.fields.getTextInputValue('description'),
    });
    await interaction.editReply({ content: ticket.private_channel_id ? `Your private ticket #${ticket.seq} is ready: <#${ticket.private_channel_id}>. You can upload screenshots there.` : `Ticket #${ticket.seq}: ${ticket.status}. Please contact support if provisioning does not finish.`, allowedMentions: noMentions });
  }
}
client.on('interactionCreate', interaction => {
  void handle(interaction).catch(async error => {
    const message = error instanceof AppError ? error.code : error?.name === 'ZodError' ? 'Please check the form fields and try again.' : 'Something went wrong. Please try again or contact support.';
    console.error(JSON.stringify({ event: 'interaction.failed', code: error instanceof AppError ? error.code : 'INTERACTION_ERROR', ...providerErrorDetails(error) }));
    if (!interaction.isRepliable()) return;
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
      else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
    } catch (reportError) { console.error(JSON.stringify({ event: 'interaction.report_failed', ...providerErrorDetails(reportError) })); }
  });
});
const autoWelcome = automaticWelcome({ guildId: env.DISCORD_GUILD_ID!, startedAt,
  welcome: (user, joinedAt, eligible, cutoff, appearance) => service.welcome(user, joinedAt, eligible, cutoff, appearance) });
function welcomeFailed(error: unknown) {
  console.error(JSON.stringify({ event: 'welcome.failed', ...providerErrorDetails(error) }));
}
client.on('guildMemberAdd', member => { void autoWelcome.joined(member).catch(welcomeFailed); });
client.on('guildMemberUpdate', (oldMember, member) => { void autoWelcome.updated(oldMember, member).catch(welcomeFailed); });
client.on('messageCreate', message => {
  void scoreGuildMessage(message, service.xp, { enabled: env.MESSAGE_CONTENT_INTENT === 'true', guildId: env.DISCORD_GUILD_ID!, pointsChannelId: env.EVO_POINTS_CHANNEL_ID })
    .catch(error => console.error(JSON.stringify({ event: 'xp.message_failed', ...providerErrorDetails(error) })));
});
client.on('guildMemberUpdate', (_oldMember, member) => {
  if (member.guild.id === env.DISCORD_GUILD_ID) void service.xp.refreshParticipant(member.id, true)
    .catch(error => console.error(JSON.stringify({ event: 'xp.eligibility_failed', ...providerErrorDetails(error) })));
});
client.on('roleUpdate', (_oldRole, role) => {
  if (role.guild.id !== env.DISCORD_GUILD_ID) return;
  if (service.transport instanceof DiscordTransport) service.transport.invalidateXpRoles();
  void service.xp.invalidateParticipants().catch(() => console.error('XP eligibility refresh failed'));
});
client.on('guildMemberUpdate', (oldMember, member) => {
  if (member.guild.id !== env.DISCORD_GUILD_ID || member.user.bot || oldMember.premiumSinceTimestamp === member.premiumSinceTimestamp) return;
  void service.xp.observeBoost(member.id, member.premiumSince, !oldMember.premiumSinceTimestamp && !!member.premiumSinceTimestamp)
    .then(() => service.xp.checkBoosts(fetchBoost))
    .catch(error => console.error(JSON.stringify({ event: 'xp.boost_failed', ...providerErrorDetails(error) })));
});
async function fetchBoost(user: string) {
  return service.transport instanceof DiscordTransport ? service.transport.boostSince(user) : null;
}
client.once('clientReady', () => console.log(JSON.stringify({ event: 'bot.ready', mode: 'DISCORD', pointsUiVersion, messageContentIntent: env.MESSAGE_CONTENT_INTENT, pid: process.pid, membersIntent: env.GUILD_MEMBERS_INTENT, warning: env.GUILD_MEMBERS_INTENT !== 'true' ? 'Automatic welcome unavailable; use /welcome' : undefined })));
client.on('error', () => console.error('Discord Gateway error'));
let shutdownRequested = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (shutdownRequested) return;
  shutdownRequested = true;
  client.destroy(); void db.close();
});
try { await client.login(env.DISCORD_TOKEN); }
catch { console.error('Discord login failed. Verify token, Guild ID and privileged intent approval in environment settings.'); await db.close(); process.exitCode = 1; }
