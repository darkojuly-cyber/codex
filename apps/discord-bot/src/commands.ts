import { SlashCommandBuilder } from 'discord.js';
export const commands = [
  new SlashCommandBuilder().setName('welcome').setDescription('Meet Mimo and explore EvoMeme'),
  new SlashCommandBuilder().setName('idea').setDescription('Get a weird idea for a playable game'),
  new SlashCommandBuilder().setName('ticket').setDescription('Open a private support request'),
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Staff: publish or update the configured support panel').addBooleanOption(option => option.setName('replace').setDescription('Create a new panel only after checking the previous one')),
  new SlashCommandBuilder().setName('points').setDescription('Evo Points and your contribution history')
    .addSubcommand(command => command.setName('rules').setDescription('Read how to earn Evo Points').addIntegerOption(option => option.setName('page').setDescription('Page').setMinValue(1).setMaxValue(100)))
    .addSubcommand(command => command.setName('history').setDescription('Read your Evo Points history').addIntegerOption(option => option.setName('page').setDescription('Page').setMinValue(1).setMaxValue(100))),
  new SlashCommandBuilder().setName('rank').setDescription('Your Evo Points and leaderboard positions'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Community Evo Points leaderboard')
    .addStringOption(option => option.setName('period').setDescription('Ranking period').addChoices({ name: 'Weekly', value: 'weekly' }, { name: 'Monthly', value: 'monthly' }, { name: 'All time', value: 'all_time' }))
    .addIntegerOption(option => option.setName('page').setDescription('Page').setMinValue(1).setMaxValue(100)),
].map(c => c.toJSON());
