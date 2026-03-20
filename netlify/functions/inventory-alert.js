/**
 * inventory-alert.js
 *
 * Netlify scheduled function — checks inventory levels and sends SMS alerts
 * for SKUs at or below their reorder point.
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   TWILIO_SID
 *   TWILIO_API
 *   TWILIO_FROM_NUMBER
 *   ALERT_PHONE_NUMBERS
 */

const { createClient } = require('@supabase/supabase-js');

async function sendSMS(message) {
  const SID = process.env.TWILIO_SID;
  const TOKEN = process.env.TWILIO_API;
  const FROM = process.env.TWILIO_FROM_NUMBER;
  const numbers = (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

  const results = [];
  for (const TO of numbers) {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: FROM, To: TO, Body: message }).toString(),
      }
    );
    const data = await res.json();
    if (!res.ok) results.push({ to: TO, error: data.message || `Twilio error ${res.status}` });
    else results.push({ to: TO, success: true });
  }
  return results;
}

exports.handler = async (event) => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // Fetch reorder points, baselines, manufacturing batches, and order line items
    const [rpRes, blRes, mfgRes, liRes, ordersRes] = await Promise.all([
      sb.from('inventory_reorder_points').select('*'),
      sb.from('inventory_baselines').select('*').order('counted_at', { ascending: false }),
      sb.from('manufacturing_batches').select('product_sku, quantity, created_at'),
      sb.from('order_line_items').select('sku, quantity, order_id'),
      sb.from('orders').select('id, created_at, order_date'),
    ]);

    const reorderPoints = {};
    (rpRes.data || []).forEach(r => { reorderPoints[r.sku] = r; });

    // Latest baseline per SKU
    const baselines = {};
    (blRes.data || []).forEach(r => {
      if (!baselines[r.sku]) baselines[r.sku] = r;
    });

    const mfgBatches = mfgRes.data || [];
    const lineItems = liRes.data || [];
    const orders = ordersRes.data || [];
    const orderMap = {};
    orders.forEach(o => { orderMap[o.id] = o; });

    const alerts = [];
    const now = new Date().toISOString();

    for (const [sku, rp] of Object.entries(reorderPoints)) {
      const baseline = baselines[sku];
      const baselineQty = baseline ? baseline.quantity : 0;
      const baselineDate = baseline ? baseline.counted_at : '1970-01-01T00:00:00Z';

      // Manufactured since baseline
      const manufactured = mfgBatches
        .filter(b => b.product_sku === sku && b.created_at > baselineDate)
        .reduce((s, b) => s + (b.quantity || 0), 0);

      // Sold since baseline
      const sold = lineItems
        .filter(li => {
          if (li.sku !== sku) return false;
          const order = orderMap[li.order_id];
          return order && (order.created_at || order.order_date) > baselineDate;
        })
        .reduce((s, li) => s + (li.quantity || 1), 0);

      const currentStock = baselineQty + manufactured - sold;

      if (currentStock <= rp.reorder_point) {
        // Check if alert was already sent in last 24 hours
        if (rp.alert_sent_at) {
          const lastAlert = new Date(rp.alert_sent_at);
          const hoursSince = (Date.now() - lastAlert.getTime()) / 3600000;
          if (hoursSince < 24) continue;
        }
        alerts.push({ sku, currentStock, reorderPoint: rp.reorder_point });
      }
    }

    if (alerts.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No low stock alerts needed.' }) };
    }

    // Build SMS message
    const lines = alerts.map(a =>
      `${a.sku}: ${a.currentStock} units (reorder at ${a.reorderPoint})`
    );
    const message = `Low Stock Alert:\n${lines.join('\n')}`;

    const smsResults = await sendSMS(message);

    // Update alert_sent_at for all alerted SKUs
    for (const a of alerts) {
      await sb.from('inventory_reorder_points')
        .update({ alert_sent_at: now })
        .eq('sku', a.sku);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ alerts, smsResults }),
    };
  } catch (err) {
    console.error('Inventory alert error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
