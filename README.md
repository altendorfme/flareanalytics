# FlareAnalytics

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflareworkers&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![GitHub stars](https://img.shields.io/github/stars/butialabs/flareanalytics?style=flat&logo=github)](https://github.com/butialabs/flareanalytics/stargazers)

An **Umami/Rybbit-style** dashboard for Cloudflare Web Analytics. A Worker pulls data hourly from the GraphQL Analytics API into D1, so you keep it past Cloudflare's six-month limit. It runs in your own account, needs no new tracking script and fits Workers Free and D1 Free!

## Install

### Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/butialabs/flareanalytics)

Click **Deploy to Cloudflare**. It copies the repo to your GitHub/GitLab, creates the D1 database, asks for the `APP_KEY` secret (e.g. `openssl rand -base64 32`; keep a copy) and deploys. Later pushes redeploy through Workers Builds.

### Wrangler

```bash
git clone https://github.com/butialabs/flareanalytics.git
cd flareanalytics
npm install
npx wrangler login
npx wrangler d1 create flareanalytics  # put the database_id in wrangler.jsonc
npx wrangler secret put APP_KEY        # e.g. openssl rand -base64 32
npm run deploy                         # build, migrate, deploy
```

### First run

1. Create the admin account. The form asks for `APP_KEY`, which also encrypts the stored Cloudflare token.
2. Connect Cloudflare with a User API Token (Account Analytics: Read, Account Settings: Read). The screen links to a prefilled token form and reports missing permissions.
3. Import history under Settings › Import history. It fetches the ~6 months Cloudflare keeps and stops before the daily D1 write quota.

Changing `APP_KEY` later makes the saved token unreadable; paste a new one under Settings › Cloudflare.

## Configuration

Variables in `wrangler.jsonc`:

| Variable | Purpose |
|---|---|
| `TIMEZONE` | IANA time zone used to split days (e.g. `America/Sao_Paulo`, `UTC`) |
| `MAX_SITES` | Maximum active sites |
| `SITES_PER_QUERY` | Sites per GraphQL query |
| `DAILY_WRITE_BUDGET` | D1 writes per day before top lists stop updating |
| `HOURLY_RETENTION_DAYS` | Days of hourly data kept |