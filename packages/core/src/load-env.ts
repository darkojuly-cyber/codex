import { config } from 'dotenv';
import { resolve } from 'node:path';

// Neon writes .env.local unless .env already exists. Runtime injection wins.
export function loadEnvironment(target: NodeJS.ProcessEnv = process.env, directory = process.cwd()) {
  config({ path: [resolve(directory, '.env.local'), resolve(directory, '.env')], processEnv: target, quiet: true });
}
