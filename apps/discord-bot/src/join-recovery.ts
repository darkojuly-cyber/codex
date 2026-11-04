import type { Operations } from '../../../packages/core/src/operations.js';

type Member = { id: string; user: { bot: boolean }; joinedAt: Date | null };

// REST pagination avoids a full member cache and does not emit welcome events.
// Only checkpoint a complete scan. Partial failures can safely replay next time.
export async function recoverMemberJoins(operations: Operations, list: (after: string | undefined) => Promise<Member[]>) {
  const window = await operations.joinRecoveryWindow();
  let after: string | undefined;
  let recovered = 0;
  for (;;) {
    const members = await list(after);
    for (const member of members) {
      if (!member.user.bot && member.joinedAt) recovered += await operations.recoverJoin(member.id, member.joinedAt, window);
    }
    if (members.length < 1000) break;
    const next = members.reduce((max, member) => BigInt(member.id) > BigInt(max) ? member.id : max, after ?? '0');
    if (next === after || next === '0') throw new Error('Member recovery pagination did not advance.');
    after = next;
  }
  await operations.completeJoinRecovery(window.until);
  return { recovered, since: window.since.toISOString(), until: window.until.toISOString() };
}
