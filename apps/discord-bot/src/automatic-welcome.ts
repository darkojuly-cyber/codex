import { GuildMemberFlags, type GuildMember, type PartialGuildMember } from 'discord.js';
import type { WelcomeAppearance } from '../../../packages/core/src/welcome-card.js';

type Member = GuildMember | PartialGuildMember;
export function automaticWelcome(options: {
  guildId: string;
  startedAt: Date;
  welcome: (user: string, joinedAt: Date, eligible: boolean, cutoff: Date, appearance: WelcomeAppearance) => Promise<boolean>;
}) {
  function eligible(member: Member) {
    return member.guild.id === options.guildId && !member.user.bot && !!member.joinedAt && member.pending === false;
  }
  async function process(member: Member, cutoff: Date) {
    if (!eligible(member)) return;
    const completed = member.flags.has(GuildMemberFlags.CompletedOnboarding);
    // Without native onboarding, joining (after membership screening) is enough.
    // Do not assume onboarding is disabled when Discord's lookup fails.
    if (!completed && (await member.guild.fetchOnboarding()).enabled) return;
    await options.welcome(member.id, member.joinedAt!, true, cutoff, {
      avatarUrl: member.user.displayAvatarURL({ size: 256, extension: 'png' }),
      guildIconUrl: member.guild.iconURL({ size: 128, extension: 'png' }) ?? undefined,
    });
  }
  return {
    async joined(member: GuildMember) {
      if (!member.joinedAt || member.joinedAt < options.startedAt) return;
      await process(member, options.startedAt);
    },
    async updated(oldMember: Member, member: GuildMember) {
      const completedNow = member.flags.has(GuildMemberFlags.CompletedOnboarding)
        && !oldMember.flags.has(GuildMemberFlags.CompletedOnboarding);
      const passedScreening = oldMember.pending === true && member.pending === false;
      if (!completedNow && !passedScreening) return;
      // Completion can happen after a restart for someone who joined earlier.
      // Only this live transition is handled; never scan historical members.
      await process(member, new Date(0));
    },
  };
}
