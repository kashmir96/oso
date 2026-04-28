/**
 * mktg-job-poll-videos — every minute, polls Veo for any pending video
 * generation jobs and finalises the ones that completed. Means Curtis
 * doesn't have to keep the chat tab open while a video renders -- the
 * cron picks it up within a minute.
 *
 * Schedule: every minute (defined in netlify.toml). Cheap call -- just
 * looks for pending rows; if none, returns immediately. If pending rows
 * exist, polls each one's operation_id sequentially. Caps at 5 polls per
 * run so the function fits in the timeout budget on busy days.
 */
const { sbSelect, sbUpdate } = require('./_lib/ckf-sb.js');
const { withRunLog } = require('./_lib/mktg-jobs.js');

const JOB = 'poll_videos';
const MAX_POLLS_PER_RUN = 5;

exports.handler = withRunLog(JOB, async () => {
  if (!process.env.GEMINI_API_KEY) {
    return { skipped: true, reason: 'GEMINI_API_KEY not set; skipping video poll' };
  }
  const pending = await sbSelect(
    'mktg_generated_assets',
    `kind=eq.video&status=eq.pending&provider_operation_id=not.is.null&order=created_at.asc&limit=${MAX_POLLS_PER_RUN}&select=asset_id,user_id,provider_operation_id,storage_path`
  );
  if (pending.length === 0) {
    return { skipped: true, reason: 'no pending video jobs' };
  }

  // Lazy-require so the test harness can stub these without loading the
  // whole mktg-assets module (which pulls in Anthropic etc.).
  const assets = require('./mktg-assets.js');
  // Pull the inner helpers via the export path used by the chat tool.
  // mktg-assets exports publicUrlFor + uploadToBucket; we duplicate the
  // download+poll logic here so this file is independent.

  let finalised = 0;
  let failed = 0;
  let stillPending = 0;

  for (const a of pending) {
    try {
      const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${a.provider_operation_id}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
      const r = await fetch(pollUrl);
      if (!r.ok) { failed++; continue; }
      const json = await r.json();
      if (!json.done) { stillPending++; continue; }
      if (json.error) {
        await sbUpdate('mktg_generated_assets', `asset_id=eq.${encodeURIComponent(a.asset_id)}`, {
          status: 'failed', error: json.error?.message || JSON.stringify(json.error).slice(0, 300),
        });
        failed++;
        continue;
      }
      const samples = json.response?.generatedSamples || json.response?.predictions || [];
      const videoUrl = samples[0]?.video?.uri || samples[0]?.videoUri || samples[0]?.uri;
      if (!videoUrl) {
        await sbUpdate('mktg_generated_assets', `asset_id=eq.${encodeURIComponent(a.asset_id)}`, {
          status: 'failed', error: 'Veo done but no video uri in response',
        });
        failed++;
        continue;
      }
      // Download + upload + finalise.
      const sep = videoUrl.includes('?') ? '&' : '?';
      const dlUrl = `${videoUrl}${sep}key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
      const dl = await fetch(dlUrl);
      if (!dl.ok) { failed++; continue; }
      const buf = Buffer.from(await dl.arrayBuffer());
      const storage_path = await assets.uploadToBucket({
        userId: a.user_id, kind: 'video', buf, mimeType: 'video/mp4', ext: 'mp4',
      });
      await sbUpdate('mktg_generated_assets', `asset_id=eq.${encodeURIComponent(a.asset_id)}`, {
        storage_path, size_bytes: buf.length, status: 'ready',
        ready_at: new Date().toISOString(),
      });
      finalised++;
    } catch (e) {
      console.error('[poll_videos]', a.asset_id, e?.message || e);
      failed++;
    }
  }

  return {
    skipped: false,
    reason: `${finalised} finalised, ${stillPending} still pending, ${failed} failed`,
  };
});
