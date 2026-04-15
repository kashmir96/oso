const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const data = JSON.parse(event.body);
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Save to Supabase
    const { error: dbError } = await supabase
      .from('anti_retail_interests')
      .insert([{
        name: data.name,
        email: data.email,
        company: data.company,
        website: data.website || null,
        category: data.category || null,
        socials: data.socials || null,
        monthly_customers: data.monthly_customers || null,
        ad_platforms: data.ad_platforms || null,
        marketing_team: data.marketing_team || null,
        channels: data.channels || null,
        flagship: data.flagship || null,
        crosssells: data.crosssells || null,
        product_size: data.product_size || null,
        anything_else: data.anything_else || null,
      }]);

    if (dbError) {
      console.error('Supabase error:', dbError);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to save' }) };
    }

    // Send email notification via Supabase Edge Function or simple fetch
    // Using a simple mailto approach via the existing email infrastructure
    const emailBody = `
New Anti-Retail Store Interest

Name: ${data.name}
Email: ${data.email}
Company: ${data.company}
Website: ${data.website || 'N/A'}
Category: ${data.category || 'N/A'}
Monthly Customers: ${data.monthly_customers || 'N/A'}
Social Media: ${data.socials || 'N/A'}
Ad Platforms: ${data.ad_platforms || 'N/A'}
Marketing Team: ${data.marketing_team || 'N/A'}
Sales Channels: ${data.channels || 'N/A'}
Flagship Product: ${data.flagship || 'N/A'}
Cross-sells: ${data.crosssells || 'N/A'}
Product Size: ${data.product_size || 'N/A'}
Notes: ${data.anything_else || 'N/A'}
    `.trim();

    // Send via Gmail API if available, otherwise log
    try {
      const { data: gmailAccounts } = await supabase
        .from('gmail_accounts')
        .select('access_token, refresh_token, email')
        .limit(1)
        .single();

      if (gmailAccounts && gmailAccounts.access_token) {
        const rawEmail = [
          `From: ${gmailAccounts.email}`,
          `To: Curtis@primalpantry.co.nz`,
          `Subject: New Anti-Retail Interest: ${data.company}`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          emailBody
        ].join('\r\n');

        const encodedEmail = Buffer.from(rawEmail).toString('base64url');

        await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${gmailAccounts.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: encodedEmail }),
        });
      }
    } catch (emailErr) {
      console.error('Email send failed (non-critical):', emailErr);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Handler error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
