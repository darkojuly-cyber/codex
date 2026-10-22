import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/e2e', workers: 1, timeout: 30000,
  use: { baseURL: 'http://localhost:5173', headless: true, launchOptions: { ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}) }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:3000/api/health', reuseExistingServer: false, timeout: 60000, env: { APP_MODE: 'mock', DATA_DIR: `.data/e2e/${Date.now()}`, HOST: '127.0.0.1', PORT: '3000', PUBLIC_ORIGIN: 'http://localhost:3000', DATABASE_URL: '' } },
});
