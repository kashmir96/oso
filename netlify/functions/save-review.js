/**
 * save-review.js
 *
 * Public endpoint — saves a customer review submitted from the review page.
 *
 * POST body:
 *   { order_id, email, customer_name, rating, review_text }
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  try {
    const { order_id, email, customer_name, rating, review_text } = JSON.parse(event.body);

    if (!email || !rating) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'email and rating required' }) };
    }

    if (rating < 1 || rating > 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'rating must be 1-5' }) };
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data, error } = await sb.from('customer_reviews').insert({
      order_id: order_id || null,
      email,
      customer_name: customer_name || null,
      rating: Number(rating),
      review_text: review_text || null,
      created_at: new Date().toISOString(),
    }).select().single();

    if (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, review_id: data.id }),
    };
  } catch (err) {
    console.error('Save review error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
