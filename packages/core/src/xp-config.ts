import { z } from 'zod';

export const xpEvents = ['first_message', 'chat', 'official_discussion', 'creation', 'confirmed_issue', 'featured', 'event', 'boost_first', 'boost_30d'] as const;
export const xpRuleSchema = z.object({
  event: z.enum(xpEvents), label: z.string().trim().min(1).max(80),
  points: z.number().int().min(1).max(10000), dailyCap: z.number().int().min(0).max(100000),
  cooldownSeconds: z.number().int().min(0).max(2592000),
  channels: z.array(z.string().regex(/^\d{17,20}$/)).max(50),
  enabled: z.boolean(), startsAt: z.string().datetime({ offset: true }).nullable(), endsAt: z.string().datetime({ offset: true }).nullable(),
}).strict().refine(r => !r.startsAt || !r.endsAt || Date.parse(r.endsAt) > Date.parse(r.startsAt), 'End must be after start')
  .refine(r => r.channels.length === 0 || ['first_message','chat','official_discussion'].includes(r.event), 'Only message rules use channel restrictions');
export const xpConfigSchema = z.object({
  enabled: z.boolean(), timezone: z.string().refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  excludedCategoryIds: z.array(z.string().regex(/^\d{17,20}$/)).max(50).optional(),
  minimumCharacters: z.number().int().min(5).max(200),
  levelThresholds: z.array(z.number().int().min(0).max(100000000)).min(1).max(50)
    .refine(a => a[0] === 0 && a.every((v, i) => i === 0 || v > a[i - 1]), 'Start at zero and use increasing thresholds'),
  rules: z.array(xpRuleSchema).max(30).refine(a => new Set(a.map(r => r.event)).size === a.length, 'Only one rule per event'),
}).strict();
export type XpConfig = z.infer<typeof xpConfigSchema>;
export type XpRule = z.infer<typeof xpRuleSchema>;
export type XpEvent = typeof xpEvents[number];
export const xpDefaults: XpConfig = {
  enabled: false, timezone: 'Asia/Shanghai', minimumCharacters: 10, levelThresholds: [0, 100, 300, 600, 1000, 1500],
  rules: [
    ['first_message', 'First meaningful message', 10, 10, 0], ['chat', 'Meaningful conversation', 2, 20, 60],
    ['official_discussion', 'Official discussion', 5, 15, 60], ['creation', 'Reviewed creations or creative tips', 5, 20, 0],
    ['confirmed_issue', 'Confirmed unique bug reports or suggestions', 3, 18, 0], ['featured', 'Team-selected contributions', 10, 0, 0],
    ['event', 'Reviewed event participation', 10, 50, 0], ['boost_first', 'First qualifying Server Boost', 20, 20, 0],
    ['boost_30d', '30 continuous days of Boost', 30, 30, 0],
  ].map(([event, label, points, dailyCap, cooldownSeconds]) => ({ event: event as XpEvent, label: String(label), points: Number(points), dailyCap: Number(dailyCap), cooldownSeconds: Number(cooldownSeconds), channels: [], enabled: !['official_discussion','event'].includes(String(event)), startsAt: null, endsAt: null })),
};

// A reviewable proposal, never an automatic replacement of published rules.
export function evoPointsProposal(current: XpConfig): XpConfig {
  return {
    ...structuredClone(current), enabled: false,
    rules: xpDefaults.rules.map(proposal => {
      const existing = current.rules.find(rule => rule.event === proposal.event);
      return { ...structuredClone(proposal),
        channels: existing ? [...existing.channels] : [],
        startsAt: existing?.startsAt ?? null, endsAt: existing?.endsAt ?? null,
      };
    }),
  };
}
export type XpPeriod = 'weekly' | 'monthly' | 'all_time';
export function periodStart(now: Date, period: XpPeriod, timezone: string): string | null {
  if (period === 'all_time') return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => Number(parts.find(p => p.type === type)!.value);
  const date = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  if (period === 'monthly') date.setUTCDate(1);
  else date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
