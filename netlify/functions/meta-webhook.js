/**
 * meta-webhook.js
 *
 * Webhook endpoint for Facebook Messenger + Instagram DMs.
 * GET  → verification challenge
 * POST → incoming message events
 *
 * Env vars: META_PAGE_ACCESS_TOKEN, META_APP_SECRET, META_VERIFY_TOKEN, META_PAGE_ID,
 *           SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const crypto = require('crypto');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function sbFetch(path, opts = {}) {
  return fetch(`${process.env.SUPABASE_URL}${path}`, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || '',
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

// Verify webhook signature from Meta
function verifySignature(body, signature) {
  if (!signature) return false;
  const secret = process.env.META_APP_SECRET;
  if (!secret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Fetch sender profile from Graph API
async function fetchSenderProfile(senderId, platform) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  try {
    const fields = platform === 'instagram' ? 'name,profile_pic' : 'first_name,last_name,profile_pic';
    const res = await fetch(
      `https://graph.facebook.com/v22.0/${senderId}?fields=${fields}&access_token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { name: 'Unknown', profile_pic: '' };
    const data = await res.json();
    const name = platform === 'instagram'
      ? (data.name || 'Instagram User')
      : `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Facebook User';
    return { name, profile_pic: data.profile_pic || '' };
  } catch {
    return { name: platform === 'instagram' ? 'Instagram User' : 'Facebook User', profile_pic: '' };
  }
}

// Get or create meta_contact for a sender
async function getOrCreateContact(senderId, platform) {
  // Check existing
  const res = await sbFetch(`/rest/v1/meta_contacts?platform_id=eq.${encodeURIComponent(senderId)}&select=*`);
  const rows = await res.json();
  if (Array.isArray(rows) && rows.length > 0) return rows[0];

  // Fetch profile and create
  const profile = await fetchSenderProfile(senderId, platform);
  await sbFetch('/rest/v1/meta_contacts', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      platform,
      platform_id: senderId,
      name: profile.name,
      profile_pic: profile.profile_pic,
    },
  });

  return { platform_id: senderId, name: profile.name, profile_pic: profile.profile_pic };
}

exports.handler = async (event) => {
  // ── GET: Webhook verification ──
  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    const mode = qs['hub.mode'];
    const token = qs['hub.verify_token'];
    const challenge = qs['hub.challenge'];

    const expectedToken = process.env.META_VERIFY_TOKEN || 'primalpantry_webhook_2026';
    console.log('Webhook verify attempt:', { mode, tokenMatch: token === expectedToken, hasEnvVar: !!process.env.META_VERIFY_TOKEN });
    if (mode === 'subscribe' && token === expectedToken) {
      console.log('Webhook verified successfully');
      return { statusCode: 200, body: challenge, headers: { 'Content-Type': 'text/plain' } };
    }
    return { statusCode: 403, body: 'Verification failed' };
  }

  // ── POST: Incoming messages ──
  if (event.httpMethod === 'POST') {
    // Validate signature
    const signature = event.headers['x-hub-signature-256'];
    if (process.env.META_APP_SECRET && !verifySignature(event.body, signature)) {
      console.error('Invalid webhook signature');
      return { statusCode: 403, body: 'Invalid signature' };
    }

    let body;
    try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

    const platform = body.object === 'instagram' ? 'instagram' : 'facebook';
    const pageId = process.env.META_PAGE_ID;

    for (const entry of (body.entry || [])) {
      for (const event of (entry.messaging || [])) {
        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        const message = event.message;

        if (!senderId || !message) continue;

        // Skip echo messages (sent by the page itself)
        if (message.is_echo) continue;

        // Get sender info
        const contact = await getOrCreateContact(senderId, platform);

        // Build message text
        let text = message.text || '';
        let attachmentInfo = '';
        if (message.attachments && message.attachments.length > 0) {
          attachmentInfo = message.attachments.map(a => `[${a.type}: ${a.payload?.url || ''}]`).join(' ');
          if (!text) text = attachmentInfo;
        }

        // Store in email_messages
        await sbFetch('/rest/v1/email_messages', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates',
          body: {
            gmail_id: message.mid,
            thread_id: `${platform}_${senderId}`,
            account_id: null,
            channel: platform,
            direction: 'inbound',
            from_address: contact.name,
            to_address: platform === 'facebook' ? 'Primal Pantry (Facebook)' : 'Primal Pantry (Instagram)',
            subject: '',
            body_text: text,
            body_html: '',
            snippet: text.slice(0, 150),
            date: new Date(event.timestamp).toISOString(),
            is_read: false,
            customer_email: contact.customer_email || '',
            order_flagged: false,
            archived: false,
          },
        });

        console.log(`${platform} message from ${contact.name}: ${text.slice(0, 50)}`);
      }
    }

    // Always return 200 quickly
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'ok' }) };
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
