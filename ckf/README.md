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
| `OPENAI_API_KEY` | OpenAI Whisper for speech-to-text |
| `ELEVENLABS_API_KEY` | ElevenLabs text-to-speech |
| `ELEVENLABS_VOICE_ID` | Optional. Defaults to `JBFqnCBsd6RMkjVDRZzb` (George — calm male). |
| `TWILIO_SID` | Twilio account SID (already set) |
| `TWILIO_API` | Twilio auth token (already set) |
| `TWILIO_FROM_NUMBER` | Sender phone (already set) |
| `APP_URL` | e.g. `https://oso.nz` — used in SMS body |

The diary reminder does NOT use `ALERT_PHONE_NUMBERS`. CKF uses a code-level constant for the recipient.

## One-time setup

1. **Apply schema:** open `oso/supabase-ckf-schema.sql` and paste it into the Supabase SQL editor. Creates 12 tables, RLS, triggers.
2. **Apply chat schema:** open `oso/supabase-ckf-chat-schema.sql` and paste it. Adds `ckf_conversations`, `ckf_messages`, `ckf_memory_facts`.
2a. **Apply marketing schema (optional, only needed before opening `/business/marketing`):** open `oso/supabase-mktg-schema.sql` and paste it. Adds the 18 `mktg_*` tables. Then visit `/ckf/business/marketing` and click **Seed playbook** to bulk-load the bundled JSON.
2b. **Create the marketing storage bucket** for chat image uploads (paste / file-picker). In the Supabase dashboard → Storage → New bucket → name `mktg-uploads`, **private**, no file-size override (Netlify function caps at 8 MB). The function signs short-lived URLs server-side; nothing touches the bucket policies.
2b. **Apply unfiltered column:** open `oso/supabase-ckf-unfiltered-column.sql` and paste it. Adds the `unfiltered TEXT` catch-all column to `diary_entries` (used by the closing chest-clearing question).
3. **Set `APP_URL`** in Netlify env if not already set.
4. **First sign-in** at `https://oso.nz/ckf` — log in with `cfairweather1996@gmail.com` and a chosen password (8+ chars). The user row auto-bootstraps. Any other email gets 403.

## Routes

| Path | Page |
| --- | --- |
| `/ckf/login` | Email + password (only Curtis is allowed) |
| `/ckf/` | Dashboard: goal grid + today's routine + suggestion count |
| `/ckf/goals` | Goal CRUD |
| `/ckf/goals/:id` | Detail + log new value + history |
| `/ckf/today` | Routine task list, check off / skip |
| `/ckf/chat` | Conversational AI — therapist / business / PT / spiritual hats |
| `/ckf/chat/:id` | Specific conversation by id |
| `/ckf/chat/memory` | Long-term memory facts the AI has accumulated |
| `/ckf/weekly` | Weekly summaries (generate / list) |
| `/ckf/ninety-day-goals` | 90-day goals + AI breakdown |
| `/ckf/business` | Business task list — top of page links into Marketing |
| `/ckf/business/marketing` | PrimalPantry marketing playbook (campaigns, concepts, ads, scripts, library). **Lazy-loaded** — chunk only fetched on first visit, so the diary stays fast. |
| `/ckf/business/marketing/campaigns/:id` | Campaign drilldown |
| `/ckf/business/marketing/concepts` / `/concepts/:id` | Concept browser + detail |
| `/ckf/business/marketing/ads` / `/ads/:ad_id` | Ad browser + detail (sortable by spend / sales / CPR) |
| `/ckf/business/marketing/scripts` / `/scripts/:id` | Production-script browser + detail |
| `/ckf/business/marketing/library` | Reference tabs: copy/visual/video archetypes, offers, hooks, symptoms, trust signals, locked decisions, weekly batches |
| `/ckf/business/marketing/chat` / `/chat/:id` | Marketing context chat — Haiku 4.5 + tool-use over the playbook + uploads. Full-screen. Composer has 🖼 (attach image to chat — vision), 📷 (capture-to-swipe-file with context prompt), and ＋ (text/link/screenshot description). |
| `/ckf/business/marketing/memory` | Long-term marketing memory facts the AI has saved |
| `/ckf/business/marketing/swipe` | Swipe file — every camera-captured inspiration, with caption + tags. Filterable by tag and campaign. |
| `/ckf/business/marketing/drafts` | List of in-progress and shipped ad drafts |
| `/ckf/business/marketing/wizard` / `/wizard/:id` | Meta Ads creator wizard — 7 steps (objective → campaign → format → concept → creative → copy → final). Generates concept recs, creative direction (video timeline + VO + B-roll, or visual brief + image prompts), and 2 primary-text variants. Final page is copy-paste-ready in Meta field order. |
| `/ckf/settings` | Change password, sign out, approve/reject suggestions |

## Netlify Functions

| Function | Purpose |
| --- | --- |
| `ckf-auth` | login / logout / check / change-password |
| `ckf-goals` | goals CRUD + log_value + history |
| `ckf-tasks` | routine_tasks CRUD + today + set_status |
| `ckf-diary` | diary CRUD (still used by tools and old form-style writes) |
| `ckf-chat` | Chat: list/open_today/auto_open/get/send + memory list/archive. Haiku 4.5 + prompt caching for low latency. Tool-use loop calls Claude with read+write tools (see `_lib/ckf-tools.js`). |
| `ckf-stt` | Speech-to-text via OpenAI Whisper. Accepts `{audio_base64, mime_type}`, returns `{text}`. |
| `ckf-tts` | Text-to-speech via ElevenLabs (Flash v2.5). Accepts `{text}`, returns `{audio_base64}`. |
| `ckf-weekly` | list + generate weekly summary |
| `ckf-ninety-day` | 90-day goals CRUD + AI breakdown |
| `ckf-business` | business_tasks CRUD |
| `ckf-suggestions` | list / approve / reject pending routine suggestions |
| `ckf-diary-reminder` | Scheduled. Sends daily SMS at 21:00 NZ if no entry exists. |
| `mktg-data` | Read-only marketing entity queries (`list_*`, `get_*`, `summary`). |
| `mktg-seed` | One-time bulk loader; reads bundled `_mktg-seed/*.json`. POST `{action:'seed', confirm:'YES'}`. |
| `mktg-perf` | Pulls ad-level Meta insights for a date window and patches `mktg_ads.performance` by matched ad_id. Uses `FB_AD_ACCOUNT_ID` / `FB_ACCESS_TOKEN`. |
| `mktg-chat` | Marketing chat (Haiku 4.5, prompt-cached system, tool-use loop). Tools defined in `_lib/mktg-tools.js` cover read/search across all playbook entities + write tools (`save_upload`, `tag_upload_to_entity`, `remember`, `archive_memory_fact`). |
| `mktg-upload` | Client-side capture into `mktg_uploads`. Supports `kind` of text / link / screenshot / **image**. Image binaries land in the private `mktg-uploads` Supabase Storage bucket; the chat function expands stored `image_ref` blocks to Claude vision blocks per turn (base64 fetched on demand, never persisted). Action `signed_url` mints 5-minute display URLs. |
| `mktg-ads` | Meta Ads creator wizard backend. Manages `mktg_drafts` rows (CRUD + archive) and runs Sonnet 4.6 generation: `generate_concepts` (3 recs from playbook + top ads), `generate_creative` (video timeline + VO + B-roll, or visual brief + image prompts), `generate_copy` (2 primary-text variants + headline + description + CTA + naming). `regenerate_step` accepts optional `feedback` for in-step refinements. |

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
