# CKF Second Brain

Personal dashboard for Curtis. Lives at `/ckf` on the oso site. Single-user app, gated by email.

## Stack

- **Frontend:** React + Vite, built into `oso/static/ckf/` so Hugo passes it through.
- **Routing:** SPA, `/ckf/*` rewrites to `/ckf/index.html` (Netlify redirect in `netlify.toml`).
- **Backend:** Netlify Functions in `oso/netlify/functions/`.
- **DB:** Supabase (service-key-only, server-side).
- **AI:** `@anthropic-ai/sdk` (already a root dep), model `claude-sonnet-4-20250514`.
- **SMS:** Twilio. Recipient hard-coded to `+64272415215` in `_lib/ckf-sms.js`.

## Required env vars (Netlify)

| Variable | Purpose |
| -------- | ------- |
| `SUPABASE_URL` | Supabase project URL (already set for oso) |
| `SUPABASE_SERVICE_KEY` | Service role key (already set) |
| `ANTHROPIC_API_KEY` | Claude API (already set) |
| `TWILIO_SID` | Twilio account SID (already set) |
| `TWILIO_API` | Twilio auth token (already set) |
| `TWILIO_FROM_NUMBER` | Sender phone (already set) |
| `APP_URL` | e.g. `https://oso.nz` — used in SMS body |

The diary reminder does NOT use `ALERT_PHONE_NUMBERS`. CKF uses a code-level constant for the recipient.

## One-time setup

1. **Apply schema:** open `oso/supabase-ckf-schema.sql` and paste it into the Supabase SQL editor. Creates 12 tables, RLS, triggers.
2. **Set `APP_URL`** in Netlify env if not already set.
3. **First sign-in** at `https://oso.nz/ckf` — log in with `cfairweather1996@gmail.com` and a chosen password (8+ chars). The user row auto-bootstraps. Any other email gets 403.

## Routes

| Path | Page |
| --- | --- |
| `/ckf/login` | Email + password (only Curtis is allowed) |
| `/ckf/` | Dashboard: goal grid + today's routine + suggestion count |
| `/ckf/goals` | Goal CRUD |
| `/ckf/goals/:id` | Detail + log new value + history |
| `/ckf/today` | Routine task list, check off / skip |
| `/ckf/diary/:date` (or `/diary/today`) | Multi-step diary form |
| `/ckf/weekly` | Weekly summaries (generate / list) |
| `/ckf/ninety-day-goals` | 90-day goals + AI breakdown |
| `/ckf/business` | Business task list |
| `/ckf/settings` | Change password, sign out, approve/reject suggestions |

## Netlify Functions

| Function | Purpose |
| --- | --- |
| `ckf-auth` | login / logout / check / change-password |
| `ckf-goals` | goals CRUD + log_value + history |
| `ckf-tasks` | routine_tasks CRUD + today + set_status |
| `ckf-diary` | diary CRUD; `save` triggers AI summary + suggestions |
| `ckf-weekly` | list + generate weekly summary |
| `ckf-ninety-day` | 90-day goals CRUD + AI breakdown |
| `ckf-business` | business_tasks CRUD |
| `ckf-suggestions` | list / approve / reject pending routine suggestions |
| `ckf-diary-reminder` | Scheduled. Sends daily SMS at 21:00 NZ if no entry exists. |

Shared helpers in `netlify/functions/_lib/` (Netlify ignores `_`-prefixed dirs):
- `ckf-sb.js` — Supabase REST helpers
- `ckf-guard.js` — auth + email gate (`withGate` wrapper)
- `ckf-sms.js` — Twilio sender, hard-coded recipient guard
- `ckf-ai.js` — Claude prompt helpers (diary, weekly, 90-day)

## Local dev

Two paths:

**A. Production-like (recommended for end-to-end checks):**
```bash
cd oso
netlify dev
```
Hits `http://localhost:8888/ckf/`, runs functions locally. Build the React bundle once first: `cd ckf && npm install && npm run build`.

**B. Fast frontend iteration with HMR:**
```bash
# terminal 1
cd oso && netlify dev   # serves functions on :8888
# terminal 2
cd oso/ckf && npm install && npm run dev   # Vite on :5173 with /.netlify/functions proxied
```
Open `http://localhost:5173/ckf/`.

## Tests

```bash
cd oso
node --test netlify/functions/__tests__
```

Covers:
- SMS recipient guard refuses any number other than `+64272415215`
- Auth gate rejects missing token / non-Curtis email / expired session

## Build (production)

`netlify.toml` runs:
```
cd ckf && npm ci && npm run build && cd .. && hugo --minify
```
Vite output goes to `static/ckf/`. Hugo copies it to `public/ckf/`. The SPA redirect in `netlify.toml` makes deep links work.

## Diary cron

`netlify.toml` schedules `ckf-diary-reminder` at `0 8,9 * * *` UTC. The handler hard-checks Pacific/Auckland local hour and only sends at exactly 21:00 — so each day, exactly one of the two firings sends the SMS, and only if no diary entry exists for today's NZ date.
