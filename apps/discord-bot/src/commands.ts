import { SlashCommandBuilder } from 'discord.js';
export const commands = [
  new SlashCommandBuilder().setName('welcome').setDescription('Meet Mimo and explore EvoMeme'),
  new SlashCommandBuilder().setName('idea').setDescription('Get a weird idea for a playable game'),
  new SlashCommandBuilder().setName('ticket').setDescription('Open a private support request'),
].map(c => c.toJSON());
