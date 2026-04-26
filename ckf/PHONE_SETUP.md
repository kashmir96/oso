# Twilio phone interface — talk to CKF while locked

A Twilio number you dial; it picks up, you talk, the AI replies, you talk back. Loops until you hang up. Works with screen locked, AirPods, in the car — anywhere you can take a call.

## How it works

```
You (your phone)
  ↓ dial Twilio number
Twilio Voice
  ↓ POST /.netlify/functions/ckf-phone-incoming
CKF (caller-ID gate → only Curtis)
  ↓ TwiML: greet + <Gather speech>
You speak
  ↓ Twilio transcribes (Google STT, included)
Twilio
  ↓ POST /.netlify/functions/ckf-phone-respond?SpeechResult=...
CKF runs the chat pipeline (today's personal conversation,
the same Claude with the same memory + tools)
  ↓ TwiML: <Say> the reply + <Gather> again
… loop until silence or hangup
```

The conversation is the *same* one your web chat uses, scoped to "personal", so memory carries across phone ↔ web. Tools the AI uses on the phone (create_errand, log_goal_value, etc.) write to the same DB.

## What you'll need

1. A Twilio account (https://console.twilio.com).
2. A Twilio phone number with **Voice** capability.
3. Two env vars in Netlify:
   - `TWILIO_VOICE` (optional — defaults to `Polly.Brian-Neural`. Try `Polly.Joanna-Neural`, `Polly.Matthew-Neural`, `Polly.Aria-Neural`, etc.)
   - `APP_URL` (already set: `https://oso.nz`)
4. The existing `TWILIO_SID`, `TWILIO_API`, `TWILIO_FROM_NUMBER` from your existing alerts setup are NOT used here — voice doesn't need them. Only the inbound webhook + caller-ID matter.

## One-time setup

### Buy a Twilio number

1. Console → **Phone Numbers** → **Manage** → **Buy a number**.
2. Country: New Zealand (or any country — calls to NZ from your phone work either way).
3. Capabilities: **Voice** required. SMS not needed for this.
4. Cost: ~$1 USD/month for an NZ local number.

### Wire the webhooks

Click the new number → **Voice Configuration** section:

- **A call comes in:**
  - Webhook: `https://oso.nz/.netlify/functions/ckf-phone-incoming`
  - HTTP: `POST`
- **Call status changes:** leave default.
- **Caller name lookup:** off.

Save.

### Test once

1. Dial the Twilio number from `+64272415215`.
2. You should hear: *"Hey Curtis. What's on your mind?"*
3. Speak something. Wait. AI replies.
4. Continue the conversation. Hang up when done.

If you call from any other number, it says *"This line is private. Goodbye."* and hangs up.

## Costs (estimated)

For ~150 minutes/month of calls:

| Item | Cost |
| --- | --- |
| NZ Twilio number rental | $1.00 |
| Inbound voice (~$0.0085/min × 150) | ~$1.30 |
| Speech-to-text (Twilio Gather, ~$0.02/min × 150) | ~$3.00 |
| Polly Neural TTS (~$0.50) | ~$0.50 |
| Anthropic API (already in your spend) | (covered) |
| **Total** | **~$5.80/month** |

## Voice quality

Default voice is **Polly.Brian-Neural** (calm British male). Other strong options for evening reflection:

- `Polly.Joanna-Neural` — warm American female
- `Polly.Matthew-Neural` — neutral American male
- `Polly.Aria-Neural` — newer Amazon Generative voice
- `Polly.Stephen-Neural` — Australian male (closer to NZ)

Set `TWILIO_VOICE` in Netlify env to switch. No deploy needed for env-only changes — Twilio reads it on next call.

## Limits + caveats

- **Reply length capped at ~600 chars** so Twilio's TTS doesn't drag. The AI naturally keeps phone replies short anyway given the conversation context.
- **Markdown stripped** before <Say> — Polly reads `*` as "asterisk" otherwise.
- **No interrupt-while-speaking.** Twilio's regular `<Gather>` waits until the AI finishes speaking, then listens. To barge in mid-reply you'd need Twilio Media Streams (a websocket bridge). Not built here — pricey + complex.
- **Caller ID is the gate.** If your carrier ever masks your number, the call will be rejected. Use the number as displayed on Twilio (E.164: `+64272415215`).
- **One round-trip per turn.** If the chat loop goes 8 turns deep (tool calls), Twilio waits the whole time. Usually fine — most evening reflection turns are 1 model call. If a recap takes >15s, Twilio may time out the webhook (15s soft limit). Move heavy summaries to the web UI.

## Disabling

To turn the phone interface off without deleting code: in Twilio Console, change the "A call comes in" webhook to a different URL (e.g. a TwiML Bin that just says "Disconnected") — or release the number entirely.
