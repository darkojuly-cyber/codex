import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../../../packages/db/src.js';
import { AppError, roles, type Actor, type Role } from '../../../packages/core/src/config.js';
import { type Env, ids } from '../../../packages/core/src/env.js';
import { REST, Routes } from 'discord.js';

declare module 'fastify' { interface FastifyRequest { actor: Actor; csrf: string } }
const token = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sessionSeconds = 30 * 24 * 3600;

export function auth(app: FastifyInstance, db: Database, env: Env) {
  const options = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: env.APP_MODE === 'discord', maxAge: sessionSeconds };
  const cookie = env.APP_MODE === 'discord' ? '__Host-evomeme' : 'evomeme_mock';
  const allowedOrigins = new Set([new URL(env.PUBLIC_ORIGIN).origin, ...(env.APP_MODE === 'mock' ? ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'] : [])]);
  async function guildRole(userId: string): Promise<Role> {
    const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN!);
    let member: { roles: string[] };
    try { member = await rest.get(Routes.guildMember(env.DISCORD_GUILD_ID!, userId)) as { roles: string[] }; }
    catch { throw new AppError(403, 'GUILD_MEMBERSHIP_UNAVAILABLE'); }
    if (ids(env.SUPER_ADMIN_USER_IDS).includes(userId)) return 'SUPER_ADMIN';
    if (member.roles.some(id => ids(env.STAFF_ROLE_IDS).includes(id))) return 'COMMUNITY_MANAGER';
    if (member.roles.some(id => ids(env.MODERATOR_ROLE_IDS).includes(id))) return 'MODERATOR';
    if (member.roles.some(id => ids(env.SUPPORT_ROLE_IDS).includes(id))) return 'SUPPORT';
    throw new AppError(403, 'STAFF_ROLE_REQUIRED');
  }
  async function createSession(reply: FastifyReply, userId: string, role: Role) {
    const session = token(); const csrf = token();
    await db.query("DELETE FROM admin_session WHERE expires_at < now()");
    await db.query("INSERT INTO admin_session(token_hash,user_id,role,csrf,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 second')", [hash(session), userId, role, csrf, sessionSeconds]);
    await db.query('INSERT INTO audit_log(id,actor_id,action,detail) VALUES($1,$2,$3,$4)', [randomUUID(), userId, 'session.created', JSON.stringify({ role, mode: env.APP_MODE })]);
    reply.setCookie(cookie, session, options);
    return { userId, role, csrf, mode: env.APP_MODE.toUpperCase() };
  }
  app.decorateRequest('actor');
  app.decorateRequest('csrf', '');
  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!request.url.startsWith('/api/')) return;
    if (env.APP_MODE === 'mock' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(request.hostname)) throw new AppError(403, 'MOCK_LOCALHOST_ONLY');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (!request.headers.origin || !allowedOrigins.has(request.headers.origin)) throw new AppError(403, 'ORIGIN_REJECTED');
    }
    const path = request.url.split('?')[0];
    if (['/api/health', '/api/auth/mock', '/api/auth/discord', '/api/auth/callback'].includes(path)) return;
    const sessionToken = request.cookies[cookie];
    if (!sessionToken) throw new AppError(401, 'LOGIN_REQUIRED');
    const [session] = await db.query<{ user_id: string; role: Role; csrf: string }>('SELECT user_id,role,csrf FROM admin_session WHERE token_hash=$1 AND expires_at>now()', [hash(sessionToken)]);
    if (!session) throw new AppError(401, 'SESSION_EXPIRED');
    const role = env.APP_MODE === 'mock' ? session.role : await guildRole(session.user_id);
    request.actor = { id: session.user_id, role };
    request.csrf = session.csrf;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !equal(String(request.headers['x-csrf-token'] ?? ''), session.csrf)) throw new AppError(403, 'CSRF_REJECTED');
  });
  app.post('/api/auth/mock', async (request, reply) => {
    if (env.APP_MODE !== 'mock') throw new AppError(404, 'NOT_FOUND');
    const { role } = z.object({ role: z.enum(roles) }).strict().parse(request.body);
    return createSession(reply, `mock-${role.toLowerCase()}`, role);
  });
  app.get('/api/auth/discord', async (_request, reply) => {
    if (env.APP_MODE !== 'discord' || !env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) throw new AppError(503, 'OAUTH_NOT_CONFIGURED');
    const state = token();
    await db.query('DELETE FROM oauth_state WHERE expires_at<now()');
    await db.query("INSERT INTO oauth_state(state_hash,expires_at) VALUES($1,now()+interval '10 minutes')", [hash(state)]);
    reply.setCookie('oauth_state', state, { ...options, maxAge: 600 });
    const params = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify', redirect_uri: env.DISCORD_REDIRECT_URI, state });
    return reply.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });
  app.get('/api/auth/callback', async (request, reply) => {
    if (env.APP_MODE !== 'discord') throw new AppError(404, 'NOT_FOUND');
    const { code, state } = z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(100) }).parse(request.query);
    if (!equal(state, request.cookies.oauth_state ?? '')) throw new AppError(403, 'OAUTH_STATE_REJECTED');
    const states = await db.query('DELETE FROM oauth_state WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash', [hash(state)]);
    reply.clearCookie('oauth_state', { path: '/' });
    if (!states.length) throw new AppError(403, 'OAUTH_STATE_EXPIRED');
    const response = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID!, client_secret: env.DISCORD_CLIENT_SECRET!, grant_type: 'authorization_code', code, redirect_uri: env.DISCORD_REDIRECT_URI! }),
    });
    if (!response.ok) throw new AppError(401, 'OAUTH_EXCHANGE_FAILED');
    const credential = await response.json() as { access_token: string };
    const identity = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${credential.access_token}` }, signal: AbortSignal.timeout(15000) });
    if (!identity.ok) throw new AppError(401, 'OAUTH_IDENTITY_FAILED');
    const user = await identity.json() as { id: string };
    await createSession(reply, user.id, await guildRole(user.id));
    return reply.redirect('/');
  });
  app.get('/api/session', async (request, reply) => {
    // Renew only after authentication, live role verification and an atomic expiry check.
    const renewed = await db.query("UPDATE admin_session SET expires_at=now()+$2*interval '1 second' WHERE token_hash=$1 AND expires_at>now() RETURNING user_id", [hash(request.cookies[cookie]!), sessionSeconds]);
    if (!renewed.length) throw new AppError(401, 'SESSION_EXPIRED');
    reply.header('Cache-Control', 'no-store');
    reply.setCookie(cookie, request.cookies[cookie]!, options);
    return { userId: request.actor.id, role: request.actor.role, csrf: request.csrf, mode: env.APP_MODE.toUpperCase() };
  });
  app.post('/api/logout', async (request, reply) => {
    await db.query('DELETE FROM admin_session WHERE token_hash=$1', [hash(request.cookies[cookie]!)]);
    await db.query('INSERT INTO audit_log(id,actor_id,action) VALUES($1,$2,$3)', [randomUUID(), request.actor.id, 'session.revoked']);
    reply.clearCookie(cookie, { path: '/' });
    return { ok: true };
  });
}
