# iOS Shortcut — talk to CKF while phone is locked

Apple Shortcuts can run while the screen is locked, including from "Hey Siri" or the Action button. This guide builds a simple back-and-forth: dictate → AI replies → speak the reply.

It uses one endpoint: `POST /.netlify/functions/ckf-quick` which:
- accepts `{ "text": "..." }` in JSON OR a plain-text body
- requires the `X-CKF-Token` header (your session token)
- opens / reuses today's personal conversation
- returns `{ "text": "<reply>" }`

The session token lives in your phone's localStorage after you log in to CKF in Safari. To copy it:

1. Open `https://oso.nz/ckf` in Safari and log in.
2. In Safari, tap **AA** in the URL bar → **Show Web Inspector** (requires Settings → Safari → Advanced → Web Inspector → on, plus a Mac for inspecting). Easier path:
3. Visit `https://oso.nz/ckf` while logged in, paste this in the URL bar (Safari accepts `javascript:` only via Bookmarklets — alternative below):
4. **Easier:** open the chat in CKF on your phone, type `/token` (the AI doesn't currently expose this — fastest is to just open Safari Web Inspector once via macOS, or use this trick):
   - On any CKF page, tap the URL bar, type `javascript:document.body.innerText=localStorage.getItem('ckf_token')` and press go. The page will display your token. Copy it. (You may need to enable `Settings → Safari → Advanced → Allow JavaScript URLs`.)
   - Then go back: `https://oso.nz/ckf`.

You'll only do this once per device — tokens are valid for 30 days; do it again if it expires.

---

## Build the Shortcut

Open the **Shortcuts** app → **+** to create a new Shortcut.

### Action 1 — Dictate Text
- Action: **Dictate Text**
- Stop Listening: **After Pause** (or **On Tap** if you want full control)
- Language: English (NZ) or whatever

### Action 2 — Get Contents of URL
- Action: **Get Contents of URL**
- URL: `https://oso.nz/.netlify/functions/ckf-quick`
- Method: **POST**
- Headers (tap to add):
  - `Content-Type` = `application/json`
  - `X-CKF-Token` = `<paste your session token>`
- Request Body: **JSON**
  - Add field: `text` (Text) → tap the field → **Magic Variable** → **Dictated Text**

### Action 3 — Get Dictionary Value
- Action: **Get Dictionary Value**
- Get: **Value**
- Key: `text`
- Dictionary: **Magic Variable** → **Contents of URL**

### Action 4 — Speak Text
- Action: **Speak Text**
- Text: **Magic Variable** → **Dictionary Value**
- Voice: pick a calm one (Daniel, Karen, etc.)
- Wait Until Finished: **on**

Save the Shortcut as **"Talk to CKF"** (or whatever — that name is the Siri trigger).

---

## Use it

- "Hey Siri, talk to CKF" → dictate → it speaks the reply.
- Works while phone is locked (you may need to authenticate with Face ID first if your Lock Screen permission for Shortcuts is set to "Require Authentication").
- You can also wire the Shortcut to:
  - **Action Button** (iPhone 15 Pro+): Settings → Action Button → Shortcut → Talk to CKF.
  - **Back Tap**: Settings → Accessibility → Touch → Back Tap → Triple Tap → Talk to CKF.
  - **Lock Screen widget** (Shortcuts widget, picks the shortcut to surface).

## Limitations vs. a true conversation loop

- One round per Siri invocation. No mid-conversation interrupts.
- Each call costs ~1–2 cents in Anthropic + nothing else (Siri's TTS is on-device, free).
- Conversation history is preserved server-side — Siri lookups land in your today personal chat, just like the web UI.

If you want true continuous bidirectional voice while locked (full Twilio phone interface), that's a separate build — see the next round.
