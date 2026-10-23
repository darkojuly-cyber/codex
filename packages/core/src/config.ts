import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/);
const optionalId = z.union([snowflake, z.literal('')]);
const safeUrl = z.union([z.literal(''), z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Only HTTPS links without credentials are allowed')]);
export const configSchema = z.object({
  phase: z.enum(['PRELAUNCH', 'WEB_LIVE', 'APP_LIVE']),
  timezone: z.string().refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  persona: z.object({ name: z.string().min(1).max(32), welcome: z.string().min(1).max(1000), promptTemplate: z.string().min(10).max(1200) }).strict(),
  links: z.object({ intro: safeUrl, web: safeUrl, ios: safeUrl, android: safeUrl }).strict(),
  channels: z.object({ welcome: optionalId, community: optionalId, ticketCategory: optionalId, publish: z.array(snowflake).max(30) }).strict(),
  enabled: z.object({ welcome: z.boolean(), tickets: z.boolean(), messaging: z.boolean(), web: z.boolean(), ios: z.boolean(), android: z.boolean() }).strict(),
  ticketLimit: z.number().int().min(1).max(5),
  reopenDays: z.number().int().min(0).max(30),
  promptDailyLimit: z.number().int().min(1).max(20),
}).strict().superRefine((c, ctx) => {
  for (const key of ['web', 'ios', 'android'] as const) {
    if (c.enabled[key] && !c.links[key]) ctx.addIssue({ code: 'custom', path: ['links', key], message: 'Enabled CTA needs an approved URL' });
  }
  if (c.phase === 'PRELAUNCH' && (c.enabled.web || c.enabled.ios || c.enabled.android)) ctx.addIssue({ code: 'custom', message: 'PRELAUNCH cannot expose creation/store CTAs' });
  if (c.phase === 'WEB_LIVE' && (c.enabled.ios || c.enabled.android)) ctx.addIssue({ code: 'custom', message: 'Store CTAs require APP_LIVE' });
});
export type Config = z.infer<typeof configSchema>;
export const defaults: Config = {
  phase: 'PRELAUNCH', timezone: 'Asia/Singapore',
  persona: { name: 'Mimo', welcome: 'Hey {user}, glad you found us 👾\n\nGot a weird idea? You’ll fit right in.\nMake a game, remix something unexpected, or just hang out and see what everyone’s cooking.\n\nNo idea where to start? Let Mimo surprise you. 🎲', promptTemplate: 'Create a playful, accessible game with clear mechanics and a shareable result.' },
  links: { intro: '', web: '', ios: '', android: '' },
  channels: { welcome: '', community: '', ticketCategory: '', publish: [] },
  enabled: { welcome: false, tickets: false, messaging: false, web: false, ios: false, android: false },
  ticketLimit: 2, reopenDays: 7, promptDailyLimit: 5,
};
export function ctas(c: Config) {
  const result: { label: string; url: string }[] = [];
  if (c.links.intro) result.push({ label: 'About EvoMeme', url: c.links.intro });
  if (c.phase !== 'PRELAUNCH' && c.enabled.web && c.links.web) result.push({ label: 'Create on Web', url: c.links.web });
  if (c.phase === 'APP_LIVE') {
    if (c.enabled.ios && c.links.ios) result.push({ label: 'Get iOS App', url: c.links.ios });
    if (c.enabled.android && c.links.android) result.push({ label: 'Get Android App', url: c.links.android });
  }
  return result;
}
export const roles = ['SUPER_ADMIN', 'COMMUNITY_MANAGER', 'MODERATOR', 'SUPPORT'] as const;
export type Role = typeof roles[number];
export type Actor = { id: string; role: Role };
export function can(actor: Actor, action: 'config' | 'publish' | 'ticket' | 'audit') {
  if (action === 'ticket') return true;
  if (action === 'audit') return actor.role !== 'SUPPORT';
  return actor.role === 'SUPER_ADMIN' || actor.role === 'COMMUNITY_MANAGER';
}
export class AppError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
