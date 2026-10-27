import { AppError, type Actor, type Role } from './config.js';
import type { Queryable } from '../../db/src.js';
import { ids, type Env } from './env.js';

export async function effectiveStaff(db: Queryable, env: Env, user: string, memberRoles: string[], mockRole?: Role): Promise<Actor> {
  if (ids(env.SUPER_ADMIN_USER_IDS).includes(user) || env.APP_MODE === 'mock' && mockRole === 'SUPER_ADMIN') return { id: user, role: 'SUPER_ADMIN' };
  const [access] = await db.query('SELECT role,revoked FROM staff_access WHERE user_id=$1', [user]);
  if (access) {
    if (access.revoked) throw new AppError(403, 'STAFF_ACCESS_REVOKED');
    return { id: user, role: access.role as Role };
  }
  const role = mockRole ?? (memberRoles.some(id => ids(env.STAFF_ROLE_IDS).includes(id)) ? 'COMMUNITY_MANAGER' : memberRoles.some(id => ids(env.MODERATOR_ROLE_IDS).includes(id)) ? 'MODERATOR' : memberRoles.some(id => ids(env.SUPPORT_ROLE_IDS).includes(id)) ? 'SUPPORT' : null);
  if (!role) throw new AppError(403, 'STAFF_ROLE_REQUIRED');
  return { id: user, role };
}
