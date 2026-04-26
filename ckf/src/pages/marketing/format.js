// Marketing-only formatters. Kept here so the CKF main bundle doesn't grow.
export function nzd(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(n);
}
export function nzdPrecise(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 2 }).format(n);
}
export function num(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-NZ').format(n);
}
export function pct(n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

export const STATUS_LABEL = {
  workhorse:        'Workhorse',
  top_revenue:      'Top revenue',
  efficient:        'Efficient',
  tested:           'Tested',
  library_proven:   'Library proven',
  new:              'New',
  gap:              'Gap',
  experimental:     'Experimental',
  retired:          'Retired',
  active:           'Active',
  launching:        'Launching',
  limited_edition:  'Limited',
  discontinued:     'Discontinued',
  'production-ready': 'Production-ready',
  draft:            'Draft',
  // Draft workflow (Phase 4)
  submitted:        'Submitted',
  in_production:    'In production',
  needs_approval:   'Needs approval',
  approved:         'Approved',
  live:             'Live',
  shipped:          'Shipped',
  archived:         'Archived',
};

export function statusPillClass(status) {
  switch (status) {
    case 'workhorse':
    case 'top_revenue':
    case 'efficient':
    case 'production-ready':
    case 'active':
    case 'approved':
    case 'live':
    case 'shipped':
      return 'pill good';
    case 'tested':
    case 'library_proven':
    case 'new':
    case 'launching':
    case 'submitted':
    case 'in_production':
      return 'pill';
    case 'gap':
    case 'experimental':
    case 'needs_approval':
      return 'pill warn';
    case 'retired':
    case 'discontinued':
    case 'archived':
      return 'pill bad';
    default:
      return 'pill';
  }
}
