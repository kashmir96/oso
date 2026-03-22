/**
 * meta-send.js
 *
 * Send replies to Facebook Messenger / Instagram DMs via Meta Send API.
 *
 * POST body: { token, platform, recipient_id, text, thread_id }
 *
 * Env vars: META_PAGE_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY
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
  const headers = {
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  return fetch(`${process.env.SUPABASE_URL}${path}`, {
    headers,
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }

  const staff = await getStaffByToken(body.token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  const { platform, recipient_id, text, thread_id } = body;
  if (!recipient_id || !text) return reply(400, { error: 'recipient_id and text required' });
  if (!platform || !['facebook', 'instagram'].includes(platform)) {
    return reply(400, { error: 'platform must be facebook or instagram' });
  }

  const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (!pageToken) return reply(500, { error: 'META_PAGE_ACCESS_TOKEN not configured' });

  // Send via Meta Send API
  const sendRes = await fetch(
    `https://graph.facebook.com/v22.0/me/messages?access_token=${pageToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipient_id },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    }
  );

  const sendData = await sendRes.json();
  if (!sendRes.ok) {
    console.error('Meta send error:', sendData);
    return reply(500, { error: 'Failed to send', detail: sendData.error?.message || JSON.stringify(sendData) });
  }

  // Get sender name for the "to" field
  const contactRes = await sbFetch(`/rest/v1/meta_contacts?platform_id=eq.${encodeURIComponent(recipient_id)}&select=name`);
  const contacts = await contactRes.json();
  const recipientName = (contacts && contacts[0]) ? contacts[0].name : 'Unknown';

  // Record in email_messages
  await sbFetch('/rest/v1/email_messages', {
    method: 'POST',
    body: {
      gmail_id: sendData.message_id || `meta_${Date.now()}`,
      thread_id: thread_id || `${platform}_${recipient_id}`,
      channel: platform,
      direction: 'outbound',
      from_address: platform === 'facebook' ? 'Primal Pantry (Facebook)' : 'Primal Pantry (Instagram)',
      to_address: recipientName,
      subject: '',
      body_text: text,
      body_html: '',
      snippet: text.slice(0, 150),
      date: new Date().toISOString(),
      is_read: true,
      staff_id: staff.id,
      staff_name: staff.display_name || 'Staff',
      order_flagged: false,
      archived: false,
    },
  });

  // Log activity
  await sbFetch('/rest/v1/staff_activity_log', {
    method: 'POST',
    body: {
      staff_id: staff.id,
      action: `${platform}_message_sent`,
      details: `Sent ${platform} message to ${recipientName}: "${text.slice(0, 80)}"`,
    },
  });

  return reply(200, { success: true, message_id: sendData.message_id });
};
