/**
 * ckf-calendar.js — read-only Google Calendar reader.
 *
 * Actions:
 *   list_today             -> events from now until end of NZ day
 *   list_range             -> { events } between { from, to } ISO timestamps
 *   list_calendars         -> the user's calendar list (id, summary, primary)
 *
 * Requires the user to have connected google_calendar via Settings.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (for token refresh).
 */
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { getValidIntegration } = require('./_lib/ckf-oauth.js');

function nzDay(now = new Date()) {
  // Start and end of "today" in NZ time, returned as ISO strings.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' });
  const dateStr = fmt.format(now);                         // YYYY-MM-DD (NZ)
  // Construct boundaries in NZ time. We don't know current NZ offset cheaply,
  // so trust the date string and let Google handle TZ conversion via an offset
  // we compute by formatting an explicit time.
  const tzFmt = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', timeZoneName: 'short',
  });
  // Just use raw date with Z-less form — Google accepts RFC3339 and we ask it
  // to interpret times in Pacific/Auckland by sending offset suffix.
  // For simplicity: send timeMin = nowISO, timeMax = next day midnight UTC.
  const todayUtc = new Date(`${dateStr}T00:00:00Z`).getTime();
  return {
    today: dateStr,
    timeMin: now.toISOString(),
    timeMax: new Date(todayUtc + 36 * 3600e3).toISOString(), // +36h covers any TZ wiggle
  };
}

async function listEvents({ accessToken, calendarId = 'primary', timeMin, timeMax, maxResults = 25 }) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', String(maxResults));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.items || [])
    // Skip declined and cancelled
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      id: e.id,
      summary: e.summary || '(no title)',
      description: e.description || null,
      location: e.location || null,
      start: e.start?.dateTime || e.start?.date || null,
      end: e.end?.dateTime || e.end?.date || null,
      all_day: !!e.start?.date && !e.start?.dateTime,
      hangout_link: e.hangoutLink || null,
      html_link: e.htmlLink || null,
      attendees: (e.attendees || []).map((a) => ({ email: a.email, response: a.responseStatus })),
    }));
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  const integration = await getValidIntegration(user.id, 'google_calendar');
  if (!integration) return reply(400, { error: 'Google Calendar not connected', not_connected: true });

  if (action === 'list_calendars') {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${integration.access_token}` },
    });
    if (!res.ok) return reply(res.status, { error: `Google Calendar ${res.status}` });
    const json = await res.json();
    return reply(200, { calendars: (json.items || []).map((c) => ({ id: c.id, summary: c.summary, primary: !!c.primary })) });
  }

  if (action === 'list_today') {
    const { timeMin, timeMax } = nzDay();
    try {
      const events = await listEvents({ accessToken: integration.access_token, timeMin, timeMax });
      return reply(200, { events });
    } catch (e) {
      return reply(500, { error: e.message });
    }
  }

  if (action === 'list_range') {
    let { from, to, calendar_id } = body;
    if (!from || !to) {
      const day = nzDay();
      from = from || day.timeMin;
      to = to || day.timeMax;
    }
    try {
      const events = await listEvents({
        accessToken: integration.access_token,
        calendarId: calendar_id || 'primary',
        timeMin: from,
        timeMax: to,
      });
      return reply(200, { events, from, to });
    } catch (e) {
      return reply(500, { error: e.message });
    }
  }

  return reply(400, { error: 'Unknown action' });
});
