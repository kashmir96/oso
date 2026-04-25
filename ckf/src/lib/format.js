// Pacific/Auckland date helpers and small format utilities.

export function nzToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' });
  return fmt.format(new Date()); // YYYY-MM-DD
}

export function fmtShortDate(d) {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T12:00:00Z' : d) : d;
  return date.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const diff = (Date.now() - then.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`;
  return fmtShortDate(then);
}

// Compute progress 0..1 given direction (higher_better vs lower_better).
export function progressPct(g) {
  if (g == null) return 0;
  const { current_value, start_value, target_value, direction } = g;
  if (current_value == null || target_value == null) return 0;
  const start = start_value ?? current_value;
  if (start === target_value) return current_value === target_value ? 1 : 0;
  const total = target_value - start;
  const done = current_value - start;
  let p = total === 0 ? 0 : done / total;
  if (direction === 'lower_better') p = (start - current_value) / (start - target_value);
  if (!isFinite(p)) p = 0;
  return Math.max(0, Math.min(1, p));
}

export function formatGoalValue(v, unit) {
  if (v == null) return '—';
  const num = Number(v);
  if (!isFinite(num)) return String(v);
  const pretty = Math.abs(num) >= 1000 ? num.toLocaleString() : num.toString();
  return unit ? `${pretty}${/[a-zA-Z]/.test(unit) ? ' ' : ''}${unit}` : pretty;
}
