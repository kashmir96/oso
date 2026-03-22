/**
 * google-gmail.js
 *
 * Gmail API proxy for the Primal Pantry dashboard.
 * Handles: sync, threads, get, send, mark_read, accounts.
 * Multi-account: each action targets a specific gmail_accounts row.
 *
 * POST body: { action, token, account_id?, ... }
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(code, data) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(data) };
}

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

async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role,display_name`);
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

// ── Token management ──

async function getAccountTokens(accountId) {
  const res = await sbFetch(`/rest/v1/gmail_accounts?id=eq.${accountId}&active=eq.true&select=*`);
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  const row = rows[0];

  // Refresh if token expires within 60s
  if (new Date(row.expires_at) < new Date(Date.now() + 60000)) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token refresh failed for account', accountId, tokenData);
      return null;
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await sbFetch(`/rest/v1/gmail_accounts?id=eq.${accountId}`, {
      method: 'PATCH',
      body: { access_token: tokenData.access_token, expires_at: expiresAt },
    });

    row.access_token = tokenData.access_token;
  }

  return row;
}

async function gmailFetch(accessToken, path, opts = {}) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

// ── MIME parsing ──

function decodeBase64Url(str) {
  if (!str) return '';
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function extractBody(payload) {
  if (!payload) return { html: '', text: '' };

  // Single part message
  if (payload.body && payload.body.data && !payload.parts) {
    const decoded = decodeBase64Url(payload.body.data);
    const mimeType = payload.mimeType || '';
    return {
      html: mimeType.includes('html') ? decoded : '',
      text: mimeType.includes('plain') ? decoded : '',
    };
  }

  // Multipart
  if (payload.parts) {
    let html = '', text = '';
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        html = decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        text = decodeBase64Url(part.body.data);
      } else if (part.mimeType && part.mimeType.startsWith('multipart/') && part.parts) {
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
  if (!headers) return '';
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function parseEmailAddress(str) {
  if (!str) return '';
  const match = str.match(/<([^>]+)>/);
  return (match ? match[1] : str).trim().toLowerCase();
}

function encodeBase64Url(str) {
  return Buffer.from(str, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Get known customer emails for matching ──

async function getKnownEmails() {
  const res = await sbFetch('/rest/v1/orders?select=email&limit=5000');
  const rows = await res.json();
  const emails = new Set();
  if (Array.isArray(rows)) {
    rows.forEach(r => { if (r.email) emails.add(r.email.toLowerCase()); });
  }
  return emails;
}

// ── Sync messages from Gmail into Supabase ──

async function syncAccount(account, knownEmails, maxResults = 100) {
  const tokens = await getAccountTokens(account.id);
  if (!tokens) { console.log('No tokens for account', account.id); return 0; }

  // Fetch recent messages
  console.log(`Fetching messages for ${account.email_address}...`);
  const listData = await gmailFetch(tokens.access_token, `/messages?maxResults=${maxResults}&q=newer_than:2d`);
  console.log(`Gmail list response:`, listData.messages ? listData.messages.length + ' messages' : 'no messages', listData.error || '');
  if (listData.error) { console.error('Gmail API error:', JSON.stringify(listData.error)); return 0; }
  if (!listData.messages || listData.messages.length === 0) return 0;

  let synced = 0;
  // Process in batches of 5 (smaller to avoid timeouts)
  for (let i = 0; i < listData.messages.length; i += 5) {
    const batch = listData.messages.slice(i, i + 5);
    const details = await Promise.all(
      batch.map(m => gmailFetch(tokens.access_token, `/messages/${m.id}?format=full`))
    );

    for (const msg of details) {
      if (!msg.id) continue;

      const headers = msg.payload?.headers || [];
      const from = getHeader(headers, 'From');
      const to = getHeader(headers, 'To');
      const cc = getHeader(headers, 'Cc');
      const subject = getHeader(headers, 'Subject');
      const dateStr = getHeader(headers, 'Date');
      const fromEmail = parseEmailAddress(from);
      const toEmail = parseEmailAddress(to);

      // Determine direction
      const isOutbound = fromEmail === account.email_address.toLowerCase();
      const direction = isOutbound ? 'outbound' : 'inbound';

      // Match customer email
      const counterpart = isOutbound ? toEmail : fromEmail;
      const customerEmail = knownEmails.has(counterpart) ? counterpart : null;

      const body = extractBody(msg.payload);
      const labels = msg.labelIds || [];
      const isRead = !labels.includes('UNREAD');

      // Strip HTML for snippet
      let snippet = msg.snippet || '';
      if (!snippet && body.text) snippet = body.text.slice(0, 150);

      // Upsert
      await sbFetch('/rest/v1/email_messages', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: {
          gmail_id: msg.id,
          thread_id: msg.threadId,
          account_id: account.id,
          direction,
          from_address: from,
          to_address: to,
          cc: cc || '',
          subject: subject || '',
          body_html: body.html || '',
          body_text: body.text || '',
          snippet,
          date: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
          is_read: isRead,
          customer_email: customerEmail,
        },
      });
      synced++;
    }
  }

  return synced;
}

// ── Main handler ──

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }

  const { action, token } = body;
  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  // ── debug: test raw Gmail API access ──
  if (action === 'debug') {
    const acctRes = await sbFetch('/rest/v1/gmail_accounts?active=eq.true&select=id,email_address');
    const accounts = await acctRes.json();
    if (!accounts || accounts.length === 0) return reply(200, { error: 'No active accounts' });

    const acct = await getAccountTokens(accounts[0].id);
    if (!acct) return reply(200, { error: 'Could not get tokens for account ' + accounts[0].id });

    // Try listing messages with no query filter
    const listRes = await gmailFetch(acct.access_token, '/messages?maxResults=3');
    // Also try profile
    const profileRes = await gmailFetch(acct.access_token, '/profile');
    return reply(200, { account: accounts[0].email_address, profile: profileRes, messages: listRes });
  }

  // ── accounts: list connected Gmail accounts ──
  if (action === 'accounts') {
    const res = await sbFetch('/rest/v1/gmail_accounts?active=eq.true&select=id,email_address,display_name,connected_at&order=connected_at.asc');
    const accounts = await res.json();
    return reply(200, { accounts: accounts || [] });
  }

  // ── sync: pull recent emails from all accounts ──
  if (action === 'sync') {
    const acctRes = await sbFetch('/rest/v1/gmail_accounts?active=eq.true&select=id,email_address');
    const accounts = await acctRes.json();
    if (!accounts || accounts.length === 0) return reply(200, { synced: 0, message: 'No Gmail accounts connected' });

    // Use empty set for customer matching to keep sync fast
    const knownEmails = new Set();
    let total = 0;
    const maxResults = Math.min(body.maxResults || 10, 10); // Cap at 10 to stay within timeout
    for (const acct of accounts) {
      try {
        const count = await syncAccount(acct, knownEmails, maxResults);
        total += count;
      } catch (e) {
        console.error(`Sync error for ${acct.email_address}:`, e.message);
      }
    }
    return reply(200, { synced: total });
  }

  // ── threads: get conversation threads for Comms tab ──
  if (action === 'threads') {
    const limit = body.limit || 50;
    const search = body.search || '';
    const filter = body.filter || 'all';

    // Single lightweight query
    const res = await sbFetch('/rest/v1/email_messages?select=thread_id,customer_email,from_address,to_address,subject,snippet,date,direction,is_read,account_id,order_flagged&archived=eq.false&order=date.desc&limit=200');
    const msgs = await res.json();
    if (!Array.isArray(msgs)) return reply(200, { threads: [] });

    // Group by thread_id
    const threadMap = {};
    for (const m of msgs) {
      const key = m.thread_id || m.customer_email || m.from_address;
      if (!threadMap[key]) {
        const email = m.customer_email || (m.direction === 'inbound' ? parseEmailAddress(m.from_address) : parseEmailAddress(m.to_address));
        threadMap[key] = {
          thread_id: m.thread_id,
          customer_email: email,
          customer_name: email || 'Unknown',
          last_subject: m.subject,
          last_snippet: m.snippet,
          last_date: m.date,
          unread_count: 0,
          message_count: 0,
          account_id: m.account_id,
          order_flagged: false,
          contact_type: 'customer',
          contact_name: null,
        };
      }
      threadMap[key].message_count++;
      if (!m.is_read && m.direction === 'inbound') threadMap[key].unread_count++;
      if (m.order_flagged) threadMap[key].order_flagged = true;
    }

    let threads = Object.values(threadMap)
      .sort((a, b) => new Date(b.last_date) - new Date(a.last_date));

    // Enrich with contact types (non-blocking, best-effort)
    try {
      const contactRes = await sbFetch('/rest/v1/contacts?select=email,name,company,type');
      const contactRows = await contactRes.json();
      if (Array.isArray(contactRows) && contactRows.length > 0) {
        const contactMap = {};
        contactRows.forEach(c => { contactMap[c.email.toLowerCase()] = c; });
        for (const t of threads) {
          const contact = contactMap[t.customer_email];
          if (contact) {
            t.contact_type = contact.type;
            t.contact_name = contact.company || contact.name;
            t.customer_name = t.contact_name;
          }
        }
      }
    } catch { /* contacts lookup failed, continue without */ }

    // Filter
    if (filter === 'suppliers') threads = threads.filter(t => t.contact_type === 'supplier');
    else if (filter === 'wholesalers') threads = threads.filter(t => t.contact_type === 'wholesaler');
    else if (filter === 'customers') threads = threads.filter(t => t.contact_type === 'customer');
    else if (filter === 'flagged') threads = threads.filter(t => t.order_flagged);

    if (search) {
      const q = search.toLowerCase();
      threads = threads.filter(t =>
        (t.customer_email || '').toLowerCase().includes(q) ||
        (t.last_subject || '').toLowerCase().includes(q) ||
        (t.last_snippet || '').toLowerCase().includes(q)
      );
    }

    return reply(200, { threads: threads.slice(0, limit) });
  }

  // ── get: fetch single message detail ──
  if (action === 'get') {
    const { message_id, account_id } = body;
    if (!message_id || !account_id) return reply(400, { error: 'message_id and account_id required' });

    const acct = await getAccountTokens(account_id);
    if (!acct) return reply(400, { error: 'Account not found or inactive' });

    const msg = await gmailFetch(acct.access_token, `/messages/${message_id}?format=full`);
    const headers = msg.payload?.headers || [];
    const msgBody = extractBody(msg.payload);

    return reply(200, {
      id: msg.id,
      threadId: msg.threadId,
      from: getHeader(headers, 'From'),
      to: getHeader(headers, 'To'),
      cc: getHeader(headers, 'Cc'),
      subject: getHeader(headers, 'Subject'),
      date: getHeader(headers, 'Date'),
      body_html: msgBody.html,
      body_text: msgBody.text,
      labels: msg.labelIds || [],
    });
  }

  // ── send: compose and send email via Gmail API ──
  if (action === 'send') {
    const { account_id, to, cc, bcc, subject, body: emailBody, threadId } = body;
    if (!account_id || !to) return reply(400, { error: 'account_id and to required' });

    const acct = await getAccountTokens(account_id);
    if (!acct) return reply(400, { error: 'Account not found or inactive' });

    // Build RFC 2822 message
    const lines = [
      `From: ${acct.display_name || acct.email_address} <${acct.email_address}>`,
      `To: ${to}`,
    ];
    if (cc) lines.push(`Cc: ${cc}`);
    if (bcc) lines.push(`Bcc: ${bcc}`);
    lines.push(`Subject: ${subject || ''}`);
    lines.push('Content-Type: text/html; charset=utf-8');
    lines.push('MIME-Version: 1.0');
    lines.push('');
    // Wrap plain text in basic HTML if no HTML tags present
    const htmlBody = (emailBody || '').includes('<') ? emailBody : `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#333;">${(emailBody || '').replace(/\n/g, '<br>')}</div>`;
    lines.push(htmlBody);

    const raw = encodeBase64Url(lines.join('\r\n'));

    const sendPayload = { raw };
    if (threadId) sendPayload.threadId = threadId;

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${acct.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sendPayload),
    });

    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      console.error('Gmail send error:', sendData);
      return reply(500, { error: 'Failed to send', detail: sendData.error?.message || sendData });
    }

    // Record in email_messages
    const knownEmails = await getKnownEmails();
    const toEmail = parseEmailAddress(to);
    const customerEmail = knownEmails.has(toEmail) ? toEmail : null;

    await sbFetch('/rest/v1/email_messages', {
      method: 'POST',
      body: {
        gmail_id: sendData.id,
        thread_id: sendData.threadId || threadId || sendData.id,
        account_id: account_id,
        direction: 'outbound',
        from_address: `${acct.display_name || acct.email_address} <${acct.email_address}>`,
        to_address: to,
        cc: cc || '',
        bcc: bcc || '',
        subject: subject || '',
        body_html: htmlBody,
        body_text: emailBody || '',
        snippet: (emailBody || '').slice(0, 150),
        date: new Date().toISOString(),
        is_read: true,
        customer_email: customerEmail,
        staff_id: staff.id,
        staff_name: staff.display_name || 'Staff',
        send_type: body.send_type || 'direct',
      },
    });

    // Log to staff_activity_log
    await sbFetch('/rest/v1/staff_activity_log', {
      method: 'POST',
      body: {
        staff_id: staff.id,
        action: 'email_sent',
        details: `Sent email to ${to}: "${(subject || '').slice(0, 80)}"`,
      },
    });

    return reply(200, { success: true, gmail_id: sendData.id, thread_id: sendData.threadId });
  }

  // ── mark_read: mark a message as read ──
  if (action === 'mark_read') {
    const { message_id, account_id } = body;
    if (!message_id || !account_id) return reply(400, { error: 'message_id and account_id required' });

    const acct = await getAccountTokens(account_id);
    if (!acct) return reply(400, { error: 'Account not found' });

    await gmailFetch(acct.access_token, `/messages/${message_id}/modify`, {
      method: 'POST',
      body: { removeLabelIds: ['UNREAD'] },
    });

    // Update local record
    await sbFetch(`/rest/v1/email_messages?gmail_id=eq.${encodeURIComponent(message_id)}&account_id=eq.${account_id}`, {
      method: 'PATCH',
      body: { is_read: true },
    });

    return reply(200, { success: true });
  }

  // ── thread_messages: get all messages in a thread ──
  if (action === 'thread_messages') {
    const { thread_id } = body;
    if (!thread_id) return reply(400, { error: 'thread_id required' });

    const res = await sbFetch(`/rest/v1/email_messages?thread_id=eq.${encodeURIComponent(thread_id)}&order=date.asc`);
    const messages = await res.json();
    return reply(200, { messages: messages || [] });
  }

  // ── prompt: admin flags an email for a staff member ──
  if (action === 'prompt') {
    const { message_id, thread_id, to_staff_id, note } = body;
    if (!to_staff_id) return reply(400, { error: 'to_staff_id required' });

    const promptBody = {
      thread_id: thread_id || null,
      from_staff_id: staff.id,
      to_staff_id: parseInt(to_staff_id),
      note: note || '',
    };
    if (message_id) promptBody.email_message_id = parseInt(message_id);

    await sbFetch('/rest/v1/email_prompts', { method: 'POST', body: promptBody });

    // Log activity
    const staffRes = await sbFetch(`/rest/v1/staff?id=eq.${to_staff_id}&select=display_name`);
    const staffRows = await staffRes.json();
    const targetName = staffRows[0]?.display_name || 'staff';
    await sbFetch('/rest/v1/staff_activity_log', {
      method: 'POST',
      body: { staff_id: staff.id, action: 'email_prompted', details: `Prompted ${targetName} to check email thread` },
    });

    return reply(200, { success: true });
  }

  // ── get_prompts: get unseen prompts for current staff ──
  if (action === 'get_prompts') {
    // Get unseen prompts for this staff member
    const promptRes = await sbFetch(`/rest/v1/email_prompts?to_staff_id=eq.${staff.id}&seen=eq.false&order=created_at.desc&limit=20`);
    const prompts = await promptRes.json();

    // Enrich with message details and prompter name
    const enriched = [];
    for (const p of (prompts || [])) {
      let msgData = {};
      if (p.email_message_id) {
        const mRes = await sbFetch(`/rest/v1/email_messages?id=eq.${p.email_message_id}&select=from_address,to_address,subject,snippet,date,account_id,thread_id`);
        const mRows = await mRes.json();
        if (mRows && mRows[0]) msgData = mRows[0];
      } else if (p.thread_id) {
        const mRes = await sbFetch(`/rest/v1/email_messages?thread_id=eq.${encodeURIComponent(p.thread_id)}&order=date.desc&limit=1&select=from_address,to_address,subject,snippet,date,account_id`);
        const mRows = await mRes.json();
        if (mRows && mRows[0]) msgData = mRows[0];
      }

      // Get prompter name
      const fromRes = await sbFetch(`/rest/v1/staff?id=eq.${p.from_staff_id}&select=display_name`);
      const fromRows = await fromRes.json();

      enriched.push({
        id: p.id,
        thread_id: p.thread_id || msgData.thread_id,
        from_staff: fromRows[0]?.display_name || 'Admin',
        note: p.note,
        created_at: p.created_at,
        email_from: msgData.from_address || '',
        email_subject: msgData.subject || '',
        email_snippet: msgData.snippet || '',
        email_date: msgData.date || '',
        account_id: msgData.account_id,
      });
    }

    return reply(200, { prompts: enriched });
  }

  // ── dismiss_prompt: mark prompt as seen ──
  if (action === 'dismiss_prompt') {
    const { prompt_id } = body;
    if (!prompt_id) return reply(400, { error: 'prompt_id required' });

    await sbFetch(`/rest/v1/email_prompts?id=eq.${prompt_id}`, {
      method: 'PATCH',
      body: { seen: true, seen_at: new Date().toISOString() },
    });

    return reply(200, { success: true });
  }

  // ── flag_order: toggle order flag on a thread ──
  if (action === 'flag_order') {
    const { thread_id, flagged } = body;
    if (!thread_id) return reply(400, { error: 'thread_id required' });

    await sbFetch(`/rest/v1/email_messages?thread_id=eq.${encodeURIComponent(thread_id)}`, {
      method: 'PATCH',
      body: { order_flagged: flagged !== false },
    });

    return reply(200, { success: true });
  }

  // ── flag_archive: archive/unarchive a thread ──
  if (action === 'flag_archive') {
    const { thread_id, archived } = body;
    if (!thread_id) return reply(400, { error: 'thread_id required' });

    await sbFetch(`/rest/v1/email_messages?thread_id=eq.${encodeURIComponent(thread_id)}`, {
      method: 'PATCH',
      body: { archived: archived !== false },
    });

    return reply(200, { success: true });
  }

  // ── get_staff_list: for prompt dropdown ──
  if (action === 'get_staff_list') {
    const res = await sbFetch('/rest/v1/staff?select=id,display_name,role&order=display_name.asc');
    const staffList = await res.json();
    return reply(200, { staff: (staffList || []).filter(s => s.id !== staff.id) });
  }

  return reply(400, { error: 'Unknown action: ' + action });
};
