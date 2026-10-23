import { SlashCommandBuilder } from 'discord.js';
export const commands = [
  new SlashCommandBuilder().setName('welcome').setDescription('Meet Mimo and explore EvoMeme'),
  new SlashCommandBuilder().setName('idea').setDescription('Get a weird idea for a playable game'),
  new SlashCommandBuilder().setName('ticket').setDescription('Open a private support request'),
  new SlashCommandBuilder().setName('points').setDescription('XP rules and your award history')
    .addSubcommand(command => command.setName('rules').setDescription('Read the latest published XP rules').addIntegerOption(option => option.setName('page').setDescription('Page').setMinValue(1).setMaxValue(100)))
    .addSubcommand(command => command.setName('history').setDescription('Read your XP ledger').addIntegerOption(option => option.setName('page').setDescription('Page').setMinValue(1).setMaxValue(100))),
  new SlashCommandBuilder().setName('rank').setDescription('Your XP, level and leaderboard positions'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Community XP leaderboard')
    .addStringOption(option => option.setName('period').setDescription('Ranking period').addChoices({ name: 'Weekly', value: 'weekly' }, { name: 'Monthly', value: 'monthly' }, { name: 'All time', value: 'all_time' }))
    .addIntegerOption(option => option.setName('page').setDescription('Page').setMinValue(1).setMaxValue(100)),
].map(c => c.toJSON());
