import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { createHash } from 'node:crypto';
import { AppError, ctas } from '../../../packages/core/src/config.js';
import type { Env } from '../../../packages/core/src/env.js';
import type { CommunityService } from '../../../packages/core/src/service.js';
import { DiscordTransport } from '../../../packages/core/src/transport.js';
import { auth } from './auth.js';

export async function createApp(service: CommunityService, env: Env) {
  const app = Fastify({ logger: { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers.x-csrf-token', 'res.headers.set-cookie'] }, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 32768 });
  await app.register(cookie);
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute', keyGenerator: request => `${request.ip}:${request.routeOptions.url}` });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY').header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR', fields: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    if (error instanceof AppError) return reply.code(error.status).send({ error: error.code });
    const status = Number((error as { statusCode?: number }).statusCode ?? 500);
    if (status < 500) return reply.code(status).send({ error: status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST' });
    // Do not log arbitrary provider errors, request bodies, SQL parameters or credentials.
    app.log.error({ error_type: error instanceof Error ? error.name : 'Unknown' }, 'Request failed');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });
  auth(app, service.db, env);
  const paramId = (request: { params: unknown }) => z.object({ id: z.string().uuid() }).parse(request.params).id;
  app.get('/api/health', async () => {
    await service.db.query('SELECT 1');
    return { status: 'ok', localProjectId: createHash('sha256').update(resolve(process.cwd()).toLowerCase()).digest('hex'), mode: env.APP_MODE.toUpperCase(), database: env.DATABASE_URL ? 'PostgreSQL' : 'PGlite (local)', discord: env.APP_MODE === 'mock' ? 'NOT_CONNECTED' : 'GATEWAY_STATUS_NOT_CHECKED', writesEnabled: env.DISCORD_WRITES_ENABLED === 'true' };
  });
  app.get('/api/dashboard', request => service.dashboard(request.actor));
  app.get('/api/config', async request => {
    service.require(request.actor, 'config');
    return { current: await service.current(), revisions: await service.db.query('SELECT * FROM config_revision ORDER BY version DESC LIMIT 50') };
  });
  app.post('/api/config/drafts', request => service.createDraft(request.actor, request.body));
  app.post('/api/config/:id/publish', request => {
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive(), confirm: z.literal(true) }).strict().parse(request.body);
    return service.publish(request.actor, paramId(request), expectedVersion);
  });
  app.post('/api/config/:id/rollback', request => service.rollback(request.actor, paramId(request)));
  app.get('/api/preview', async request => {
    service.require(request.actor, 'config');
    const { body } = await service.current();
    return { persona: body.persona, phase: body.phase, ctas: ctas(body), brand: 'PLACEHOLDER — official assets not provided' };
  });
  app.get('/api/tickets', request => service.tickets(request.actor));
  app.get('/api/tickets/:id', request => service.ticket(request.actor, paramId(request)));
  app.patch('/api/tickets/:id', request => service.updateTicket(request.actor, paramId(request), request.body));
  app.get('/api/seeds', request => { service.require(request.actor, 'config'); return service.seeds(); });
  app.post('/api/seeds', request => service.addSeed(request.actor, request.body));
  app.get('/api/messages', request => {
    service.require(request.actor, 'publish');
    return service.db.query('SELECT j.*,d.status AS delivery_status,d.attempts,d.error_code,d.discord_message_id FROM message_job j LEFT JOIN message_delivery d ON d.job_id=j.id ORDER BY j.created_at DESC LIMIT 100');
  });
  app.post('/api/messages', async request => {
    service.require(request.actor, 'publish');
    if (service.transport instanceof DiscordTransport) {
      const channelId = z.object({ channelId: z.string().regex(/^\d{17,20}$/) }).parse(request.body).channelId;
      if (!await service.transport.channelBelongsToGuild(channelId)) throw new AppError(400, 'CHANNEL_OUTSIDE_GUILD');
    }
    return service.createJob(request.actor, request.body);
  });
  app.post('/api/messages/:id/confirm', request => {
    z.object({ confirm: z.literal(true) }).strict().parse(request.body);
    return service.confirmJob(request.actor, paramId(request));
  });
  app.post('/api/messages/:id/cancel', request => service.cancelJob(request.actor, paramId(request)));
  app.get('/api/audit', request => { service.require(request.actor, 'audit'); return service.db.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200'); });
  app.get('/api/xp/config', request => service.xp.configuration(request.actor));
  app.get('/api/xp/rules', () => service.xp.current());
  app.get('/api/xp/me', request => service.xp.summary(request.actor.id));
  app.get('/api/xp/history', request => service.xp.history(request.actor.id, z.object({ page: z.coerce.number().int().min(1).max(100).default(1) }).parse(request.query).page));
  app.get('/api/xp/leaderboard', request => {
    const { period, page } = z.object({ period: z.enum(['weekly','monthly','all_time']).default('weekly'), page: z.coerce.number().int().min(1).max(100).default(1) }).parse(request.query);
    return service.xp.leaderboard(period, page);
  });
  app.post('/api/xp/drafts', request => service.xp.draft(request.actor, request.body));
  app.post('/api/xp/proposal', request => service.xp.proposal(request.actor));
  app.post('/api/xp/:id/approve', request => service.xp.approve(request.actor, paramId(request)));
  app.post('/api/xp/:id/publish', request => {
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive(), confirm: z.literal(true) }).strict().parse(request.body);
    return service.xp.publish(request.actor, paramId(request), expectedVersion);
  });
  async function checkXpTarget(actor: Parameters<typeof service.xp.requireManager>[0], body: unknown) {
    service.xp.requireManager(actor);
    const { userId } = z.object({ userId: z.string().regex(/^\d{17,20}$/) }).parse(body);
    if (service.transport instanceof DiscordTransport) {
      const { Routes } = await import('discord.js');
      let member: { user?: { bot?: boolean } };
      try { member = await service.transport.rest.get(Routes.guildMember(env.DISCORD_GUILD_ID!, userId)) as typeof member; }
      catch { throw new AppError(400, 'XP_MEMBER_UNAVAILABLE'); }
      if (member.user?.bot) throw new AppError(400, 'XP_BOT_NOT_ELIGIBLE');
    }
  }
  app.post('/api/xp/adjustments', async request => { await checkXpTarget(request.actor, request.body); return service.xp.adjust(request.actor, request.body); });
  app.post('/api/xp/contributions', async request => { await checkXpTarget(request.actor, request.body); return service.xp.reviewed(request.actor, request.body); });
  app.get('/api/discord/audit', request => { service.require(request.actor, 'config'); return service.transport.auditGuild(); });
  // Local simulator exercises the same service as the real Gateway. Never available in Discord mode.
  app.post('/api/mock/:action', async request => {
    if (!service.mock) throw new AppError(404, 'NOT_FOUND');
    service.require(request.actor, 'config');
    const { action } = z.object({ action: z.enum(['idea', 'prompt', 'ticket', 'tick']) }).parse(request.params);
    if (action === 'idea') return service.idea(request.actor.id);
    if (action === 'prompt') return service.prompt(request.actor.id, z.object({ seedId: z.string().uuid() }).parse(request.body).seedId);
    if (action === 'ticket') return service.createTicket(request.actor.id, z.object({ requestKey: z.string().min(5).max(100) }).parse(request.body).requestKey, z.object({ input: z.unknown() }).parse(request.body).input);
    await service.tick(); return { ok: true };
  });
  const dist = resolve('apps/admin-console/dist');
  if (existsSync(dist)) {
    await app.register(staticFiles, { root: dist });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'NOT_FOUND' }) : reply.sendFile('index.html'));
  }
  return app;
}
