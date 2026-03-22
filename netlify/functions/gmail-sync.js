/**
 * gmail-sync.js
 *
 * Netlify scheduled function – runs every 4 hours.
 * Syncs recent emails from all connected Gmail accounts into email_messages table.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */

function sbFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${url}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: opts.prefer || '',
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function refreshToken(account) {
  if (new Date(account.expires_at) > new Date(Date.now() + 60000)) return account;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
    }).toString(),
  });

  const data = await tokenRes.json();
  if (!data.access_token) {
    console.error(`Token refresh failed for ${account.email_address}:`, data);
    return null;
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await sbFetch(`/rest/v1/gmail_accounts?id=eq.${account.id}`, {
    method: 'PATCH',
    body: { access_token: data.access_token, expires_at: expiresAt },
  });

  account.access_token = data.access_token;
  return account;
}

function decodeBase64Url(str) {
  if (!str) return '';
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload) {
  if (!payload) return { html: '', text: '' };
  if (payload.body && payload.body.data && !payload.parts) {
    const decoded = decodeBase64Url(payload.body.data);
    return {
      html: (payload.mimeType || '').includes('html') ? decoded : '',
      text: (payload.mimeType || '').includes('plain') ? decoded : '',
    };
  }
  if (payload.parts) {
    let html = '', text = '';
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) html = decodeBase64Url(part.body.data);
      else if (part.mimeType === 'text/plain' && part.body?.data) text = decodeBase64Url(part.body.data);
      else if (part.mimeType?.startsWith('multipart/') && part.parts) {
        const nested = extractBody(part);
        if (nested.html) html = nested.html;
        if (nested.text) text = nested.text;
      }
    }
    return { html, text };
  }
  return { html: '', text: '' };
}

function getHeader(headers, name) {
  const h = (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function parseEmailAddress(str) {
  if (!str) return '';
  const match = str.match(/<([^>]+)>/);
  return (match ? match[1] : str).trim().toLowerCase();
}

exports.handler = async () => {
  console.log('Gmail sync starting...');

  // Get all active accounts
  const acctRes = await sbFetch('/rest/v1/gmail_accounts?active=eq.true&select=*');
  const accounts = await acctRes.json();

  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.log('No active Gmail accounts.');
    return { statusCode: 200, body: 'No accounts' };
  }

  // Get known customer emails
  const orderRes = await sbFetch('/rest/v1/orders?select=email&limit=5000');
  const orders = await orderRes.json();
  const knownEmails = new Set();
  if (Array.isArray(orders)) orders.forEach(r => { if (r.email) knownEmails.add(r.email.toLowerCase()); });

  let totalSynced = 0;

  for (const account of accounts) {
    try {
      const acct = await refreshToken(account);
      if (!acct) continue;

      console.log(`Syncing ${acct.email_address}...`);

      // Fetch messages from last 24h
      const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=newer_than:1d`, {
        headers: { Authorization: `Bearer ${acct.access_token}` },
      });
      const listData = await listRes.json();

      if (!listData.messages || listData.messages.length === 0) {
        console.log(`  No new messages for ${acct.email_address}`);
        continue;
      }

      // Process in batches of 10
      for (let i = 0; i < listData.messages.length; i += 10) {
        const batch = listData.messages.slice(i, i + 10);
        const details = await Promise.all(
          batch.map(m =>
            fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
              headers: { Authorization: `Bearer ${acct.access_token}` },
            }).then(r => r.json())
          )
        );

        for (const msg of details) {
          if (!msg.id) continue;
          const headers = msg.payload?.headers || [];
          const from = getHeader(headers, 'From');
          const to = getHeader(headers, 'To');
          const fromEmail = parseEmailAddress(from);
          const toEmail = parseEmailAddress(to);
          const isOutbound = fromEmail === acct.email_address.toLowerCase();
          const counterpart = isOutbound ? toEmail : fromEmail;
          const customerEmail = knownEmails.has(counterpart) ? counterpart : null;
          const body = extractBody(msg.payload);
          const labels = msg.labelIds || [];

          await sbFetch('/rest/v1/email_messages', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates',
            body: {
              gmail_id: msg.id,
              thread_id: msg.threadId,
              account_id: acct.id,
              direction: isOutbound ? 'outbound' : 'inbound',
              from_address: from,
              to_address: to,
              cc: getHeader(headers, 'Cc') || '',
              subject: getHeader(headers, 'Subject') || '',
              body_html: body.html || '',
              body_text: body.text || '',
              snippet: msg.snippet || (body.text || '').slice(0, 150),
              date: getHeader(headers, 'Date') ? new Date(getHeader(headers, 'Date')).toISOString() : new Date().toISOString(),
              is_read: !labels.includes('UNREAD'),
              customer_email: customerEmail,
            },
          });
          totalSynced++;
        }
      }

      console.log(`  Synced for ${acct.email_address}`);
    } catch (e) {
      console.error(`Error syncing ${account.email_address}:`, e.message);
    }
  }

  console.log(`Gmail sync complete. ${totalSynced} messages across ${accounts.length} accounts.`);
  return { statusCode: 200, body: `Synced ${totalSynced} messages` };
};
