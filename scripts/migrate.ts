import { runtime } from '../packages/core/src/runtime.js';
const { db, env } = await runtime();
console.log(`Migrations and safe seeds applied (${env.APP_MODE.toUpperCase()}).`);
await db.close();
