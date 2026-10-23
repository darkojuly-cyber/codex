# Neon PostgreSQL setup

This application runs as long-lived Node.js processes (Fastify API, Discord Gateway bot,
and worker). It retains `pg` and SQL migrations; no edge driver or Neon Auth is needed.
`neon.ts` declares Postgres-only configuration and leaves Discord OAuth in place.
Neon deploy configures backend services; it does not host this app's frontend or start the bot.

## Link and deploy

Run from the project root on a machine that can access the Neon API:

```sh
npx neon@latest login
npx neon@latest init -y --no-agent-setup --org-id org-dry-cherry-46296844 --project-id little-mode-69782682 --branch production --services postgres
npx neon@latest deploy
```

Complete browser sign-in on that machine. Do not paste credentials into chat.
`--no-agent-setup` skips a global plugin installation; the Neon and Neon Postgres
skills are already installed in this repository.

Deploy pulls credentials into `.env` if present, otherwise `.env.local`. Both are
gitignored. All backend entry points load `.env.local`, then `.env`, without
overwriting variables injected by the shell or hosting platform.

- `DATABASE_URL`: pooled URL for app queries, available to server code only.
- `DATABASE_URL_UNPOOLED`: direct URL used for automatic startup migrations and
  `npm run db:migrate`; when absent, migrations use `DATABASE_URL` as before.
- Keep SSL parameters supplied by Neon; never disable certificate verification.

The selected branch is explicitly `production`, as requested. Use a separate Neon
branch for Mock experimentation: starting Mock against an unbound database writes
the `LOCAL_MOCK` identity, and the app intentionally rejects later use in Discord mode.
Do not reset an existing binding to switch modes.

For real Discord, follow [DEPLOYMENT.md](DEPLOYMENT.md) for `APP_MODE=discord`,
actual Discord credentials, Guild/role bindings and an HTTPS `PUBLIC_ORIGIN`.
Shell values such as `APP_MODE=mock` or a localhost HTTP origin override env files;
use a fresh terminal or explicitly correct them before starting real services.

## Validation

```sh
npm run build
npm test
npm run lint
```

After deploy and the real-mode configuration are complete, `npm run api` applies
migrations and starts the API. `/api/health` performs a database query and must
report `database: PostgreSQL`. Test the authenticated console flows too; a build
alone does not demonstrate that Neon is connected. Keep Discord writes disabled
until the test-Guild audit and bindings are confirmed.

## Workspace attempt: 2026-10-23

- Global CLI installation failed because `/home/agent/.local/lib` was not writable.
  Used `npx` with a cache under `/tmp` instead.
- Global agent-plugin installation failed on the user cache directory. Installed
  project-local Neon skills instead and initialized with `--no-agent-setup`.
- Init wrote an **offline, unverified** project link and `neon.ts`.
- `neon deploy` and `neon login` both failed to reach the API. A request to
  `https://console.neon.tech/api/v2/projects` failed with
  `CONNECT tunnel failed, response 403` from the environment proxy.
- No Neon environment credentials were pulled and no successful provisioning or
  live database test is claimed. Retry deployment after network access/sign-in
  is available. Local Mock tests do not substitute for live Neon verification.
