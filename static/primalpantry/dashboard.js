// ── Lazy-load Leaflet (only when map is needed) ──
let leafletLoaded = false;
function loadLeaflet() {
  if (leafletLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9/dist/leaflet.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9/dist/leaflet.min.js';
    js.onload = () => {
      const heat = document.createElement('script');
      heat.src = 'https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js';
      heat.onload = () => { leafletLoaded = true; resolve(); };
      heat.onerror = reject;
      document.head.appendChild(heat);
    };
    js.onerror = reject;
    document.head.appendChild(js);
  });
}

// ── Sortable Tables ──
function makeTableSortable(table) {
  if (!table || !table.querySelector('thead')) return;
  const headers = table.querySelectorAll('thead th');
  headers.forEach((th, colIdx) => {
    if (!th.textContent.trim()) return;
    th.classList.add('sortable');
    th.addEventListener('click', function() {
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      if (rows.length <= 1 && rows[0]?.querySelector('.loading')) return;
      const isAsc = th.classList.contains('sort-asc');
      headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      const dir = isAsc ? 'desc' : 'asc';
      th.classList.add('sort-' + dir);
      rows.sort((a, b) => {
        const aCell = a.cells[colIdx];
        const bCell = b.cells[colIdx];
        if (!aCell || !bCell) return 0;
        let aVal = aCell.textContent.trim();
        let bVal = bCell.textContent.trim();
        const aNum = parseFloat(aVal.replace(/[$,%,]/g, ''));
        const bNum = parseFloat(bVal.replace(/[$,%,]/g, ''));
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return dir === 'asc' ? aNum - bNum : bNum - aNum;
        }
        const aDate = Date.parse(aVal);
        const bDate = Date.parse(bVal);
        if (!isNaN(aDate) && !isNaN(bDate)) {
          return dir === 'asc' ? aDate - bDate : bDate - aDate;
        }
        return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

function applySortableToAllTables() {
  document.querySelectorAll('#dashboard table').forEach(t => {
    if (!t.dataset.sortable) {
      t.dataset.sortable = '1';
      makeTableSortable(t);
    }
  });
}

const sortObserver = new MutationObserver(() => applySortableToAllTables());
document.addEventListener('DOMContentLoaded', () => {
  const dashboard = document.getElementById('dashboard');
  if (dashboard) {
    sortObserver.observe(dashboard, { childList: true, subtree: true });
    applySortableToAllTables();
  }
});

// Chart card expand/collapse on click
document.addEventListener('click', function(e) {
  const card = e.target.closest('.chart-card');
  if (!card) return;
  // Only toggle if the card has a chart-wrap child (canvas charts, heatmap, map)
  if (!card.querySelector('.chart-wrap')) return;
  // Don't toggle if clicking interactive elements inside
  if (e.target.closest('select, input, button, a, .utm-table, .wa-table, table')) return;
  card.classList.toggle('expanded');
  // Trigger Chart.js resize after transition
  setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 350);
});

// Password visibility toggle
document.querySelectorAll('.pw-toggle').forEach(btn => {
  btn.addEventListener('click', function() {
    const input = document.getElementById(this.dataset.target);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    this.innerHTML = show
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  });
});

// Authenticated data proxy — all Supabase queries go through the backend
const db = {
  from(table) {
    let _op, _params = {};
    const chain = {
      select(cols) { if (!_op) _op = 'select'; _params.select = cols || '*'; return chain; },
      insert(data) { _op = 'insert'; _params.data = data; return chain; },
      update(data) { _op = 'update'; _params.data = data; return chain; },
      delete() { _op = 'delete'; return chain; },
      upsert(data, opts) { _op = 'upsert'; _params.data = data; if (opts?.onConflict) _params.onConflict = opts.onConflict; return chain; },
      eq(col, val) { _params.filters = _params.filters || []; _params.filters.push({ col, op: 'eq', val }); return chain; },
      neq(col, val) { _params.filters = _params.filters || []; _params.filters.push({ col, op: 'neq', val }); return chain; },
      gt(col, val) { _params.filters = _params.filters || []; _params.filters.push({ col, op: 'gt', val }); return chain; },
      gte(col, val) { _params.filters = _params.filters || []; _params.filters.push({ col, op: 'gte', val }); return chain; },
      lt(col, val) { _params.filters = _params.filters || []; _params.filters.push({ col, op: 'lt', val }); return chain; },
      lte(col, val) { _params.filters = _params.filters || []; _params.filters.push({ col, op: 'lte', val }); return chain; },
      contains(col, val) { _params.filters = _params.filters || []; _params.filters.push({ col, op: 'cs', val }); return chain; },
      order(col, opts) { _params.order = { col, ascending: opts?.ascending ?? true }; return chain; },
      limit(n) { _params.limit = n; return chain; },
      single() { _params.single = true; return chain; },
      then(resolve, reject) {
        return fetch('/.netlify/functions/dashboard-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: currentStaff?.token, table, operation: _op, params: _params }),
        })
        .then(r => r.json())
        .then(result => resolve(result))
        .catch(reject);
      },
    };
    return chain;
  }
};
let allOrders = [], allLineItems = [], filteredOrders = [], charts = {};
let customerTags = {}; // email → Set of tags
let shipmentsPage = 1;
let trendingPage = 1;
let utmPage = 1;
let magnetPage = 1;
let bundlesPage = 1;
let ordersPage = 1;
let customersPage = 1;
let landingRevPage = 1;
const PAGE_SIZE = 10;
let currentStaff = null;
let activeTab = 'sales';
let attributionModel = localStorage.getItem('oso_attr_model') || 'first';
let statsMode = localStorage.getItem('oso_stats_mode') || 'total';
let currentAdSpend = 0;
let currentPaidRev = 0;
let currentPaidConv = 0;
let currentPaidClicks = 0;
let currentPaidImpr = 0;
let statsRefreshTimer = null;
const STATS_REFRESH_MS = 60000;
let lastKnownRevenue = null;

function renderPagination(containerId, currentPage, totalItems, onPageChange) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const container = document.getElementById(containerId);
  if (!container) return;
  if (totalItems <= PAGE_SIZE) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div class="pagination">
      <button id="${containerId}-prev" ${currentPage <= 1 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${currentPage} of ${totalPages} (${totalItems} total)</span>
      <button id="${containerId}-next" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
    </div>`;
  document.getElementById(`${containerId}-prev`).addEventListener('click', () => { if (currentPage > 1) onPageChange(currentPage - 1); });
  document.getElementById(`${containerId}-next`).addEventListener('click', () => { if (currentPage < totalPages) onPageChange(currentPage + 1); });
}

// ── Auth ──
function hideAllAuthBoxes() {
  ['login-box', 'change-pw-box', 'totp-setup-box', 'totp-verify-box'].forEach(id => document.getElementById(id).style.display = 'none');
}

document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('username-input').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('password-input').focus(); });
document.getElementById('password-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('change-pw-btn').addEventListener('click', doChangePassword);
document.getElementById('confirm-pw-input').addEventListener('keydown', e => { if (e.key === 'Enter') doChangePassword(); });
document.getElementById('totp-setup-btn').addEventListener('click', doTOTPSetup);
document.getElementById('totp-setup-code').addEventListener('input', e => { if (e.target.value.length === 6) doTOTPSetup(); });
document.getElementById('totp-verify-btn').addEventListener('click', doTOTPVerify);
document.getElementById('totp-verify-code').addEventListener('input', e => { if (e.target.value.length === 6) doTOTPVerify(); });
document.getElementById('logout-btn').addEventListener('click', () => { localStorage.removeItem('pp_staff'); localStorage.removeItem('pp_staff_ts'); location.reload(); });
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('order-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('order-search').addEventListener('input', () => { ordersPage = 1; renderOrdersTable(); });
document.getElementById('product-view').addEventListener('change', () => renderProductsChart(currentLineItems));
document.getElementById('product-metric').addEventListener('change', () => renderProductsChart(currentLineItems));
document.getElementById('team-btn').addEventListener('click', openTeamModal);
document.getElementById('team-close').addEventListener('click', () => document.getElementById('team-modal').classList.remove('open'));
document.getElementById('team-modal').addEventListener('click', e => { if (e.target === e.currentTarget) document.getElementById('team-modal').classList.remove('open'); });
document.getElementById('team-add-btn').addEventListener('click', addStaffMember);

// Helper to log frontend actions
async function logFrontendActivity(activityAction, detail) {
  if (!currentStaff || !currentStaff.token) return;
  try {
    await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'log-activity', token: currentStaff.token, activity_action: activityAction, detail }),
    });
  } catch {}
}

async function doLogin() {
  const username = document.getElementById('username-input').value.trim();
  const password = document.getElementById('password-input').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  if (!username || !password) { errEl.textContent = 'Enter username and password'; errEl.style.display = 'block'; return; }
  document.getElementById('login-btn').disabled = true;
  document.getElementById('login-btn').textContent = 'Signing in...';
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', username, password, totp_remembered: localStorage.getItem('pp_totp_remembered') }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      errEl.textContent = data.error || 'Login failed'; errEl.style.display = 'block';
      document.getElementById('login-btn').disabled = false; document.getElementById('login-btn').textContent = 'Sign in'; return;
    }
    currentStaff = { ...data.staff, token: data.token };

    if (data.staff.must_change_password) {
      hideAllAuthBoxes();
      document.getElementById('change-pw-box').style.display = 'block';
    } else if (data.needs_totp_setup) {
      // Show TOTP setup screen with QR code
      hideAllAuthBoxes();
      document.getElementById('totp-secret-display').textContent = data.totp_secret;
      document.getElementById('totp-qr').src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(data.totp_uri);
      document.getElementById('totp-setup-box').style.display = 'block';
      document.getElementById('totp-setup-code').focus();
    } else if (data.needs_totp_verify) {
      // Show TOTP verify screen
      hideAllAuthBoxes();
      document.getElementById('totp-verify-box').style.display = 'block';
      document.getElementById('totp-verify-code').focus();
    } else {
      localStorage.setItem('pp_staff', JSON.stringify(currentStaff)); localStorage.setItem('pp_staff_ts', String(Date.now()));
      showDashboard();
    }
  } catch (err) {
    errEl.textContent = 'Connection error'; errEl.style.display = 'block';
    document.getElementById('login-btn').disabled = false; document.getElementById('login-btn').textContent = 'Sign in';
  }
}

async function doChangePassword() {
  const newPw = document.getElementById('new-pw-input').value;
  const confirmPw = document.getElementById('confirm-pw-input').value;
  const errEl = document.getElementById('change-pw-error');
  errEl.style.display = 'none';
  if (newPw.length < 6) { errEl.textContent = 'Min 6 characters'; errEl.style.display = 'block'; return; }
  if (newPw !== confirmPw) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'change-password', token: currentStaff.token, new_password: newPw }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) { errEl.textContent = data.error || 'Failed'; errEl.style.display = 'block'; return; }
    currentStaff.must_change_password = false;
    // After password change, need to re-login to trigger TOTP setup
    hideAllAuthBoxes();
    document.getElementById('login-box').style.display = 'block';
    document.getElementById('login-error').textContent = 'Password set! Please sign in again.';
    document.getElementById('login-error').style.display = 'block';
    document.getElementById('login-error').style.color = 'var(--green)';
    document.getElementById('login-btn').disabled = false;
    document.getElementById('login-btn').textContent = 'Sign in';
  } catch { errEl.textContent = 'Connection error'; errEl.style.display = 'block'; }
}

async function doTOTPSetup() {
  const code = document.getElementById('totp-setup-code').value.trim();
  const errEl = document.getElementById('totp-setup-error');
  errEl.style.display = 'none';
  if (code.length !== 6) { errEl.textContent = 'Enter the 6-digit code'; errEl.style.display = 'block'; return; }
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup-totp', token: currentStaff.token, code }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) { errEl.textContent = data.error || 'Invalid code'; errEl.style.display = 'block'; document.getElementById('totp-setup-code').value = ''; return; }
    localStorage.setItem('pp_totp_remembered', String(Date.now()));
    localStorage.setItem('pp_staff', JSON.stringify(currentStaff)); localStorage.setItem('pp_staff_ts', String(Date.now()));
    showDashboard();
  } catch { errEl.textContent = 'Connection error'; errEl.style.display = 'block'; }
}

async function doTOTPVerify() {
  const code = document.getElementById('totp-verify-code').value.trim();
  const errEl = document.getElementById('totp-verify-error');
  errEl.style.display = 'none';
  if (code.length !== 6) { errEl.textContent = 'Enter the 6-digit code'; errEl.style.display = 'block'; return; }
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify-totp', token: currentStaff.token, code }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) { errEl.textContent = data.error || 'Invalid code'; errEl.style.display = 'block'; document.getElementById('totp-verify-code').value = ''; return; }
    localStorage.setItem('pp_totp_remembered', String(Date.now()));
    localStorage.setItem('pp_staff', JSON.stringify(currentStaff)); localStorage.setItem('pp_staff_ts', String(Date.now()));
    showDashboard();
  } catch { errEl.textContent = 'Connection error'; errEl.style.display = 'block'; }
}

const savedStaff = localStorage.getItem('pp_staff');
const staffTs = Number(localStorage.getItem('pp_staff_ts') || 0);
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
if (savedStaff && (Date.now() - staffTs) < THIRTY_DAYS) {
  try { currentStaff = JSON.parse(savedStaff); localStorage.setItem('pp_staff_ts', String(Date.now())); showDashboard(); } catch { localStorage.removeItem('pp_staff'); localStorage.removeItem('pp_staff_ts'); }
} else if (savedStaff) {
  localStorage.removeItem('pp_staff'); localStorage.removeItem('pp_staff_ts');
}

// Tab access by role
const ROLE_TABS = {
  manufacturing: ['manufacturing'],
  shipping: ['shipping'],
  office: ['sales', 'orders', 'shipping', 'customers', 'comms', 'manufacturing', 'website', 'marketing', 'finance', 'actions'],
  admin: ['sales', 'orders', 'shipping', 'customers', 'comms', 'manufacturing', 'website', 'marketing', 'finance', 'actions'],
  owner: ['sales', 'orders', 'shipping', 'customers', 'comms', 'manufacturing', 'website', 'marketing', 'finance', 'actions', 'settings'],
};

function applyTabVisibility() {
  if (!currentStaff) return;
  const allowed = ROLE_TABS[currentStaff.role] || ROLE_TABS.office;
  document.querySelectorAll('.nav-item').forEach(btn => {
    const tab = btn.dataset.tab;
    btn.style.display = allowed.includes(tab) ? '' : 'none';
  });
  // Set default tab to first allowed tab
  const activeBtn = document.querySelector('.nav-item.active');
  if (activeBtn && !allowed.includes(activeBtn.dataset.tab)) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const firstBtn = document.querySelector('.nav-item[data-tab="' + allowed[0] + '"]');
    if (firstBtn) {
      firstBtn.classList.add('active');
      document.getElementById('tab-' + allowed[0]).classList.add('active');
      activeTab = allowed[0];
    }
  }
}

function showDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  const claudeFab = document.getElementById('claude-fab');
  if (claudeFab) claudeFab.style.display = 'flex';
  if (currentStaff) {
    document.getElementById('staff-greeting').textContent = currentStaff.display_name;
    if (currentStaff.can_manage_users) document.getElementById('team-btn').style.display = '';
    applyTabVisibility();
  }
  initDashboard();
  // For shipping role, load shipping data immediately (don't wait for full initDashboard)
  if (currentStaff && currentStaff.role === 'shipping' && !shippingLoaded) {
    loadShippingData();
  }
  // Check for prompt notifications after login
  setTimeout(() => { if (typeof checkCommsPrompts === 'function') checkCommsPrompts(); }, 2000);
  setTimeout(() => { if (typeof checkActionAlerts === 'function') checkActionAlerts(); }, 3000);
}

// ── Team Management ──
async function openTeamModal() {
  if (!currentStaff || !currentStaff.can_manage_users) return;
  document.getElementById('team-modal').classList.add('open');
  document.getElementById('team-list').innerHTML = '<div class="loading">Loading team...</div>';
  document.getElementById('team-result').textContent = '';
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list-users', token: currentStaff.token }),
    });
    const data = await res.json();
    if (!data.success) { document.getElementById('team-list').innerHTML = '<p style="color:var(--red);">' + data.error + '</p>'; return; }
    let html = '<table class="team-table"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>2FA</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    data.users.forEach(u => {
      const roleCls = 'role-' + u.role;
      const totpStatus = u.totp_enabled ? '<span style="color:var(--green);">Enabled</span>' : '<span style="color:var(--amber);">Not set</span>';
      const statusText = u.must_change_password ? '<span style="color:var(--amber);">Needs password</span>' : '<span style="color:var(--green);">Active</span>';
      let roleCell;
      if (currentStaff.role === 'owner' && u.id !== currentStaff.id) {
        roleCell = '<select onchange="updateStaffRole(' + u.id + ',this.value)" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.15rem 0.3rem;border-radius:4px;font-size:0.7rem;">' +
          ['owner','admin','office','shipping','manufacturing'].map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>';
      } else {
        roleCell = '<span class="role-badge ' + roleCls + '">' + u.role + '</span>';
      }
      html += '<tr><td>' + u.username + '</td><td>' + u.display_name + '</td><td>' + roleCell + '</td><td>' + totpStatus + '</td><td>' + statusText + '</td><td class="team-actions"><button onclick="resetStaffPassword(' + u.id + ')">Reset PW</button><button onclick="resetStaffTOTP(' + u.id + ',\'' + u.username + '\')">Reset 2FA</button>' + (u.id !== currentStaff.id ? '<button class="danger" onclick="deleteStaffMember(' + u.id + ',\'' + u.username + '\')">Remove</button>' : '') + '</td></tr>';
    });
    html += '</tbody></table>';
    document.getElementById('team-list').innerHTML = html;

    // Populate activity filter dropdown with usernames
    const filterEl = document.getElementById('activity-staff-filter');
    filterEl.innerHTML = '<option value="">All Staff</option>' + data.users.map(u => '<option value="' + u.username + '">' + u.display_name + '</option>').join('');
  } catch { document.getElementById('team-list').innerHTML = '<p style="color:var(--red);">Failed to load team</p>'; }

  // Only owner can see the "can manage users" checkbox
  const manageGroup = document.getElementById('team-manage').closest('.form-group');
  if (manageGroup) manageGroup.style.display = currentStaff.role === 'owner' ? '' : 'none';

  // Show activity log for owner
  if (currentStaff.role === 'owner') {
    document.getElementById('activity-log-section').style.display = 'block';
    loadActivityLog();
  } else {
    document.getElementById('activity-log-section').style.display = 'none';
  }
}

async function loadActivityLog() {
  const container = document.getElementById('activity-log-list');
  container.innerHTML = '<div class="loading">Loading activity...</div>';
  const staffFilter = document.getElementById('activity-staff-filter').value;
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get-activity-log', token: currentStaff.token, staff_filter: staffFilter || undefined }),
    });
    const data = await res.json();
    if (!data.success || !data.logs.length) { container.innerHTML = '<p style="color:var(--dim);padding:0.5rem;">No activity recorded yet.</p>'; return; }
    container.innerHTML = '<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:0.3rem 0.5rem;font-size:0.65rem;color:var(--dim);text-transform:uppercase;border-bottom:1px solid var(--border);">Time</th><th style="text-align:left;padding:0.3rem 0.5rem;font-size:0.65rem;color:var(--dim);text-transform:uppercase;border-bottom:1px solid var(--border);">User</th><th style="text-align:left;padding:0.3rem 0.5rem;font-size:0.65rem;color:var(--dim);text-transform:uppercase;border-bottom:1px solid var(--border);">Action</th><th style="text-align:left;padding:0.3rem 0.5rem;font-size:0.65rem;color:var(--dim);text-transform:uppercase;border-bottom:1px solid var(--border);">Detail</th></tr></thead><tbody>' +
      data.logs.map(l => {
        const t = new Date(l.created_at);
        const timeStr = t.toLocaleDateString('en-NZ', {day:'2-digit',month:'short'}) + ' ' + t.toLocaleTimeString('en-NZ', {hour:'2-digit',minute:'2-digit'});
        return '<tr><td style="padding:0.3rem 0.5rem;border-bottom:1px solid var(--cream-deep);white-space:nowrap;">' + timeStr + '</td><td style="padding:0.3rem 0.5rem;border-bottom:1px solid var(--cream-deep);">' + (l.staff_username || '-') + '</td><td style="padding:0.3rem 0.5rem;border-bottom:1px solid var(--cream-deep);"><span style="background:var(--bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.7rem;">' + l.action + '</span></td><td style="padding:0.3rem 0.5rem;border-bottom:1px solid var(--cream-deep);">' + (l.detail || '-') + '</td></tr>';
      }).join('') + '</tbody></table>';
  } catch { container.innerHTML = '<p style="color:var(--red);">Failed to load activity log</p>'; }
}

document.getElementById('activity-staff-filter').addEventListener('change', loadActivityLog);
document.getElementById('activity-refresh-btn').addEventListener('click', loadActivityLog);

async function addStaffMember() {
  const username = document.getElementById('team-username').value.trim();
  const display_name = document.getElementById('team-display').value.trim();
  const role = document.getElementById('team-role').value;
  const can_manage_users = document.getElementById('team-manage').checked;
  const resultEl = document.getElementById('team-result');
  if (!username || !display_name) { resultEl.textContent = 'Username and display name required'; resultEl.style.color = 'var(--red)'; return; }
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create-user', token: currentStaff.token, username, display_name, role, can_manage_users }),
    });
    const data = await res.json();
    if (data.success) {
      resultEl.innerHTML = '<span style="color:var(--green);">Added ' + username + '. Temp password: <strong>' + data.temp_password + '</strong></span>';
      document.getElementById('team-username').value = ''; document.getElementById('team-display').value = ''; document.getElementById('team-manage').checked = false;
      openTeamModal();
    } else { resultEl.textContent = data.error || 'Failed'; resultEl.style.color = 'var(--red)'; }
  } catch { resultEl.textContent = 'Connection error'; resultEl.style.color = 'var(--red)'; }
}
async function updateStaffRole(userId, newRole) {
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update-user', token: currentStaff.token, user_id: userId, role: newRole }),
    });
    const data = await res.json();
    if (!data.success) alert(data.error || 'Failed to update role');
  } catch { alert('Connection error'); }
}
async function resetStaffPassword(userId) {
  if (!confirm('Reset password? They will need to set a new one on next login.')) return;
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update-user', token: currentStaff.token, user_id: userId, reset_password: true }),
    });
    const data = await res.json();
    if (data.success) { alert('Password reset. Temp password: ' + data.password_reset); openTeamModal(); }
    else alert(data.error || 'Failed');
  } catch { alert('Connection error'); }
}
async function resetStaffTOTP(userId, username) {
  if (!confirm('Reset 2FA for ' + username + '? They will need to set up Google Authenticator again on next login.')) return;
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update-user', token: currentStaff.token, user_id: userId, reset_totp: true }),
    });
    const data = await res.json();
    if (data.success) { alert('2FA reset for ' + username); openTeamModal(); }
    else alert(data.error || 'Failed');
  } catch { alert('Connection error'); }
}
async function deleteStaffMember(userId, username) {
  if (!confirm('Remove ' + username + ' from the team?')) return;
  try {
    const res = await fetch('/.netlify/functions/staff-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-user', token: currentStaff.token, user_id: userId }),
    });
    const data = await res.json();
    if (data.success) openTeamModal(); else alert(data.error || 'Failed');
  } catch { alert('Connection error'); }
}

// ── Filtering ──
let currentRange = 'today';

// Date range dropdown
let liveInterval = null;
document.getElementById('date-range').addEventListener('change', function() {
  currentRange = this.value;
  const custom = currentRange === 'custom';
  const live = currentRange === 'live';
  document.getElementById('date-from').style.display = custom ? '' : 'none';
  document.getElementById('date-to').style.display = custom ? '' : 'none';
  // Toggle live mode
  const grid = document.getElementById('stats-grid');
  if (live) {
    grid.classList.add('live-mode');
    startLiveMode();
  } else {
    grid.classList.remove('live-mode');
    stopLiveMode();
  }
  applyFilter();
});
document.getElementById('date-from').addEventListener('change', applyFilter);
document.getElementById('date-to').addEventListener('change', applyFilter);
document.getElementById('filter-utm').addEventListener('change', applyFilter);
document.getElementById('filter-utm-medium').addEventListener('change', applyFilter);
document.getElementById('filter-utm-campaign').addEventListener('change', applyFilter);
document.getElementById('filter-city').addEventListener('change', applyFilter);

// Local date helper — returns YYYY-MM-DD in browser timezone (not UTC)
function localDateStr(d) {
  // Convert to NZ time for consistent date handling
  const nz = new Date(d.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
  const p = n => String(n).padStart(2, '0');
  return `${nz.getFullYear()}-${p(nz.getMonth() + 1)}-${p(nz.getDate())}`;
}
function daysAgoLocal(n) { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); }

function getDateRange() {
  // Use NZ time — all order dates should be in NZ timezone
  const now = new Date();
  const today = localDateStr(now);
  const yesterday = daysAgoLocal(1);

  switch (currentRange) {
    case 'today': return [today, today];
    case 'yesterday': return [yesterday, yesterday];
    case '7d': return [daysAgoLocal(7), today];
    case '30d': return [daysAgoLocal(30), today];
    case 'month': {
      const nz = new Date(now.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
      const p = n => String(n).padStart(2, '0');
      return [`${nz.getFullYear()}-${p(nz.getMonth() + 1)}-01`, today];
    }
    case 'all': return ['2000-01-01', today];
    case 'custom': {
      const from = document.getElementById('date-from').value || '2000-01-01';
      const to = document.getElementById('date-to').value || today;
      return [from, to];
    }
    case 'live': return [today, today]; // live mode still shows today's orders
    default: return [today, today];
  }
}

function populateFilterDropdowns() {
  // UTM sources
  const utmSelect = document.getElementById('filter-utm');
  const sources = [...new Set(allOrders.map(o => resolveOrderSource(o)).filter(Boolean))].sort();
  utmSelect.innerHTML = '<option value="">All</option>' + sources.map(s => `<option value="${s}">${utmTranslate('utm_source', s)}</option>`).join('');

  // UTM mediums
  const mediumSelect = document.getElementById('filter-utm-medium');
  const mediums = [...new Set(allOrders.map(o => o.utm_medium || getUtmFromUrl(o.thank_you_url, 'utm_medium') || '').filter(Boolean))].sort();
  mediumSelect.innerHTML = '<option value="">All</option>' + mediums.map(m => `<option value="${m}">${utmTranslate('utm_medium', m)}</option>`).join('');

  // UTM campaigns
  const campaignSelect = document.getElementById('filter-utm-campaign');
  const campaigns = [...new Set(allOrders.map(o => resolveOrderCampaign(o)).filter(Boolean))].sort();
  campaignSelect.innerHTML = '<option value="">All</option>' + campaigns.map(c => `<option value="${c}">${utmTranslate('utm_campaign', c)}</option>`).join('');

  // Cities
  const citySelect = document.getElementById('filter-city');
  const cities = [...new Set(allOrders.map(o => o.city || '').filter(Boolean))].sort();
  citySelect.innerHTML = '<option value="">All Cities</option>' + cities.map(c => `<option value="${c}">${c}</option>`).join('');
}

function applyFilter() {
  const [from, to] = getDateRange();
  const utmFilter = document.getElementById('filter-utm').value;
  const mediumFilter = document.getElementById('filter-utm-medium').value;
  const campaignFilter = document.getElementById('filter-utm-campaign').value;
  const cityFilter = document.getElementById('filter-city').value;
  filteredOrders = allOrders.filter(o => {
    if (o.order_date < from || o.order_date > to) return false;
    if (utmFilter && resolveOrderSource(o) !== utmFilter) return false;
    if (mediumFilter && (o.utm_medium || getUtmFromUrl(o.thank_you_url, 'utm_medium') || '') !== mediumFilter) return false;
    if (campaignFilter && (resolveOrderCampaign(o)) !== campaignFilter) return false;
    if (cityFilter && o.city !== cityFilter) return false;
    return true;
  });

  const filteredOrderIds = new Set(filteredOrders.map(o => o.id));
  const filteredLI = allLineItems.filter(li => filteredOrderIds.has(li.order_id));

  // Re-render the active tab
  renderStats(filteredOrders, filteredLI);
  if (activeTab === 'sales') {
    renderAll(filteredOrders, filteredLI);
  } else if (activeTab === 'orders') {
    renderOrdersTable();
  } else if (activeTab === 'customers') {
    renderCustomersTab();
  } else if (activeTab === 'shipping' && shippingLoaded) {
    renderShipmentsTable();
  } else if (activeTab === 'manufacturing') {
    loadManufacturingTab();
  } else if (activeTab === 'marketing') {
    mktLastDateRange = null; // force reload
    loadMarketingTab();
  } else if (activeTab === 'website') {
    if (typeof loadWebsiteAnalytics === 'function') loadWebsiteAnalytics();
  } else if (activeTab === 'finance') {
    // Only reload finance on manual filter change, not auto-refresh (would clear expense form inputs)
    if (!window._isAutoRefresh && typeof loadFinanceTab === 'function') loadFinanceTab();
  }
}

// ── Init ──
async function loadAdSpend() {
  if (!currentStaff || !currentStaff.token) return;
  try {
    const [from, to] = getDateRange();
    const tok = encodeURIComponent(currentStaff.token);
    const [fbRes, gRes, fbRangeRes, refundsRes] = await Promise.all([
      fetch(`/.netlify/functions/facebook-adspend?token=${tok}`).then(r => r.json()).catch(() => ({ spend: 0 })),
      fetch(`/.netlify/functions/google-ads?token=${tok}&from=${from}&to=${to}`).then(r => r.json()).catch(() => ({ campaigns: [] })),
      fetch(`/.netlify/functions/facebook-campaigns?token=${tok}&from=${from}&to=${to}`).then(r => r.json()).catch(() => ({ campaigns: [] })),
      fetch(`/.netlify/functions/stripe-refunds-list?token=${tok}&from=${from}&to=${to}`).then(r => r.json()).catch(() => ({ refunds: [], total: 0, count: 0 })),
    ]);
    // Store refund data globally for stats + timeseries
    window._stripeRefunds = refundsRes.refunds || [];
    window._stripeRefundTotal = refundsRes.total || 0;
    window._stripeRefundCount = refundsRes.count || 0;
    // Today's ad spend for the banner (Facebook today + Google today)
    const todayStr = new Date().toISOString().slice(0, 10);
    const fbTodaySpend = Number(fbRes.spend || 0);
    const gCampaigns = gRes.campaigns || [];
    const fbCampaigns = fbRangeRes.campaigns || [];
    // Period totals from all campaigns
    const gTotalSpend = gCampaigns.reduce((s, c) => s + (c.spend || 0), 0);
    const fbTotalSpend = fbCampaigns.reduce((s, c) => s + (c.spend || 0), 0);
    currentPaidRev = [...fbCampaigns, ...gCampaigns].reduce((s, c) => s + (c.conversions_value || 0), 0);
    currentPaidConv = [...fbCampaigns, ...gCampaigns].reduce((s, c) => s + (c.conversions || 0), 0);
    currentPaidClicks = [...fbCampaigns, ...gCampaigns].reduce((s, c) => s + (c.clicks || 0), 0);
    currentPaidImpr = [...fbCampaigns, ...gCampaigns].reduce((s, c) => s + (c.impressions || 0), 0);
    // Blended ad spend: FB insights (today) + Google campaigns + FB campaigns (whichever is higher)
    const todaySpend = fbTodaySpend + gTotalSpend;
    currentAdSpend = Math.max(todaySpend, fbTotalSpend + gTotalSpend);
    // Banner
    const el = document.getElementById('adspend-value');
    if (el) el.textContent = currentAdSpend > 0 ? '$' + currentAdSpend.toFixed(2) : '—';
    // Load hourly adspend data for pace chart (stored by scheduled function)
    db.from('adspend_hourly').select('date,hour,source,hourly_spend').gte('date', from).lte('date', to).order('date', { ascending: true }).order('hour', { ascending: true })
      .then(res => { window._adspendHourlyData = (res && res.data) ? res.data : Array.isArray(res) ? res : []; })
      .catch(() => { window._adspendHourlyData = []; });

    // Re-render stats and pace chart with updated adspend
    applyFilter();
  } catch (e) {
    currentAdSpend = 0; currentPaidRev = 0; currentPaidConv = 0; currentPaidClicks = 0; currentPaidImpr = 0;
    const el = document.getElementById('adspend-value');
    if (el) el.textContent = '—';
  }
}

async function initDashboard() {
  if (!currentStaff?.token) return; // Prevent unauthenticated access
  try {
  } catch (err) {
    document.getElementById('orders-table').innerHTML = `<tr><td colspan="8">Supabase error: ${err.message}</td></tr>`;
    return;
  }

  const [ordersRes, liRes] = await Promise.all([
    db.from('orders').select('*').order('created_at', { ascending: false }),
    db.from('order_line_items').select('*'),
  ]);

  if (ordersRes.error) {
    document.getElementById('orders-table').innerHTML = `<tr><td colspan="8">DB error: ${ordersRes.error.message}</td></tr>`;
    // Don't return — still load the active tab (shipping role needs this)
  }

  allOrders = ordersRes.data || [];
  allLineItems = liRes.data || [];
  try {
    await loadUnitCosts();
    populateFilterDropdowns();
    populateSegmentDropdowns();
    renderSavedSegments();
    await loadCustomerTags();
  } catch (e) { console.warn('initDashboard partial error:', e.message); }
  applyFilter();
  loadAdSpend();
  loadExpenses();

  // Start auto-refresh of stats every 15 seconds
  startStatsRefresh();
}

// ── Refresh stats (lightweight: re-fetch data, update stat cards only) ──
async function refreshStats() {
  if (!currentStaff) return;
  try {
    const [ordersRes, liRes] = await Promise.all([
      db.from('orders').select('*').order('created_at', { ascending: false }),
      db.from('order_line_items').select('*'),
    ]);
    if (ordersRes.error) return;
    allOrders = ordersRes.data || [];
    allLineItems = liRes.data || [];

    // Re-apply filters and update stats only
    const [from, to] = getDateRange();
    const utmFilter = document.getElementById('filter-utm').value;
    const mediumFilter = document.getElementById('filter-utm-medium').value;
    const campaignFilter = document.getElementById('filter-utm-campaign').value;
    const cityFilter = document.getElementById('filter-city').value;
    filteredOrders = allOrders.filter(o => {
      if (o.order_date < from || o.order_date > to) return false;
      if (utmFilter && resolveOrderSource(o) !== utmFilter) return false;
      if (mediumFilter && (o.utm_medium || getUtmFromUrl(o.thank_you_url, 'utm_medium') || '') !== mediumFilter) return false;
      if (campaignFilter && (resolveOrderCampaign(o)) !== campaignFilter) return false;
      if (cityFilter && o.city !== cityFilter) return false;
      return true;
    });
    const filteredOrderIds = new Set(filteredOrders.map(o => o.id));
    const filteredLI = allLineItems.filter(li => filteredOrderIds.has(li.order_id));
    renderStats(filteredOrders, filteredLI);
    loadCommsResponseStats();
    loadAdSpend();
    updateRefreshTime();
  } catch (e) {
    // Silent fail on auto-refresh
  }
}

function updateRefreshTime() {
  const el = document.getElementById('last-refresh');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function startStatsRefresh() {
  if (statsRefreshTimer) clearInterval(statsRefreshTimer);
  statsRefreshTimer = setInterval(autoRefresh, STATS_REFRESH_MS);
}

// ── Auto-refresh: re-fetch data and update all widgets silently ──
let lastAutoRefresh = '';
async function autoRefresh() {
  if (!currentStaff) return;
  // Only re-fetch if tab is active (visible)
  if (document.hidden) return;
  try {
    // Fetch only orders created since last known order to check for new ones
    const latestCreatedAt = allOrders.length > 0 ? allOrders[0].created_at : null;
    if (latestCreatedAt && latestCreatedAt === lastAutoRefresh) {
      // Quick check: any new orders since last refresh?
      const checkRes = await db.from('orders').select('id').order('created_at', { ascending: false }).limit(1);
      if (checkRes.data?.[0]?.id === allOrders[0]?.id) {
        updateRefreshTime();
        return; // No new orders, skip full reload
      }
    }
    const [ordersRes, liRes] = await Promise.all([
      db.from('orders').select('*').order('created_at', { ascending: false }),
      db.from('order_line_items').select('*'),
    ]);
    if (ordersRes.error) return;
    allOrders = ordersRes.data || [];
    allLineItems = liRes.data || [];
    lastAutoRefresh = allOrders.length > 0 ? allOrders[0].created_at : '';
    populateFilterDropdowns();
    populateSegmentDropdowns();
    window._isAutoRefresh = true;
    applyFilter();
    window._isAutoRefresh = false;
    updateRefreshTime();
  } catch (e) {
    // Silent fail on auto-refresh
  }
}

// ── Full refresh (stats + active tab tables/charts) ──
async function fullRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = '↻ Refreshing...';
  try {
    const [ordersRes, liRes] = await Promise.all([
      db.from('orders').select('*').order('created_at', { ascending: false }),
      db.from('order_line_items').select('*'),
    ]);
    if (ordersRes.error) throw ordersRes.error;
    allOrders = ordersRes.data || [];
    allLineItems = liRes.data || [];
    populateFilterDropdowns();
    populateSegmentDropdowns();
    applyFilter();

    // Also refresh shipping if it was loaded
    if (shippingLoaded && activeTab === 'shipping') {
      shippingLoaded = false;
      loadShippingData();
    }
  } catch (e) {
    console.error('Refresh error:', e);
  }
  btn.disabled = false;
  btn.textContent = '↻ Refresh';
  updateRefreshTime();
}

document.getElementById('refresh-btn').addEventListener('click', fullRefresh);

// ── Attribution model toggle (dashboard-wide) ──
(function() {
  const firstBtn = document.getElementById('attr-first');
  const lastBtn = document.getElementById('attr-last');
  function setAttrModel(model) {
    attributionModel = model;
    localStorage.setItem('oso_attr_model', model);
    firstBtn.style.background = model === 'first' ? 'var(--sage)' : 'var(--card)';
    firstBtn.style.color = model === 'first' ? '#141210' : 'var(--muted)';
    lastBtn.style.background = model === 'last' ? 'var(--sage)' : 'var(--card)';
    lastBtn.style.color = model === 'last' ? '#141210' : 'var(--muted)';
  }
  firstBtn.addEventListener('click', () => { setAttrModel('first'); fullRefresh(); });
  lastBtn.addEventListener('click', () => { setAttrModel('last'); fullRefresh(); });
  // Restore saved state on load
  setAttrModel(attributionModel);
})();

// ── Stats mode toggle (Total / Avg Per Order) ──
(function() {
  const totalBtn = document.getElementById('stats-mode-total');
  const avgBtn = document.getElementById('stats-mode-avg');
  function setStatsMode(mode) {
    statsMode = mode;
    localStorage.setItem('oso_stats_mode', mode);
    totalBtn.style.background = mode === 'total' ? 'var(--sage)' : 'var(--card)';
    totalBtn.style.color = mode === 'total' ? '#141210' : 'var(--muted)';
    avgBtn.style.background = mode === 'avg' ? 'var(--sage)' : 'var(--card)';
    avgBtn.style.color = mode === 'avg' ? '#141210' : 'var(--muted)';
  }
  function refreshStats() {
    const ords = filteredOrders.length > 0 ? filteredOrders : allOrders;
    const ordIds = new Set(ords.map(o => o.id));
    const li = allLineItems.filter(l => ordIds.has(l.order_id));
    renderStats(ords, li);
  }
  totalBtn.addEventListener('click', () => { setStatsMode('total'); refreshStats(); });
  avgBtn.addEventListener('click', () => { setStatsMode('avg'); refreshStats(); });
  setStatsMode(statsMode);
})();

// ── Render all ──
function renderAll(orders, lineItems) {
  trendingPage = 1; utmPage = 1; magnetPage = 1; bundlesPage = 1; ordersPage = 1; customersPage = 1; landingRevPage = 1;
  renderStats(orders, lineItems);
  renderCumulativeRevenue();
  renderHoursChart(orders);
  renderProductsChart(lineItems);
  renderUTM(orders);
  renderHeatmap(allOrders);
  renderMap(orders);
  renderLandingRevenue(orders);
  renderMagnetProducts(orders);
  renderBoughtTogether(orders);
  renderTrending(orders);
  renderNewVsReturning(orders);
}

// ── Sale sound (cha-ching) via Web Audio API ──
function playSaleSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Two-tone chime: C5 then E5
    [[523.25, 0], [659.25, 0.12]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.4);
    });
    // Close context after sounds finish
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

// ── Confetti burst from a target element ──
function fireConfetti(targetEl) {
  const rect = targetEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ['#8CB47A', '#D4A84B', '#DBBFA8', '#a3c995', '#e8e2da', '#6B8F5B'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = cx + 'px';
    piece.style.top = cy + 'px';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (4 + Math.random() * 6) + 'px';
    piece.style.height = (4 + Math.random() * 6) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    const angle = (Math.random() - 0.5) * 120;
    const dist = 60 + Math.random() * 120;
    const dx = Math.sin(angle * Math.PI / 180) * dist;
    piece.style.setProperty('--dx', dx + 'px');
    piece.style.animationDuration = (1.2 + Math.random() * 1.2) + 's';
    piece.style.animationDelay = (Math.random() * 0.3) + 's';
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 3000);
  }
  targetEl.classList.add('celebrate');
  setTimeout(() => targetEl.classList.remove('celebrate'), 1500);
}

// ── Stats ──
function renderStats(orders, lineItems) {
  const revenue = sum(orders, 'total_value');
  const orderCount = orders.length;
  const aov = orderCount > 0 ? revenue / orderCount : 0;

  // Repeat customers
  const emailCounts = {};
  allOrders.forEach(o => { if (o.email) emailCounts[o.email] = (emailCounts[o.email] || 0) + 1; });
  const repeatCustomers = Object.values(emailCounts).filter(c => c > 1).length;
  const totalCustomers = Object.keys(emailCounts).length;

  // CLV = total revenue / unique customers
  const allRevenue = sum(allOrders, 'total_value');
  const clv = totalCustomers > 0 ? allRevenue / totalCustomers : 0;

  // Avg jars per order (using line item quantities)
  const totalQty = lineItems.reduce((s, li) => s + (li.quantity || 0), 0);
  const avgJars = orderCount > 0 ? totalQty / orderCount : 0;

  // Unique emails in filtered period
  const periodEmails = new Set(orders.map(o => o.email).filter(Boolean));

  // Refund rate
  const refundedOrders = orders.filter(o => (o.status || '').toLowerCase().includes('refund'));
  const refundRate = orderCount > 0 ? (refundedOrders.length / orderCount * 100).toFixed(1) : '0.0';

  // Revenue growth (current period vs same-length prior period)
  const [from, to] = getDateRange();
  const periodDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
  const pfFrom = new Date(from); pfFrom.setDate(pfFrom.getDate() - periodDays);
  const priorFrom = localDateStr(pfFrom);
  const pfTo = new Date(from); pfTo.setDate(pfTo.getDate() - 1);
  const priorTo = localDateStr(pfTo);
  const priorOrders = allOrders.filter(o => o.order_date >= priorFrom && o.order_date <= priorTo);
  const priorRevenue = sum(priorOrders, 'total_value');
  const growthPct = priorRevenue > 0 ? ((revenue - priorRevenue) / priorRevenue * 100).toFixed(1) : (revenue > 0 ? '100.0' : '0.0');
  const growthSign = Number(growthPct) >= 0 ? '+' : '';

  // Avg days between repeat orders
  const customerOrders = {};
  allOrders.forEach(o => {
    if (!o.email) return;
    if (!customerOrders[o.email]) customerOrders[o.email] = [];
    customerOrders[o.email].push(o.order_date);
  });
  let totalGaps = 0, gapCount = 0;
  Object.values(customerOrders).forEach(dates => {
    if (dates.length < 2) return;
    dates.sort();
    for (let i = 1; i < dates.length; i++) {
      const gap = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
      totalGaps += gap;
      gapCount++;
    }
  });
  const avgReorderDays = gapCount > 0 ? (totalGaps / gapCount).toFixed(0) : '-';

  // Prior period stats for comparison
  const priorOrderCount = priorOrders.length;
  const priorLI = allLineItems.filter(li => { const o = allOrders.find(oo => oo.id === li.order_id); return o && o.order_date >= priorFrom && o.order_date <= priorTo; });
  const priorAov = priorOrderCount > 0 ? priorRevenue / priorOrderCount : 0;
  const priorTotalQty = priorLI.reduce((s, li) => s + (li.quantity || 0), 0);
  const priorAvgJars = priorOrderCount > 0 ? priorTotalQty / priorOrderCount : 0;
  const priorRefunds = priorOrders.filter(o => (o.status || '').toLowerCase().includes('refund')).length;
  const priorRefundRate = priorOrderCount > 0 ? (priorRefunds / priorOrderCount * 100).toFixed(1) : '0.0';
  const priorShippingAvg = priorOrderCount > 0 ? sum(priorOrders, 'shipping_cost') / priorOrderCount : 0;
  const priorDiscounts = sum(priorOrders, 'discount_applied');

  // Build 24-hour sparkline data for each metric
  function buildHourlySpark(hourMetricFn) {
    const points = [];
    for (let h = 0; h < 24; h++) points.push(hourMetricFn(h));
    return points;
  }
  // Parse order hour in NZ time
  function orderHourNZ(o) {
    const d = new Date(o.created_at || o.order_date + 'T00:00:00');
    const nz = new Date(d.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
    return nz.getHours();
  }
  const sparkRevenue = buildHourlySpark(h => orders.filter(o => orderHourNZ(o) === h).reduce((s, o) => s + Number(o.total_value || 0), 0));
  const sparkOrders = buildHourlySpark(h => orders.filter(o => orderHourNZ(o) === h).length);
  const sparkAov = buildHourlySpark(h => { const ho = orders.filter(o => orderHourNZ(o) === h); const r = ho.reduce((s, o) => s + Number(o.total_value || 0), 0); return ho.length > 0 ? r / ho.length : 0; });

  const priorPeriodLabel = { today: 'vs yesterday', yesterday: 'vs day before', '7d': 'vs prev 7 days', '30d': 'vs prev 30 days', month: 'vs last month', all: 'all time', custom: 'vs prev period' }[currentRange] || 'vs prior';
  function fmtDelta(curr, prev, isMoney, isPercent) {
    if (prev === 0 && curr === 0) return '<span class="flat">—</span>';
    const diff = curr - prev;
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '';
    const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    let val;
    if (isMoney) val = fmt_money(Math.abs(diff));
    else if (isPercent) val = Math.abs(diff).toFixed(1) + '%';
    else val = Math.abs(diff).toFixed(1);
    return `<span class="${cls}">${arrow} ${val}</span> ${priorPeriodLabel}`;
  }

  function renderSparkBars(points, color) {
    const max = Math.max(...points, 0.01);
    return '<div class="sparkline">' + points.map(v => {
      const h = Math.max(1, (v / max) * 24);
      return `<div class="spark-bar" style="height:${h}px;background:${v > 0 ? color : 'var(--border)'}"></div>`;
    }).join('') + '</div>';
  }

  // COGS for period
  const periodCOGS = orders.reduce((s, o) => s + getOrderCOGS(o.id), 0);
  const priorCOGS = priorOrders.reduce((s, o) => s + getOrderCOGS(o.id), 0);
  const grossMargin = revenue > 0 ? ((revenue - periodCOGS) / revenue * 100).toFixed(1) : '0.0';
  const sparkCOGS = buildHourlySpark(h => orders.filter(o => orderHourNZ(o) === h).reduce((s, o) => s + getOrderCOGS(o.id), 0));

  // Profit = Revenue - COGS - Adspend - Refunds - Expenses
  const currentRefundTotal = window._stripeRefundTotal || 0;
  const dailyExpenses = expensesData.reduce((s, e) => s + expenseDailyEquiv(Number(e.amount), e.frequency), 0);
  const periodExpenses = dailyExpenses * periodDays;
  const profit = revenue - periodCOGS - currentAdSpend - currentRefundTotal - periodExpenses;
  const priorProfit = priorRevenue - priorCOGS; // no prior adspend/refunds/expenses available
  const avgProfit = orderCount > 0 ? profit / orderCount : 0;
  const avgCOGS = orderCount > 0 ? periodCOGS / orderCount : 0;
  const blendedCPA = orderCount > 0 ? currentAdSpend / orderCount : 0;
  const priorAvgCOGS = priorOrderCount > 0 ? priorCOGS / priorOrderCount : 0;

  // Wait-time stats (computed from ALL orders, not just filtered period)
  const waitingOrders = allOrders.filter(o => orderDaysWaiting(o) >= 0);
  const waitDays = waitingOrders.map(o => orderDaysWaiting(o));
  const longestWait = waitDays.length > 0 ? Math.max(...waitDays) : 0;
  const waitOver2 = waitDays.filter(d => d > 2).length;

  // Refund $ value — prefer Stripe data, fallback to order status
  const refundTotal = (window._stripeRefundTotal > 0) ? window._stripeRefundTotal : refundedOrders.reduce((s, o) => s + Number(o.total_value || 0), 0);
  const refundCount = (window._stripeRefundCount > 0) ? window._stripeRefundCount : refundedOrders.length;

  // Overview stats — toggled by statsMode
  const isAvg = statsMode === 'avg';
  const stats = [
    isAvg
      ? { label: 'Avg Profit', value: fmt_money(avgProfit), sub: 'per order after all costs', color: profit >= 0 ? 'var(--green)' : 'var(--red)' }
      : { label: 'Profit', value: fmt_money(profit), sub: periodExpenses > 0 ? `incl $${periodExpenses.toFixed(0)} opex` : 'rev − cogs − ads − refunds', prior: fmtDelta(profit, priorProfit, true), color: profit >= 0 ? 'var(--green)' : 'var(--red)' },
    isAvg
      ? { label: 'AOV', value: fmt_money(aov), sub: 'avg order value', prior: fmtDelta(aov, priorAov, true), spark: renderSparkBars(sparkAov, 'var(--sage)'), color: 'var(--sage)' }
      : { label: 'Revenue', value: fmt_money(revenue), sub: `${growthSign}${growthPct}% vs prior period`, prior: fmtDelta(revenue, priorRevenue, true), spark: renderSparkBars(sparkRevenue, 'var(--sage)'), color: 'var(--green)' },
    isAvg
      ? { label: 'Avg Order COGs', value: fmt_money(avgCOGS), sub: 'cost per order', prior: fmtDelta(avgCOGS, priorAvgCOGS, true), color: 'var(--honey)' }
      : { label: 'COGs', value: fmt_money(periodCOGS), sub: `${grossMargin}% gross margin`, prior: fmtDelta(periodCOGS, priorCOGS, true), spark: renderSparkBars(sparkCOGS, 'var(--honey)'), color: 'var(--honey)' },
    isAvg
      ? { label: 'Blended CPA', value: fmt_money(blendedCPA), sub: 'adspend per order', color: 'var(--amber)' }
      : { label: 'Adspend', value: fmt_money(currentAdSpend), sub: currentPaidImpr > 0 ? currentPaidImpr.toLocaleString() + ' impressions' : 'period ad spend', color: 'var(--amber)' },
    isAvg
      ? { label: 'Avg Items/Order', value: avgJars.toFixed(1), sub: 'line items per order', prior: fmtDelta(avgJars, priorAvgJars), color: 'var(--pink)' }
      : { label: 'Total Items', value: totalQty, sub: 'items purchased', prior: fmtDelta(totalQty, priorTotalQty), color: 'var(--pink)' },
    { label: 'Orders', value: orderCount, sub: `${periodEmails.size} customers`, prior: fmtDelta(orderCount, priorOrderCount), spark: renderSparkBars(sparkOrders, 'var(--blue)'), color: 'var(--blue)' },
    { label: 'ROAS', value: currentAdSpend > 0 ? (currentPaidRev / currentAdSpend).toFixed(1) + 'x' : '-', sub: currentPaidConv > 0 ? currentPaidConv + ' paid conversions' : 'return on ad spend', color: 'var(--sage)' },
    { label: 'Live Visitors', value: '<span id="wa-live-count">-</span>', sub: 'on site now', color: 'var(--cyan)' },
    { label: 'Website Visitors', value: '<span id="wa-visitors-count">-</span>', sub: 'unique visitors', color: 'var(--cyan)' },
    { label: 'Refunds', value: `${fmt_money(refundTotal)} (${refundCount})`, sub: `${refundCount} refund${refundCount !== 1 ? 's' : ''} from Stripe`, color: 'var(--red)' },
  ];

  function renderStatCard(s) {
    const sensitive = ['Revenue', 'Orders', 'Profit', 'AOV', 'Avg Profit'].includes(s.label);
    const isRevCard = s.label === 'Revenue' || s.label === 'AOV';
    return `<div class="stat-card${sensitive ? ' sensitive-stat' : ''}" ${isRevCard ? 'id="revenue-stat-card"' : ''}>
      <div class="label">${s.label}</div>
      <div class="value" style="color:${s.color}">${s.value}</div>
      <div class="sub">${s.sub}</div>
      ${s.prior ? `<div class="prior">${s.prior}</div>` : ''}
      ${s.spark || ''}
    </div>`;
  }

  const liveHeroHtml = `<div class="stat-card live-hero" id="live-hero-card">
    <div class="live-label"><span class="live-pulse"></span>Live right now</div>
    <div class="live-count" id="live-hero-count">-</div>
    <div class="live-sub">active visitors on site</div>
    <div class="live-pages" id="live-pages-grid"></div>
    <div class="live-visitors-list" id="live-visitors-list"></div>
  </div>`;
  document.getElementById('stats-grid').innerHTML = liveHeroHtml + stats.map(renderStatCard).join('');
  if (currentRange === 'live') {
    document.getElementById('stats-grid').classList.add('live-mode');
    fetchLiveDetail();
  }

  // Orders tab stats
  const ordersTabEl = document.getElementById('orders-stats-grid');
  if (ordersTabEl) {
    ordersTabEl.innerHTML = [
      { label: 'Discounts Given', value: fmt_money(sum(orders, 'discount_applied')), sub: `${orders.filter(o => Number(o.discount_applied) > 0).length} orders`, prior: fmtDelta(sum(orders, 'discount_applied'), priorDiscounts, true), color: 'var(--red)' },
      { label: 'Refund Rate', value: `${refundRate}%`, sub: `${refundedOrders.length} refunded`, prior: fmtDelta(Number(refundRate), Number(priorRefundRate), false, true), color: 'var(--red)' },
      { label: 'Longest Wait', value: longestWait + 'd', sub: 'unshipped order', color: longestWait >= 4 ? 'var(--red)' : longestWait >= 2 ? 'var(--amber)' : 'var(--green)' },
      { label: 'Waiting 2+ Days', value: waitOver2, sub: `of ${waitingOrders.length} unshipped`, color: waitOver2 > 0 ? 'var(--red)' : 'var(--green)' },
    ].map(renderStatCard).join('');
  }

  // Re-apply stats visibility after rebuild
  if (typeof applyStatsVisibility === 'function') applyStatsVisibility();

  // Confetti on new sale
  if (lastKnownRevenue !== null && revenue > lastKnownRevenue) {
    const revenueCard = document.getElementById('revenue-stat-card');
    if (revenueCard) { fireConfetti(revenueCard); playSaleSound(); }
  }
  lastKnownRevenue = revenue;

  // Async: fetch website visitors + live visitors from analytics
  if (currentStaff && currentStaff.token) {
    const [waFrom, waTo] = getDateRange();
    fetch(`/.netlify/functions/analytics-dashboard?metric=summary&site=PrimalPantry.co.nz&from=${waFrom}&to=${waTo}&token=${currentStaff.token}`)
      .then(r => r.json())
      .then(s => {
        const el = document.getElementById('wa-visitors-count');
        const v = s.unique_visitors || 0;
        if (el) el.textContent = v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v;
      }).catch(() => {});
    fetch(`/.netlify/functions/analytics-realtime?site=PrimalPantry.co.nz&token=${currentStaff.token}`)
      .then(r => r.json())
      .then(d => {
        const el = document.getElementById('wa-live-count');
        if (el) el.textContent = d.active_visitors || 0;
      }).catch(() => {});
  }
}

// ── Live mode ──
async function fetchLiveDetail() {
  if (!currentStaff || !currentStaff.token) return;
  try {
    const res = await fetch(`/.netlify/functions/analytics-realtime?site=PrimalPantry.co.nz&detail=1&token=${currentStaff.token}`);
    const d = await res.json();
    const count = d.active_visitors || 0;
    const heroCount = document.getElementById('live-hero-count');
    if (heroCount) heroCount.textContent = count;
    const liveCount = document.getElementById('wa-live-count');
    if (liveCount) liveCount.textContent = count;

    // Render active pages
    const pagesGrid = document.getElementById('live-pages-grid');
    if (pagesGrid && d.pages && d.pages.length) {
      pagesGrid.innerHTML = d.pages.slice(0, 10).map(p =>
        `<div class="live-page"><span class="page-path" title="${p.page || p.pathname || ''}">${p.page || p.pathname || '/'}</span><span class="page-count">${p.visitors || p.count || 0}</span></div>`
      ).join('');
    } else if (pagesGrid) {
      pagesGrid.innerHTML = '<div style="color:var(--dim);font-size:0.8rem;grid-column:1/-1">No active pages</div>';
    }

    // Render visitor list
    const visList = document.getElementById('live-visitors-list');
    if (visList && d.visitors && d.visitors.length) {
      visList.innerHTML = d.visitors.slice(0, 15).map(v =>
        `<div class="live-visitor"><span>${v.country || ''} ${v.city || ''}</span><span>${v.page || v.pathname || '/'}</span><span style="color:var(--muted)">${v.browser || ''}</span></div>`
      ).join('');
    } else if (visList) {
      visList.innerHTML = '';
    }
  } catch (e) { console.warn('Live fetch failed', e); }
}

function startLiveMode() {
  stopLiveMode();
  fetchLiveDetail();
  liveInterval = setInterval(fetchLiveDetail, 10000); // refresh every 10s
}

function stopLiveMode() {
  if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }
}

// ── Comms response stats (populates overview + comms sidebar) ──
async function loadCommsResponseStats() {
  try {
    const data = await db.from('email_messages').select('thread_id,direction,date,customer_email').order('date', { ascending: true });
    const msgs = data.data || [];
    if (!msgs.length) return;

    // Group by thread
    const threads = {};
    msgs.forEach(m => {
      const tid = m.thread_id || m.customer_email || m.date;
      if (!threads[tid]) threads[tid] = [];
      threads[tid].push(m);
    });

    let totalResponseMs = 0, responseCount = 0, unanswered = 0;

    Object.values(threads).forEach(thread => {
      thread.sort((a, b) => new Date(a.date) - new Date(b.date));

      // Find response times: inbound followed by outbound
      let lastInbound = null;
      let answered = false;
      for (const m of thread) {
        if (m.direction === 'inbound') {
          lastInbound = m;
          answered = false;
        } else if (m.direction === 'outbound' && lastInbound && !answered) {
          totalResponseMs += new Date(m.date) - new Date(lastInbound.date);
          responseCount++;
          answered = true;
        }
      }

      // Check if last message is inbound (unanswered)
      if (thread[thread.length - 1].direction === 'inbound') {
        unanswered++;
      }
    });

    // Format avg response time
    let avgLabel = '-';
    if (responseCount > 0) {
      const avgMs = totalResponseMs / responseCount;
      const mins = Math.round(avgMs / 60000);
      if (mins < 60) avgLabel = mins + 'm';
      else if (mins < 1440) avgLabel = Math.round(mins / 60) + 'h';
      else avgLabel = Math.round(mins / 1440) + 'd';
    }

    // Update overview stats
    const overviewAvg = document.getElementById('stat-avg-response');
    const overviewUn = document.getElementById('stat-unanswered');
    if (overviewAvg) overviewAvg.textContent = avgLabel;
    if (overviewUn) {
      overviewUn.textContent = unanswered;
      overviewUn.style.color = unanswered > 0 ? 'var(--amber)' : 'var(--green)';
    }

    // Update comms sidebar stats
    const commsAvg = document.getElementById('comms-avg-response');
    const commsUn = document.getElementById('comms-unanswered');
    if (commsAvg) commsAvg.textContent = avgLabel;
    if (commsUn) {
      commsUn.textContent = unanswered;
      commsUn.style.color = unanswered > 0 ? 'var(--amber)' : 'var(--green)';
    }
  } catch (e) {
    console.error('Comms stats error:', e);
  }
}

// ── Revenue chart ──
function renderRevenueChart(orders) {
  const [from, to] = getDateRange();
  const days = {};
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days[fmt_date(d)] = 0;
  }
  orders.forEach(o => { if (days[o.order_date] !== undefined) days[o.order_date] += Number(o.total_value || 0); });

  const labels = Object.keys(days).map(d => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getDate()}/${dt.getMonth() + 1}`;
  });

  if (charts.revenue) charts.revenue.destroy();
  charts.revenue = new Chart(document.getElementById('revenue-chart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Revenue', data: Object.values(days), backgroundColor: '#6B8F5B', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: {
      y: { ticks: { color: '#9c9287', callback: v => '$' + v }, grid: { color: '#252220' } },
      x: { ticks: { color: '#9c9287', maxRotation: 45, maxTicksLimit: 15 }, grid: { display: false } },
    }},
  });
}

// ── Cumulative Monthly Revenue Pace ──
function renderCumulativeRevenue() {
  const mode = (document.getElementById('pace-mode') || {}).value || 'daily';
  if (mode === 'daily') renderDailyPace(); else renderMonthlyPace();
}

document.getElementById('pace-mode')?.addEventListener('change', renderCumulativeRevenue);

function renderDailyPace() {
  const now = new Date();
  const currentHour = now.getHours();
  const todayStr = localDateStr(now);

  // Same weekday last week
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastWeekStr = localDateStr(lastWeek);

  const todayHourly = Array(24).fill(0);
  const lastWeekHourly = Array(24).fill(0);
  const todayCogsHourly = Array(24).fill(0);

  allOrders.forEach(o => {
    const val = Number(o.total_value || 0);
    if (o.order_date === todayStr) {
      const h = o.created_at ? new Date(o.created_at).getHours() : 0;
      todayHourly[h] += val;
      todayCogsHourly[h] += getOrderCOGS(o.id);
    } else if (o.order_date === lastWeekStr) {
      const h = o.created_at ? new Date(o.created_at).getHours() : 0;
      lastWeekHourly[h] += val;
    }
  });

  // Use stored cumulative adspend snapshots for the hourly chart
  // Each row has the cumulative_spend at that hour — plot directly
  const cumAdspendByHour = Array(24).fill(null);
  let hasHourlyAdspend = false;
  if (window._adspendHourlyData && Array.isArray(window._adspendHourlyData)) {
    const todayData = window._adspendHourlyData.filter(r => r.date === todayStr);
    if (todayData.length > 0) {
      hasHourlyAdspend = true;
      // Aggregate FB + Google cumulative spend per hour
      const bySrc = {};
      todayData.forEach(r => {
        if (!bySrc[r.source]) bySrc[r.source] = {};
        bySrc[r.source][r.hour] = Number(r.cumulative_spend || 0);
      });
      // For each hour up to current, sum all sources' cumulative values
      for (let h = 0; h <= currentHour; h++) {
        let total = 0;
        for (const src of Object.keys(bySrc)) {
          // Use this hour's value, or carry forward from the last recorded hour
          let val = bySrc[src][h];
          if (val === undefined) {
            for (let ph = h - 1; ph >= 0; ph--) {
              if (bySrc[src][ph] !== undefined) { val = bySrc[src][ph]; break; }
            }
          }
          total += val || 0;
        }
        cumAdspendByHour[h] = total;
      }
    }
  }
  if (!hasHourlyAdspend) {
    // Fallback: spread evenly across completed hours
    const adspendPerHour = currentHour > 0 ? currentAdSpend / (currentHour + 1) : currentAdSpend;
    let runAds = 0;
    for (let h = 0; h <= currentHour; h++) {
      runAds += adspendPerHour;
      cumAdspendByHour[h] = runAds;
    }
  }

  // Build hourly refunds from Stripe data
  const todayRefundHourly = Array(24).fill(0);
  if (window._stripeRefunds) {
    window._stripeRefunds.forEach(r => {
      if (r.date === todayStr) todayRefundHourly[r.hour] += r.amount;
    });
  }

  // Daily expenses spread hourly
  const dailyExp = expensesData.reduce((s, e) => s + expenseDailyEquiv(Number(e.amount), e.frequency), 0);
  const hourlyExpense = dailyExp / 24;

  const labels = [], cumToday = [], cumLastWeek = [], cumTotalCosts = [];
  let runToday = 0, runLW = 0, runCogs = 0, runRefunds = 0, runExpenses = 0;
  for (let h = 0; h < 24; h++) {
    const ampm = h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm';
    labels.push(ampm);
    runLW += lastWeekHourly[h];
    cumLastWeek.push(runLW);
    if (h <= currentHour) {
      runToday += todayHourly[h]; cumToday.push(runToday);
      runCogs += todayCogsHourly[h];
      runRefunds += todayRefundHourly[h];
      runExpenses += hourlyExpense;
      cumTotalCosts.push(runCogs + (cumAdspendByHour[h] || 0) + runRefunds + runExpenses);
    } else {
      cumToday.push(null); cumTotalCosts.push(null);
    }
  }

  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayLabel = 'Today (' + dayNames[now.getDay()] + ')';
  const lwLabel = 'Last ' + dayNames[lastWeek.getDay()] + ' (' + lastWeekStr.slice(5) + ')';

  if (charts.cumRevenue) charts.cumRevenue.destroy();
  charts.cumRevenue = new Chart(document.getElementById('cumulative-revenue-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: lwLabel, data: cumLastWeek, borderColor: 'rgba(156,146,135,0.35)', backgroundColor: 'rgba(156,146,135,0.05)', fill: true, borderWidth: 1.5, borderDash: [4, 3], tension: 0.3, pointRadius: 0, order: 3 },
        { label: todayLabel + ' Revenue', data: cumToday, borderColor: '#6B8F5B', backgroundColor: 'rgba(107,143,91,0.2)', fill: true, borderWidth: 2.5, tension: 0.3, pointRadius: 0, pointHitRadius: 8, order: 2 },
        { label: 'Total Costs (COGS + Ads + Refunds + Opex)', data: cumTotalCosts, borderColor: '#E67E22', backgroundColor: 'rgba(230,126,34,0.35)', fill: true, borderWidth: 2, tension: 0.3, pointRadius: 0, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' } } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': $' + (ctx.parsed.y || 0).toFixed(2) } },
      },
      scales: {
        x: { ticks: { color: '#9c9287', maxTicksLimit: 12, font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: '#9c9287', callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v) }, grid: { color: 'rgba(51,45,39,0.5)' } },
      },
    },
  });
}

function renderMonthlyPace() {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth(), today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const currentDaily = Array(daysInMonth).fill(0);
  const cogsDaily = Array(daysInMonth).fill(0);
  allOrders.forEach(o => {
    const d = new Date(o.order_date + 'T00:00:00');
    if (d.getFullYear() === year && d.getMonth() === month) {
      currentDaily[d.getDate() - 1] += Number(o.total_value || 0);
      cogsDaily[d.getDate() - 1] += getOrderCOGS(o.id);
    }
  });

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
  const prevDaily = Array(daysInPrevMonth).fill(0);
  allOrders.forEach(o => {
    const d = new Date(o.order_date + 'T00:00:00');
    if (d.getFullYear() === prevYear && d.getMonth() === prevMonth) prevDaily[d.getDate() - 1] += Number(o.total_value || 0);
  });

  // Build daily refunds from Stripe data for this month
  const refundDaily = Array(daysInMonth).fill(0);
  if (window._stripeRefunds) {
    window._stripeRefunds.forEach(r => {
      const d = new Date(r.date + 'T00:00:00');
      if (d.getFullYear() === year && d.getMonth() === month) {
        refundDaily[d.getDate() - 1] += r.amount;
      }
    });
  }

  // Distribute adspend proportionally to daily revenue
  let totalRevenueToNow = 0;
  for (let i = 0; i < today; i++) totalRevenueToNow += currentDaily[i];

  const labels = [], cumCurrent = [], cumPrev = [], cumTotalCosts = [];
  let runCurrent = 0, runPrev = 0, runCosts = 0;
  for (let i = 0; i < daysInMonth; i++) {
    labels.push(i + 1);
    if (i < today) {
      runCurrent += currentDaily[i]; cumCurrent.push(runCurrent);
      const dailyAdspend = totalRevenueToNow > 0 ? currentAdSpend * (currentDaily[i] / totalRevenueToNow) : currentAdSpend / today;
      runCosts += cogsDaily[i] + dailyAdspend + refundDaily[i]; cumTotalCosts.push(runCosts);
    } else {
      cumCurrent.push(null); cumTotalCosts.push(null);
    }
    if (i < daysInPrevMonth) runPrev += prevDaily[i];
    cumPrev.push(runPrev);
  }

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const currLabel = monthNames[month] + ' ' + year;
  const prevLabel = monthNames[prevMonth] + ' ' + prevYear;

  if (charts.cumRevenue) charts.cumRevenue.destroy();
  charts.cumRevenue = new Chart(document.getElementById('cumulative-revenue-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: prevLabel + ' (pace)', data: cumPrev, borderColor: 'rgba(156,146,135,0.35)', backgroundColor: 'rgba(156,146,135,0.05)', fill: true, borderWidth: 1.5, borderDash: [4, 3], tension: 0.3, pointRadius: 0, order: 3 },
        { label: currLabel + ' Revenue', data: cumCurrent, borderColor: '#6B8F5B', backgroundColor: 'rgba(107,143,91,0.2)', fill: true, borderWidth: 2.5, tension: 0.3, pointRadius: 0, pointHitRadius: 8, order: 2 },
        { label: 'Total Costs (COGS + Ads + Refunds + Opex)', data: cumTotalCosts, borderColor: '#E67E22', backgroundColor: 'rgba(230,126,34,0.35)', fill: true, borderWidth: 2, tension: 0.3, pointRadius: 0, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' } } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': $' + (ctx.parsed.y || 0).toFixed(2), title: items => 'Day ' + items[0].label } },
      },
      scales: {
        x: { ticks: { color: '#9c9287', maxTicksLimit: 15, font: { size: 10 } }, grid: { display: false }, title: { display: true, text: 'Day of Month', color: '#6e6259', font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { color: '#9c9287', callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v) }, grid: { color: 'rgba(51,45,39,0.5)' } },
      },
    },
  });
}

// ── Orders by hour ──
function renderHoursChart(orders) {
  const hours = Array(24).fill(0);
  orders.forEach(o => {
    let h = o.order_hour;
    if (h == null && o.created_at) h = new Date(o.created_at).getHours();
    if (h != null && h >= 0 && h < 24) hours[h]++;
  });

  const labels = hours.map((_, i) => `${i}:00`);

  if (charts.hours) charts.hours.destroy();
  charts.hours = new Chart(document.getElementById('hours-chart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Orders', data: hours, backgroundColor: '#D4A84B', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: {
      y: { ticks: { color: '#9c9287' }, grid: { color: '#252220' } },
      x: { ticks: { color: '#9c9287', maxRotation: 45 }, grid: { display: false } },
    }},
  });
}

// ── Top products ──
let currentLineItems = [];
function renderProductsChart(lineItems) {
  currentLineItems = lineItems;
  const view = document.getElementById('product-view').value;
  const metric = document.getElementById('product-metric').value;
  const products = {};
  lineItems.forEach(li => {
    const key = view === 'sku' ? (li.sku || 'Unknown') : (li.description || li.sku || 'Unknown');
    if (metric === 'revenue') {
      products[key] = (products[key] || 0) + (li.quantity * Number(li.unit_price || 0));
    } else {
      products[key] = (products[key] || 0) + li.quantity;
    }
  });

  const sorted = Object.entries(products).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const colors = ['#6B8F5B', '#D4A84B', '#2E1A0E', '#DBBFA8', '#8CB47A', '#6B4D38', '#B84233', '#442A16', '#E5EDDF', '#877B71'];

  if (charts.products) charts.products.destroy();
  charts.products = new Chart(document.getElementById('products-chart'), {
    type: 'doughnut',
    data: { labels: sorted.map(s => s[0]), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.slice(0, sorted.length) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' }, padding: 6, boxWidth: 12 } } } },
  });
}

// ── UTM Sources ──
function renderUTM(orders) {
  const sources = {};
  orders.forEach(o => {
    const src = resolveOrderSource(o) || 'Direct';
    sources[src] = (sources[src] || 0) + 1;
  });

  const sorted = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  const max = sorted.length > 0 ? sorted[0][1] : 1;
  const container = document.getElementById('utm-container');

  if (sorted.length === 0 || (sorted.length === 1 && sorted[0][0] === 'Direct')) {
    container.innerHTML = '<p style="color:var(--dim);font-size:0.85rem;">No UTM data yet. UTM params from thank-you URLs will appear here.</p>';
    return;
  }

  const start = (utmPage - 1) * PAGE_SIZE;
  const page = sorted.slice(start, start + PAGE_SIZE);

  container.innerHTML = `<table class="utm-table">
    <thead><tr><th>Source</th><th>Orders</th><th></th></tr></thead>
    <tbody>${page.map(([src, count]) => `
      <tr>
        <td>${utmTranslate('utm_source', src)}</td>
        <td>${count}</td>
        <td><span class="utm-bar" style="width:${(count / max) * 100}px"></span></td>
      </tr>
    `).join('')}</tbody>
  </table><div id="utm-pagination"></div>`;
  renderPagination('utm-pagination', utmPage, sorted.length, p => { utmPage = p; renderUTM(orders); });
}

function getUtmFromUrl(url, param) {
  try {
    const p = param || 'utm_source';
    const u = new URL(url);
    const direct = u.searchParams.get(p);
    if (direct) return direct;
    const landing = u.searchParams.get('landing_url');
    if (landing) { try { return new URL(landing).searchParams.get(p) || ''; } catch { return ''; } }
    return '';
  } catch { return ''; }
}

// Extract a param from order's landing_page, thank_you_url, or the landing_url inside thank_you_url
function getOrderParam(o, param) {
  return getUtmFromUrl(o.thank_you_url, param) || getUtmFromUrl(o.landing_page, param) || '';
}

// Resolve order source with gad_source/gclid/fbclid fallback
function resolveOrderSource(o) {
  const src = o.utm_source || o.analytics_source || getOrderParam(o, 'utm_source') || '';
  if (src) return src;
  // Google Ads auto-params: gad_source=1, gclid, gbraid
  if (o.gclid || getOrderParam(o, 'gclid') || getOrderParam(o, 'gad_source') || getOrderParam(o, 'gbraid')) return 'google';
  if (o.fbclid || getOrderParam(o, 'fbclid')) return 'facebook';
  return '';
}

// Resolve order campaign with gad_campaignid fallback
function resolveOrderCampaign(o) {
  return o.utm_campaign || getOrderParam(o, 'utm_campaign') || getOrderParam(o, 'gad_campaignid') || '';
}

function sourceColor(src) {
  const colors = [
    { bg: 'rgba(140,180,122,0.15)', fg: '#8CB47A' },
    { bg: 'rgba(212,168,75,0.15)', fg: '#D4A84B' },
    { bg: 'rgba(219,191,168,0.12)', fg: '#DBBFA8' },
    { bg: 'rgba(163,201,149,0.12)', fg: '#a3c995' },
    { bg: 'rgba(224,96,80,0.12)', fg: '#e06050' },
    { bg: 'rgba(107,143,91,0.15)', fg: '#6B8F5B' },
    { bg: 'rgba(180,160,140,0.12)', fg: '#c4b09a' },
    { bg: 'rgba(200,170,130,0.12)', fg: '#d4b88a' },
  ];
  let h = 0;
  for (let i = 0; i < src.length; i++) h = ((h << 5) - h + src.charCodeAt(i)) | 0;
  const c = colors[Math.abs(h) % colors.length];
  return c;
}

function sourcePill(src) {
  if (!src) return '';
  const c = sourceColor(src);
  const display = typeof utmTranslateAny === 'function' ? utmTranslateAny(src) : src;
  return `<span class="source-pill" style="background:${c.bg};color:${c.fg}">${display}</span>`;
}

// Rich source pill from order: "source – campaign / content"
function orderSourcePill(o) {
  const src = resolveOrderSource(o);
  if (!src) return '';
  const c = sourceColor(src);
  const srcDisplay = utmTranslate('utm_source', src);
  // Build detail: campaign, then adgroup/content/keyword
  const camp = resolveOrderCampaign(o);
  const content = o.utm_content || getOrderParam(o, 'utm_content') || '';
  const term = o.utm_term || getOrderParam(o, 'utm_term') || '';
  const adgroup = o.utm_adgroup || getOrderParam(o, 'utm_adgroup') || '';
  const details = [];
  if (camp) details.push(utmTranslate('utm_campaign', camp));
  if (adgroup) details.push(utmTranslateAny(adgroup));
  if (content) details.push(utmTranslateAny(content));
  if (term && !content) details.push(utmTranslateAny(term));
  const label = details.length ? srcDisplay + ' – ' + details.join(' / ') : srcDisplay;
  return `<span class="source-pill" style="background:${c.bg};color:${c.fg}">${label}</span>`;
}

// ── Heatmap (Day of week x Hour) ──
function renderHeatmap(orders) {
  const grid = Array(7).fill(null).map(() => Array(24).fill(0));
  orders.forEach(o => {
    const dow = new Date(o.order_date + 'T00:00:00').getDay();
    const h = o.order_hour != null ? o.order_hour : new Date(o.created_at).getHours();
    grid[dow][h]++;
  });

  const max = Math.max(1, ...grid.flat());
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const container = document.getElementById('heatmap-container');

  let html = '<div class="heatmap-grid">';
  // Header row
  html += '<div></div>';
  for (let h = 0; h < 24; h++) html += `<div class="heatmap-header">${h}</div>`;

  for (let d = 0; d < 7; d++) {
    html += `<div class="heatmap-label">${dayLabels[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const v = grid[d][h];
      const intensity = v / max;
      const bg = v === 0 ? 'rgba(107,143,91,0.05)' : `rgba(107,143,91,${0.15 + intensity * 0.85})`;
      html += `<div class="heatmap-cell" style="background:${bg}" title="${dayLabels[d]} ${h}:00 — ${v} orders">${v || ''}</div>`;
    }
  }
  html += '</div>';
  container.innerHTML = html;
}

// ── Shipping status lookup for orders ──
function getShipStatus(order) {
  if (!allShipments.length || !order.stripe_session_id) return null;
  return allShipments.find(s => s.order_number === order.stripe_session_id) || null;
}

function shipStatusPill(order) {
  const ship = getShipStatus(order);
  if (!ship) return '';
  const status = ship._shipping_status || 'Unknown';
  const cls = status.toLowerCase().replace(/\s+/g, '-');
  return `<span class="ship-status-badge ${cls}">${status}</span>`;
}

// Auto-sync shipping: persist shipped_at (one-way flip) + mark Delivered
async function syncDeliveredOrders() {
  if (!allShipments.length || !allOrders.length) return;
  const skipStatuses = ['delivered', 'refunded', 'incorrect order', 'cancelled'];
  const toDeliver = [], toShip = [];
  allShipments.forEach(ship => {
    const st = ship._shipping_status;
    if (st !== 'In Transit' && st !== 'Delivered') return;
    const order = allOrders.find(o => o.stripe_session_id === ship.order_number);
    if (!order) return;
    if (!order.shipped_at) toShip.push({ order, shipped_date: ship.shipped_date || new Date().toISOString() });
    if (st === 'Delivered' && !skipStatuses.includes((order.status || '').toLowerCase())) toDeliver.push(order);
  });
  for (const { order, shipped_date } of toShip) {
    const { error } = await db.from('orders').update({ shipped_at: shipped_date }).eq('id', order.id);
    if (!error) { order.shipped_at = shipped_date; }
  }
  for (const order of toDeliver) {
    const { error } = await db.from('orders').update({ status: 'Delivered' }).eq('id', order.id);
    if (!error) { order.status = 'Delivered'; }
  }
  if (toShip.length || toDeliver.length) renderOrdersTable();
}

// Days waiting badge — shows active wait (days+hours) or gray delivered pill
function daysWaitingBadge(order) {
  const skip = ['refunded', 'incorrect order', 'cancelled'];
  if (skip.includes((order.status || '').toLowerCase())) return '';
  const created = order.created_at ? new Date(order.created_at) : (order.order_date ? new Date(order.order_date + 'T00:00:00') : null);
  if (!created) return '';

  // Delivered: gray pill with total delivery time
  const ship = getShipStatus(order);
  if ((order.status || '').toLowerCase() === 'delivered' || (ship && ship._shipping_status === 'Delivered')) {
    const endDate = ship?.delivered_date ? new Date(ship.delivered_date) : new Date();
    const diffMs = endDate - created;
    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const label = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
    return `<span class="dw-badge dw-delivered" title="Order placed to delivered">${label}</span>`;
  }

  // In transit: show wait but no urgency colors
  if (order.shipped_at) {
    const diffMs = Date.now() - created;
    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const label = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
    return `<span class="dw-badge dw-green" title="${days}d ${hours}h since order">${label}</span>`;
  }

  // Not yet shipped: active waiting with urgency
  const diffMs = Date.now() - created;
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  const label = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  let cls = 'dw-green';
  if (days >= 4) cls = 'dw-red dw-pulse';
  else if (days >= 3) cls = 'dw-orange';
  else if (days >= 2) cls = 'dw-yellow';
  return `<span class="dw-badge ${cls}" title="${days}d ${hours}h waiting">${label}</span>`;
}

function orderDaysWaiting(order) {
  const skip = ['delivered', 'refunded', 'incorrect order', 'cancelled'];
  if (order.shipped_at || skip.includes((order.status || '').toLowerCase())) return -1;
  const created = order.created_at ? new Date(order.created_at) : (order.order_date ? new Date(order.order_date + 'T00:00:00') : null);
  if (!created) return -1;
  return Math.floor((Date.now() - created) / 86400000);
}

function responseTimePill(inboundDate, outboundDate) {
  if (!inboundDate || !outboundDate) return '';
  const diffMs = new Date(outboundDate) - new Date(inboundDate);
  if (diffMs < 0) return '';
  const diffMins = Math.round(diffMs / 60000);
  let label, cls;
  if (diffMins < 60) { label = diffMins + 'm'; cls = 'fast'; }
  else if (diffMins < 1440) { label = Math.round(diffMins / 60) + 'h'; cls = diffMins < 240 ? 'fast' : 'normal'; }
  else { const d = Math.round(diffMins / 1440); label = d + 'd'; cls = d <= 1 ? 'normal' : d <= 3 ? 'slow' : 'very-slow'; }
  return `<span class="response-pill ${cls}" title="Response time">${label} reply</span>`;
}

function orderStatusIcon(status) {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s === 'refunded') return '<span class="status-icon refunded" title="Refunded">R</span>';
  if (s === 'incorrect order') return '<span class="status-icon incorrect-order" title="Incorrect Order">IO</span>';
  return '';
}
// ── Orders table ──
let orderSortCol = 'date';
let orderSortAsc = false; // default: most recent first

function getOrderSortValue(o, col, orderLineItemMap) {
  switch (col) {
    case 'wait': return orderDaysWaiting(o);
    case 'date': return o.created_at || o.order_date || '';
    case 'customer': return (o.customer_name || '').toLowerCase();
    case 'email': return (o.email || '').toLowerCase();
    case 'location': return [o.city, o.country_code].filter(Boolean).join(', ').toLowerCase();
    case 'total': return Number(o.total_value || 0);
    case 'cogs': return getOrderCOGS(o.id);
    case 'margin': { const cg = getOrderCOGS(o.id); const tv = Number(o.total_value || 0); return cg > 0 && tv > 0 ? (tv - cg) / tv : -1; }
    case 'source': return resolveOrderSource(o).toLowerCase();
    default: return '';
  }
}

function renderOrdersTable() {
  const tbody = document.getElementById('orders-table');
  const query = (document.getElementById('order-search').value || '').toLowerCase();

  const orderLineItemMap = {};
  allLineItems.forEach(li => {
    if (!orderLineItemMap[li.order_id]) orderLineItemMap[li.order_id] = [];
    orderLineItemMap[li.order_id].push(li);
  });

  // When searching, search across ALL orders (not just date-filtered)
  let orders = query ? [...allOrders] : [...filteredOrders];
  if (query) {
    orders = orders.filter(o => {
      const fields = [o.customer_name, o.email, o.city, o.utm_source, o.status].join(' ').toLowerCase();
      const liText = (orderLineItemMap[o.id] || []).map(li => `${li.description} ${li.sku}`).join(' ').toLowerCase();
      return fields.includes(query) || liText.includes(query);
    });
  }
  // Sort by selected column
  orders.sort((a, b) => {
    const va = getOrderSortValue(a, orderSortCol, orderLineItemMap);
    const vb = getOrderSortValue(b, orderSortCol, orderLineItemMap);
    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    return orderSortAsc ? cmp : -cmp;
  });

  // Update header sort indicators
  document.querySelectorAll('[data-order-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.orderSort === orderSortCol) {
      th.classList.add(orderSortAsc ? 'sort-asc' : 'sort-desc');
    }
  });

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="loading">No orders found</td></tr>';
    document.getElementById('orders-pagination').innerHTML = '';
    return;
  }

  const start = (ordersPage - 1) * PAGE_SIZE;
  const page = orders.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = page.map(o => {
    const items = orderLineItemMap[o.id] || [];
    const magnet = items.length ? items[0].description : '';
    const addons = items.slice(1).map(li => li.description).filter(Boolean);
    const itemsHtml = magnet
      ? `<span style="color:var(--red);font-weight:600;">${magnet}</span>${addons.length ? ' – ' + addons.join(', ') : ''}`
      : '-';
    const src = resolveOrderSource(o);
    return `
    <tr class="clickable" data-id="${o.id}">
      <td>${daysWaitingBadge(o)}</td>
      <td>${o.order_date}${o.created_at ? ' ' + new Date(o.created_at).toLocaleTimeString('en-NZ', {hour:'2-digit',minute:'2-digit'}) : ''}</td>
      <td>${o.customer_name || '-'}${orderStatusIcon(o.status)}</td>
      <td>${o.email || '-'}</td>
      <td>${[o.city, o.country_code].filter(Boolean).join(', ') || '-'}</td>
      <td>$${Number(o.total_value || 0).toFixed(2)}</td>
      <td>${(() => { const cg = getOrderCOGS(o.id); return cg > 0 ? '$' + cg.toFixed(2) : '-'; })()}</td>
      <td>${(() => { const cg = getOrderCOGS(o.id); const tv = Number(o.total_value || 0); return cg > 0 && tv > 0 ? ((tv - cg) / tv * 100).toFixed(0) + '%' : '-'; })()}</td>
      <td>${sourcePill(resolveOrderSource(o)) || '-'}</td>
      <td style="font-size:0.82rem;">${itemsHtml}</td>
      <td>${shipStatusPill(o)}</td>
    </tr>`;
  }).join('');

  // Attach click handlers
  tbody.querySelectorAll('tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => openOrderModal(Number(tr.dataset.id)));
  });
  renderPagination('orders-pagination', ordersPage, orders.length, p => { ordersPage = p; renderOrdersTable(); });
}

// Orders table sort click handlers
document.querySelectorAll('[data-order-sort]').forEach(th => {
  th.addEventListener('click', function() {
    const col = this.dataset.orderSort;
    if (orderSortCol === col) orderSortAsc = !orderSortAsc;
    else { orderSortCol = col; orderSortAsc = col === 'customer' || col === 'email' || col === 'location' || col === 'source'; }
    ordersPage = 1;
    renderOrdersTable();
  });
});

// ── Order modal ──
function openOrderModal(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const items = allLineItems.filter(li => li.order_id === orderId);

  document.getElementById('modal-title').innerHTML = `<span>Order — ${order.customer_name || order.email}</span><span id="modal-ship-badge" style="font-size:0.75rem;margin-left:auto;"></span>`;
  document.getElementById('modal-title').style.cssText = 'display:flex;align-items:center;gap:0.75rem;';

  // Analytics pills at top of modal
  const oSrc = resolveOrderSource(order);
  const magnetItem = (items[0] || {}).description || '';
  let pillsHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">';
  if (oSrc) pillsHtml += orderSourcePill(order);
  if (magnetItem) pillsHtml += sourcePill(magnetItem);
  pillsHtml += '</div>';

  const isAdmin = currentStaff && (currentStaff.role === 'owner' || currentStaff.role === 'admin');
  if (isAdmin) {
    pillsHtml = `<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;">
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${pillsHtml.replace(/<\/?div[^>]*>/g, '')}</div>
      <button id="modal-edit-btn" data-order-id="${orderId}" style="background:none;border:1px solid var(--sage);color:var(--sage);border-radius:6px;padding:0.3rem 0.7rem;font-size:0.75rem;cursor:pointer;font-weight:600;font-family:'DM Sans',sans-serif;white-space:nowrap;">Edit Order</button>
    </div>`;
  }
  const statusOptions = isAdmin
    ? ['Ordered - Paid', 'Processing', 'Shipped', 'Delivered', 'Refunded', 'Incorrect Order', 'Cancelled']
    : ['Ordered - Paid', 'Processing', 'Shipped', 'Delivered'];
  const statusSelect = `<select id="modal-status" data-order-id="${orderId}" style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:0.85rem;">
    ${statusOptions.map(s => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s}</option>`).join('')}
  </select>`;

  const rows = [
    ['Date', order.order_date],
    ['Email', order.email],
    ['Phone', order.phone || '-'],
    ['Status', statusSelect],
    ['Total', '$' + Number(order.total_value || 0).toFixed(2)],
    ['Shipping Cost', '$' + Number(order.shipping_cost || 0).toFixed(2)],
    ['Discount', '$' + Number(order.discount_applied || 0).toFixed(2)],
    ['Currency', order.currency],
    ['Market', order.market],
    ['Address', [order.street_address, order.suburb, order.city, order.postcode, order.country_code].filter(Boolean).join(', ')],
    ['Landing Page', order.landing_page || '-'],
    ['Magnet Product', magnetItem || '-'],
    ['Last Product Page', order.last_product_page || '-'],
    ['Analytics Source', order.analytics_source || '-'],
    ['UTM Source', utmTranslate('utm_source', resolveOrderSource(order)) || '-'],
    ['UTM Medium', utmTranslate('utm_medium', order.utm_medium || getUtmFromUrl(order.thank_you_url, 'utm_medium')) || '-'],
    ['UTM Campaign', utmTranslate('utm_campaign', resolveOrderCampaign(order)) || '-'],
    ['Thank You URL', order.thank_you_url ? `<a href="${order.thank_you_url}" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all;font-size:0.8rem;">${order.thank_you_url}</a>` : '-'],
    ['Stripe ID', order.stripe_session_id],
  ];

  let html = pillsHtml + rows.map(([l, v]) => `<div class="modal-row"><span class="label">${l}</span><span>${v || '-'}</span></div>`).join('');

  if (items.length > 0) {
    html += '<h3 style="margin:1rem 0 0.5rem;font-size:0.9rem;color:var(--muted)">Line Items</h3>';
    html += items.map(li => `
      <div class="modal-row">
        <span>${li.quantity}x ${li.description || li.sku || 'Unknown'}</span>
        <span>$${Number(li.unit_price || 0).toFixed(2)}</span>
      </div>
    `).join('');
  }

  // Customer Journey section
  html += `<h3 style="margin:1rem 0 0.5rem;font-size:0.9rem;color:var(--muted)">Customer Journey</h3>
  <div id="modal-journey" style="padding:0.5rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:0.8rem;color:var(--dim);">Loading journey...</div>`;

  // Load journey data async
  setTimeout(() => loadOrderJourney(order), 50);

  // Shipping status detail (auto-loaded)
  html += `<div id="modal-shipping-detail" style="margin-top:0.75rem;padding:0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;display:none;"></div>`;

  // Review prompt button (only for delivered orders)
  const isDelivered = (order.status || '').toLowerCase().includes('delivered');
  const alreadyPrompted = !!order.review_prompted_at;
  if (isDelivered) {
    if (alreadyPrompted) {
      const promptDate = new Date(order.review_prompted_at).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' });
      html += `<div style="margin-top:0.75rem;text-align:center;">
        <span style="background:rgba(140,180,122,0.15);color:var(--sage);padding:0.3rem 0.8rem;border-radius:6px;font-size:0.8rem;font-weight:600;">Review Requested ${promptDate}</span>
      </div>`;
    } else {
      html += `<div style="margin-top:0.75rem;text-align:center;">
        <button id="modal-review-btn" data-order-id="${orderId}" style="background:var(--honey);color:#141210;border:none;border-radius:6px;padding:0.5rem 1.2rem;font-size:0.85rem;cursor:pointer;font-weight:600;font-family:'DM Sans',sans-serif;">Request Review</button>
      </div>`;
    }
  }

  // Awaiting Item button
  const awaitingSku = order.awaiting_sku;
  if (awaitingSku) {
    const awaitDesc = getSkuDesc(awaitingSku);
    html += `<div style="margin-top:0.75rem;text-align:center;display:flex;gap:0.5rem;justify-content:center;align-items:center;">
      <button class="awaiting-modal-btn active" onclick="openAwaitingPicker('${order.order_number || order.stripe_session_id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> Awaiting: ${awaitDesc}</button>
      <button class="awaiting-clear-btn" onclick="clearAwaitingSku('${order.order_number || order.stripe_session_id}');closeModal();">Clear</button>
    </div>`;
  } else {
    html += `<div style="margin-top:0.75rem;text-align:center;">
      <button class="awaiting-modal-btn" onclick="openAwaitingPicker('${order.order_number || order.stripe_session_id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> Awaiting Item</button>
    </div>`;
  }

  // Action buttons row (Email + Reprint)
  html += `<div style="margin-top:0.75rem;text-align:center;display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;">
    <button onclick="openComposeModal({to: '${(order.email || '').replace(/'/g, "\\'")}', subject: 'Re: Your Primal Pantry Order #${orderId}'})" style="background:none;border:1px solid var(--sage);color:var(--sage);border-radius:6px;padding:0.5rem 1.2rem;font-size:0.85rem;cursor:pointer;font-weight:600;font-family:'DM Sans',sans-serif;">Email Customer</button>
    <span id="modal-reprint-wrap" style="display:none;position:relative;">
      <button id="modal-reprint-btn" style="background:none;border:1px solid var(--cyan);color:var(--cyan);border-radius:6px;padding:0.5rem 1.2rem;font-size:0.85rem;cursor:pointer;font-weight:600;font-family:'DM Sans',sans-serif;">Reprint Label</button>
      <div id="modal-reprint-menu" style="display:none;position:absolute;top:110%;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:0.4rem;min-width:200px;z-index:200;box-shadow:0 4px 16px rgba(0,0,0,0.5);">
        <div style="font-size:0.65rem;color:var(--dim);padding:0.3rem 0.75rem;text-transform:uppercase;letter-spacing:0.05em;">Reprint Options</div>
        <button class="reprint-opt" data-action="asis" style="width:100%;text-align:left;background:none;border:none;color:var(--text);padding:0.5rem 0.75rem;border-radius:6px;cursor:pointer;font-size:0.85rem;font-family:'DM Sans',sans-serif;">Print As Is</button>
        <div style="border-top:1px solid var(--border);margin:0.25rem 0;"></div>
        <div style="font-size:0.65rem;color:var(--dim);padding:0.3rem 0.75rem;text-transform:uppercase;letter-spacing:0.05em;">Change Size &amp; Print</div>
        <button class="reprint-opt" data-action="DL" style="width:100%;text-align:left;background:none;border:none;color:var(--text);padding:0.5rem 0.75rem;border-radius:6px;cursor:pointer;font-size:0.85rem;font-family:'DM Sans',sans-serif;">DL — Small</button>
        <button class="reprint-opt" data-action="A5" style="width:100%;text-align:left;background:none;border:none;color:var(--text);padding:0.5rem 0.75rem;border-radius:6px;cursor:pointer;font-size:0.85rem;font-family:'DM Sans',sans-serif;">A5 — Medium</button>
        <button class="reprint-opt" data-action="A4" style="width:100%;text-align:left;background:none;border:none;color:var(--text);padding:0.5rem 0.75rem;border-radius:6px;cursor:pointer;font-size:0.85rem;font-family:'DM Sans',sans-serif;">A4 — Large</button>
        <button class="reprint-opt" data-action="Foolscap" style="width:100%;text-align:left;background:none;border:none;color:var(--text);padding:0.5rem 0.75rem;border-radius:6px;cursor:pointer;font-size:0.85rem;font-family:'DM Sans',sans-serif;">Foolscap — Extra Large</button>
      </div>
    </span>
  </div>`;

  // Only owner/admin can see refund/delete buttons
  if (currentStaff && (currentStaff.role === 'owner' || currentStaff.role === 'admin')) {
    const isStripe = order.stripe_session_id && !order.stripe_session_id.startsWith('manual_');
    const isRefunded = order.status === 'Refunded' || order.status === 'Partial Refund';
    const orderTotal = Number(order.total_value || 0);

    html += `<div style="margin-top:1.5rem;padding-top:1rem;border-top:2px solid var(--red);background:rgba(244,63,94,0.08);border-radius:0 0 8px 8px;padding:1rem;">
      <div style="color:var(--red);font-weight:700;font-size:0.85rem;margin-bottom:0.75rem;">DANGER ZONE</div>`;

    // Show refund details if already refunded
    if (isRefunded && order.refund_reason) {
      html += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:0.75rem;margin-bottom:0.75rem;font-size:0.85rem;">
        <div style="font-weight:600;color:var(--amber);margin-bottom:0.25rem;">Refund Processed</div>
        <div class="modal-row"><span class="label">Amount</span><span>$${Number(order.refund_amount || orderTotal).toFixed(2)}</span></div>
        <div class="modal-row"><span class="label">Reason</span><span>${(order.refund_reason || '').replace(/</g,'&lt;')}</span></div>
        <div class="modal-row"><span class="label">Date</span><span>${order.refund_date ? new Date(order.refund_date).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' }) : '-'}</span></div>
      </div>`;
    }

    // Refund form (only if not already refunded AND has Stripe session)
    if (!isRefunded && isStripe) {
      html += `<div style="margin-bottom:0.75rem;">
        <label style="font-size:0.8rem;color:var(--muted);display:block;margin-bottom:0.25rem;">Refund Amount ($)</label>
        <input type="number" id="refund-amount" step="0.01" min="0.01" max="${orderTotal.toFixed(2)}" value="${orderTotal.toFixed(2)}" style="width:120px;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);font-size:0.85rem;">
        <span id="refund-type-label" style="font-size:0.75rem;color:var(--amber);font-weight:600;margin-left:0.5rem;">FULL REFUND</span>
      </div>
      <div style="margin-bottom:0.75rem;">
        <label style="font-size:0.8rem;color:var(--muted);display:block;margin-bottom:0.25rem;">Reason (required)</label>
        <textarea id="refund-reason" rows="2" placeholder="Reason for refund..." style="width:100%;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);font-size:0.85rem;resize:vertical;font-family:inherit;"></textarea>
      </div>
      <button class="delete-btn" id="modal-refund" data-order-id="${orderId}" data-order-total="${orderTotal}" style="padding:0.4rem 1rem;font-size:0.8rem;border-color:var(--amber);color:var(--amber);">Process Refund</button>`;
    } else if (!isRefunded && !isStripe) {
      // Manual order — allow marking as refunded without Stripe
      html += `<div style="margin-bottom:0.75rem;">
        <label style="font-size:0.8rem;color:var(--muted);display:block;margin-bottom:0.25rem;">Refund Amount ($)</label>
        <input type="number" id="refund-amount" step="0.01" min="0.01" value="${orderTotal.toFixed(2)}" style="width:120px;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);font-size:0.85rem;">
      </div>
      <div style="margin-bottom:0.75rem;">
        <label style="font-size:0.8rem;color:var(--muted);display:block;margin-bottom:0.25rem;">Reason (required)</label>
        <textarea id="refund-reason" rows="2" placeholder="Reason for refund..." style="width:100%;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);font-size:0.85rem;resize:vertical;font-family:inherit;"></textarea>
      </div>
      <button class="delete-btn" id="modal-refund" data-order-id="${orderId}" data-order-total="${orderTotal}" style="padding:0.4rem 1rem;font-size:0.8rem;border-color:var(--amber);color:var(--amber);">Mark as Refunded</button>`;
    }

    html += `
      <button class="delete-btn" id="modal-delete" data-order-id="${orderId}" style="padding:0.4rem 1rem;font-size:0.8rem;margin-top:0.5rem;">Delete Order</button>
    </div>`;
  }

  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('order-modal').classList.add('open');

  // Status change handler
  document.getElementById('modal-status').addEventListener('change', async function() {
    const newStatus = this.value;
    const oid = Number(this.dataset.orderId);
    const { error } = await db.from('orders').update({ status: newStatus }).eq('id', oid);
    if (error) {
      alert('Failed to update status: ' + error.message);
    } else {
      const order = allOrders.find(o => o.id === oid);
      if (order) order.status = newStatus;
      renderOrdersTable();
      logFrontendActivity('status_change', `Changed order #${oid} (${order ? order.customer_name || order.email : '?'}) status to "${newStatus}"`);
    }
  });

  // Auto-load shipping status into badge + detail
  (async function() {
    const badge = document.getElementById('modal-ship-badge');
    const detail = document.getElementById('modal-shipping-detail');
    const order = allOrders.find(o => o.id === orderId);
    if (!order || !order.stripe_session_id) return;

    if (!shippingLoaded) {
      badge.innerHTML = '<span style="color:var(--muted);font-size:0.75rem;">Loading...</span>';
      try {
        const res = await fetch(ESHIP_PROXY + '?limit=500');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        allShipments = data.orders || [];
        shippingLoaded = true;
      } catch (err) {
        badge.innerHTML = '';
        return;
      }
    }

    const shipment = allShipments.find(s => s.order_number === order.stripe_session_id);
    if (!shipment) { badge.innerHTML = ''; return; }

    const status = shipment._shipping_status || 'Unknown';
    const cls = status.toLowerCase().replace(/\s+/g, '-');
    badge.innerHTML = `<span class="ship-status-badge ${cls}">${status}</span>`;

    const statusColor = {
      'Waiting to Print': 'var(--muted)',
      'Printed': 'var(--amber)',
      'In Transit': 'var(--accent)',
      'Delivered': 'var(--green)',
      'Exception': 'var(--red)',
    }[shipment._shipping_status] || 'var(--text)';

    const trackingNum = shipment.tracking_number || '';
    const trackingHref = shipment.tracking_url || (trackingNum ? `https://www.nzpost.co.nz/tools/tracking/item/${trackingNum}` : '');
    const trackingLink = trackingHref
      ? `<a href="${trackingHref}" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all;font-size:0.8rem;">${trackingNum || 'Track'}</a>`
      : '-';

    let timeToShip = '-';
    if (order.created_at && shipment.shipped_date) {
      const diff = (new Date(shipment.shipped_date) - new Date(order.created_at)) / 86400000;
      if (diff >= 0 && diff < 365) timeToShip = diff < 1 ? Math.round(diff * 24) + 'h' : diff.toFixed(1) + 'd';
    }
    let shippingWait = '-';
    if (shipment.shipped_date && shipment.delivered_date) {
      const diff = (new Date(shipment.delivered_date) - new Date(shipment.shipped_date)) / 86400000;
      if (diff >= 0 && diff < 365) shippingWait = diff < 1 ? Math.round(diff * 24) + 'h' : diff.toFixed(1) + 'd';
    }

    const shipRows = [
      ['Status', `<span style="color:${statusColor};font-weight:700;">${shipment._shipping_status}</span>`],
      ['Carrier', shipment.carrier_name || shipment.carrier || '-'],
      ['Tracking', trackingLink],
      ['Shipped Date', shipment.shipped_date ? new Date(shipment.shipped_date).toLocaleDateString() : '-'],
      ['Time to Ship', timeToShip],
      ['Shipping Wait Time', shippingWait],
      ['Destination', [shipment.destination?.city, shipment.destination?.country_code].filter(Boolean).join(', ') || '-'],
    ];

    // Bag size editor — only for unshipped/printed orders
    const canEditBag = ['Waiting to Print', 'Printed'].includes(shipment._shipping_status);
    const BAG_SIZES = [
      { label: 'DL', code: 'CPOLTPDL', desc: 'Small' },
      { label: 'A5', code: 'CPOLTPA5', desc: 'Medium' },
      { label: 'A4', code: 'CPOLTPA4', desc: 'Large' },
      { label: 'Foolscap', code: 'CPOLTPA3', desc: 'Extra Large' },
    ];
    const currentMethod = shipment.shipping_method || '';
    const currentBag = BAG_SIZES.find(b => b.code === currentMethod);
    const bagLabel = currentBag ? currentBag.label : currentMethod || '-';

    let bagSizeHtml = '';
    if (canEditBag) {
      const options = BAG_SIZES.map(b =>
        `<option value="${b.code}" ${b.code === currentMethod ? 'selected' : ''}>${b.label} — ${b.desc}</option>`
      ).join('');
      bagSizeHtml = `<div class="modal-row" style="align-items:center;">
        <span class="label">Bag Size</span>
        <span style="display:flex;align-items:center;gap:0.5rem;">
          <select id="modal-bag-size" onclick="event.stopPropagation();" onmousedown="event.stopPropagation();" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.3rem 0.5rem;border-radius:6px;font-size:0.8rem;font-family:'DM Sans',sans-serif;">
            ${options}
          </select>
          <button id="modal-bag-save" style="background:var(--sage);color:#141210;border:none;padding:0.3rem 0.6rem;border-radius:4px;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;">Update</button>
          <span id="modal-bag-result" style="font-size:0.75rem;"></span>
        </span>
      </div>`;
    } else {
      bagSizeHtml = `<div class="modal-row"><span class="label">Bag Size</span><span>${bagLabel}</span></div>`;
    }

    detail.innerHTML = '<h4 style="margin:0 0 0.5rem;font-size:0.85rem;color:var(--muted);">eShip Shipping Details</h4>' +
      shipRows.map(([l, v]) => `<div class="modal-row"><span class="label">${l}</span><span>${v}</span></div>`).join('') +
      bagSizeHtml;
    detail.style.display = 'block';

    // Attach bag size update handler
    if (canEditBag) {
      document.getElementById('modal-bag-save').addEventListener('click', async function() {
        const newMethod = document.getElementById('modal-bag-size').value;
        const resultEl = document.getElementById('modal-bag-result');
        const btn = this;
        btn.disabled = true; btn.textContent = 'Saving...';
        resultEl.textContent = '';
        try {
          const res = await fetch('/.netlify/functions/eship-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: shipment.order_id, shipping_method: newMethod, token: currentStaff.token }),
          });
          const data = await res.json();
          if (data.success) {
            resultEl.innerHTML = '<span style="color:var(--sage);">Updated!</span>';
            shipment.shipping_method = newMethod;
            if (data.order_id) shipment.order_id = data.order_id; // ID changes on delete+recreate
          } else {
            resultEl.innerHTML = '<span style="color:var(--red);">' + (data.error || 'Failed') + '</span>';
          }
        } catch (e) {
          resultEl.innerHTML = '<span style="color:var(--red);">' + e.message + '</span>';
        }
        btn.disabled = false; btn.textContent = 'Update';
      });
    }

    // Show reprint button and attach handler
    const reprintWrap = document.getElementById('modal-reprint-wrap');
    const reprintBtn = document.getElementById('modal-reprint-btn');
    const reprintMenu = document.getElementById('modal-reprint-menu');
    if (reprintWrap && reprintBtn && shipment.order_id) {
      reprintWrap.style.display = '';

      const SIZE_CODES = { DL: 'CPOLTPDL', A5: 'CPOLTPA5', A4: 'CPOLTPA4', Foolscap: 'CPOLTPA3' };

      // Toggle menu on button click
      reprintBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const isOpen = reprintMenu.style.display === 'block';
        reprintMenu.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) {
          // Close menu when clicking anywhere else
          setTimeout(() => {
            const closeHandler = (ev) => {
              if (!reprintMenu.contains(ev.target) && ev.target !== reprintBtn) {
                reprintMenu.style.display = 'none';
              }
              document.removeEventListener('click', closeHandler);
            };
            document.addEventListener('click', closeHandler);
          }, 0);
        }
      });

      // Handle menu option clicks
      reprintMenu.querySelectorAll('.reprint-opt').forEach(opt => {
        opt.addEventListener('mouseenter', function() { this.style.background = 'var(--bg)'; });
        opt.addEventListener('mouseleave', function() { this.style.background = 'none'; });
        opt.addEventListener('click', async function(e) {
          e.stopPropagation();
          reprintMenu.style.display = 'none';
          const action = this.dataset.action;
          reprintBtn.disabled = true;

          // Print directly — pass carrier_service_code at print time if changing size
          reprintBtn.textContent = action === 'asis' ? 'Printing...' : 'Printing as ' + action + '...';
          const printBody = { order_ids: [shipment.order_id] };
          if (action !== 'asis') printBody.carrier_service_code = SIZE_CODES[action];
          try {
            const res = await fetch('/.netlify/functions/eship-print', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(printBody),
            });
            const data = await res.json();
            if (data.printed > 0) {
              reprintBtn.textContent = 'Printed!';
              reprintBtn.style.borderColor = 'var(--sage)';
              reprintBtn.style.color = 'var(--sage)';
            } else {
              const errMsg = data.failed?.[0]?.result?.errors?.[0]?.details || data.failed?.[0]?.result?.errors?.[0]?.message || 'Print failed';
              reprintBtn.textContent = errMsg.length > 30 ? errMsg.slice(0, 30) + '...' : errMsg;
              reprintBtn.style.color = 'var(--red)';
              reprintBtn.style.borderColor = 'var(--red)';
              // Auto-set status for address errors
              if (errMsg.toLowerCase().includes('address') || errMsg.toLowerCase().includes('postcode') || errMsg.toLowerCase().includes('town')) {
                const order = allOrders.find(o => o.stripe_session_id === shipment.order_number || o.order_number === shipment.order_number);
                if (order) {
                  db.from('orders').update({ status: 'Invalid Address - Fix in eShip' }).eq('id', order.id);
                  order.status = 'Invalid Address - Fix in eShip';
                  const statusEl = document.getElementById('modal-status');
                  if (statusEl) statusEl.value = order.status;
                }
              }
            }
          } catch (err) {
            reprintBtn.textContent = 'Error';
            reprintBtn.style.color = 'var(--red)';
          }
          setTimeout(() => { reprintBtn.disabled = false; reprintBtn.textContent = 'Reprint Label'; reprintBtn.style.borderColor = 'var(--cyan)'; reprintBtn.style.color = 'var(--cyan)'; }, 3000);
        });
      });
    }
  })();

  // Refund amount input — update label dynamically
  const refundAmountInput = document.getElementById('refund-amount');
  const refundTypeLabel = document.getElementById('refund-type-label');
  if (refundAmountInput && refundTypeLabel) {
    refundAmountInput.addEventListener('input', function() {
      const orderTotal = Number(this.max || this.dataset?.orderTotal || 0);
      const entered = Number(this.value || 0);
      if (entered >= orderTotal) {
        refundTypeLabel.textContent = 'FULL REFUND';
        refundTypeLabel.style.color = 'var(--amber)';
      } else {
        refundTypeLabel.textContent = 'PARTIAL REFUND';
        refundTypeLabel.style.color = 'var(--accent)';
      }
    });
  }

  // Edit order handler
  const editBtn = document.getElementById('modal-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', function() {
      enterEditMode(Number(this.dataset.orderId));
    });
  }

  // Review prompt handler
  const reviewBtn = document.getElementById('modal-review-btn');
  if (reviewBtn) {
    reviewBtn.addEventListener('click', async function() {
      const oid = Number(this.dataset.orderId);
      const order = allOrders.find(o => o.id === oid);
      if (!order) return;
      if (!confirm(`Send review request to ${order.email}?`)) return;

      this.disabled = true;
      this.textContent = 'Sending...';

      try {
        const res = await fetch('/.netlify/functions/send-review-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: order.email,
            customer_name: order.customer_name,
            order_id: oid,
            token: currentStaff?.token,
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          order.review_prompted_at = new Date().toISOString();
          const promptDate = new Date().toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' });
          this.outerHTML = `<span style="background:rgba(140,180,122,0.15);color:var(--sage);padding:0.3rem 0.8rem;border-radius:6px;font-size:0.8rem;font-weight:600;">Review Requested ${promptDate}</span>`;
          logFrontendActivity('review_prompt', `Sent review request for order #${oid} to ${order.email}`);
        } else {
          alert('Failed: ' + (data.error || 'unknown'));
          this.disabled = false;
          this.textContent = 'Request Review';
        }
      } catch (err) {
        alert('Error: ' + err.message);
        this.disabled = false;
        this.textContent = 'Request Review';
      }
    });
  }

  // Refund handler — refunds Stripe (full or partial), saves reason to Supabase
  const refundBtn = document.getElementById('modal-refund');
  if (refundBtn) {
    refundBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      const oid = Number(this.dataset.orderId);
      const order = allOrders.find(o => o.id === oid);
      if (!order) return;

      const orderTotal = Number(this.dataset.orderTotal || order.total_value || 0);
      const amountInput = document.getElementById('refund-amount');
      const reasonInput = document.getElementById('refund-reason');
      const refundAmount = Number(amountInput?.value || orderTotal);
      const reason = (reasonInput?.value || '').trim();

      if (!reason) { alert('Please enter a reason for the refund.'); reasonInput?.focus(); return; }
      if (refundAmount <= 0) { alert('Refund amount must be greater than $0.'); amountInput?.focus(); return; }
      if (refundAmount > orderTotal) { alert('Refund amount cannot exceed $' + orderTotal.toFixed(2)); amountInput?.focus(); return; }

      const isPartial = refundAmount < orderTotal;
      const isManual = !order.stripe_session_id || order.stripe_session_id.startsWith('manual_');
      const confirmMsg = isManual
        ? `Mark this order as ${isPartial ? 'partially ' : ''}refunded ($${refundAmount.toFixed(2)})?\n\nReason: ${reason}`
        : `${isPartial ? 'Partial refund' : 'Full refund'} of $${refundAmount.toFixed(2)} via Stripe?\n\nReason: ${reason}`;

      if (!confirm(confirmMsg)) return;

      const statusMessages = [];
      this.disabled = true;
      this.textContent = 'Processing...';

      // Issue Stripe refund (skip for manual orders)
      if (!isManual) {
        try {
          const amountCents = Math.round(refundAmount * 100);
          const refundRes = await fetch('/.netlify/functions/stripe-refund', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stripe_session_id: order.stripe_session_id,
              amount_cents: isPartial ? amountCents : undefined,
              reason: reason,
              token: currentStaff?.token,
            }),
          });
          const refundData = await refundRes.json();
          if (refundRes.ok && refundData.success) {
            statusMessages.push('Stripe refund issued — $' + refundAmount.toFixed(2));
          } else {
            statusMessages.push('Stripe refund failed: ' + (refundData.error || 'unknown'));
            this.disabled = false;
            this.textContent = 'Process Refund';
            alert(statusMessages.join('\n'));
            return;
          }
        } catch (err) {
          statusMessages.push('Stripe refund error: ' + err.message);
          this.disabled = false;
          this.textContent = 'Process Refund';
          alert(statusMessages.join('\n'));
          return;
        }
      } else {
        statusMessages.push('Manual order — marked as refunded');
      }

      // Update order in Supabase with refund details
      const newStatus = isPartial ? 'Partial Refund' : 'Refunded';
      const updateData = {
        status: newStatus,
        refund_amount: refundAmount,
        refund_reason: reason,
        refund_date: new Date().toISOString(),
      };
      await db.from('orders').update(updateData).eq('id', oid);
      if (order) {
        order.status = newStatus;
        order.refund_amount = refundAmount;
        order.refund_reason = reason;
        order.refund_date = updateData.refund_date;
      }

      // Check if order is unshipped in eShip — offer to remove
      if (order.stripe_session_id && !order.stripe_session_id.startsWith('manual_')) {
        if (confirm('Remove from eShip? (if not yet shipped)')) {
          try {
            const cancelRes = await fetch('/.netlify/functions/eship-cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order_number: order.stripe_session_id }),
            });
            const cancelData = await cancelRes.json();
            if (cancelRes.ok && cancelData.success) {
              statusMessages.push('Removed from eShip');
            } else {
              statusMessages.push('eShip: ' + (cancelData.error || 'not found'));
            }
          } catch (err) {
            statusMessages.push('eShip removal skipped');
          }
        }
      }

      renderOrdersTable();
      closeModal();
      logFrontendActivity('order_refund', `${isPartial ? 'Partial refund' : 'Full refund'} on order #${oid} (${order.customer_name || order.email || '?'}) — $${refundAmount.toFixed(2)}. Reason: ${reason}. ${statusMessages.join('. ')}`);
      alert(statusMessages.join('\n'));
    });
  }

  // Delete handler — permanently removes order, with optional Stripe refund and eShip removal
  const deleteBtn = document.getElementById('modal-delete');
  if (!deleteBtn) return;
  deleteBtn.addEventListener('click', async function(e) {
    e.stopPropagation();
    const oid = Number(this.dataset.orderId);
    const order = allOrders.find(o => o.id === oid);
    if (!order) return;

    if (!currentStaff || (currentStaff.role !== 'owner' && currentStaff.role !== 'admin')) {
      alert('You do not have permission to delete orders.'); return;
    }

    const isStripeOrder = order.stripe_session_id && !order.stripe_session_id.startsWith('manual_');

    // Build options dialog
    let dialogMsg = 'DELETE order #' + oid + ' ($' + Number(order.total_value || 0).toFixed(2) + ')?\n\nThis will permanently remove the order record.\n\nAdditional actions (enter Y for yes):\n';
    let doRefund = false;
    let doEship = false;

    if (isStripeOrder) {
      const refundAnswer = prompt(dialogMsg + '\nRefund on Stripe? (Y/N)');
      if (refundAnswer === null) return; // cancelled
      doRefund = refundAnswer.trim().toUpperCase() === 'Y';
    }

    const eshipAnswer = prompt('Remove from eShip? (Y/N)');
    if (eshipAnswer === null) return;
    doEship = eshipAnswer.trim().toUpperCase() === 'Y';

    // Final confirmation
    const confirmText = prompt('To confirm deletion, type DELETE:');
    if (confirmText !== 'DELETE') { alert('Deletion cancelled.'); return; }

    const statusMessages = [];
    this.disabled = true;
    this.textContent = 'Deleting...';

    // 1. Optionally refund via Stripe
    if (doRefund && isStripeOrder) {
      try {
        const refundRes = await fetch('/.netlify/functions/stripe-refund', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stripe_session_id: order.stripe_session_id }),
        });
        const refundData = await refundRes.json();
        if (refundRes.ok && refundData.success) {
          statusMessages.push('Stripe refund issued');
        } else {
          statusMessages.push('Stripe refund failed: ' + (refundData.error || 'unknown'));
        }
      } catch (err) {
        statusMessages.push('Stripe refund error: ' + err.message);
      }
    }

    // 2. Optionally remove from eShip
    if (doEship && order.stripe_session_id) {
      try {
        const cancelRes = await fetch('/.netlify/functions/eship-cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_number: order.stripe_session_id }),
        });
        const cancelData = await cancelRes.json();
        if (cancelRes.ok && cancelData.success) {
          statusMessages.push('Removed from eShip');
        } else {
          statusMessages.push('eShip: ' + (cancelData.error || 'not found'));
        }
      } catch (err) {
        statusMessages.push('eShip removal skipped');
      }
    }

    // 3. Delete from Supabase
    await db.from('order_line_items').delete().eq('order_id', oid);
    const { error } = await db.from('orders').delete().eq('id', oid);
    if (error) {
      alert('Failed to delete from database: ' + error.message);
      this.disabled = false;
      this.textContent = 'Delete Order';
      return;
    }
    statusMessages.push('Order deleted from database');

    // 4. Remove from local state
    const deletedEmail = order.email;
    allOrders = allOrders.filter(o => o.id !== oid);
    allLineItems = allLineItems.filter(li => li.order_id !== oid);

    if (deletedEmail) {
      const remainingOrders = allOrders.filter(o => o.email === deletedEmail);
      if (remainingOrders.length === 0) {
        statusMessages.push('Customer removed (no remaining orders)');
      }
    }

    closeModal();
    applyFilter();
    logFrontendActivity('order_delete', `Deleted order #${oid} (${order.customer_name || order.email || '?'}) — $${Number(order.total_value || 0).toFixed(2)}. ${statusMessages.join('. ')}`);
    alert(statusMessages.join('\n'));
  });
}

// ── Order Edit Mode ──
function enterEditMode(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;
  const items = allLineItems.filter(li => li.order_id === orderId);

  document.getElementById('modal-title').textContent = `Edit Order — ${order.customer_name || order.email}`;

  // Check shipping status for warning
  const ship = getShipStatus(order);
  const shipStatus = ship?._shipping_status || '';
  let warningHtml = '';
  if (['Printed', 'In Transit', 'Delivered'].includes(shipStatus)) {
    warningHtml = `<div class="edit-warning-banner">This order is "${shipStatus}" — changes will update the database but the shipping label will NOT be updated.</div>`;
  }

  let html = warningHtml;

  // Customer details
  html += `<div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;margin-bottom:0.5rem;margin-top:0.5rem;">Customer Details</div>`;
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1rem;">
    <div><label style="font-size:0.65rem;color:var(--muted);">Name</label><input class="edit-input" id="edit-name" value="${(order.customer_name || '').replace(/"/g, '&quot;')}"></div>
    <div><label style="font-size:0.65rem;color:var(--muted);">Email</label><input class="edit-input" id="edit-email" value="${(order.email || '').replace(/"/g, '&quot;')}"></div>
    <div><label style="font-size:0.65rem;color:var(--muted);">Phone</label><input class="edit-input" id="edit-phone" value="${(order.phone || '').replace(/"/g, '&quot;')}"></div>
    <div><label style="font-size:0.65rem;color:var(--muted);">City</label><input class="edit-input" id="edit-city" value="${(order.city || '').replace(/"/g, '&quot;')}"></div>
    <div><label style="font-size:0.65rem;color:var(--muted);">Street</label><input class="edit-input" id="edit-street" value="${(order.street_address || '').replace(/"/g, '&quot;')}"></div>
    <div><label style="font-size:0.65rem;color:var(--muted);">Suburb</label><input class="edit-input" id="edit-suburb" value="${(order.suburb || '').replace(/"/g, '&quot;')}"></div>
    <div><label style="font-size:0.65rem;color:var(--muted);">Postcode</label><input class="edit-input" id="edit-postcode" value="${(order.postcode || '').replace(/"/g, '&quot;')}"></div>
    <div><label style="font-size:0.65rem;color:var(--muted);">Shipping Cost</label><input class="edit-input" id="edit-shipping-cost" type="number" step="0.01" value="${Number(order.shipping_cost || 0).toFixed(2)}"></div>
  </div>`;

  // Line items
  html += `<div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;margin-bottom:0.5rem;">Line Items</div>`;
  html += `<div id="edit-items">`;
  items.forEach((li, i) => {
    html += `<div class="edit-line-item" data-sku="${(li.sku || '').replace(/"/g, '&quot;')}">
      <input class="edit-input edit-qty" type="number" min="1" value="${li.quantity}" onchange="recalcEditTotal()">
      <input class="edit-input edit-desc" value="${(li.description || li.sku || '').replace(/"/g, '&quot;')}">
      <input class="edit-input edit-price" type="number" step="0.01" value="${Number(li.unit_price || 0).toFixed(2)}" onchange="recalcEditTotal()">
      <button class="edit-remove" onclick="this.parentElement.remove(); recalcEditTotal();">&times;</button>
    </div>`;
  });
  html += `</div>`;

  // Add item row
  html += `<div class="edit-add-row">
    <input class="edit-input edit-desc" id="add-item-desc" placeholder="Description" style="flex:1;">
    <input class="edit-input edit-qty" id="add-item-qty" type="number" min="1" value="1" style="width:50px;">
    <input class="edit-input edit-price" id="add-item-price" type="number" step="0.01" placeholder="Price" style="width:70px;">
    <button class="edit-add-btn" onclick="addEditItem()">+ Add</button>
  </div>`;

  // Total
  html += `<div class="edit-total" id="edit-total">Total: $${items.reduce((s, li) => s + li.quantity * li.unit_price, 0).toFixed(2)}</div>`;

  // Actions
  html += `<div class="edit-actions">
    <button class="edit-cancel-btn" onclick="openOrderModal(${orderId})">Cancel</button>
    <button class="edit-save-btn" id="edit-save-btn" onclick="saveOrderEdits(${orderId})">Save Changes</button>
  </div>`;

  document.getElementById('modal-body').innerHTML = html;
}

function addEditItem() {
  const desc = document.getElementById('add-item-desc').value.trim();
  const qty = Number(document.getElementById('add-item-qty').value) || 1;
  const price = Number(document.getElementById('add-item-price').value) || 0;
  if (!desc) { alert('Enter a description.'); return; }

  const row = document.createElement('div');
  row.className = 'edit-line-item';
  row.dataset.sku = '';
  row.innerHTML = `
    <input class="edit-input edit-qty" type="number" min="1" value="${qty}" onchange="recalcEditTotal()">
    <input class="edit-input edit-desc" value="${desc.replace(/"/g, '&quot;')}">
    <input class="edit-input edit-price" type="number" step="0.01" value="${price.toFixed(2)}" onchange="recalcEditTotal()">
    <button class="edit-remove" onclick="this.parentElement.remove(); recalcEditTotal();">&times;</button>`;
  document.getElementById('edit-items').appendChild(row);

  document.getElementById('add-item-desc').value = '';
  document.getElementById('add-item-qty').value = '1';
  document.getElementById('add-item-price').value = '';
  recalcEditTotal();
}

function recalcEditTotal() {
  let total = 0;
  document.querySelectorAll('.edit-line-item').forEach(row => {
    const qty = Number(row.querySelector('.edit-qty').value) || 0;
    const price = Number(row.querySelector('.edit-price').value) || 0;
    total += qty * price;
  });
  const el = document.getElementById('edit-total');
  if (el) el.textContent = `Total: $${total.toFixed(2)}`;
}

async function saveOrderEdits(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const saveBtn = document.getElementById('edit-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    // Gather customer fields
    const editedCustomer = {
      customer_name: document.getElementById('edit-name').value.trim(),
      email: document.getElementById('edit-email').value.trim(),
      phone: document.getElementById('edit-phone').value.trim(),
      street_address: document.getElementById('edit-street').value.trim(),
      suburb: document.getElementById('edit-suburb').value.trim(),
      city: document.getElementById('edit-city').value.trim(),
      postcode: document.getElementById('edit-postcode').value.trim(),
    };

    if (!editedCustomer.customer_name || !editedCustomer.email) {
      alert('Name and email are required.'); saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; return;
    }

    // Gather line items
    const editedItems = [];
    document.querySelectorAll('.edit-line-item').forEach(row => {
      const qty = Number(row.querySelector('.edit-qty').value);
      const desc = row.querySelector('.edit-desc').value.trim();
      const sku = row.dataset.sku || '';
      const price = Number(row.querySelector('.edit-price').value);
      if (qty > 0 && desc) editedItems.push({ description: desc, sku, quantity: qty, unit_price: price });
    });

    if (editedItems.length === 0) { alert('Order must have at least one item.'); saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; return; }

    const newTotal = editedItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const shippingCost = Number(document.getElementById('edit-shipping-cost').value) || 0;

    // Update order in Supabase
    const { error: orderErr } = await db.from('orders').update({
      ...editedCustomer,
      total_value: newTotal,
      shipping_cost: shippingCost,
    }).eq('id', orderId);

    if (orderErr) { alert('Failed to update order: ' + orderErr.message); saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; return; }

    // Replace line items
    await db.from('order_line_items').delete().eq('order_id', orderId);
    const lineItemRows = editedItems.map(item => ({
      order_id: orderId,
      description: item.description,
      sku: item.sku,
      quantity: item.quantity,
      unit_price: item.unit_price,
    }));
    await db.from('order_line_items').insert(lineItemRows);

    // eShip logic
    const ship = getShipStatus(order);
    const eshipStatus = ship?._shipping_status || '';

    if (eshipStatus === 'Waiting to Print') {
      try {
        await fetch('/.netlify/functions/eship-cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_number: order.stripe_session_id }),
        });
        await fetch('/.netlify/functions/manual-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eship_only: true,
            order_number: order.stripe_session_id,
            customer_name: editedCustomer.customer_name,
            email: editedCustomer.email,
            phone: editedCustomer.phone,
            street: editedCustomer.street_address,
            suburb: editedCustomer.suburb,
            city: editedCustomer.city,
            postcode: editedCustomer.postcode,
            items: editedItems,
            shipping_cost: shippingCost,
          }),
        });
      } catch (err) {
        console.error('eShip update error:', err);
      }
    } else if (['Printed', 'In Transit', 'Delivered'].includes(eshipStatus)) {
      alert('Note: This order is "' + eshipStatus + '". The shipping label has NOT been updated.');
    }

    // Update local state
    Object.assign(order, editedCustomer, { total_value: newTotal, shipping_cost: shippingCost });
    allLineItems = allLineItems.filter(li => li.order_id !== orderId);
    lineItemRows.forEach(li => allLineItems.push(li));

    // Re-render
    renderOrdersTable();
    openOrderModal(orderId);

    logFrontendActivity('order_edit', `Edited order #${orderId} (${editedCustomer.customer_name}) — new total $${newTotal.toFixed(2)}`);
  } catch (err) {
    alert('Error saving: ' + err.message);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }
}

function closeModal() {
  document.getElementById('order-modal').classList.remove('open');
}

// ── Landing Page Revenue ──
function renderLandingRevenue(orders) {
  const landingData = {};
  orders.forEach(o => {
    let lp = o.landing_page || '';
    if (!lp) return;
    // Clean up: strip protocol/domain if it's our own site, keep path only
    try {
      const u = new URL(lp, 'https://primalpantry.co.nz');
      if (u.hostname.includes('primalpantry')) lp = u.pathname;
    } catch {}
    if (!landingData[lp]) landingData[lp] = { count: 0, revenue: 0 };
    landingData[lp].count++;
    landingData[lp].revenue += Number(o.total_value || 0);
  });
  const sorted = Object.entries(landingData).sort((a, b) => b[1].revenue - a[1].revenue);
  const maxRev = sorted.length > 0 ? sorted[0][1].revenue : 1;
  const container = document.getElementById('landing-rev-container');

  if (sorted.length === 0) {
    container.innerHTML = '<p style="color:var(--dim);font-size:0.85rem;">No landing page data</p>';
    return;
  }

  const start = (landingRevPage - 1) * PAGE_SIZE;
  const page = sorted.slice(start, start + PAGE_SIZE);
  const totalRev = orders.reduce((s, o) => s + Number(o.total_value || 0), 0);

  container.innerHTML = `<table class="utm-table">
    <thead><tr><th>Landing Page</th><th>Orders</th><th>Revenue</th><th>AOV</th><th>% Rev</th><th></th></tr></thead>
    <tbody>${page.map(([lp, data]) => `
      <tr>
        <td style="font-size:0.75rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${lp}">${lp}</td>
        <td>${data.count}</td>
        <td>${fmt_money(data.revenue)}</td>
        <td>${fmt_money(data.count > 0 ? data.revenue / data.count : 0)}</td>
        <td>${totalRev > 0 ? (data.revenue / totalRev * 100).toFixed(1) : 0}%</td>
        <td><span class="utm-bar" style="width:${(data.revenue / maxRev) * 120}px;background:var(--honey);"></span></td>
      </tr>
    `).join('')}</tbody>
  </table><div id="landing-rev-pagination"></div>`;
  renderPagination('landing-rev-pagination', landingRevPage, sorted.length, p => { landingRevPage = p; renderLandingRevenue(orders); });
}

// ── Helpers ──
// ── Magnet Products ──
function renderMagnetProducts(orders) {
  const firstItems = {};
  const totalOrders = orders.length;
  orders.forEach(o => {
    const items = allLineItems.filter(li => li.order_id === o.id).sort((a, b) => a.id - b.id);
    if (items.length > 0) {
      const name = items[0].description || items[0].sku || 'Unknown';
      if (!firstItems[name]) firstItems[name] = { count: 0, revenue: 0 };
      firstItems[name].count++;
      firstItems[name].revenue += Number(o.total_value || 0);
    }
  });
  const sorted = Object.entries(firstItems).sort((a, b) => b[1].count - a[1].count);
  const max = sorted.length > 0 ? sorted[0][1].count : 1;
  const container = document.getElementById('magnet-container');

  if (sorted.length === 0) {
    container.innerHTML = '<p style="color:var(--dim);font-size:0.85rem;">No data yet</p>';
    return;
  }

  const start = (magnetPage - 1) * PAGE_SIZE;
  const page = sorted.slice(start, start + PAGE_SIZE);

  container.innerHTML = `<table class="utm-table">
    <thead><tr><th>Product</th><th>Orders</th><th>Revenue</th><th>% of Orders</th><th></th></tr></thead>
    <tbody>${page.map(([name, data]) => `
      <tr>
        <td>${name}</td>
        <td>${data.count}</td>
        <td>${fmt_money(data.revenue)}</td>
        <td>${totalOrders > 0 ? (data.count / totalOrders * 100).toFixed(1) : 0}%</td>
        <td><span class="utm-bar" style="width:${(data.count / max) * 120}px;background:var(--cyan);"></span></td>
      </tr>
    `).join('')}</tbody>
  </table><div id="magnet-pagination"></div>`;
  renderPagination('magnet-pagination', magnetPage, sorted.length, p => { magnetPage = p; renderMagnetProducts(orders); });
}

// ── Frequently Bought Together ──
function renderBoughtTogether(orders) {
  const pairCounts = {};
  orders.forEach(o => {
    const items = allLineItems.filter(li => li.order_id === o.id);
    const names = [...new Set(items.map(li => li.description || li.sku || '').filter(Boolean))].sort();
    // Generate all pairs
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = `${names[i]} + ${names[j]}`;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
  });

  const sorted = Object.entries(pairCounts).sort((a, b) => b[1] - a[1]);
  const max = sorted.length > 0 ? sorted[0][1] : 1;
  const container = document.getElementById('bundles-container');

  if (sorted.length === 0) {
    container.innerHTML = '<p style="color:var(--dim);font-size:0.85rem;">Need multi-item orders to show pairs</p>';
    return;
  }

  const start = (bundlesPage - 1) * PAGE_SIZE;
  const page = sorted.slice(start, start + PAGE_SIZE);

  container.innerHTML = `<table class="utm-table">
    <thead><tr><th>Product Pair</th><th>Orders</th><th></th></tr></thead>
    <tbody>${page.map(([pair, count]) => `
      <tr>
        <td style="font-size:0.75rem;">${pair}</td>
        <td>${count}</td>
        <td><span class="utm-bar" style="width:${(count / max) * 100}px;background:var(--purple);"></span></td>
      </tr>
    `).join('')}</tbody>
  </table><div id="bundles-pagination"></div>`;
  renderPagination('bundles-pagination', bundlesPage, sorted.length, p => { bundlesPage = p; renderBoughtTogether(orders); });
}

// ── Trending Products ──
function renderTrending(orders) {
  const [from, to] = getDateRange();
  const periodDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
  const tpFrom = new Date(from); tpFrom.setDate(tpFrom.getDate() - periodDays);
  const priorFrom = localDateStr(tpFrom);
  const tpTo = new Date(from); tpTo.setDate(tpTo.getDate() - 1);
  const priorTo = localDateStr(tpTo);

  // Current period product quantities
  const currentProducts = {};
  const currentOrderIds = new Set(orders.map(o => o.id));
  allLineItems.filter(li => currentOrderIds.has(li.order_id)).forEach(li => {
    const name = li.description || li.sku || 'Unknown';
    currentProducts[name] = (currentProducts[name] || 0) + li.quantity;
  });

  // Prior period product quantities
  const priorProducts = {};
  const priorOrders = allOrders.filter(o => o.order_date >= priorFrom && o.order_date <= priorTo);
  const priorOrderIds = new Set(priorOrders.map(o => o.id));
  allLineItems.filter(li => priorOrderIds.has(li.order_id)).forEach(li => {
    const name = li.description || li.sku || 'Unknown';
    priorProducts[name] = (priorProducts[name] || 0) + li.quantity;
  });

  // Calculate growth
  const allProducts = new Set([...Object.keys(currentProducts), ...Object.keys(priorProducts)]);
  const trends = [];
  allProducts.forEach(name => {
    const curr = currentProducts[name] || 0;
    const prev = priorProducts[name] || 0;
    const change = prev > 0 ? ((curr - prev) / prev * 100) : (curr > 0 ? 100 : 0);
    if (curr > 0 || prev > 0) trends.push({ name, curr, prev, change });
  });

  trends.sort((a, b) => b.change - a.change || b.curr - a.curr);
  const container = document.getElementById('trending-container');

  if (trends.length === 0) {
    container.innerHTML = '<p style="color:var(--dim);font-size:0.85rem;">No data yet</p>';
    return;
  }

  const start = (trendingPage - 1) * PAGE_SIZE;
  const page = trends.slice(start, start + PAGE_SIZE);

  container.innerHTML = `<table class="utm-table">
    <thead><tr><th>Product</th><th>Now</th><th>Prior</th><th>Change</th></tr></thead>
    <tbody>${page.map(t => {
      const color = t.change > 0 ? 'var(--green)' : t.change < 0 ? 'var(--red)' : 'var(--dim)';
      const arrow = t.change > 0 ? '↑' : t.change < 0 ? '↓' : '→';
      return `<tr>
        <td>${t.name}</td>
        <td>${t.curr}</td>
        <td>${t.prev}</td>
        <td style="color:${color};font-weight:600;">${arrow} ${Math.abs(t.change).toFixed(0)}%</td>
      </tr>`;
    }).join('')}</tbody>
  </table><div id="trending-pagination"></div>`;
  renderPagination('trending-pagination', trendingPage, trends.length, p => { trendingPage = p; renderTrending(orders); });
}

// ── New vs Returning Customers ──
function renderNewVsReturning(orders) {
  // Build first-order date per email from ALL orders
  const firstOrderDate = {};
  allOrders.slice().sort((a, b) => a.order_date.localeCompare(b.order_date)).forEach(o => {
    if (o.email && !firstOrderDate[o.email]) firstOrderDate[o.email] = o.order_date;
  });

  // For filtered orders, classify as new or returning
  const [from, to] = getDateRange();
  const days = {};
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days[fmt_date(d)] = { new: 0, returning: 0 };
  }

  orders.forEach(o => {
    if (!o.email || !days[o.order_date]) return;
    if (firstOrderDate[o.email] === o.order_date) {
      days[o.order_date].new++;
    } else {
      days[o.order_date].returning++;
    }
  });

  const labels = Object.keys(days).map(d => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getDate()}/${dt.getMonth() + 1}`;
  });

  if (charts.newret) charts.newret.destroy();
  charts.newret = new Chart(document.getElementById('newret-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'New', data: Object.values(days).map(d => d.new), backgroundColor: '#8CB47A', borderRadius: 6 },
        { label: 'Returning', data: Object.values(days).map(d => d.returning), backgroundColor: '#D4A84B', borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' } } } },
      scales: {
        y: { stacked: true, ticks: { color: '#9c9287' }, grid: { color: '#252220' } },
        x: { stacked: true, ticks: { color: '#9c9287', maxRotation: 45, maxTicksLimit: 15 }, grid: { display: false } },
      },
    },
  });
}

// ── Geographic Map ──
const NZ_CITIES = {
  'auckland':[-36.85,174.76],'wellington':[-41.29,174.78],'christchurch':[-43.53,172.64],
  'hamilton':[-37.79,175.28],'tauranga':[-37.69,176.17],'napier':[-39.49,176.91],
  'hastings':[-39.64,176.85],'dunedin':[-45.87,170.50],'palmerston north':[-40.35,175.61],
  'nelson':[-41.27,173.28],'rotorua':[-38.14,176.25],'new plymouth':[-39.07,174.08],
  'whangarei':[-35.73,174.32],'invercargill':[-46.41,168.35],'whanganui':[-39.93,175.05],
  'gisborne':[-38.66,178.02],'blenheim':[-41.51,173.95],'timaru':[-44.40,171.25],
  'taupo':[-38.69,176.08],'masterton':[-40.95,175.66],'levin':[-40.63,175.28],
  'ashburton':[-43.90,171.75],'cambridge':[-37.88,175.47],'tokoroa':[-38.23,175.87],
  'te awamutu':[-38.01,175.32],'hawera':[-39.59,174.28],'oamaru':[-45.10,170.97],
  'kapiti':[-40.91,174.98],'paraparaumu':[-40.91,174.98],'waihi':[-37.39,175.83],
  'thames':[-37.14,175.54],'matamata':[-37.81,175.77],'morrinsville':[-37.65,175.53],
  'te kuiti':[-38.33,175.16],'kaikoura':[-42.40,173.68],'greymouth':[-42.45,171.21],
  'queenstown':[-45.03,168.66],'wanaka':[-44.70,169.13],'rangiora':[-43.31,172.60],
  'rolleston':[-43.59,172.38],'pukekohe':[-37.20,174.90],'manukau':[-36.99,174.88],
  'north shore':[-36.80,174.76],'waitakere':[-36.85,174.54],'lower hutt':[-41.21,174.91],
  'upper hutt':[-41.12,175.07],'porirua':[-41.13,174.84],'petone':[-41.23,174.87],
  'papakura':[-37.07,174.95],'takanini':[-37.05,174.93],'whangaparaoa':[-36.62,174.74],
  'orewa':[-36.59,174.69],'silverdale':[-36.61,174.67],'hibiscus coast':[-36.60,174.70],
  'te puke':[-37.78,176.32],'katikati':[-37.55,175.92],'whakatane':[-37.95,176.99],
  'opotiki':[-38.01,177.29],'kawerau':[-38.08,176.70],'mount maunganui':[-37.64,176.18],
  'papamoa':[-37.72,176.28],'kerikeri':[-35.23,174.00],'kaitaia':[-35.11,173.26],
  'dargaville':[-35.93,173.88],'paihia':[-35.28,174.09],'mangawhai':[-36.13,174.58],
  'snells beach':[-36.42,174.73],'warkworth':[-36.40,174.66],'helensville':[-36.68,174.45],
  'kumeu':[-36.78,174.56],'huapai':[-36.77,174.54],'taupiri':[-37.67,175.27],
  'huntly':[-37.56,175.16],'ngaruawahia':[-37.67,175.16],'raglan':[-37.80,174.88],
  'gore':[-46.10,168.94],'balclutha':[-46.23,169.73],'alexandra':[-45.25,169.38],
  'cromwell':[-45.05,169.20],'mosgiel':[-45.87,170.35],'milton':[-46.12,169.97],
  'waimate':[-44.73,171.05],'geraldine':[-44.10,171.24],'temuka':[-44.24,171.28],
  'hokitika':[-42.45,170.97],'westport':[-41.76,171.60],'reefton':[-42.12,171.86],
  'picton':[-41.29,174.00],'seddon':[-41.67,174.07],'ward':[-41.83,174.17],
  'kaiapoi':[-43.38,172.66],'woodend':[-43.32,172.67],'pegasus':[-43.30,172.69],
  'lincoln':[-43.65,172.49],'darfield':[-43.49,172.11],'leeston':[-43.77,172.30],
  'haruru':[-35.27,174.07],'haruru falls':[-35.27,174.07],
};

let mapInstance = null;
let heatLayer = null;
let adspendHeatLayer = null;
let mapOrderMarkers = [];
let mapAdMarkers = [];
let cachedMapOrders = null;
let cachedAdspendRegions = { facebook: [], google: [] };

// NZ region centroids (Facebook returns region names like "Auckland", "Canterbury", etc.)
const NZ_REGIONS = {
  'auckland':[-36.85,174.76],'auckland region':[-36.85,174.76],
  'canterbury':[-43.53,172.64],'canterbury region':[-43.53,172.64],
  'wellington':[-41.29,174.78],'wellington region':[-41.29,174.78],
  'waikato':[-37.79,175.28],'waikato region':[-37.79,175.28],
  'bay of plenty':[-37.69,176.17],'bay of plenty region':[-37.69,176.17],
  'otago':[-45.87,170.50],'otago region':[-45.87,170.50],
  'manawatu-whanganui':[-40.35,175.61],'manawatū-whanganui':[-40.35,175.61],'manawatu-wanganui':[-40.35,175.61],
  'hawke\'s bay':[-39.49,176.91],'hawkes bay':[-39.49,176.91],'hawke\'s bay region':[-39.49,176.91],
  'taranaki':[-39.07,174.08],'taranaki region':[-39.07,174.08],
  'northland':[-35.73,174.32],'northland region':[-35.73,174.32],
  'southland':[-46.41,168.35],'southland region':[-46.41,168.35],
  'nelson':[-41.27,173.28],'nelson region':[-41.27,173.28],
  'marlborough':[-41.51,173.95],'marlborough region':[-41.51,173.95],
  'gisborne':[-38.66,178.02],'gisborne region':[-38.66,178.02],'gisborne district':[-38.66,178.02],
  'tasman':[-41.27,172.85],'tasman region':[-41.27,172.85],
  'west coast':[-42.45,171.21],'west coast region':[-42.45,171.21],
  'chatham islands':[-43.88,-176.52],
};

function renderMap(orders) {
  cachedMapOrders = orders;
  const container = document.getElementById('order-map');
  if (typeof L === 'undefined') {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim);font-size:0.85rem;">Loading map...</div>';
    loadLeaflet().then(() => renderMap(orders)).catch(() => { container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--red);font-size:0.85rem;">Map failed to load</div>'; });
    return;
  }

  if (!mapInstance) {
    mapInstance = L.map('order-map', { scrollWheelZoom: false }).setView([-41.0, 174.0], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '',
      maxZoom: 18,
    }).addTo(mapInstance);

    // Wire up dropdown listeners
    var mapLayerSel = document.getElementById('map-layer');
    var mapAdSrcSel = document.getElementById('map-ad-source');
    if (mapLayerSel) mapLayerSel.addEventListener('change', function() { console.log('[Map] Layer changed to:', this.value); refreshMapLayers(); });
    if (mapAdSrcSel) mapAdSrcSel.addEventListener('change', function() { console.log('[Map] Ad source changed to:', this.value); refreshMapLayers(); });

    // Load adspend region data once
    loadAdspendRegions();
  }

  refreshMapLayers();
  setTimeout(() => mapInstance.invalidateSize(), 200);
}

function loadAdspendRegions() {
  if (!currentStaff || !currentStaff.token) return;
  const tok = encodeURIComponent(currentStaff.token);
  // Use same date range as dashboard filters
  const [from, to] = getDateRange();

  // Facebook regions
  fetch(`/.netlify/functions/facebook-campaigns?token=${tok}&from=${from}&to=${to}&geo=region`)
    .then(r => r.json())
    .then(data => {
      cachedAdspendRegions.facebook = data.regions || [];
      refreshMapLayers();
    }).catch(() => {});

  // Google regions
  fetch(`/.netlify/functions/google-ads?token=${tok}&from=${from}&to=${to}&geo=region`)
    .then(r => r.json())
    .then(data => {
      // Google returns city/region names — aggregate into NZ regions
      const regionAgg = {};
      (data.regions || []).forEach(r => {
        // Try to match to a known NZ region
        const norm = r.region.toLowerCase().replace(/ region$/i,'').replace(/ district$/i,'').replace(/ā/g,'a').replace(/ū/g,'u').replace(/ī/g,'i').replace(/ō/g,'o').replace(/ē/g,'e').trim();
        // Check if it's a known region
        let matched = null;
        for (const rk of Object.keys(NZ_REGIONS)) {
          const rkNorm = rk.replace(/ region$/,'');
          if (norm === rkNorm) { matched = rkNorm; break; }
        }
        if (!matched) return; // skip non-region entries (cities etc)
        if (!regionAgg[matched]) regionAgg[matched] = { region: matched, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversions_value: 0 };
        regionAgg[matched].spend += r.spend;
        regionAgg[matched].impressions += r.impressions;
        regionAgg[matched].clicks += r.clicks;
        regionAgg[matched].conversions += r.conversions;
        regionAgg[matched].conversions_value += r.conversions_value;
      });
      cachedAdspendRegions.google = Object.values(regionAgg);
      refreshMapLayers();
    }).catch(() => {});
}

window.refreshMapLayers = refreshMapLayers;
function refreshMapLayers() {
  if (!mapInstance) return;
  const layer = (document.getElementById('map-layer') || {}).value || 'both';
  const adSource = (document.getElementById('map-ad-source') || {}).value || 'all';
  const showOrders = layer === 'orders' || layer === 'both';
  const showAds = layer === 'adspend' || layer === 'both';

  // Hide/show ad source dropdown
  const srcSel = document.getElementById('map-ad-source');
  if (srcSel) srcSel.style.display = (layer === 'orders') ? 'none' : '';

  // Clear existing layers
  if (heatLayer) { mapInstance.removeLayer(heatLayer); heatLayer = null; }
  if (adspendHeatLayer) { mapInstance.removeLayer(adspendHeatLayer); adspendHeatLayer = null; }
  mapOrderMarkers.forEach(m => mapInstance.removeLayer(m));
  mapOrderMarkers = [];
  mapAdMarkers.forEach(m => mapInstance.removeLayer(m));
  mapAdMarkers = [];

  // ── Build city→region lookup ──
  const cityToRegionMap = {};
  Object.keys(NZ_CITIES).forEach(city => {
    const cc = NZ_CITIES[city];
    let bestRegion = '', bestDist = Infinity;
    Object.entries(NZ_REGIONS).forEach(([rName, rc]) => {
      if (rName.includes(' region')) return;
      const d = Math.abs(cc[0] - rc[0]) + Math.abs(cc[1] - rc[1]);
      if (d < bestDist) { bestDist = d; bestRegion = rName; }
    });
    cityToRegionMap[city] = bestRegion;
  });

  // ── Collect all data first to find global max $ for shared scaling ──
  let orderMarkerData = [];
  let adMarkerData = [];

  // Orders data
  if (showOrders && cachedMapOrders) {
    if (showAds) {
      // Aggregate orders to REGION level when comparing with adspend
      const regionOrders = {};
      cachedMapOrders.forEach(o => {
        const city = (o.city || '').toLowerCase().trim();
        if (!city) return;
        const region = cityToRegionMap[city] || city;
        if (!regionOrders[region]) regionOrders[region] = { count: 0, revenue: 0, name: region.charAt(0).toUpperCase() + region.slice(1) };
        regionOrders[region].count++;
        regionOrders[region].revenue += Number(o.total_value || 0);
      });
      Object.entries(regionOrders).forEach(([region, data]) => {
        const coords = NZ_REGIONS[region] || NZ_REGIONS[region + ' region'];
        if (!coords) return;
        orderMarkerData.push({ coords, ...data });
      });
    } else {
      // City-level detail when orders only
      const cityOrders = {};
      cachedMapOrders.forEach(o => {
        const city = (o.city || '').toLowerCase().trim();
        if (!city) return;
        if (!cityOrders[city]) cityOrders[city] = { count: 0, revenue: 0, name: o.city };
        cityOrders[city].count++;
        cityOrders[city].revenue += Number(o.total_value || 0);
      });
      Object.entries(cityOrders).forEach(([city, data]) => {
        const coords = NZ_CITIES[city];
        if (!coords) return;
        orderMarkerData.push({ coords, ...data });
      });
    }
  }

  // Adspend data
  if (showAds) {
    const regionSpend = {};
    const addRegions = (regions) => {
      (regions || []).forEach(r => {
        const key = r.region.toLowerCase().replace(/ region$/i, '').trim();
        if (!regionSpend[key]) regionSpend[key] = { name: r.region, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversions_value: 0 };
        regionSpend[key].spend += r.spend;
        regionSpend[key].impressions += r.impressions;
        regionSpend[key].clicks += r.clicks;
        regionSpend[key].conversions += r.conversions;
        regionSpend[key].conversions_value += r.conversions_value;
      });
    };
    if (adSource === 'all' || adSource === 'facebook') addRegions(cachedAdspendRegions.facebook);
    if (adSource === 'all' || adSource === 'google') addRegions(cachedAdspendRegions.google);

    const normalise = s => s.toLowerCase().replace(/\s*region$/,'').replace(/\s*district$/,'').replace(/ā/g,'a').replace(/ū/g,'u').replace(/ī/g,'i').replace(/ō/g,'o').replace(/ē/g,'e').trim();
    const regionLookup = {};
    Object.keys(NZ_REGIONS).forEach(k => { regionLookup[normalise(k)] = NZ_REGIONS[k]; });

    Object.entries(regionSpend).forEach(([key, data]) => {
      const norm = normalise(key);
      const coords = regionLookup[norm];
      if (!coords) return;
      adMarkerData.push({ coords, ...data });
    });
  }

  // ── Shared $ scale: find the single highest dollar value across both layers ──
  const allDollarValues = [
    ...orderMarkerData.map(m => m.revenue),
    ...adMarkerData.map(m => m.spend),
  ];
  const globalMax = Math.max(...allDollarValues, 1);

  // ── Render orders ──
  if (showOrders) {
    const heatData = [];
    orderMarkerData.forEach(m => {
      for (let i = 0; i < m.count; i++) heatData.push([m.coords[0], m.coords[1], 1]);
    });
    if (heatData.length > 0) {
      heatLayer = L.heatLayer(heatData, {
        radius: 25, blur: 20, maxZoom: 10,
        gradient: { 0.2: '#3b82f6', 0.4: '#8b5cf6', 0.6: '#ec4899', 0.8: '#f59e0b', 1.0: '#f43f5e' },
      }).addTo(mapInstance);
    }

    orderMarkerData.forEach(m => {
      const ratio = m.revenue / globalMax;
      const radius = Math.max(2, ratio * 20); // pure proportional, min 2px
      const marker = L.circleMarker(m.coords, {
        radius,
        color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.35, weight: 1,
      }).bindTooltip(`<b>${m.name}</b><br>${m.count} orders<br>$${m.revenue.toFixed(2)}<br><i>Click to filter</i>`, { className: '' })
        .addTo(mapInstance);
      marker.on('click', () => {
        const citySelect = document.getElementById('filter-city');
        const match = [...citySelect.options].find(opt => opt.value.toLowerCase() === m.name.toLowerCase());
        if (match) { citySelect.value = match.value; } else {
          const opt = document.createElement('option'); opt.value = m.name; opt.textContent = m.name;
          citySelect.appendChild(opt); citySelect.value = m.name;
        }
        applyFilter();
      });
      mapOrderMarkers.push(marker);
    });
  }

  // ── Render adspend ──
  if (showAds) {
    adMarkerData.forEach(m => {
      const offset = showOrders ? 0.15 : 0;
      const ratio = m.spend / globalMax;
      const radius = Math.max(2, ratio * 20); // pure proportional, min 2px
      const marker = L.circleMarker([m.coords[0] + offset, m.coords[1] + offset], {
        radius,
        color: '#E67E22', fillColor: '#E67E22', fillOpacity: 0.3, weight: 2, dashArray: '4 2',
      }).bindTooltip(
        `<b>${m.name}</b> <span style="color:#E67E22">● Ad Spend</span><br>` +
        `Spend: $${m.spend.toFixed(2)}<br>` +
        `Impressions: ${m.impressions.toLocaleString()}<br>` +
        `Clicks: ${m.clicks.toLocaleString()}<br>` +
        `Conversions: ${m.conversions}<br>` +
        `Conv. Value: $${m.conversions_value.toFixed(2)}`,
        { className: '' }
      ).addTo(mapInstance);
      mapAdMarkers.push(marker);
    });
  }
}

function sum(arr, key) { return arr.reduce((s, o) => s + Number(o[key] || 0), 0); }
function fmt_money(v) { return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmt_date(d) {
  // Use NZ timezone for date calculations
  const nz = new Date(d.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
  return nz.getFullYear() + '-' + String(nz.getMonth() + 1).padStart(2, '0') + '-' + String(nz.getDate()).padStart(2, '0');
}

function topCustomer(orders, mode) {
  const customers = {};
  orders.forEach(o => {
    if (!o.email) return;
    if (!customers[o.email]) customers[o.email] = { name: o.customer_name || o.email, spend: 0, count: 0 };
    customers[o.email].spend += Number(o.total_value || 0);
    customers[o.email].count++;
  });
  const entries = Object.values(customers);
  if (entries.length === 0) return { name: '-', total: 0 };
  if (mode === 'count') {
    entries.sort((a, b) => b.count - a.count);
    return { name: entries[0].name, total: entries[0].count };
  }
  entries.sort((a, b) => b.spend - a.spend);
  return { name: entries[0].name, total: entries[0].spend };
}

// ── Customer Journey in Order Modal ──
async function loadOrderJourney(order) {
  const el = document.getElementById('modal-journey');
  if (!el) return;

  const token = currentStaff ? currentStaff.token : '';
  if (!token) { el.textContent = 'Not authenticated'; return; }

  const site = 'PrimalPantry.co.nz';
  const orderTime = order.created_at || order.order_date;
  if (!orderTime) { el.textContent = 'No order timestamp available'; return; }

  const params = new URLSearchParams({
    token,
    site,
    order_time: new Date(orderTime).toISOString(),
  });
  if (order.visitor_hash) params.set('visitor_hash', order.visitor_hash);
  if (order.utm_source) params.set('utm_source', order.utm_source);
  if (order.landing_page) params.set('landing_page', order.landing_page);
  if (order.client_browser) params.set('browser', order.client_browser);
  if (order.country_code) params.set('country', order.country_code);

  try {
    const res = await fetch(`/.netlify/functions/analytics-journey?${params}`);
    if (!res.ok) throw new Error('API error ' + res.status);
    const journey = await res.json();

    if (!journey || journey.length === 0) {
      el.innerHTML = '<span style="color:var(--dim);">No journey data found for this order</span>';
      return;
    }

    // Render timeline
    let html = '<div style="position:relative;padding-left:1.5rem;">';
    // Vertical line
    html += '<div style="position:absolute;left:0.45rem;top:0.4rem;bottom:0.4rem;width:2px;background:var(--border);"></div>';

    journey.forEach((step, i) => {
      const time = new Date(step.event_time).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Pacific/Auckland' });
      const isEntry = step.entry_page;
      const isEvent = step.event_type === 'event';
      const isThankYou = (step.pathname || '').includes('thank-you');

      // Dot color
      let dotColor = 'var(--dim)';
      if (isEntry) dotColor = 'var(--sage)';
      else if (isEvent) dotColor = 'var(--honey)';
      else if (isThankYou) dotColor = 'var(--sage)';

      // Label
      let label = step.pathname || '';
      if (isEvent) label = step.event_name || 'Event';

      // Source pill for the first entry step
      let sourcePill = '';
      if (isEntry && i === journey.findIndex(s => s.entry_page)) {
        const parts = [];
        if (step.utm_source) parts.push(utmTranslate('utm_source', step.utm_source));
        const rawD = step.utm_campaign || step.utm_adgroup || step.utm_content || '';
        const detail = rawD ? utmTranslate(step.utm_campaign ? 'utm_campaign' : step.utm_adgroup ? 'utm_adgroup' : 'utm_content', rawD) : '';
        if (detail) parts.push(detail);
        if (parts.length) {
          sourcePill = `<span style="display:inline-block;background:var(--sage);color:var(--bg);font-size:0.65rem;font-weight:600;padding:0.15rem 0.5rem;border-radius:9999px;margin-bottom:0.3rem;">${parts.join(' – ')}</span>`;
        } else if (step.referrer_domain) {
          sourcePill = `<span style="display:inline-block;background:var(--border);color:var(--text);font-size:0.65rem;font-weight:600;padding:0.15rem 0.5rem;border-radius:9999px;margin-bottom:0.3rem;">${step.referrer_domain}</span>`;
        }
      }

      // Extra info
      let extra = '';
      if (isEntry && step.referrer_domain) extra = `from ${step.referrer_domain}`;
      if (step.duration > 0) extra += (extra ? ' · ' : '') + step.duration + 's';

      html += `<div style="position:relative;margin-bottom:0.6rem;padding-left:0.5rem;">
        <div style="position:absolute;left:-1.15rem;top:0.25rem;width:8px;height:8px;border-radius:50%;background:${dotColor};"></div>
        ${sourcePill}
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.5rem;">
          <span style="color:${isEvent ? 'var(--honey)' : isThankYou ? 'var(--sage)' : 'var(--text)'};font-weight:${isEntry || isThankYou || isEvent ? '600' : '400'};">${label}</span>
          <span style="color:var(--dim);font-size:0.7rem;white-space:nowrap;">${time}</span>
        </div>
        ${extra ? `<div style="font-size:0.7rem;color:var(--dim);margin-top:0.1rem;">${extra}</div>` : ''}
      </div>`;
    });

    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<span style="color:var(--red);">Failed to load journey: ${e.message}</span>`;
  }
}

// ── Nav drawer ──
const navDrawer = document.getElementById('nav-drawer');
const navOverlay = document.getElementById('nav-overlay');
const navLabel = document.getElementById('nav-active-label');
const navNames = { sales: 'Overview', orders: 'Orders', shipping: 'Shipping', customers: 'Customers', comms: 'Communications', manufacturing: 'Product & Inventory', website: 'Website Analytics', marketing: 'Marketing', finance: 'Finance', settings: 'Settings' };

function openNav() { navDrawer.classList.add('open'); navOverlay.classList.add('open'); }
function closeNav() { navDrawer.classList.remove('open'); navOverlay.classList.remove('open'); }

document.getElementById('nav-hamburger-btn').addEventListener('click', () => {
  navDrawer.classList.contains('open') ? closeNav() : openNav();
});
navOverlay.addEventListener('click', closeNav);

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    activeTab = this.dataset.tab;
    document.getElementById('tab-' + activeTab).classList.add('active');
    navLabel.textContent = navNames[activeTab] || activeTab;
    closeNav();
    // Source/Medium/Campaign/City filters: only on website, marketing
    const showUtmFilters = activeTab === 'website' || activeTab === 'marketing';
    document.querySelectorAll('.filter-bar .filter-group').forEach((g, i) => {
      if (i === 0) return; // Keep Period filter visible
      g.style.display = showUtmFilters ? '' : 'none';
    });
    // Hide entire filter bar on finance (has its own date context)
    document.querySelector('.filter-bar').style.display = (activeTab === 'finance' || activeTab === 'comms' || activeTab === 'settings') ? 'none' : '';
    // Attribution toggle: only on website, marketing
    document.getElementById('attr-toggle').style.display = (activeTab === 'website' || activeTab === 'marketing') ? '' : 'none';
    // Stats mode toggle: only on overview and sales
    document.getElementById('stats-mode-toggle').style.display = (activeTab === 'sales') ? '' : 'none';
    // Ad spend banner: only on marketing tab
    document.getElementById('adspend-banner').style.display = (activeTab === 'marketing') ? '' : 'none';
    loadActiveTab();
    checkCommsPrompts(); // Check for pending prompts on every tab switch
  });
});

// ── Stats eye toggle (hidden by default) ──
let statsVisible = false;
const eyeBtn = document.getElementById('stats-eye-btn');
const eyeIcon = document.getElementById('stats-eye-icon');
const eyeOpen = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
const eyeClosed = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
function applyStatsVisibility() {
  document.querySelectorAll('.sensitive-stat').forEach(el => el.classList.toggle('blurred', !statsVisible));
  document.querySelectorAll('.sensitive-chart').forEach(el => el.classList.toggle('blurred', !statsVisible));
  eyeIcon.innerHTML = statsVisible ? eyeOpen : eyeClosed;
  eyeBtn.style.color = statsVisible ? 'var(--sage)' : 'var(--dim)';
  eyeBtn.style.borderColor = statsVisible ? 'var(--sage)' : 'var(--border)';
}
applyStatsVisibility();
eyeBtn.addEventListener('click', () => { statsVisible = !statsVisible; applyStatsVisibility(); });

function loadActiveTab() {
  if (activeTab === 'sales') {
    renderAll(filteredOrders, allLineItems.filter(li => new Set(filteredOrders.map(o => o.id)).has(li.order_id)));
  } else if (activeTab === 'orders') {
    renderOrdersTable();
    // Load shipping data in background so order pills show eShip status
    if (!shippingLoaded) {
      fetch(ESHIP_PROXY + '?limit=500').then(r => r.json()).then(data => {
        allShipments = data.orders || [];
        shippingLoaded = true;
        renderOrdersTable();
        syncDeliveredOrders();
      }).catch(() => {});
    }
  } else if (activeTab === 'shipping' && !shippingLoaded) {
    loadShippingData();
  } else if (activeTab === 'customers') {
    initCustomersSubTabs();
    renderCustomersTab();
  } else if (activeTab === 'manufacturing') {
    loadManufacturingTab();
  } else if (activeTab === 'website') {
    waInit();
  } else if (activeTab === 'marketing') {
    loadMarketingTab();
  } else if (activeTab === 'comms') {
    loadCommsTab();
  } else if (activeTab === 'finance') {
    loadFinanceTab();
  } else if (activeTab === 'actions') {
    loadActionsTab();
  } else if (activeTab === 'settings') {
    loadSettingsTab();
  }
}

// ── Customers Tab ──

function getSegmentFilters() {
  return {
    type: document.getElementById('seg-type').value,
    spend: document.getElementById('seg-spend').value,
    orders: document.getElementById('seg-orders').value,
    recency: document.getElementById('seg-recency').value,
    city: document.getElementById('seg-city').value,
    source: document.getElementById('seg-source').value,
    tag: document.getElementById('seg-tag').value,
  };
}

function applySegmentFilters(customerList) {
  const f = getSegmentFilters();
  const today = new Date();
  return customerList.filter(c => {
    // Type
    if (f.type === 'new' && c.orders.length > 1) return false;
    if (f.type === 'returning' && c.orders.length < 2) return false;
    // Spend
    if (f.spend) {
      const s = c.totalSpend;
      if (f.spend === '0-50' && (s < 0 || s > 50)) return false;
      if (f.spend === '50-200' && (s < 50 || s > 200)) return false;
      if (f.spend === '200-500' && (s < 200 || s > 500)) return false;
      if (f.spend === '500+' && s < 500) return false;
    }
    // Orders
    if (f.orders) {
      const n = c.orders.length;
      if (f.orders === '1' && n !== 1) return false;
      if (f.orders === '2-5' && (n < 2 || n > 5)) return false;
      if (f.orders === '5+' && n < 5) return false;
    }
    // Recency
    if (f.recency) {
      const daysSince = Math.floor((today - new Date(c.lastOrder)) / 86400000);
      if (f.recency === 'lapsed' && daysSince < 90) return false;
      if (f.recency !== 'lapsed') {
        const d = parseInt(f.recency);
        if (daysSince > d) return false;
      }
    }
    // City
    if (f.city && c.city !== f.city) return false;
    // Source (first order's utm_source)
    if (f.source) {
      const firstOrder = c.orders[c.orders.length - 1];
      const src = firstOrder ? resolveOrderSource(firstOrder) : '';
      if (src !== f.source) return false;
    }
    // Tag
    if (f.tag) {
      const tags = customerTags[c.email] || new Set();
      if (!tags.has(f.tag)) return false;
    }
    return true;
  });
}

function populateSegmentDropdowns() {
  const customers = {};
  allOrders.forEach(o => {
    if (!o.email) return;
    if (!customers[o.email]) customers[o.email] = { city: '', sources: new Set() };
    if (o.city) customers[o.email].city = o.city;
    const src = resolveOrderSource(o);
    if (src) customers[o.email].sources.add(src);
  });

  const cities = [...new Set(Object.values(customers).map(c => c.city).filter(Boolean))].sort();
  const sources = [...new Set(Object.values(customers).flatMap(c => [...c.sources]))].sort();

  const citySelect = document.getElementById('seg-city');
  citySelect.innerHTML = '<option value="">All Cities</option>' + cities.map(c => `<option value="${c}">${c}</option>`).join('');

  const srcSelect = document.getElementById('seg-source');
  srcSelect.innerHTML = '<option value="">All Sources</option>' + sources.map(s => `<option value="${s}">${utmTranslate('utm_source', s)}</option>`).join('');
}

function getSavedSegments() {
  try { return JSON.parse(localStorage.getItem('pp_segments') || '{}'); } catch { return {}; }
}

function renderSavedSegments() {
  const saved = getSavedSegments();
  const sel = document.getElementById('seg-saved');
  sel.innerHTML = '<option value="">Saved Segments…</option>' +
    Object.keys(saved).map(n => `<option value="${n}">${n}</option>`).join('') +
    (Object.keys(saved).length ? '<option value="__delete__">— Delete a segment —</option>' : '');
}

function saveSegment() {
  const name = prompt('Segment name:');
  if (!name || !name.trim()) return;
  const saved = getSavedSegments();
  saved[name.trim()] = getSegmentFilters();
  localStorage.setItem('pp_segments', JSON.stringify(saved));
  renderSavedSegments();
}

function loadSegment(name) {
  if (!name) return;
  if (name === '__delete__') {
    const del = prompt('Enter segment name to delete:');
    if (del) { deleteSegment(del); }
    document.getElementById('seg-saved').value = '';
    return;
  }
  const saved = getSavedSegments();
  const f = saved[name];
  if (!f) return;
  document.getElementById('seg-type').value = f.type || '';
  document.getElementById('seg-spend').value = f.spend || '';
  document.getElementById('seg-orders').value = f.orders || '';
  document.getElementById('seg-recency').value = f.recency || '';
  document.getElementById('seg-city').value = f.city || '';
  document.getElementById('seg-source').value = f.source || '';
  document.getElementById('seg-tag').value = f.tag || '';
  customersPage = 1;
  renderCustomersTab();
}

function deleteSegment(name) {
  const saved = getSavedSegments();
  delete saved[name];
  localStorage.setItem('pp_segments', JSON.stringify(saved));
  renderSavedSegments();
}

function clearSegmentFilters() {
  ['seg-type', 'seg-spend', 'seg-orders', 'seg-recency', 'seg-city', 'seg-source', 'seg-tag', 'seg-saved'].forEach(id => {
    document.getElementById(id).value = '';
  });
  customersPage = 1;
  renderCustomersTab();
}

// ── Customer Tags ──
const TAG_PRESETS = ['VIP', 'Wholesale', 'Influencer', 'Staff', 'Flagged'];
function tagClass(t) { return TAG_PRESETS.includes(t) ? 'tag-' + t.toLowerCase() : 'tag-custom'; }

async function loadCustomerTags() {
  const { data, error } = await db.from('customer_tags').select('*');
  if (error) { console.error('Failed to load tags:', error); return; }
  customerTags = {};
  (data || []).forEach(row => {
    if (!customerTags[row.email]) customerTags[row.email] = new Set();
    customerTags[row.email].add(row.tag);
  });
}

async function addTag(email, tag) {
  if (!tag) return;
  const { error } = await db.from('customer_tags').insert({ email, tag });
  if (error && !error.message.includes('duplicate')) { alert('Error adding tag: ' + error.message); return; }
  if (!customerTags[email]) customerTags[email] = new Set();
  customerTags[email].add(tag);
  renderCustomersTab();
}

async function removeTag(email, tag) {
  const { error } = await db.from('customer_tags').delete().eq('email', email).eq('tag', tag);
  if (error) { alert('Error removing tag: ' + error.message); return; }
  if (customerTags[email]) customerTags[email].delete(tag);
  renderCustomersTab();
}

function toggleTagPicker(email, btn) {
  // Close any existing picker
  const existing = document.querySelector('.tag-picker');
  if (existing) { existing.remove(); return; }

  const tags = customerTags[email] || new Set();
  const picker = document.createElement('div');
  picker.className = 'tag-picker';
  picker.innerHTML = TAG_PRESETS.map(t =>
    `<div class="tag-picker-item ${tags.has(t) ? 'active' : ''}" onclick="event.stopPropagation(); this.parentElement.remove(); addTag('${email}', '${t}')">${t}</div>`
  ).join('') +
    `<div class="tag-picker-item" onclick="event.stopPropagation(); this.parentElement.remove(); const t=prompt('Custom tag:'); if(t) addTag('${email}', t.trim());">+ Custom…</div>`;

  // Position relative to button
  btn.style.position = 'relative';
  picker.style.top = '22px';
  picker.style.left = '0';
  btn.appendChild(picker);

  // Close on outside click
  setTimeout(() => {
    const close = (e) => { if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

function renderTagPills(email) {
  const tags = customerTags[email] || new Set();
  let html = '<span class="tag-pills">';
  tags.forEach(t => {
    html += `<span class="tag-pill ${tagClass(t)}">${t}<span class="tag-x" onclick="event.stopPropagation(); removeTag('${email}', '${t}')">&times;</span></span>`;
  });
  html += `<button class="tag-add-btn" onclick="event.stopPropagation(); toggleTagPicker('${email}', this)">+</button>`;
  html += '</span>';
  return html;
}

function renderCustomersTab() {
  const customers = {};
  allOrders.forEach(o => {
    if (!o.email) return;
    if (!customers[o.email]) {
      customers[o.email] = {
        name: o.customer_name || o.email,
        email: o.email,
        phone: o.phone || '',
        city: o.city || '',
        country: o.country_code || '',
        orders: [],
        totalSpend: 0,
        firstOrder: o.order_date,
        lastOrder: o.order_date,
      };
    }
    const c = customers[o.email];
    c.totalSpend += Number(o.total_value || 0);
    if (o.customer_name) c.name = o.customer_name;
    if (o.phone) c.phone = o.phone;
    if (o.city) c.city = o.city;
    if (o.order_date < c.firstOrder) c.firstOrder = o.order_date;
    if (o.order_date > c.lastOrder) c.lastOrder = o.order_date;
    c.orders.push(o);
  });

  // Sort orders within each customer by date desc
  Object.values(customers).forEach(c => c.orders.sort((a, b) => b.order_date.localeCompare(a.order_date)));

  const allCustomerList = Object.values(customers);
  let customerList = applySegmentFilters(allCustomerList);

  // Stats (based on filtered segment)
  const totalCustomers = customerList.length;
  const totalAll = allCustomerList.length;
  const repeatCustomers = customerList.filter(c => c.orders.length > 1).length;
  const totalOrders = customerList.reduce((s, c) => s + c.orders.length, 0);
  const avgOrdersPerCustomer = totalCustomers > 0 ? (totalOrders / totalCustomers).toFixed(1) : '0';
  const totalSpendAll = customerList.reduce((s, c) => s + c.totalSpend, 0);
  const avgSpend = totalCustomers > 0 ? totalSpendAll / totalCustomers : 0;
  const topSpender = [...customerList].sort((a, b) => b.totalSpend - a.totalSpend)[0];
  const topOrderer = [...customerList].sort((a, b) => b.orders.length - a.orders.length)[0];

  // Update segment count
  const isFiltered = totalCustomers !== totalAll;
  document.getElementById('seg-count').textContent = isFiltered ? `${totalCustomers} of ${totalAll} customers` : '';

  document.getElementById('customer-stats-grid').innerHTML = [
    { label: 'Total Customers', value: totalCustomers, sub: `${repeatCustomers} repeat`, color: 'var(--blue)' },
    { label: 'Repeat Rate', value: totalCustomers > 0 ? (repeatCustomers / totalCustomers * 100).toFixed(1) + '%' : '0%', sub: `${repeatCustomers} of ${totalCustomers}`, color: 'var(--green)' },
    { label: 'Avg Orders/Customer', value: avgOrdersPerCustomer, sub: 'all time', color: 'var(--purple)' },
    { label: 'Avg Spend/Customer', value: fmt_money(avgSpend), sub: 'lifetime', color: 'var(--cyan)' },
    { label: 'CLV', value: fmt_money(avgSpend), sub: 'lifetime value', color: 'var(--cyan)' },
    { label: 'Top Spender', value: topSpender ? topSpender.name : '-', sub: topSpender ? fmt_money(topSpender.totalSpend) : '', color: 'var(--lime)' },
    { label: 'Most Orders', value: topOrderer ? topOrderer.name : '-', sub: topOrderer ? topOrderer.orders.length + ' orders' : '', color: 'var(--amber)' },
  ].map(s => `
    <div class="stat-card">
      <div class="label">${s.label}</div>
      <div class="value" style="color:${s.color}">${s.value}</div>
      <div class="sub">${s.sub}</div>
    </div>
  `).join('');

  // Search + sort
  const query = (document.getElementById('customer-search').value || '').toLowerCase();
  const sortBy = document.getElementById('customer-sort').value;

  if (query) {
    customerList = customerList.filter(c =>
      c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query)
    );
  }

  switch (sortBy) {
    case 'spend': customerList.sort((a, b) => b.totalSpend - a.totalSpend); break;
    case 'orders': customerList.sort((a, b) => b.orders.length - a.orders.length); break;
    case 'recent': customerList.sort((a, b) => b.lastOrder.localeCompare(a.lastOrder)); break;
    case 'name': customerList.sort((a, b) => a.name.localeCompare(b.name)); break;
  }

  const container = document.getElementById('customers-list');
  if (customerList.length === 0) {
    container.innerHTML = '<p style="color:var(--dim);padding:1rem;">No customers found</p>';
    document.getElementById('customers-pagination').innerHTML = '';
    return;
  }

  const start = (customersPage - 1) * PAGE_SIZE;
  const pageList = customerList.slice(start, start + PAGE_SIZE);

  container.innerHTML = pageList.map((c, i) => {
    const orderItems = c.orders.map(o => {
      const items = allLineItems.filter(li => li.order_id === o.id);
      const itemStr = items.map(li => `${li.quantity}x ${li.description || li.sku || '?'}`).join(', ');
      const src = resolveOrderSource(o);
      const magnet = items[0] ? items[0].description : '';
      const ship = getShipStatus(o);
      const shipPill = ship ? `<span class="ship-status-badge ${(ship._shipping_status || '').toLowerCase().replace(/\s+/g, '-')}">${ship._shipping_status}</span>` : '';

      // Time to ship: order received → shipped/in-transit (or now)
      const orderTime = o.created_at ? new Date(o.created_at) : (o.order_date ? new Date(o.order_date) : null);
      let shipTimeStr = '-';
      if (orderTime) {
        const shippedTime = ship?.shipped_date ? new Date(ship.shipped_date) : new Date();
        const shipHours = ((shippedTime - orderTime) / 3600000).toFixed(1);
        shipTimeStr = ship?.shipped_date ? `${shipHours}h` : `${shipHours}h <span style="color:var(--dim);font-size:0.65rem;">waiting</span>`;
      }

      // Wait completed: order received → delivered (or now)
      let waitStr = '-';
      if (orderTime) {
        const deliveredTime = (ship?._shipping_status === 'Delivered' && ship?.delivered_date) ? new Date(ship.delivered_date) : new Date();
        const waitHours = ((deliveredTime - orderTime) / 3600000).toFixed(1);
        waitStr = (ship?._shipping_status === 'Delivered') ? `${waitHours}h` : `${waitHours}h <span style="color:var(--dim);font-size:0.65rem;">open</span>`;
      }

      return `<div class="customer-order-row" onclick="event.stopPropagation(); openOrderModal(${o.id});">
        <span>${o.order_date}</span>
        <span>$${Number(o.total_value || 0).toFixed(2)}</span>
        ${sourcePill(resolveOrderSource(o))} ${magnet ? sourcePill(magnet) : ''} ${shipPill} ${daysWaitingBadge(o)}
        <span style="font-size:0.7rem;color:var(--muted);" title="Time to ship">Ship: ${shipTimeStr}</span>
        <span style="font-size:0.7rem;color:var(--muted);" title="Total wait time">Wait: ${waitStr}</span>
        <div class="customer-order-items" style="width:100%;">${itemStr || 'No items'}</div>
      </div>`;
    }).join('');

    const daysSinceFirst = c.orders.length > 1 ? Math.round((new Date(c.lastOrder) - new Date(c.firstOrder)) / 86400000) : 0;
    const avgFreq = c.orders.length > 1 ? Math.round(daysSinceFirst / (c.orders.length - 1)) : null;

    return `<div class="customer-profile" onclick="this.classList.toggle('expanded')">
      <div class="customer-header">
        <div class="customer-avatar">
          <svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div>
            <span class="customer-name">${c.name}</span>
            <span class="customer-email">${c.email}</span>
            ${renderTagPills(c.email)}
          </div>
        </div>
        <div class="customer-meta">
          <span><span class="val">${c.orders.length}</span> orders</span>
          <span><span class="val">${fmt_money(c.totalSpend)}</span> spent</span>
          <span><span class="val">${fmt_money(c.totalSpend / c.orders.length)}</span> AOV</span>
          ${avgFreq !== null ? `<span>Every <span class="val">${avgFreq}d</span></span>` : ''}
          ${c.city ? `<span>${c.city}${c.country ? ', ' + c.country : ''}</span>` : ''}
          ${c.phone ? `<span>${c.phone}</span>` : ''}
          <span>Last: ${c.lastOrder}</span>
          <button class="tl-btn" onclick="event.stopPropagation(); openCustomerTimeline('${c.email.replace(/'/g, "\\'")}')">Timeline</button>
          <button class="tl-btn" onclick="event.stopPropagation(); openComposeModal({to: '${c.email.replace(/'/g, "\\'")}'})">Email</button>
        </div>
      </div>
      <div class="customer-orders-list">
        <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.5rem;text-transform:uppercase;">Order History (${c.orders.length})</div>
        ${orderItems}
        <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border);">
          <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.5rem;text-transform:uppercase;">Email History</div>
          <div class="customer-emails-container" data-email="${c.email}" id="cust-emails-${c.email.replace(/[^a-zA-Z0-9]/g, '_')}">
            <span style="font-size:0.75rem;color:var(--dim);">Click to load...</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  renderPagination('customers-pagination', customersPage, customerList.length, p => { customersPage = p; renderCustomersTab(); });

  // Lazy-load emails when customer card is expanded
  document.querySelectorAll('.customer-profile').forEach(card => {
    card.addEventListener('click', function() {
      if (!this.classList.contains('expanded')) return;
      const container = this.querySelector('.customer-emails-container');
      if (!container || container.dataset.loaded) return;
      container.dataset.loaded = '1';
      loadCustomerEmails(container.dataset.email, container);
    });
  });
}

async function loadCustomerEmails(email, container) {
  container.innerHTML = '<span style="font-size:0.75rem;color:var(--dim);">Loading...</span>';
  try {
    const data = await db.from('email_messages').select('*').eq('customer_email', email.toLowerCase()).order('date', { ascending: true });
    const msgs = data.data || [];
    if (!msgs.length) {
      container.innerHTML = '<span style="font-size:0.75rem;color:var(--dim);">No emails</span>';
      return;
    }

    // Group into threads
    const threads = {};
    msgs.forEach(m => {
      const tid = m.thread_id || m.id;
      if (!threads[tid]) threads[tid] = [];
      threads[tid].push(m);
    });

    let html = '';
    Object.values(threads).forEach(thread => {
      thread.sort((a, b) => new Date(a.date) - new Date(b.date));
      const first = thread[0];
      const last = thread[thread.length - 1];
      const subject = first.subject || '(no subject)';
      const dateStr = new Date(first.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
      const msgCount = thread.length;
      const threadId = 'cust-thread-' + (first.thread_id || first.id);

      // Compute response times within thread
      let responsePills = '';
      for (let i = 1; i < thread.length; i++) {
        if (thread[i].direction === 'outbound' && thread[i - 1].direction === 'inbound') {
          responsePills += responseTimePill(thread[i - 1].date, thread[i].date);
        }
      }

      html += `<div style="border:1px solid var(--border);border-radius:8px;margin-bottom:0.5rem;overflow:hidden;">
        <div style="padding:0.5rem 0.75rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;" onclick="event.stopPropagation();var el=document.getElementById('${threadId}');el.style.display=el.style.display==='none'?'block':'none';">
          <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
            <span style="font-size:0.8rem;font-weight:600;">${subject.replace(/</g, '&lt;')}</span>
            <span style="font-size:0.65rem;color:var(--dim);">${msgCount} msg${msgCount > 1 ? 's' : ''}</span>
            ${responsePills}
          </div>
          <span style="font-size:0.7rem;color:var(--dim);">${dateStr}</span>
        </div>
        <div id="${threadId}" style="display:none;border-top:1px solid var(--border);">
          ${thread.map(m => {
            const isOut = m.direction === 'outbound';
            const time = new Date(m.date).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const from = (m.from_address || '').split('<')[0].trim();
            const bodyText = (m.body_text || m.snippet || '').slice(0, 300).replace(/</g, '&lt;').replace(/\n/g, '<br>');
            const staffBadge = isOut && m.staff_name ? `<span class="comms-staff-badge">${m.staff_name}</span>` : '';
            return `<div style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);background:${isOut ? 'rgba(140,180,122,0.05)' : 'transparent'};">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;margin-bottom:0.25rem;">
                <span style="font-size:0.75rem;font-weight:600;">${from}</span>
                <div style="display:flex;align-items:center;gap:0.3rem;">
                  ${staffBadge}
                  <span style="font-size:0.65rem;color:var(--dim);">${time}</span>
                </div>
              </div>
              <div style="font-size:0.75rem;color:var(--muted);line-height:1.4;">${bodyText || '<span style="color:var(--dim);">(no content)</span>'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    });

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<span style="font-size:0.75rem;color:var(--red);">Failed to load emails</span>';
  }
}

// ── Customers Sub-Tab Switching ──
let customersSubTabInited = false;
let customersActiveSubTab = 'ecommerce';

function initCustomersSubTabs() {
  if (customersSubTabInited) return;
  customersSubTabInited = true;

  document.querySelectorAll('#customers-sub-tabs .settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#customers-sub-tabs .settings-tab-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      customersActiveSubTab = this.dataset.customersTab;
      document.querySelectorAll('.customers-panel').forEach(p => p.style.display = 'none');
      document.getElementById('customers-' + customersActiveSubTab).style.display = 'block';
      if (customersActiveSubTab === 'ecommerce') renderCustomersTab();
      else if (customersActiveSubTab === 'retail') loadRetailCustomersTab();
    });
  });

  // Retail customer add button
  document.getElementById('rc-add-btn').addEventListener('click', async () => {
    const name = document.getElementById('rc-name').value.trim();
    if (!name) return;
    const btn = document.getElementById('rc-add-btn');
    btn.disabled = true; btn.textContent = 'Adding...';
    try {
      await fetch('/.netlify/functions/suppliers?token=' + currentStaff.token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'wholesalers', name,
          contact_name: document.getElementById('rc-contact').value.trim(),
          email: document.getElementById('rc-email').value.trim(),
          phone: document.getElementById('rc-phone').value.trim(),
          website: document.getElementById('rc-website').value.trim(),
          payment_terms: document.getElementById('rc-terms').value.trim(),
          address: document.getElementById('rc-address').value.trim(),
          notes: document.getElementById('rc-notes').value.trim(),
        }),
      });
      ['rc-name','rc-contact','rc-email','rc-phone','rc-website','rc-terms','rc-address','rc-notes'].forEach(id => {
        const el = document.getElementById(id);
        if (el.tagName === 'TEXTAREA') el.value = ''; else el.value = '';
      });
      await loadRetailCustomersList();
    } catch (e) { alert('Error: ' + e.message); }
    btn.disabled = false; btn.textContent = 'Add Retailer';
  });
}

async function loadRetailCustomersTab() {
  loadRetailCustomersList();
  loadRetailInvoiceStats();
}

async function loadRetailCustomersList() {
  try {
    await ensureXeroStatus();
    const res = await fetch('/.netlify/functions/suppliers?token=' + currentStaff.token + '&type=wholesalers');
    const data = await res.json();
    const list = data.wholesalers || [];
    document.getElementById('retail-count').textContent = list.length;
    renderEntityTable('rc-table', list, 'wholesalers');
    // Show/hide xero sync button
    const rcSync = document.getElementById('rc-xero-sync');
    if (rcSync) rcSync.style.display = xeroConnected ? '' : 'none';
  } catch {
    document.getElementById('rc-table').innerHTML = '<tr><td colspan="6" class="loading">Failed to load</td></tr>';
  }
}

async function loadRetailInvoiceStats() {
  const countEl = document.getElementById('retail-inv-count');
  const valueEl = document.getElementById('retail-inv-value');
  const tableEl = document.getElementById('retail-invoices-table');

  try {
    await ensureXeroStatus();
    if (!xeroConnected) {
      countEl.textContent = '–';
      valueEl.textContent = '–';
      tableEl.innerHTML = '<tr><td colspan="6" class="loading">Connect Xero to view invoices</td></tr>';
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const data = await xeroFetch('Invoices', {
      Statuses: 'AUTHORISED,PAID',
      where: 'Type=="ACCREC"&&Date>=DateTime(' + today.replace(/-/g, ',') + ')',
      order: 'Date DESC'
    });

    const invoices = data.Invoices || [];
    // Filter to today only (in case API returns broader results)
    const todayInvoices = invoices.filter(inv => {
      const invDate = inv.DateString || (inv.Date ? inv.Date.replace(/\/Date\((\d+).*/, (_, ms) => new Date(Number(ms)).toISOString().split('T')[0]) : '');
      return invDate === today;
    });

    const totalValue = todayInvoices.reduce((sum, inv) => sum + (inv.SubTotal || inv.Total || 0), 0);
    countEl.textContent = todayInvoices.length;
    valueEl.textContent = fmt_money(totalValue);

    if (todayInvoices.length === 0) {
      tableEl.innerHTML = '<tr><td colspan="6" class="loading">No invoices created today</td></tr>';
      return;
    }

    tableEl.innerHTML = todayInvoices.map(inv => {
      const invDate = inv.DateString || '';
      const dueDate = inv.DueDateString || '';
      const status = inv.Status || '';
      const statusClass = status === 'PAID' ? 'color:var(--green)' : 'color:var(--amber)';
      return `<tr>
        <td style="font-weight:500;">${esc(inv.InvoiceNumber || '–')}</td>
        <td>${esc(inv.Contact ? inv.Contact.Name : '–')}</td>
        <td>${invDate}</td>
        <td>${dueDate}</td>
        <td>$${(inv.Total || 0).toFixed(2)}</td>
        <td><span style="${statusClass};font-size:0.75rem;font-weight:600;">${status}</span></td>
      </tr>`;
    }).join('');
  } catch (e) {
    countEl.textContent = '–';
    valueEl.textContent = '–';
    tableEl.innerHTML = '<tr><td colspan="6" class="loading">Failed to load invoices</td></tr>';
  }
}

// ── Customer Timeline Modal ──
document.getElementById('timeline-close').addEventListener('click', () => {
  document.getElementById('customer-timeline-modal').classList.remove('open');
});
document.getElementById('customer-timeline-modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});

async function openCustomerTimeline(email) {
  const modal = document.getElementById('customer-timeline-modal');
  const header = document.getElementById('timeline-header');
  const body = document.getElementById('timeline-body');
  modal.classList.add('open');
  header.innerHTML = '<h2 style="margin:0;">Loading...</h2>';
  body.innerHTML = '';

  // Gather customer data from orders
  const custOrders = allOrders.filter(o => o.email === email).sort((a, b) => (a.created_at || a.order_date).localeCompare(b.created_at || b.order_date));
  if (!custOrders.length) { header.innerHTML = '<h2>No orders found</h2>'; return; }

  const name = custOrders[custOrders.length - 1].customer_name || email;
  const totalSpend = custOrders.reduce((s, o) => s + Number(o.total_value || 0), 0);
  const aov = totalSpend / custOrders.length;
  const firstDate = custOrders[0].order_date;
  const lastDate = custOrders[custOrders.length - 1].order_date;
  const daysBetween = custOrders.length > 1 ? Math.round((new Date(lastDate) - new Date(firstDate)) / 86400000) : 0;
  const avgFreq = custOrders.length > 1 ? Math.round(daysBetween / (custOrders.length - 1)) : null;

  // Favourite product
  const productCount = {};
  custOrders.forEach(o => {
    const items = allLineItems.filter(li => li.order_id === o.id);
    items.forEach(li => {
      const name = li.description || li.sku || '?';
      productCount[name] = (productCount[name] || 0) + li.quantity;
    });
  });
  const favProduct = Object.entries(productCount).sort((a, b) => b[1] - a[1])[0];

  // Header stats
  header.innerHTML = `
    <h2 style="margin:0 0 0.5rem;">${name}</h2>
    <div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;">${email}</div>
    <div class="tl-stats">
      <div class="tl-stat"><div class="label">Orders</div><div class="value">${custOrders.length}</div><div class="sub">since ${firstDate}</div></div>
      <div class="tl-stat"><div class="label">Total Spend</div><div class="value">${fmt_money(totalSpend)}</div><div class="sub">lifetime</div></div>
      <div class="tl-stat"><div class="label">AOV</div><div class="value">${fmt_money(aov)}</div><div class="sub">avg order</div></div>
      <div class="tl-stat"><div class="label">Frequency</div><div class="value">${avgFreq !== null ? avgFreq + 'd' : '—'}</div><div class="sub">${avgFreq !== null ? 'between orders' : 'single order'}</div></div>
      <div class="tl-stat"><div class="label">Favourite</div><div class="value" style="font-size:0.8rem;">${favProduct ? favProduct[0] : '—'}</div><div class="sub">${favProduct ? favProduct[1] + 'x purchased' : ''}</div></div>
    </div>
  `;

  // Fetch analytics sessions for this customer
  let sessions = [];
  try {
    const token = currentStaff ? currentStaff.token : '';
    // Try to find sessions by matching visitor hashes from orders
    const visitorHashes = custOrders.map(o => o.visitor_hash).filter(Boolean);
    const persistentIds = custOrders.map(o => o.persistent_id).filter(Boolean);

    // Also try fetching journey data for each order
    const journeyPromises = custOrders.map(async o => {
      try {
        const params = new URLSearchParams({ token, site: 'PrimalPantry.co.nz', order_time: new Date(o.created_at || o.order_date).toISOString() });
        if (o.visitor_hash) params.set('visitor_hash', o.visitor_hash);
        if (o.utm_source) params.set('utm_source', o.utm_source);
        if (o.country_code) params.set('country', o.country_code);
        const res = await fetch(`/.netlify/functions/analytics-journey?${params}`);
        if (!res.ok) return [];
        return await res.json();
      } catch { return []; }
    });
    const journeyResults = await Promise.all(journeyPromises);

    // Build timeline events combining orders and sessions
    const timelineEvents = [];

    // Add orders
    custOrders.forEach((o, idx) => {
      const items = allLineItems.filter(li => li.order_id === o.id);
      const journey = journeyResults[idx] || [];
      const src = resolveOrderSource(o);
      const campaign = resolveOrderCampaign(o);
      const content = o.utm_content || '';

      // Add session pages before the order
      if (journey.length) {
        const sessionPages = journey.filter(j => j.event_type === 'pageview' && !(j.pathname || '').includes('thank-you'));
        const entryStep = journey.find(j => j.entry_page);
        const sessionSrc = entryStep?.utm_source || src;
        const sessionCamp = entryStep?.utm_campaign || campaign;
        const sessionContent = entryStep?.utm_content || content;

        if (sessionPages.length) {
          timelineEvents.push({
            type: 'session',
            time: journey[0].event_time,
            source: sessionSrc,
            campaign: sessionCamp,
            content: sessionContent,
            referrer: entryStep?.referrer_domain || '',
            pages: sessionPages.map(p => p.pathname),
            duration: sessionPages.reduce((s, p) => s + (p.duration || 0), 0),
          });
        }
      }

      // Add order
      timelineEvents.push({
        type: 'order',
        time: o.created_at || o.order_date,
        order: o,
        items,
        source: src,
        campaign,
        content,
      });
    });

    // Fetch email communications for this customer
    try {
      const emailData = await db.from('email_messages').select('*').eq('customer_email', email.toLowerCase()).order('date', { ascending: true });
      if (emailData.data && emailData.data.length > 0) {
        emailData.data.forEach(em => {
          timelineEvents.push({ type: 'email', time: em.date, email: em });
        });
      }
    } catch {}

    // Sort by time
    timelineEvents.sort((a, b) => new Date(a.time) - new Date(b.time));

    // Render timeline
    let html = '<div class="tl-line">';
    let lastDateStr = '';

    timelineEvents.forEach(ev => {
      const date = new Date(ev.time);
      const dateStr = date.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' });
      const timeStr = date.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Pacific/Auckland' });

      if (dateStr !== lastDateStr) {
        html += `<div class="tl-date-sep">${dateStr}</div>`;
        lastDateStr = dateStr;
      }

      // Source pill
      const srcParts = [];
      if (ev.source) srcParts.push(utmTranslate('utm_source', ev.source));
      const detail = ev.campaign || ev.content || '';
      if (detail) srcParts.push(utmTranslateAny(detail));
      const pill = srcParts.length
        ? `<span style="display:inline-block;background:var(--sage);color:var(--bg);font-size:0.6rem;font-weight:600;padding:0.1rem 0.4rem;border-radius:9999px;">${srcParts.join(' – ')}</span>`
        : ev.referrer
          ? `<span style="display:inline-block;background:var(--border);color:var(--text);font-size:0.6rem;font-weight:600;padding:0.1rem 0.4rem;border-radius:9999px;">${ev.referrer}</span>`
          : '';

      if (ev.type === 'session') {
        html += `<div class="tl-node">
          <div class="tl-dot" style="background:var(--dim);"></div>
          <div class="tl-session-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <span style="color:var(--muted);">Website visit</span>
              ${pill}
              <span style="color:var(--dim);font-size:0.65rem;">${timeStr}${ev.duration ? ' · ' + ev.duration + 's' : ''}</span>
            </div>
            <div class="tl-pages">${ev.pages.map(p => `<span class="tl-page">${p}</span>`).join('')}</div>
          </div>
        </div>`;
      } else if (ev.type === 'order') {
        const items = ev.items;
        const itemStr = items.map(li => `<span style="font-size:0.75rem;">${li.quantity}x ${li.description || li.sku || '?'}</span>`).join('<br>');
        const ship = getShipStatus(ev.order);
        const shipPill = ship ? `<span class="ship-status-badge ${(ship._shipping_status || '').toLowerCase().replace(/\\s+/g, '-')}" style="font-size:0.6rem;">${ship._shipping_status}</span>` : '';

        html += `<div class="tl-node">
          <div class="tl-dot" style="background:var(--sage);"></div>
          <div class="tl-order-card" onclick="document.getElementById('customer-timeline-modal').classList.remove('open'); openOrderModal(${ev.order.id});">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.4rem;">
              <span style="font-weight:700;color:var(--sage);">Order #${ev.order.id}</span>
              ${pill}
              ${shipPill}
              ${daysWaitingBadge(ev.order)}
              <span style="color:var(--dim);font-size:0.65rem;">${timeStr}</span>
            </div>
            <div style="margin-bottom:0.3rem;">${itemStr}</div>
            <div style="font-weight:700;font-size:0.9rem;color:var(--text);">$${Number(ev.order.total_value || 0).toFixed(2)}</div>
          </div>
        </div>`;
      } else if (ev.type === 'email') {
        const em = ev.email;
        const dirColor = em.direction === 'outbound' ? 'var(--sage)' : 'var(--honey)';
        const sendType = em.send_type || 'direct';
        const typeColors = { direct: { bg:'rgba(140,180,122,0.15)', fg:'var(--sage)' }, bulk: { bg:'rgba(212,168,75,0.15)', fg:'var(--honey)' }, automated: { bg:'rgba(180,140,210,0.15)', fg:'#b48cd2' } };
        const tc = typeColors[sendType] || typeColors.direct;
        const typeLabel = sendType.charAt(0).toUpperCase() + sendType.slice(1);
        const staffBadge = em.staff_name ? `<span class="comms-staff-badge">${em.staff_name}</span>` : '';
        const emailId = 'tl-email-' + em.id;
        const bodyText = (em.body_text || em.snippet || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
        html += `<div class="tl-node">
          <div class="tl-dot" style="background:${dirColor};"></div>
          <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:0.75rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <span style="cursor:pointer;background:${tc.bg};color:${tc.fg};padding:0.15rem 0.5rem;border-radius:9999px;font-size:0.7rem;font-weight:600;" onclick="event.stopPropagation();var el=document.getElementById('${emailId}');el.style.display=el.style.display==='none'?'block':'none';">${typeLabel}</span>
              ${staffBadge}
              <span style="color:var(--dim);font-size:0.65rem;">${timeStr}</span>
            </div>
            <div style="font-size:0.8rem;color:var(--muted);margin-top:0.25rem;">${(em.subject || '(no subject)').replace(/</g, '&lt;')}</div>
            <div id="${emailId}" style="display:none;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);font-size:0.8rem;color:var(--text);line-height:1.5;">
              <div style="font-weight:600;margin-bottom:0.25rem;color:var(--muted);font-size:0.75rem;">Subject: ${(em.subject || '').replace(/</g, '&lt;')}</div>
              <div>${bodyText || '<span style="color:var(--dim);">(no content)</span>'}</div>
            </div>
          </div>
        </div>`;
      }
    });

    html += '</div>';

    // Total at bottom
    html += `<div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:0.8rem;color:var(--muted);">Lifetime Total</span>
      <span style="font-size:1.25rem;font-weight:700;color:var(--sage);">${fmt_money(totalSpend)}</span>
    </div>`;

    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<span style="color:var(--red);">Failed to load timeline: ${e.message}</span>`;
  }
}

// Attach customer tab events
document.getElementById('customer-search').addEventListener('input', () => { customersPage = 1; renderCustomersTab(); });
document.getElementById('customer-sort').addEventListener('change', () => { customersPage = 1; renderCustomersTab(); });

// Segment filter events
['seg-type', 'seg-spend', 'seg-orders', 'seg-recency', 'seg-city', 'seg-source', 'seg-tag'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => { customersPage = 1; renderCustomersTab(); });
});
document.getElementById('seg-saved').addEventListener('change', (e) => loadSegment(e.target.value));
document.getElementById('seg-save-btn').addEventListener('click', saveSegment);
document.getElementById('seg-clear-btn').addEventListener('click', clearSegmentFilters);

// ── Shipping Tab ──
const ESHIP_PROXY = '/.netlify/functions/eship-orders';
let shippingLoaded = false;
let allShipments = [];
let activeShipFilter = '';

async function loadShippingData() {
  const tbody = document.getElementById('shipments-table');
  tbody.innerHTML = '<tr><td colspan="9" class="loading">Loading shipping data...</td></tr>';

  try {
    const res = await fetch(ESHIP_PROXY + '?limit=500');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    allShipments = data.orders || [];
    shippingLoaded = true;
    syncDeliveredOrders();
    renderShippingStats(data);
    renderShippingStatusChart();
    renderShipTimeChart();
    renderFulfillmentTrend();
    renderShipmentsTable();

    // Attach search + filter handlers
    document.getElementById('shipment-search').addEventListener('input', () => { shipmentsPage = 1; renderShipmentsTable(); });
    // In bulk bag mode, Enter in search bar treats input as barcode scan
    document.getElementById('shipment-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && bulkBagMode && bulkBagSize) {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) { handleBulkBagScan(val); e.target.value = ''; shipmentsPage = 1; renderShipmentsTable(); }
      }
    });
    document.getElementById('shipment-status-filter').addEventListener('change', (e) => {
      activeShipFilter = e.target.value;
      shipmentsPage = 1;
      renderShippingStats({});
      renderShipmentsTable();
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading">Error loading shipping data: ${err.message}</td></tr>`;
  }
}

let shipSummary = {};
function renderShippingStats(data) {
  // Use summary from API for accurate total counts across all pages
  if (data.summary) shipSummary = data.summary;
  const waitingToPrint = shipSummary.waiting_to_print || allShipments.filter(o => o._shipping_status === 'Waiting to Print').length;
  const printed = shipSummary.printed || allShipments.filter(o => o._shipping_status === 'Printed').length;
  const inTransit = allShipments.filter(o => o._shipping_status === 'In Transit').length;
  const delivered = allShipments.filter(o => o._shipping_status === 'Delivered').length;
  const exception = allShipments.filter(o => o._shipping_status === 'Exception').length;

  // Avg days to ship (order → dispatch)
  let shipDays = [];
  allShipments.forEach(o => {
    if (o.order_date && o.shipped_date) {
      const diff = (new Date(o.shipped_date) - new Date(o.order_date)) / 86400000;
      if (diff >= 0 && diff < 365) shipDays.push(diff);
    }
  });
  const avgShipDays = shipDays.length > 0 ? (shipDays.reduce((a,b)=>a+b,0) / shipDays.length).toFixed(2) : '-';

  // Avg delivery time (dispatch → delivered)
  let deliveryDays = [];
  allShipments.forEach(o => {
    if (o._shipping_status === 'Delivered' && o.shipped_date && o.delivered_date) {
      const diff = (new Date(o.delivered_date) - new Date(o.shipped_date)) / 86400000;
      if (diff >= 0 && diff < 60) deliveryDays.push(diff);
    }
  });
  const avgDeliveryDays = deliveryDays.length > 0 ? (deliveryDays.reduce((a,b)=>a+b,0) / deliveryDays.length).toFixed(2) : '-';

  // IO's this month: orders placed this month with "Incorrect Order" status
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const iosThisMonth = allOrders.filter(o => o.order_date >= monthStart && (o.status || '').toLowerCase() === 'incorrect order').length;

  // Awaiting stock count + breakdown
  const awaitingOrders = allOrders.filter(o => o.awaiting_sku);
  const awaitingCount = awaitingOrders.length;
  let awaitingSub = 'orders on hold';
  if (awaitingCount > 0) {
    const bysku = {};
    awaitingOrders.forEach(o => { bysku[o.awaiting_sku] = (bysku[o.awaiting_sku] || 0) + 1; });
    const top = Object.entries(bysku).sort((a, b) => b[1] - a[1]).slice(0, 3);
    awaitingSub = top.map(([sku, n]) => `${n}x ${sku}`).join(', ');
  }

  const stats = [
    { label: 'Waiting to Print', value: waitingToPrint, sub: 'needs printing', color: 'var(--amber)', filter: 'Waiting to Print' },
    { label: 'Printed', value: printed, sub: 'ready to ship', color: '#facc15', filter: 'Printed' },
    { label: 'In Transit', value: inTransit, sub: 'dispatched', color: 'var(--blue)', filter: 'In Transit' },
    { label: 'Delivered', value: delivered, sub: 'completed', color: 'var(--green)', filter: 'Delivered' },
    { label: 'Exception', value: exception, sub: 'needs attention', color: '#fca5a5', filter: 'Exception' },
    { label: 'Awaiting Stock', value: awaitingCount, sub: awaitingSub, color: 'var(--amber)', filter: 'Awaiting Stock' },
    { label: 'Avg Ship Time', value: avgShipDays === '-' ? '-' : avgShipDays + 'd', sub: 'order → dispatch', color: 'var(--cyan)', filter: '' },
    { label: 'Avg Delivery', value: avgDeliveryDays === '-' ? '-' : avgDeliveryDays + 'd', sub: 'dispatch → delivered', color: 'var(--green)', filter: '' },
    { label: "IO's This Month", value: iosThisMonth, sub: 'incorrect orders', color: 'var(--amber)', filter: '' },
  ];

  document.getElementById('shipping-stats').innerHTML = stats.map(s => `
    <div class="stat-card${activeShipFilter === s.filter && s.filter ? ' active-filter' : ''}" ${s.filter ? `onclick="setShipFilter('${s.filter}')"` : ''} style="${s.filter ? 'cursor:pointer' : ''}">
      <div class="label">${s.label}</div>
      <div class="value" style="color:${s.color}">${s.value}</div>
      <div class="sub">${s.sub}</div>
    </div>
  `).join('');
}

function setShipFilter(status) {
  activeShipFilter = activeShipFilter === status ? '' : status;
  document.getElementById('shipment-status-filter').value = activeShipFilter;
  shipmentsPage = 1;
  renderShippingStats({});
  renderShipmentsTable();
}

function renderShippingStatusChart() {
  // Fixed order and colors for statuses
  const statusOrder = ['Waiting to Print', 'Printed', 'In Transit', 'Delivered', 'Exception'];
  const statusColors = { 'Waiting to Print': '#D4A84B', 'Printed': '#DBBFA8', 'In Transit': '#6B8F5B', 'Delivered': '#8CB47A', 'Exception': '#B84233' };

  const statusCounts = {};
  allShipments.forEach(o => {
    const s = o._shipping_status || 'Unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  const labels = statusOrder.filter(s => statusCounts[s]);
  const data = labels.map(s => statusCounts[s]);
  const colors = labels.map(s => statusColors[s]);

  if (charts.shipStatus) charts.shipStatus.destroy();
  charts.shipStatus = new Chart(document.getElementById('shipping-status-chart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' }, padding: 6, boxWidth: 12 } } } },
  });
}

function renderShipTimeChart() {
  // Show distribution of days-to-ship as a bar chart
  const buckets = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  allShipments.forEach(o => {
    if (o.order_date && o.shipped_date) {
      const diff = Math.floor((new Date(o.shipped_date) - new Date(o.order_date)) / 86400000);
      if (diff < 0 || diff > 365) return;
      if (diff >= 5) buckets['5+']++;
      else buckets[String(diff)]++;
    }
  });

  if (charts.shipTime) charts.shipTime.destroy();
  charts.shipTime = new Chart(document.getElementById('ship-time-chart'), {
    type: 'bar',
    data: {
      labels: Object.keys(buckets).map(k => k + (k !== '5+' ? ' day' + (k !== '1' ? 's' : '') : '')),
      datasets: [{ label: 'Orders', data: Object.values(buckets), backgroundColor: '#8CB47A', borderRadius: 6 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: {
      y: { ticks: { color: '#9c9287' }, grid: { color: '#252220' } },
      x: { ticks: { color: '#9c9287' }, grid: { display: false } },
    }},
  });
}

function renderFulfillmentTrend() {
  // Group shipments by week and calculate avg days to ship per week
  const weekData = {};
  allShipments.forEach(o => {
    if (!o.order_date || !o.shipped_date) return;
    const diff = (new Date(o.shipped_date) - new Date(o.order_date)) / 86400000;
    if (diff < 0 || diff > 365) return;
    // Get ISO week start (Monday)
    const d = new Date(o.shipped_date);
    const day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() + mondayOffset);
    const key = weekStart.toISOString().split('T')[0];
    if (!weekData[key]) weekData[key] = { total: 0, count: 0 };
    weekData[key].total += diff;
    weekData[key].count++;
  });

  const sortedWeeks = Object.keys(weekData).sort();
  if (sortedWeeks.length < 2) return; // Need at least 2 weeks for a trend

  const labels = sortedWeeks.map(w => {
    const d = new Date(w);
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  });
  const avgDays = sortedWeeks.map(w => +(weekData[w].total / weekData[w].count).toFixed(2));

  if (charts.fulfillmentTrend) charts.fulfillmentTrend.destroy();
  charts.fulfillmentTrend = new Chart(document.getElementById('fulfillment-trend-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Avg Days to Ship',
        data: avgDays,
        borderColor: '#8CB47A',
        backgroundColor: 'rgba(140,180,122,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#8CB47A',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { title: { display: true, text: 'Days', color: '#9c9287', font: { size: 11, family: 'DM Sans' } }, ticks: { color: '#9c9287' }, grid: { color: '#252220' } },
        x: { ticks: { color: '#9c9287', maxRotation: 45 }, grid: { display: false } },
      },
    },
  });
}

function renderShipmentsTable() {
  const tbody = document.getElementById('shipments-table');
  const query = (document.getElementById('shipment-search').value || '').toLowerCase();

  // Add/remove checkbox column header for bulk bag mode
  const thead = tbody.closest('table').querySelector('thead tr');
  const existingCheckTh = thead.querySelector('.bulk-bag-th');
  if (bulkBagMode && !existingCheckTh) {
    const th = document.createElement('th');
    th.className = 'bulk-bag-th';
    th.style.width = '2rem';
    thead.insertBefore(th, thead.firstChild);
  } else if (!bulkBagMode && existingCheckTh) {
    existingCheckTh.remove();
  }

  let orders = allShipments;
  if (activeShipFilter === 'Awaiting Stock') {
    orders = orders.filter(o => {
      const m = allOrders.find(ord => ord.order_number === o.order_number || ord.stripe_session_id === o.order_number);
      return m && m.awaiting_sku;
    });
  } else if (activeShipFilter) {
    orders = orders.filter(o => o._shipping_status === activeShipFilter);
  }
  if (query) {
    orders = orders.filter(o => {
      const fields = [
        o.order_number, o.name, o.destination?.name,
        o.destination?.city, o.tracking_number,
        ...(o.tracking_numbers || []),
        o.carrier_name, o.carrier,
      ].filter(Boolean).join(' ').toLowerCase();
      return fields.includes(query);
    });
  }

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">No shipments found</td></tr>';
    renderPagination('shipments-pagination', 1, 0, () => {});
    return;
  }

  // In bulk bag mode, sort checked orders to the top
  if (bulkBagMode && bulkBagOrderIds.length > 0) {
    orders.sort((a, b) => {
      const aChecked = bulkBagOrderIds.includes(a.order_id || a.id || 0) ? 0 : 1;
      const bChecked = bulkBagOrderIds.includes(b.order_id || b.id || 0) ? 0 : 1;
      return aChecked - bChecked;
    });
  }

  const start = (shipmentsPage - 1) * PAGE_SIZE;
  tbody.innerHTML = orders.slice(start, start + PAGE_SIZE).map(o => {
    const dest = o.destination || {};
    const status = o._shipping_status || '-';
    const statusClass = status.toLowerCase().replace(/\s+/g, '-');
    const carrier = o.carrier_name || o.carrier || '-';
    const tracking = o.tracking_number || o.tracking_numbers?.[0] || '';
    const trackUrl = o.tracking_url || (tracking ? `https://www.nzpost.co.nz/tools/tracking/item/${tracking}` : '');
    const date = o.shipped_date || o.order_date || '-';
    const displayDate = date !== '-' ? new Date(date).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '-';

    // Match to order data for $ value, # items, days waiting badge
    const matched = allOrders.find(ord => ord.order_number === o.order_number || ord.stripe_session_id === o.order_number);
    const orderValue = matched ? '$' + Number(matched.total_value || 0).toFixed(2) : '-';
    const itemCount = matched ? allLineItems.filter(li => li.order_id === matched.id).reduce((s, li) => s + (li.quantity || 1), 0) : '-';
    const badge = matched ? daysWaitingBadge(matched) : '';
    const clippedOrder = (o.order_number || '-').length > 12 ? (o.order_number.slice(0, 12) + '…') : (o.order_number || '-');

    // Show awaiting badge inline with status
    const awaitingBadge = matched && matched.awaiting_sku ? ` <span class="ship-status-badge awaiting-stock">Awaiting: ${matched.awaiting_sku}</span>` : '';
    const clickHandler = matched ? `onclick="openOrderModal(${matched.id})" style="cursor:pointer;"` : '';

    // Checkbox for bulk bag mode — only for unshipped/printed orders
    const shipOrderId = o.order_id || o.id || 0;
    const canChangeBag = ['Waiting to Print', 'Printed'].includes(status);
    const checkboxTd = bulkBagMode ? `<td onclick="event.stopPropagation();" style="text-align:center;width:2rem;">${canChangeBag ? `<input type="checkbox" class="bulk-bag-check" data-order-id="${shipOrderId}" ${bulkBagOrderIds.includes(shipOrderId) ? 'checked' : ''} onchange="toggleBulkBagOrder(${shipOrderId}, this.checked)" style="cursor:pointer;width:16px;height:16px;accent-color:var(--cyan);">` : '<span style="color:var(--dim);font-size:0.7rem;">—</span>'}</td>` : '';

    return `<tr ${clickHandler}>
      ${checkboxTd}
      <td title="${o.order_number || ''}" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${clippedOrder}</td>
      <td>${dest.name || o.name || '-'}</td>
      <td>${[dest.city, dest.country_code || dest.country].filter(Boolean).join(', ') || '-'}</td>
      <td>${orderValue}</td>
      <td style="text-align:center;">${itemCount}</td>
      <td>${carrier}</td>
      <td>${tracking ? `<a class="tracking-link" href="${trackUrl}" target="_blank" rel="noopener">${tracking}</a>` : '-'}</td>
      <td><span class="ship-status-badge ${statusClass}">${status}</span> ${badge}${awaitingBadge}</td>
      <td>${displayDate}</td>
    </tr>`;
  }).join('');

  renderPagination('shipments-pagination', shipmentsPage, orders.length, p => { shipmentsPage = p; renderShipmentsTable(); });
}

// ── eShip Print ──
document.getElementById('eship-print-btn').addEventListener('click', async () => {
  const waitingOrders = allShipments.filter(o => o._shipping_status === 'Waiting to Print');
  if (waitingOrders.length === 0) {
    alert('No orders waiting to print.');
    return;
  }
  if (!confirm(`Print ${waitingOrders.length} unprinted order${waitingOrders.length !== 1 ? 's' : ''} via eShip?\n\nLabels will be sent to the printer connected to the eShip Desktop Agent.`)) return;

  const btn = document.getElementById('eship-print-btn');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Printing...';
  btn.style.opacity = '0.6';

  const orderIds = waitingOrders.map(o => o.order_id || o.id).filter(Boolean);
  try {
    const res = await fetch('/.netlify/functions/eship-print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_ids: orderIds }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Print failed');
    let msg = `${data.printed} order${data.printed !== 1 ? 's' : ''} sent to printer.`;
    if (data.failed && data.failed.length > 0) {
      const errors = data.failed.map(f => {
        const errMsg = f.result?.errors?.[0]?.details || f.result?.errors?.[0]?.message || f.error || 'Unknown error';
        return `Order ${f.order_id}: ${errMsg}`;
      }).join('\n');
      msg += `\n\n${data.failed.length} failed:\n${errors}`;
      // Auto-update order status for address errors
      for (const f of data.failed) {
        const errDetail = (f.result?.errors?.[0]?.details || f.result?.errors?.[0]?.message || '').toLowerCase();
        if (errDetail.includes('address') || errDetail.includes('postcode') || errDetail.includes('town')) {
          const shipment = allShipments.find(s => s.order_id === f.order_id);
          if (shipment) {
            const order = allOrders.find(o => o.stripe_session_id === shipment.order_number || o.order_number === shipment.order_number);
            if (order) {
              await db.from('orders').update({ status: 'Invalid Address - Fix in eShip' }).eq('id', order.id);
              order.status = 'Invalid Address - Fix in eShip';
            }
          }
        }
      }
    }
    alert(msg);
    await loadShippingData();
  } catch (err) {
    alert('Print failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
    btn.style.opacity = '1';
  }
});

// ── Awaiting Stock ──
let awaitingPickerOrderNumber = null;
let bulkAwaitingMode = false;
let bulkAwaitingSku = null;
let bulkAwaitingCount = 0;
let scannerActive = false;

function getSkuDesc(sku) {
  const p = SHOP_PRODUCTS.find(p => p.sku === sku);
  return p ? p.desc : sku;
}

function openAwaitingPicker(orderNumber) {
  awaitingPickerOrderNumber = orderNumber;
  const list = document.getElementById('awaiting-sku-list');
  list.innerHTML = SHOP_PRODUCTS.map(p => `
    <div class="sku-option" onclick="pickAwaitingSku('${p.sku}')">
      <span>${p.desc}</span>
      <span class="sku-code">${p.sku}</span>
    </div>
  `).join('');
  document.getElementById('awaiting-sku-modal').classList.add('open');
}

function closeAwaitingModal() {
  document.getElementById('awaiting-sku-modal').classList.remove('open');
  awaitingPickerOrderNumber = null;
}

async function pickAwaitingSku(sku) {
  if (bulkAwaitingMode) {
    // Entering bulk mode - SKU selected
    bulkAwaitingSku = sku;
    closeAwaitingModal();
    startBulkScanning();
    return;
  }
  if (!awaitingPickerOrderNumber) return;
  const orderNum = awaitingPickerOrderNumber;
  closeAwaitingModal();
  await setAwaitingSku(orderNum, sku);
  // Re-open the order modal to show updated state
  const order = allOrders.find(o => o.order_number === orderNum || o.stripe_session_id === orderNum);
  if (order && document.getElementById('order-modal').classList.contains('open')) {
    openOrderModal(order.id);
  }
}

async function setAwaitingSku(orderNumber, sku) {
  const order = allOrders.find(o => o.order_number === orderNumber || o.stripe_session_id === orderNumber);
  if (!order) { console.warn('Order not found:', orderNumber); return false; }
  const { error } = await db.from('orders').update({ awaiting_sku: sku }).eq('id', order.id);
  if (error) { alert('Failed to set awaiting: ' + error.message); return false; }
  order.awaiting_sku = sku;
  renderShippingStats({});
  renderShipmentsTable();
  return true;
}

async function clearAwaitingSku(orderNumber) {
  const order = allOrders.find(o => o.order_number === orderNumber || o.stripe_session_id === orderNumber);
  if (!order) return;
  const { error } = await db.from('orders').update({ awaiting_sku: null }).eq('id', order.id);
  if (error) { alert('Failed to clear awaiting: ' + error.message); return; }
  order.awaiting_sku = null;
  renderShippingStats({});
  renderShipmentsTable();
}

async function clearAllAwaitingForSku(sku) {
  const awaiting = allOrders.filter(o => o.awaiting_sku === sku);
  if (!awaiting.length) return;
  if (!confirm(`Clear "Awaiting Stock" for ${awaiting.length} order${awaiting.length !== 1 ? 's' : ''} awaiting ${sku}?`)) return;
  for (const order of awaiting) {
    await db.from('orders').update({ awaiting_sku: null }).eq('id', order.id);
    order.awaiting_sku = null;
  }
  renderShippingStats({});
  renderShipmentsTable();
  if (typeof renderQueuedBatches === 'function') renderQueuedBatches();
  if (typeof renderMfgStats === 'function') renderMfgStats();
}

// ── Barcode Scanner ──
document.getElementById('barcode-scan-btn').addEventListener('click', () => {
  toggleScanner();
});

function toggleScanner() {
  scannerActive = !scannerActive;
  const btn = document.getElementById('barcode-scan-btn');
  btn.classList.toggle('active', scannerActive);
  if (scannerActive) {
    document.getElementById('barcode-input').value = '';
    document.getElementById('barcode-input').focus();
  } else {
    document.getElementById('barcode-input').blur();
  }
}

document.getElementById('barcode-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = this.value.trim();
    this.value = '';
    if (!val) return;

    if (bulkBagMode && bulkBagSize) {
      // Bulk bag size mode: update scanned order's bag size
      handleBulkBagScan(val);
    } else if (bulkAwaitingMode && bulkAwaitingSku) {
      // Bulk mode: tag the scanned order
      handleBulkScan(val);
    } else {
      // Normal mode: search/filter by scanned barcode
      // Try the raw value first; if no results, try extracting NZ Post tracking number
      let searchVal = val;
      document.getElementById('shipment-search').value = searchVal;
      shipmentsPage = 1;
      renderShipmentsTable();

      // If no results found with full barcode, try extracting tracking number patterns
      const visibleRows = document.getElementById('shipments-table').querySelectorAll('tr:not(.loading)');
      if (visibleRows.length === 0 || (visibleRows.length === 1 && visibleRows[0].querySelector('.loading'))) {
        // NZ Post tracking: typically 2 letters + 9 digits + 2 letters (e.g. LN123456789NZ)
        const nzPostMatch = val.match(/[A-Z]{2}\d{9}[A-Z]{2}/i);
        if (nzPostMatch && nzPostMatch[0] !== val) {
          searchVal = nzPostMatch[0];
          document.getElementById('shipment-search').value = searchVal;
          renderShipmentsTable();
        }
      }

      const table = document.getElementById('shipments-table');
      table.classList.add('scan-flash');
      setTimeout(() => table.classList.remove('scan-flash'), 400);
    }
    // Re-focus for next scan
    setTimeout(() => this.focus(), 50);
  }
});

// Keep scanner focused when clicking elsewhere in shipping tab
// But NOT during bulk bag mode — search bar needs to stay usable
document.getElementById('barcode-input').addEventListener('blur', function() {
  if ((scannerActive || bulkAwaitingMode) && !bulkBagMode) {
    setTimeout(() => {
      if ((scannerActive || bulkAwaitingMode) && !bulkBagMode) this.focus();
    }, 100);
  }
});

// ── Bulk Awaiting Mode ──
document.getElementById('bulk-awaiting-btn').addEventListener('click', () => {
  if (bulkAwaitingMode) { exitBulkAwaitingMode(); return; }
  // Open SKU picker in bulk mode
  bulkAwaitingMode = true;
  openAwaitingPicker(null);
});

function startBulkScanning() {
  bulkAwaitingCount = 0;
  document.getElementById('bulk-sku-label').textContent = bulkAwaitingSku;
  document.getElementById('bulk-count').textContent = '0';
  document.getElementById('bulk-banner').classList.add('active');
  scannerActive = true;
  document.getElementById('barcode-scan-btn').classList.add('active');
  document.getElementById('barcode-input').value = '';
  document.getElementById('barcode-input').focus();
}

async function handleBulkScan(scannedValue) {
  // Try to match to a shipment by order number, tracking number, or NZ Post barcode
  const val = scannedValue.trim();
  const nzPostMatch = val.match(/[A-Z]{2}\d{9}[A-Z]{2}/i);
  const trackingVal = nzPostMatch ? nzPostMatch[0].toUpperCase() : null;
  const valUpper = val.toUpperCase();
  const shipment = allShipments.find(s =>
    s.order_number === val ||
    (s.tracking_number && (s.tracking_number === val || s.tracking_number.toUpperCase() === valUpper)) ||
    (trackingVal && s.tracking_number && s.tracking_number.toUpperCase() === trackingVal) ||
    (s.tracking_number && val.length >= 6 && (val.includes(s.tracking_number) || s.tracking_number.includes(val))) ||
    (s.tracking_numbers && s.tracking_numbers.some(t => t === val || t.toUpperCase() === valUpper || val.includes(t) || t.includes(val)))
  );
  if (!shipment) {
    const table = document.getElementById('shipments-table');
    table.classList.add('scan-flash-err');
    setTimeout(() => table.classList.remove('scan-flash-err'), 400);
    return;
  }

  const order = allOrders.find(o => o.order_number === shipment.order_number || o.stripe_session_id === shipment.order_number);
  if (!order) {
    const table = document.getElementById('shipments-table');
    table.classList.add('scan-flash-err');
    setTimeout(() => table.classList.remove('scan-flash-err'), 400);
    return;
  }

  if (order.awaiting_sku === bulkAwaitingSku) {
    // Already tagged with same SKU, skip
    return;
  }

  const ok = await setAwaitingSku(shipment.order_number, bulkAwaitingSku);
  if (ok) {
    bulkAwaitingCount++;
    document.getElementById('bulk-count').textContent = bulkAwaitingCount;
    const table = document.getElementById('shipments-table');
    table.classList.add('scan-flash');
    setTimeout(() => table.classList.remove('scan-flash'), 400);
  }
}

function exitBulkAwaitingMode() {
  const count = bulkAwaitingCount;
  const sku = bulkAwaitingSku;
  bulkAwaitingMode = false;
  bulkAwaitingSku = null;
  bulkAwaitingCount = 0;
  scannerActive = false;
  document.getElementById('bulk-banner').classList.remove('active');
  document.getElementById('barcode-scan-btn').classList.remove('active');
  document.getElementById('barcode-input').blur();
  renderShippingStats({});
  renderShipmentsTable();
  if (count > 0) {
    alert(`Tagged ${count} order${count !== 1 ? 's' : ''} as awaiting ${sku}.`);
  }
}

// ── Bulk Bag Size Mode ──
let bulkBagMode = false;
let bulkBagSize = null;
let bulkBagSizeLabel = null;
let bulkBagCount = 0;
let bulkBagOrderIds = [];

const BAG_SIZE_MAP = {
  CPOLTPDL: 'DL',
  CPOLTPA5: 'A5',
  CPOLTPA4: 'A4',
  CPOLTPA3: 'Foolscap',
};

function closeBagSizeModal() {
  document.getElementById('bag-size-modal').classList.remove('open');
  if (bulkBagMode && !bulkBagSize) {
    bulkBagMode = false;
  }
}

function pickBagSize(code) {
  document.getElementById('bag-size-modal').classList.remove('open');
  if (!bulkBagMode) return;
  bulkBagSize = code;
  bulkBagSizeLabel = BAG_SIZE_MAP[code] || code;
  startBulkBagScanning();
}

document.getElementById('bulk-bag-btn').addEventListener('click', () => {
  if (bulkBagMode) { exitBulkBagMode(); return; }
  bulkBagMode = true;
  document.getElementById('bag-size-modal').classList.add('open');
});

function startBulkBagScanning() {
  bulkBagCount = 0;
  bulkBagOrderIds = [];
  document.getElementById('bulk-bag-label').textContent = bulkBagSizeLabel;
  document.getElementById('bulk-bag-count').textContent = '0';
  document.getElementById('bulk-bag-status').textContent = 'Tick orders or scan barcodes to select';
  document.getElementById('bulk-bag-print').style.display = 'none';
  document.getElementById('bulk-bag-banner').classList.add('active');
  renderShipmentsTable();
  // Auto-focus search bar after modal closes
  setTimeout(() => { document.getElementById('shipment-search').value = ''; document.getElementById('shipment-search').focus(); }, 300);
}

function toggleBulkBagOrder(orderId, checked) {
  if (checked && !bulkBagOrderIds.includes(orderId)) {
    bulkBagOrderIds.push(orderId);
  } else if (!checked) {
    bulkBagOrderIds = bulkBagOrderIds.filter(id => id !== orderId);
  }
  bulkBagCount = bulkBagOrderIds.length;
  document.getElementById('bulk-bag-count').textContent = bulkBagCount;
  if (bulkBagCount > 0) {
    document.getElementById('bulk-bag-status').innerHTML = bulkBagCount + ' selected — ready to update';
    document.getElementById('bulk-bag-print').style.display = '';
    document.getElementById('bulk-bag-print').textContent = 'Print ' + bulkBagCount + ' as ' + bulkBagSizeLabel;
  } else {
    document.getElementById('bulk-bag-status').textContent = 'Tick orders or scan barcodes to select';
    document.getElementById('bulk-bag-print').style.display = 'none';
  }
}

function handleBulkBagScan(scannedValue) {
  const val = scannedValue.trim();
  const valUpper = val.toUpperCase();
  const nzPostMatch = val.match(/[A-Z]{2}\d{9}[A-Z]{2}/i);
  const trackingVal = nzPostMatch ? nzPostMatch[0].toUpperCase() : null;
  const shipment = allShipments.find(s => {
    if (s.order_number === val) return true;
    // Exact tracking match
    if (s.tracking_number && (s.tracking_number === val || s.tracking_number.toUpperCase() === valUpper)) return true;
    // NZ Post letter pattern extracted from barcode
    if (trackingVal && s.tracking_number && s.tracking_number.toUpperCase() === trackingVal) return true;
    // Barcode contains tracking number or vice versa (for long NZ Post numeric barcodes)
    if (s.tracking_number && val.length >= 6 && (val.includes(s.tracking_number) || s.tracking_number.includes(val))) return true;
    // Check tracking_numbers array
    if (s.tracking_numbers && s.tracking_numbers.some(t => t === val || t.toUpperCase() === valUpper || val.includes(t) || t.includes(val))) return true;
    // Match by destination name (for manual search)
    const destName = (s.destination?.name || s.name || '').toLowerCase();
    if (destName && val.toLowerCase() === destName) return true;
    return false;
  });

  const table = document.getElementById('shipments-table');
  const shipOrderId = shipment ? (shipment.order_id || shipment.id) : null;
  if (!shipment || !shipOrderId) {
    table.classList.add('scan-flash-err');
    setTimeout(() => table.classList.remove('scan-flash-err'), 400);
    return;
  }

  // Toggle the checkbox for this order
  if (!bulkBagOrderIds.includes(shipOrderId)) {
    toggleBulkBagOrder(shipOrderId, true);
    // Tick the checkbox in the table if visible
    const cb = table.querySelector(`.bulk-bag-check[data-order-id="${shipOrderId}"]`);
    if (cb) cb.checked = true;
    table.classList.add('scan-flash');
    setTimeout(() => table.classList.remove('scan-flash'), 400);
  }
}

// Print handler for bulk bag mode — prints with carrier_service_code directly
document.getElementById('bulk-bag-print').addEventListener('click', async () => {
  const btn = document.getElementById('bulk-bag-print');
  const statusEl = document.getElementById('bulk-bag-status');
  if (bulkBagOrderIds.length === 0) return;

  btn.disabled = true;
  statusEl.innerHTML = '<span style="color:var(--dim);">Printing ' + bulkBagOrderIds.length + ' as ' + bulkBagSizeLabel + '...</span>';
  btn.textContent = 'Printing...';

  try {
    const res = await fetch('/.netlify/functions/eship-print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_ids: bulkBagOrderIds, carrier_service_code: bulkBagSize }),
    });
    const data = await res.json();
    if (data.success || data.printed !== undefined) {
      const printCount = data.printed || 0;
      let msg = `Printed ${printCount} label${printCount !== 1 ? 's' : ''} as ${bulkBagSizeLabel}.`;
      if (data.failed && data.failed.length > 0) {
        const errors = data.failed.map(f => {
          const errMsg = f.result?.errors?.[0]?.details || f.result?.errors?.[0]?.message || f.error || 'Unknown error';
          return `Order ${f.order_id}: ${errMsg}`;
        }).join('\n');
        msg += `\n\n${data.failed.length} failed:\n${errors}`;
        // Auto-set invalid address status for failed orders
        for (const f of data.failed) {
          const errDetail = (f.result?.errors?.[0]?.details || f.result?.errors?.[0]?.message || '').toLowerCase();
          if (errDetail.includes('address') || errDetail.includes('postcode') || errDetail.includes('town')) {
            const shipment = allShipments.find(s => s.order_id === f.order_id);
            if (shipment) {
              const order = allOrders.find(o => o.stripe_session_id === shipment.order_number || o.order_number === shipment.order_number);
              if (order) {
                db.from('orders').update({ status: 'Invalid Address - Fix in eShip' }).eq('id', order.id);
                order.status = 'Invalid Address - Fix in eShip';
              }
            }
          }
        }
      }
      alert(msg);
      exitBulkBagMode();
      loadShippingData();
      return;
    } else {
      statusEl.innerHTML = '<span style="color:var(--red);">Print failed: ' + (data.error || 'Unknown error') + '</span>';
    }
  } catch (e) {
    statusEl.innerHTML = '<span style="color:var(--red);">Print error: ' + e.message + '</span>';
  }
  btn.disabled = false;
  btn.textContent = 'Update ' + bulkBagCount + ' to ' + bulkBagSizeLabel + ' & Print';
});

function exitBulkBagMode() {
  bulkBagMode = false;
  bulkBagSize = null;
  bulkBagSizeLabel = null;
  bulkBagCount = 0;
  bulkBagOrderIds = [];
  document.getElementById('bulk-bag-banner').classList.remove('active');
  document.getElementById('barcode-input').blur();
  renderShipmentsTable();
}

// ── Queued Batches (Manufacturing) ──
function renderQueuedBatches() {
  const container = document.getElementById('mfg-queued-batches');
  const list = document.getElementById('mfg-queued-list');
  if (!container || !list) return;

  const awaiting = allOrders.filter(o => o.awaiting_sku);
  if (!awaiting.length) { container.style.display = 'none'; return; }

  // Group by SKU
  const bysku = {};
  awaiting.forEach(o => {
    if (!bysku[o.awaiting_sku]) bysku[o.awaiting_sku] = [];
    bysku[o.awaiting_sku].push(o);
  });

  const skus = Object.keys(bysku).sort((a, b) => bysku[b].length - bysku[a].length);
  list.innerHTML = skus.map(sku => {
    const orders = bysku[sku];
    const desc = getSkuDesc(sku);
    return `<div class="queued-sku-card">
      <div class="queued-sku-info">
        <div class="queued-sku-name">${desc}</div>
        <div class="queued-sku-count">${orders.length} order${orders.length !== 1 ? 's' : ''} awaiting ${sku}</div>
      </div>
      <div class="queued-sku-actions">
        <button class="queued-batch-btn" onclick="prefillBatchForSku('${sku}')">+ Batch</button>
        <button class="queued-clear-btn" onclick="clearAllAwaitingForSku('${sku}')">Clear All</button>
      </div>
    </div>`;
  }).join('');
  container.style.display = '';
}

function prefillBatchForSku(sku) {
  // Switch to batches sub-tab if not already there
  document.querySelectorAll('[data-mfg-panel]').forEach(btn => btn.classList.toggle('active', btn.dataset.mfgPanel === 'batches'));
  document.querySelectorAll('[id^="mfg-panel-"]').forEach(p => p.style.display = p.id === 'mfg-panel-batches' ? '' : 'none');
  // Pre-fill the SKU
  document.getElementById('mfg-sku').value = sku;
  document.getElementById('mfg-qty').focus();
}

// ── Manual Order ──
const SHOP_PRODUCTS = [
  { desc: 'Tallow Balm - Vanilla Rose 60ml', sku: 'Balm-VR60', price: 18.95 },
  { desc: 'Tallow Balm - Vanilla Rose 120ml', sku: 'Balm-VR120', price: 29.95 },
  { desc: 'Whipped Tallow Balm - Frankincense 250ml', sku: 'F250', price: 39.95 },
  { desc: 'Tallow & Honey Balm - Manuka & Vanilla Bean 120ml', sku: 'Balm-PG-VM120', price: 29.95 },
  { desc: 'Tallow Balm Trio - VVV 120ml', sku: 'trio-VVV-120', price: 47.95 },
  { desc: 'Tallow Balm Trio - VFL 120ml', sku: 'balm-trio-VFL120', price: 47.95 },
  { desc: 'Tallow Balm Trio - VVL 120ml', sku: 'trio-VVL-120', price: 47.95 },
  { desc: 'Tallow Shampoo Bar', sku: 'shampoo', price: 17.95 },
  { desc: 'Tallow Shampoo - Fresh Geranium - Bottle 500ml', sku: 'shampoo-bottle', price: 34.95 },
  { desc: 'Tallow Eye Cream', sku: 'eye-c', price: 34.95 },
  { desc: 'Day n Night Duo (Sunrise Glow + Midnight Mousse)', sku: 'day-night-duo', price: 54.95 },
  { desc: 'Night Cream 50ml - Reviana', sku: 'reviana-night', price: 49.95 },
  { desc: 'Complexion Bundle - Reviana', sku: 'reviana-complexion', price: 149.95 },
];

let manualCustomItems = [];

document.getElementById('manual-order-btn').addEventListener('click', () => {
  manualCustomItems = [];
  renderManualForm();
  document.getElementById('manual-order-modal').classList.add('open');
});
document.getElementById('manual-close').addEventListener('click', () => {
  document.getElementById('manual-order-modal').classList.remove('open');
});
document.getElementById('manual-order-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('manual-order-modal').classList.remove('open');
});

function renderManualForm() {
  const container = document.getElementById('mo-products');
  container.innerHTML = SHOP_PRODUCTS.map((p, i) => `
    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid var(--cream-deep);">
      <input type="number" id="mo-pqty-${i}" value="0" min="0" style="width:50px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.3rem;border-radius:4px;font-size:0.85rem;text-align:center;">
      <span style="flex:1;font-size:0.8rem;">${p.desc}</span>
      <span style="font-size:0.8rem;color:var(--muted);">$${p.price.toFixed(2)}</span>
    </div>
  `).join('');

  document.getElementById('mo-custom-items').innerHTML = '';
  document.getElementById('mo-result').innerHTML = '';
}

document.getElementById('mo-add-custom').addEventListener('click', () => {
  const desc = document.getElementById('mo-custom-desc').value.trim();
  const sku = document.getElementById('mo-custom-sku').value.trim();
  const qty = Number(document.getElementById('mo-custom-qty').value) || 1;
  const price = Number(document.getElementById('mo-custom-price').value) || 0;
  if (!desc) return;
  manualCustomItems.push({ desc, sku, qty, price });
  document.getElementById('mo-custom-desc').value = '';
  document.getElementById('mo-custom-sku').value = '';
  document.getElementById('mo-custom-qty').value = '1';
  document.getElementById('mo-custom-price').value = '';
  const container = document.getElementById('mo-custom-items');
  container.innerHTML = manualCustomItems.map((item, i) => `
    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;font-size:0.8rem;">
      <span>${item.qty}x ${item.desc} (${item.sku || 'no sku'}) — $${item.price.toFixed(2)}</span>
      <button onclick="manualCustomItems.splice(${i},1);this.parentElement.remove();" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:0.9rem;">&times;</button>
    </div>
  `).join('');
});

document.getElementById('mo-submit').addEventListener('click', async function() {
  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Creating...';
  const resultDiv = document.getElementById('mo-result');
  resultDiv.innerHTML = '';

  // Gather items from product picker
  const items = [];
  SHOP_PRODUCTS.forEach((p, i) => {
    const qty = Number(document.getElementById('mo-pqty-' + i)?.value) || 0;
    if (qty > 0) items.push({ description: p.desc, sku: p.sku, quantity: qty, unit_price: p.price });
  });
  // Add custom items
  manualCustomItems.forEach(ci => {
    items.push({ description: ci.desc, sku: ci.sku, quantity: ci.qty, unit_price: ci.price });
  });

  if (items.length === 0) {
    resultDiv.innerHTML = '<span style="color:var(--red);">Add at least one item</span>';
    btn.disabled = false;
    btn.textContent = 'Create Order';
    return;
  }

  const payload = {
    customer_name: document.getElementById('mo-name').value.trim(),
    email: document.getElementById('mo-email').value.trim(),
    phone: document.getElementById('mo-phone').value.trim(),
    payment_method: document.getElementById('mo-payment').value,
    street: document.getElementById('mo-street').value.trim(),
    suburb: document.getElementById('mo-suburb').value.trim(),
    city: document.getElementById('mo-city').value.trim(),
    postcode: document.getElementById('mo-postcode').value.trim(),
    shipping_cost: Number(document.getElementById('mo-shipping').value) || 0,
    notes: document.getElementById('mo-notes').value.trim(),
    items,
  };

  if (!payload.customer_name || !payload.email || !payload.city) {
    resultDiv.innerHTML = '<span style="color:var(--red);">Name, email, and city are required</span>';
    btn.disabled = false;
    btn.textContent = 'Create Order';
    return;
  }

  try {
    const res = await fetch('/.netlify/functions/manual-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    let msg = '';
    if (data.supabase?.success) msg += '<span style="color:var(--green);">Saved to database.</span> ';
    else msg += `<span style="color:var(--red);">DB error: ${data.supabase?.error || 'unknown'}</span> `;
    if (data.eship?.success) msg += '<span style="color:var(--green);">Pushed to eShip.</span>';
    else msg += `<span style="color:var(--amber);">eShip: ${data.eship?.error || 'skipped'}</span>`;

    resultDiv.innerHTML = msg;

    if (data.supabase?.success) {
      const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      logFrontendActivity('manual_order', `Created manual order for ${payload.customer_name} (${payload.email}) — $${total.toFixed(2)}, ${items.length} item(s)`);
      setTimeout(() => { initDashboard(); }, 1000);
    }
  } catch (err) {
    resultDiv.innerHTML = `<span style="color:var(--red);">Error: ${err.message}</span>`;
  }

  btn.disabled = false;
  btn.textContent = 'Create Order';
});

// ══════════════════════════════════════════
// ── Website Analytics Tab ──
// ══════════════════════════════════════════
(function() {
  const WA_API = '/.netlify/functions';
  let waLoaded = false, waChart = null, waRealtimeInterval = null;
  let waSite = '', waDateRange = 'today';
  let waFilters = []; // [{col:'referrer_domain', val:'google.com', label:'Referrer: google.com'}, ...]
  let waRevMaps = {}; // Revenue lookups by dimension, populated in waLoadDashboard
  let waView = 'traffic'; // 'traffic' or 'funnel'
  let waTrafficData = {}; // cached traffic-mode table data
  let waFunnelData = {}; // cached funnel-mode table data

  // Map table container IDs to filter column names
  const waFilterMap = {
    'wa-pages-table': { col: 'pathname', labelPrefix: 'Page' },
    'wa-referrers-table': { col: 'referrer_domain', labelPrefix: 'Referrer' },
    'wa-devices-table': { col: 'device_type', labelPrefix: 'Device' },
    'wa-browsers-table': { col: 'browser', labelPrefix: 'Browser' },
    'wa-countries-table': { col: 'country', labelPrefix: 'Country' },
    'wa-os-table': { col: 'os', labelPrefix: 'OS' },
    'wa-events-table': { col: 'event_name', labelPrefix: 'Event' },
  };

  function waAddFilter(col, val, labelPrefix) {
    // Remove existing filter on same column
    waFilters = waFilters.filter(f => f.col !== col);
    const displayVal = col.startsWith('utm_') || col.startsWith('ft_') || col.startsWith('lt_') ? utmTranslate(col, val) : val;
    waFilters.push({ col, val, label: labelPrefix + ': ' + displayVal });
    waRenderFilterBar();
    waLoadDashboard();
  }

  function waRemoveFilter(col) {
    waFilters = waFilters.filter(f => f.col !== col);
    waRenderFilterBar();
    waLoadDashboard();
  }

  function waClearFilters() {
    waFilters = [];
    waRenderFilterBar();
    waLoadDashboard();
  }

  function waRenderFilterBar() {
    const bar = document.getElementById('wa-filter-bar');
    if (!waFilters.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.innerHTML = waFilters.map(f =>
      `<span class="wa-filter-chip">${f.label} <button onclick="waRemoveFilter('${f.col}')">&times;</button></span>`
    ).join('') + (waFilters.length > 1 ? '<button onclick="waClearFilters()" style="background:none;border:none;color:var(--dim);font-size:0.75rem;cursor:pointer;">Clear all</button>' : '');
  }
  // Expose to onclick handlers
  window.waRemoveFilter = waRemoveFilter;
  window.waClearFilters = waClearFilters;

  // View toggle: traffic vs funnel
  window.waSetView = async function(view) {
    waView = view;
    document.getElementById('wa-view-traffic').classList.toggle('active', view === 'traffic');
    document.getElementById('wa-view-funnel').classList.toggle('active', view === 'funnel');
    if (view === 'funnel' && (!waFunnelData['wa-pages-table'] || waFunnelData['wa-pages-table'].length === 0)) {
      // Show loading state
      Object.keys(waDimMap).forEach(id => { document.getElementById(id).innerHTML = '<div class="wa-loading">Loading funnel data...</div>'; });
      await waLoadFunnelData();
    }
    waRenderCurrentView();
  };

  function waRenderCurrentView() {
    if (waView === 'funnel') {
      waRenderFunnelTables();
    } else {
      waRenderTrafficTables();
    }
  }

  // Dimension mapping for funnel API calls
  const waDimMap = {
    'wa-pages-table': { col: 'pathname', label: 'Page' },
    'wa-referrers-table': { col: 'referrer_domain', label: 'Referrer' },
    'wa-devices-table': { col: 'device_type', label: 'Device' },
    'wa-browsers-table': { col: 'browser', label: 'Browser' },
    'wa-countries-table': { col: 'country', label: 'Country' },
    'wa-os-table': { col: 'os', label: 'OS' },
    'wa-campaigns-table': { col: 'utm_campaign', label: 'Campaign' },
  };

  const funnelCols = function(nameLabel) {
    return [
      { key: 'name', label: nameLabel },
      { key: 'visitors', label: 'Visitors' },
      { key: 'atc', label: 'ATC' },
      { key: 'sales', label: 'Sales' },
      { key: '_atc_rate', label: 'ATC %', fmt: v => v + '%' },
      { key: '_sale_rate', label: 'Sale %', fmt: v => v + '%' },
      { key: '_revenue', label: 'Revenue', fmt: v => v > 0 ? fmt_money(v) : '-' },
    ];
  };

  async function waLoadFunnelData() {
    const { from, to } = waGetDates();
    const base = { site: waSite, from, to, metric: 'funnel' };
    const dims = Object.entries(waDimMap);
    const results = await Promise.allSettled(
      dims.map(([_, d]) => waFetch('analytics-dashboard', { ...base, col: d.col }))
    );
    // Also load order revenue by dimension
    const revByDim = {};
    const orders = (typeof filteredOrders !== 'undefined' ? filteredOrders : allOrders || []).filter(o => {
      if (waSite.toLowerCase().includes('reviana')) return (o.source_site || '').toLowerCase().includes('reviana') || (o.source_site || '').toLowerCase().includes('reviora') || (o.landing_page || '').toLowerCase().includes('reviana') || (o.landing_page || '').toLowerCase().includes('reviora');
      return true;
    });

    waFunnelData = {};
    dims.forEach(([tableId, dim], i) => {
      const data = results[i].status === 'fulfilled' ? results[i].value : [];
      // Build revenue lookup for this dimension from orders
      const revMap = {};
      if (dim.col === 'pathname') {
        orders.forEach(o => { let lp = o.landing_page || ''; if (lp) { try { lp = new URL(lp, 'https://x.com').pathname; } catch {} revMap[lp] = (revMap[lp] || 0) + Number(o.total_value || 0); } });
      }
      // Enrich rows with computed rates and revenue
      const enriched = (data || []).map(r => ({
        ...r,
        _atc_rate: r.visitors > 0 ? (r.atc / r.visitors * 100).toFixed(1) : '0.0',
        _sale_rate: r.visitors > 0 ? (r.sales / r.visitors * 100).toFixed(1) : '0.0',
        _revenue: revMap[r.name] || 0,
      }));
      waFunnelData[tableId] = enriched;
    });
  }

  function waRenderFunnelTables() {
    Object.entries(waDimMap).forEach(([tableId, dim]) => {
      const rows = waFunnelData[tableId] || [];
      waRenderTable(tableId, rows, funnelCols(dim.label));
    });
  }

  function waRenderTrafficTables() {
    const t = waTrafficData;
    if (!t.pages) return;
    const revCol = { key: '_revenue', label: 'Revenue', fmt: v => v > 0 ? fmt_money(v) : '-' };
    waRenderTable('wa-pages-table', t.pages, [{ key: 'name', label: 'Page' }, { key: 'visitors', label: 'Visitors' }, { key: 'views', label: 'Views' }, revCol]);
    waRenderTable('wa-referrers-table', t.referrers, [{ key: 'name', label: 'Referrer' }, { key: 'visitors', label: 'Visitors' }, { key: 'views', label: 'Views' }]);
    waRenderTable('wa-devices-table', t.devices, [{ key: 'name', label: 'Device' }, { key: 'visitors', label: 'Visitors' }]);
    waRenderTable('wa-browsers-table', t.browsers, [{ key: 'name', label: 'Browser' }, { key: 'visitors', label: 'Visitors' }]);
    waRenderTable('wa-countries-table', t.countries, [{ key: 'name', label: 'Country' }, { key: 'visitors', label: 'Visitors' }]);
    waRenderTable('wa-os-table', t.os, [{ key: 'name', label: 'OS' }, { key: 'visitors', label: 'Visitors' }]);
    waRenderTable('wa-campaigns-table', t.campaigns, [{ key: 'name', label: 'Name' }, { key: 'visitors', label: 'Visitors' }, { key: 'views', label: 'Views' }, revCol]);
  }

  function waToken() { return currentStaff ? currentStaff.token : ''; }

  function waGetDates() {
    const range = document.getElementById('wa-range').value;
    const now = new Date();
    let from, to;
    if (range === 'today') {
      from = to = fmt_date(now);
    } else if (range === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      from = to = fmt_date(y);
    } else if (range === '7d') {
      to = fmt_date(now);
      const d = new Date(now); d.setDate(d.getDate() - 6);
      from = fmt_date(d);
    } else if (range === '30d') {
      to = fmt_date(now);
      const d = new Date(now); d.setDate(d.getDate() - 29);
      from = fmt_date(d);
    } else {
      from = document.getElementById('wa-from').value;
      to = document.getElementById('wa-to').value;
    }
    return { from, to };
  }

  async function waFetch(fn, params) {
    params.token = waToken();
    if (params.metric === 'campaigns') params.attr = attributionModel;
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${WA_API}/${fn}?${qs}`);
    if (res.status === 401) {
      // Retry once — deploys can cause transient 401s
      await new Promise(r => setTimeout(r, 2000));
      const retry = await fetch(`${WA_API}/${fn}?${qs}`);
      if (retry.status === 401) { throw new Error('Session expired'); }
      return retry.json();
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error('API error ' + res.status + ': ' + (errBody.error || ''));
    }
    return res.json();
  }

  function fmtDuration(sec) {
    sec = Math.round(sec);
    if (sec < 60) return sec + 's';
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function fmtNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  const WA_PAGE_SIZE = 10;
  const waTablePages = {}; // { containerId: currentPage }

  function waRenderTable(containerId, rows, cols, opts = {}) {
    const el = document.getElementById(containerId);
    if (!Array.isArray(rows) || rows.length === 0) {
      el.innerHTML = '<p style="color:var(--dim);text-align:center;padding:1rem;font-size:0.85rem;">No data</p>';
      return;
    }
    if (!waTablePages[containerId]) waTablePages[containerId] = 1;
    const page = waTablePages[containerId];
    const totalPages = Math.ceil(rows.length / WA_PAGE_SIZE);
    // Clamp page
    if (page > totalPages) waTablePages[containerId] = totalPages;
    const start = (waTablePages[containerId] - 1) * WA_PAGE_SIZE;
    const pageRows = rows.slice(start, start + WA_PAGE_SIZE);

    const filterInfo = waFilterMap[containerId];
    const activeFilterVal = filterInfo ? waFilters.find(f => f.col === filterInfo.col)?.val : null;
    const maxVal = Math.max(...rows.map(r => r[cols[1].key] || 0));
    let html = '<table class="wa-table"><thead><tr>';
    cols.forEach(c => { html += `<th>${c.label}</th>`; });
    html += '</tr></thead><tbody>';
    // Determine UTM field for translation (campaign tables only)
    const utmFieldForTable = opts.utmField || (containerId === 'wa-campaigns-table' ? (document.querySelector('.wa-panel-tab.active[data-wa-panel="campaigns"]')?.dataset.waCol || 'utm_campaign') : '');
    pageRows.forEach(r => {
      const pct = maxVal > 0 ? ((r[cols[1].key] || 0) / maxVal * 100) : 0;
      const nameVal = r[cols[0].key] || '';
      const isActive = activeFilterVal === nameVal;
      html += `<tr class="${isActive ? 'wa-active' : ''}" data-wa-container="${containerId}" data-wa-val="${nameVal.replace(/"/g, '&quot;')}">`;
      cols.forEach((c, i) => {
        let val = r[c.key] != null ? r[c.key] : '-';
        if (c.fmt) val = c.fmt(val);
        if (i === 0 && utmFieldForTable) {
          const translated = utmTranslate(utmFieldForTable, nameVal);
          const displayVal = translated !== nameVal ? `${translated} <span style="font-size:0.6rem;color:var(--dim);font-family:monospace;">${nameVal.length > 20 ? nameVal.slice(0,18) + '…' : nameVal}</span>` : val;
          html += `<td class="wa-bar-cell"><div class="wa-bar-bg" style="width:${pct}%"></div><span class="wa-bar-text" title="${nameVal}">${displayVal}</span></td>`;
        } else if (i === 0) {
          html += `<td class="wa-bar-cell"><div class="wa-bar-bg" style="width:${pct}%"></div><span class="wa-bar-text">${val}</span></td>`;
        } else {
          html += `<td>${val}</td>`;
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    // Pagination controls
    if (rows.length > WA_PAGE_SIZE) {
      const cp = waTablePages[containerId];
      html += `<div class="pagination" style="margin-top:0.5rem;"><button class="wa-pg-prev" data-wa-pg="${containerId}" ${cp <= 1 ? 'disabled' : ''}>← Prev</button><span style="font-size:0.75rem;color:var(--dim);">Page ${cp} of ${totalPages} (${rows.length} total)</span><button class="wa-pg-next" data-wa-pg="${containerId}" ${cp >= totalPages ? 'disabled' : ''}>Next →</button></div>`;
    }
    el.innerHTML = html;
    // Pagination click handlers
    el.querySelectorAll('.wa-pg-prev').forEach(btn => {
      btn.addEventListener('click', () => { waTablePages[containerId] = Math.max(1, waTablePages[containerId] - 1); waRenderTable(containerId, rows, cols, opts); });
    });
    el.querySelectorAll('.wa-pg-next').forEach(btn => {
      btn.addEventListener('click', () => { waTablePages[containerId] = Math.min(totalPages, waTablePages[containerId] + 1); waRenderTable(containerId, rows, cols, opts); });
    });
    // Add click handlers for filtering
    if (filterInfo) {
      el.querySelectorAll('tr[data-wa-val]').forEach(row => {
        row.addEventListener('click', function() {
          const val = this.dataset.waVal;
          if (activeFilterVal === val) {
            waRemoveFilter(filterInfo.col);
          } else {
            waAddFilter(filterInfo.col, val, filterInfo.labelPrefix);
          }
        });
      });
    }
    // Add page drill-down click handlers for page tables
    const isPageTable = ['wa-pages-table', 'wa-entry-table', 'wa-exit-table'].includes(containerId);
    if (isPageTable) {
      el.querySelectorAll('tr[data-wa-val]').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('dblclick', function(e) {
          e.stopPropagation();
          const pathname = this.dataset.waVal;
          if (pathname && typeof openPageModal === 'function') openPageModal(pathname);
        });
      });
    }
  }

  let waRealtimePages = [], waRealtimeVisitors = [];
  let waRealtimePanelOpen = false;

  async function waLoadRealtime() {
    try {
      const params = { site: waSite };
      if (waRealtimePanelOpen) params.detail = '1';
      const data = await waFetch('analytics-realtime', params);
      document.getElementById('wa-realtime').textContent = data.active_visitors || 0;
      waRealtimePages = data.pages || [];
      waRealtimeVisitors = data.visitors || [];
      if (waRealtimePanelOpen) waRenderRealtimePanel();
    } catch {}
  }

  function waTimeAgo(iso) {
    const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return diff + 's ago';
    return Math.floor(diff / 60) + 'm ago';
  }

  function waRenderRealtimePanel() {
    const el = document.getElementById('wa-realtime-pages');
    if (!waRealtimeVisitors.length && !waRealtimePages.length) {
      el.innerHTML = '<p style="color:var(--dim);text-align:center;padding:1rem;">No active visitors</p>';
      return;
    }

    let html = '';

    // Visitor journey cards
    if (waRealtimeVisitors.length) {
      waRealtimeVisitors.forEach(v => {
        const pages = typeof v.pages === 'string' ? JSON.parse(v.pages) : v.pages;
        const meta = [];
        if (v.referrer) meta.push('<span>via ' + v.referrer + '</span>');
        if (v.country) meta.push('<span>' + v.country + '</span>');
        if (v.browser) meta.push('<span>' + v.browser + '</span>');
        if (v.device) meta.push('<span>' + v.device + '</span>');

        html += '<div class="wa-visitor">';
        html += '<div class="wa-visitor-header">';
        html += '<div class="wa-visitor-meta">' + meta.join('') + '</div>';
        html += '<span style="font-size:0.65rem;color:var(--dim);">' + waTimeAgo(v.last_seen) + '</span>';
        html += '</div>';
        html += '<div class="wa-journey">';
        pages.forEach((p, i) => {
          const isFirst = i === 0;
          const isLast = i === pages.length - 1;
          const cls = isFirst ? 'wa-entry' : (isLast ? 'wa-current' : '');
          html += '<span class="wa-journey-step ' + cls + '" title="' + p.page + '">' + p.page + '</span>';
          if (p.duration > 0) html += '<span class="wa-journey-dur">' + p.duration + 's</span>';
          if (!isLast) html += '<span class="wa-journey-arrow">&rarr;</span>';
        });
        html += '</div>';
        html += '</div>';
      });
    } else if (waRealtimePages.length) {
      // Fallback to page summary if visitor detail not loaded yet
      const max = Math.max(...waRealtimePages.map(p => p.visitors));
      html = '<table class="wa-table"><thead><tr><th>Page</th><th>Visitors</th></tr></thead><tbody>';
      waRealtimePages.forEach(p => {
        const pct = max > 0 ? (p.visitors / max * 100) : 0;
        html += '<tr><td class="wa-bar-cell"><div class="wa-bar-bg" style="width:' + pct + '%;background:rgba(74,222,128,0.15)"></div><span class="wa-bar-text"><span class="wa-realtime-dot"></span>' + p.pathname + '</span></td><td>' + p.visitors + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    el.innerHTML = html;

    // Realtime map
    const mapEl = document.getElementById('wa-realtime-map');
    if (mapEl && waRealtimeVisitors.length) {
      const countryCounts = {};
      waRealtimeVisitors.forEach(v => { if (v.country) countryCounts[v.country] = (countryCounts[v.country] || 0) + 1; });
      if (Object.keys(countryCounts).length > 0) {
        mapEl.innerHTML = '<h4 style="font-size:0.75rem;color:var(--dim);margin-bottom:0.5rem;">Active Visitor Locations</h4>';
        waRenderCountryMap(mapEl, countryCounts, true);
      } else {
        mapEl.innerHTML = '';
      }
    } else if (mapEl) {
      mapEl.innerHTML = '';
    }
  }

  document.getElementById('wa-realtime-card').addEventListener('click', function() {
    const panel = document.getElementById('wa-realtime-panel');
    waRealtimePanelOpen = panel.style.display === 'none';
    panel.style.display = waRealtimePanelOpen ? 'block' : 'none';
    this.classList.toggle('active', waRealtimePanelOpen);
    if (waRealtimePanelOpen) {
      waLoadRealtime(); // refresh with detail=1
    }
  });

  function waRenderConversions(data) {
    const el = document.getElementById('wa-conversions');
    if (!data || !data.length) {
      el.innerHTML = '<p style="color:var(--dim);text-align:center;padding:1rem;font-size:0.85rem;">No conversions</p>';
      return;
    }
    let html = '';
    data.forEach(c => {
      html += '<div class="wa-conversion">';
      // Source pill
      const srcParts = [];
      if (c.utm_source) srcParts.push(utmTranslate('utm_source', c.utm_source));
      const rawDetail = c.utm_campaign || c.utm_adgroup || c.utm_content || '';
      const srcDetail = rawDetail ? utmTranslate(c.utm_campaign ? 'utm_campaign' : c.utm_adgroup ? 'utm_adgroup' : 'utm_content', rawDetail) : '';
      if (srcDetail) srcParts.push(srcDetail);
      if (srcParts.length) {
        html += '<span style="display:inline-block;background:var(--sage);color:var(--bg);font-size:0.6rem;font-weight:600;padding:0.1rem 0.4rem;border-radius:9999px;margin-right:0.3rem;">' + srcParts.join(' – ') + '</span>';
      } else if (c.referrer) {
        html += '<span style="display:inline-block;background:var(--border);color:var(--text);font-size:0.6rem;font-weight:600;padding:0.1rem 0.4rem;border-radius:9999px;margin-right:0.3rem;">' + c.referrer + '</span>';
      }
      html += '<span class="wa-conv-page wa-landing" title="Landing">' + (c.landing_page || '?') + '</span>';
      html += '<span class="wa-journey-arrow">→</span>';
      html += '<span class="wa-conv-page wa-sale" title="Sale page">' + (c.sale_page || '?') + '</span>';
      html += '<span class="wa-journey-arrow">→</span>';
      html += '<span class="wa-conv-page wa-thankyou">✓ converted</span>';
      const meta = [];
      if (c.country) meta.push(c.country);
      if (c.device) meta.push(c.device);
      html += '<span class="wa-conv-meta">' + meta.join(' · ') + '</span>';
      html += '</div>';
    });
    el.innerHTML = html;
  }

  // Spark animation for realtime events
  let waPrevEvents = {};
  function waCheckForNewEvents(data) {
    if (!data.pages) return;
    // Check for new "add to cart" and "proceed to checkout" events
    const evNames = { 'add to cart': { color: '#C0C0C0', label: 'Add to Cart' }, 'proceed to checkout': { color: '#FFD700', label: 'Checkout' }, 'checkout completed': { color: '#FFD700', label: 'Purchase!' } };
    // We need the events endpoint for this - poll alongside realtime
  }

  function waSpark(color, label) {
    const card = document.getElementById('wa-realtime-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const container = document.createElement('div');
    container.className = 'wa-spark';
    container.style.left = cx + 'px';
    container.style.top = cy + 'px';

    // Label
    const lbl = document.createElement('div');
    lbl.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);top:-25px;font-size:0.7rem;font-weight:700;color:' + color + ';white-space:nowrap;animation:wa-spark-fly 1.2s ease-out forwards;--dx:0px;--dy:-40px;';
    lbl.textContent = label;
    container.appendChild(lbl);

    // Particles
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'wa-spark-particle';
      const angle = (Math.PI * 2 / 12) * i;
      const dist = 30 + Math.random() * 30;
      p.style.cssText = 'width:4px;height:4px;background:' + color + ';--dx:' + Math.cos(angle) * dist + 'px;--dy:' + Math.sin(angle) * dist + 'px;animation-delay:' + (Math.random() * 0.1) + 's;';
      container.appendChild(p);
    }
    document.body.appendChild(container);
    setTimeout(() => container.remove(), 1200);
  }

  // Track event counts to detect new events between polls
  let waLastEventCounts = {};
  async function waCheckRealtimeEvents() {
    if (!waSite || !waToken()) return;
    try {
      const { from, to } = waGetDates();
      const events = await waFetch('analytics-dashboard', { site: waSite, from, to, metric: 'events' });
      if (!events || !events.length) return;
      const sparkEvents = { 'add to cart': '#C0C0C0', 'proceed to checkout': '#FFD700', 'checkout completed': '#FFD700' };
      events.forEach(e => {
        const name = e.event_name;
        const count = e.completions || 0;
        if (sparkEvents[name] && waLastEventCounts[name] !== undefined && count > waLastEventCounts[name]) {
          waSpark(sparkEvents[name], name === 'add to cart' ? '🛒 Add to Cart!' : name === 'proceed to checkout' ? '💳 Checkout!' : '🎉 Purchase!');
        }
        waLastEventCounts[name] = count;
      });
    } catch {}
  }

  async function waLoadDashboard() {
    if (!waSite || !waToken()) return;
    waFunnelData = {}; // Clear cached funnel data on reload
    Object.keys(waTablePages).forEach(k => { waTablePages[k] = 1; }); // Reset pagination
    const { from, to } = waGetDates();

    // Show loading
    document.querySelectorAll('#tab-website .wa-loading').forEach(el => { el.style.display = ''; });

    try {
      // Build filter params
      const fp = {};
      waFilters.forEach((f, i) => { fp['fc' + i] = f.col; fp['fv' + i] = f.val; });
      const base = { site: waSite, from, to, ...fp };

      const results = await Promise.allSettled([
        waFetch('analytics-dashboard', { ...base, metric: 'summary' }),
        waFetch('analytics-dashboard', { ...base, metric: 'timeseries' }),
        waFetch('analytics-dashboard', { ...base, metric: 'pages' }),
        waFetch('analytics-dashboard', { ...base, metric: 'referrers' }),
        waFetch('analytics-dashboard', { ...base, metric: 'browsers' }),
        waFetch('analytics-dashboard', { ...base, metric: 'devices' }),
        waFetch('analytics-dashboard', { ...base, metric: 'countries' }),
        waFetch('analytics-dashboard', { ...base, metric: 'os' }),
        waFetch('analytics-dashboard', { ...base, metric: 'events' }),
        waFetch('analytics-dashboard', { ...base, metric: 'campaigns', col: 'utm_campaign' }),
        waFetch('analytics-dashboard', { ...base, metric: 'funnel_stages' }),
      ]);
      const v = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        console.error('WA metric failed:', ['summary','timeseries','pages','referrers','browsers','devices','countries','os','events','campaigns','funnel_stages'][i], r.reason);
        return null;
      });
      const [summary, timeseries, pages, referrers, browsers, devices, countries, os, events, campaigns, funnelStagesData] = v;

      // Stats
      const s = summary || {};
      document.getElementById('wa-uniques').textContent = fmtNum(s.unique_visitors || 0);
      document.getElementById('wa-pageviews').textContent = fmtNum(s.total_pageviews || 0);
      document.getElementById('wa-duration').textContent = fmtDuration(s.avg_duration || 0);
      document.getElementById('wa-bounce').textContent = (s.bounce_rate || 0) + '%';
      document.getElementById('wa-events').textContent = fmtNum(s.event_completions || 0);

      // Funnel metrics — prefer session-based RPC, fallback to event uniques
      const fs = funnelStagesData || {};
      const hasFunnelRPC = fs.visitors != null;
      const uniqueVisitors = s.unique_visitors || 0;
      const evAtc = ((events || []).find(e => e.event_name === 'add to cart') || {}).uniques || 0;
      const evCheckout = ((events || []).find(e => e.event_name === 'proceed to checkout') || {}).uniques || 0;
      const evSale = ((events || []).find(e => e.event_name === 'checkout completed') || {}).uniques || 0;
      const fVisitors = hasFunnelRPC ? fs.visitors : uniqueVisitors;
      const fAtc = hasFunnelRPC ? fs.atc : Math.min(evAtc, uniqueVisitors);
      const fCheckout = hasFunnelRPC ? fs.checkout : Math.min(evCheckout, Math.min(evAtc, uniqueVisitors));
      const fPurchased = hasFunnelRPC ? fs.purchased : Math.min(evSale, Math.min(evCheckout, Math.min(evAtc, uniqueVisitors)));
      const lpAtc = fVisitors > 0 ? (fAtc / fVisitors * 100).toFixed(1) : '0.0';
      const lpSale = fVisitors > 0 ? (fPurchased / fVisitors * 100).toFixed(1) : '0.0';
      const atcSale = fAtc > 0 ? (fPurchased / fAtc * 100).toFixed(1) : '0.0';
      // AOV from orders data for the selected site + date range
      const siteOrders = (typeof filteredOrders !== 'undefined' ? filteredOrders : allOrders || []).filter(o => {
        if (waSite.toLowerCase().includes('reviana')) return (o.source_site || '').toLowerCase().includes('reviana') || (o.source_site || '').toLowerCase().includes('reviora') || (o.landing_page || '').toLowerCase().includes('reviana') || (o.landing_page || '').toLowerCase().includes('reviora');
        return true;
      });
      const waAov = siteOrders.length > 0 ? siteOrders.reduce((s, o) => s + Number(o.total_value || 0), 0) / siteOrders.length : 0;
      document.getElementById('wa-lp-atc').textContent = lpAtc + '%';
      document.getElementById('wa-lp-sale').textContent = lpSale + '%';
      document.getElementById('wa-atc-sale').textContent = atcSale + '%';
      document.getElementById('wa-aov').textContent = fmt_money(waAov);

      // Funnel visualisation — session-based, each stage is a subset of the prior
      const funnelStages = [
        { label: 'Visitors', count: fVisitors, color: '#6B8F5B' },
        { label: 'Add to Cart', count: fAtc, color: '#8CB47A' },
        { label: 'Checkout', count: fCheckout, color: '#D4A84B' },
        { label: 'Purchased', count: fPurchased, color: '#C0955A' },
      ];
      const funnelEl = document.getElementById('wa-funnel-viz');
      if (fVisitors > 0) {
        let fhtml = '<div class="wa-funnel">';
        funnelStages.forEach((st, i) => {
          const widthPct = fVisitors > 0 ? Math.max(15, (st.count / fVisitors) * 100) : 15;
          const dropPct = i > 0 ? ((1 - st.count / funnelStages[i - 1].count) * 100) : 0;
          const dropStr = i > 0 && funnelStages[i - 1].count > 0 ? `↓ ${dropPct.toFixed(0)}% drop` : '';
          if (i > 0) fhtml += '<div class="wa-funnel-arrow">→</div>';
          fhtml += `<div class="wa-funnel-stage">
            <div class="wa-funnel-bar" style="background:${st.color};width:${widthPct}%;min-width:60px;">
              <span class="wa-funnel-count">${st.count}</span>
              <span class="wa-funnel-label">${st.label}</span>
            </div>
            ${dropStr ? `<div class="wa-funnel-drop">${dropStr}</div>` : ''}
          </div>`;
        });
        fhtml += '</div>';
        funnelEl.innerHTML = fhtml;
        funnelEl.style.display = '';
        renderAbandonmentStats(funnelStages);
      } else {
        funnelEl.style.display = 'none';
        document.getElementById('wa-abandonment-stats').style.display = 'none';
      }

      // Timeseries chart
      waRenderTimeseries(timeseries || []);

      // Build revenue lookups from order data
      const revByPage = {}, revBySource = {}, revByMedium = {}, revByCampaign = {};
      (typeof filteredOrders !== 'undefined' ? filteredOrders : allOrders || []).forEach(o => {
        const rev = Number(o.total_value || 0);
        // Landing page → pathname
        let lp = o.landing_page || '';
        if (lp) {
          try { const u = new URL(lp, 'https://primalpantry.co.nz'); if (u.hostname.includes('primalpantry') || u.hostname.includes('reviora') || u.hostname.includes('reviana')) lp = u.pathname; } catch {}
          revByPage[lp] = (revByPage[lp] || 0) + rev;
        }
        // UTM source
        const src = resolveOrderSource(o);
        if (src) revBySource[src] = (revBySource[src] || 0) + rev;
        // UTM medium
        const med = o.utm_medium || (o.thank_you_url ? getUtmFromUrl(o.thank_you_url, 'utm_medium') : '') || '';
        if (med) revByMedium[med] = (revByMedium[med] || 0) + rev;
        // UTM campaign
        const camp = resolveOrderCampaign(o);
        if (camp) revByCampaign[camp] = (revByCampaign[camp] || 0) + rev;
      });
      waRevMaps = { pathname: revByPage, utm_source: revBySource, utm_medium: revByMedium, utm_campaign: revByCampaign };

      // Cache traffic data and render based on view mode
      function waEnrichRev(rows, revMap) {
        if (!rows) return rows;
        return rows.map(r => ({ ...r, _revenue: revMap[r.name] || 0 }));
      }
      waTrafficData = {
        pages: waEnrichRev(pages, revByPage),
        referrers: referrers,
        devices: devices,
        browsers: browsers,
        countries: countries,
        os: os,
        campaigns: waEnrichRev(campaigns, revByCampaign),
      };

      if (waView === 'funnel') {
        await waLoadFunnelData();
        waRenderFunnelTables();
      } else {
        waRenderTrafficTables();
      }

      // Historical country heatmap
      waRenderHistoricalMap(countries);

      // Events table (special columns)
      waRenderTable('wa-events-table', events, [
        { key: 'event_name', label: 'Event' },
        { key: 'uniques', label: 'Uniques' },
        { key: 'completions', label: 'Completions' },
        { key: 'conv_rate', label: 'Conv. Rate', fmt: v => v + '%' },
      ]);

      // Conversions (async, doesn't block main load)
      waFetch('analytics-dashboard', { site: waSite, from, to, metric: 'conversions' })
        .then(conv => waRenderConversions(conv || []))
        .catch(() => waRenderConversions([]));

      // Checkout errors (from Supabase directly)
      waLoadCheckoutErrors();

    } catch (err) {
      console.error('WA load error:', err);
    }

    // Realtime
    waLoadRealtime();
    if (waRealtimeInterval) clearInterval(waRealtimeInterval);
    waRealtimeInterval = setInterval(() => { waLoadRealtime(); waCheckRealtimeEvents(); }, 30000);
  }

  function waRenderTimeseries(data) {
    const ctx = document.getElementById('wa-timeseries');
    if (waChart) { waChart.destroy(); waChart = null; }
    if (!Array.isArray(data) || data.length === 0) return;

    const labels = data.map(d => {
      const dt = new Date(d.period);
      // If hourly data, show HH:MM, otherwise show date
      if (data.length > 0 && data[0].period && data[0].period.includes('T')) {
        return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    });

    waChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Visitors',
            data: data.map(d => d.visitors),
            borderColor: '#6B8F5B',
            backgroundColor: 'rgba(107,143,91,0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: data.length > 30 ? 0 : 3,
          },
          {
            label: 'Pageviews',
            data: data.map(d => d.pageviews),
            borderColor: '#D4A84B',
            backgroundColor: 'transparent',
            borderDash: [4, 4],
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' } } } },
        scales: {
          x: { ticks: { color: '#9c9287', maxTicksLimit: 12 }, grid: { color: 'rgba(51,45,39,0.5)' } },
          y: { beginAtZero: true, ticks: { color: '#9c9287' }, grid: { color: 'rgba(51,45,39,0.5)' } },
        },
      },
    });
  }

  // Panel tab switching (pages/referrers/campaigns sub-tabs)
  document.querySelectorAll('.wa-panel-tab').forEach(tab => {
    tab.addEventListener('click', async function() {
      const panel = this.dataset.waPanel;
      this.closest('.wa-panel-tabs').querySelectorAll('.wa-panel-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');

      const metric = this.dataset.waMetric;
      const col = this.dataset.waCol || '';
      const { from, to } = waGetDates();
      const containerId = 'wa-' + panel + '-table';

      document.getElementById(containerId).innerHTML = '<div class="wa-loading">Loading...</div>';

      try {
        const params = { site: waSite, from, to, metric };
        if (col) params.col = col;
        let data = await waFetch('analytics-dashboard', params);
        const cols = [{ key: 'name', label: 'Name' }, { key: 'visitors', label: 'Visitors' }, { key: 'views', label: 'Views' }];
        // Enrich with revenue if we have a matching revenue map
        const revMap = waRevMaps[col] || waRevMaps[metric] || null;
        if (revMap && data) {
          data = data.map(r => ({ ...r, _revenue: revMap[r.name] || 0 }));
          cols.push({ key: '_revenue', label: 'Revenue', fmt: v => v > 0 ? fmt_money(v) : '-' });
        }
        waRenderTable(containerId, data, cols, { utmField: col });
      } catch (err) {
        document.getElementById(containerId).innerHTML = '<p style="color:var(--red);">Error loading data</p>';
      }
    });
  });

  // ── UTM Mappings ──
  let utmMappings = []; // loaded from Supabase
  const utmMapLookup = {}; // { 'utm_campaign': { '123': 'Friendly Name' }, ... }

  function utmTranslate(field, value) {
    if (!value) return value;
    const bucket = utmMapLookup[field];
    return bucket && bucket[value] ? bucket[value] : value;
  }
  // Translate a UTM value when the field is unknown — checks all fields
  function utmTranslateAny(value) {
    if (!value) return value;
    for (const field of Object.keys(utmMapLookup)) {
      if (utmMapLookup[field][value]) return utmMapLookup[field][value];
    }
    return value;
  }
  window.utmTranslate = utmTranslate;
  window.utmTranslateAny = utmTranslateAny;
  window.utmEnsureLoaded = async function() {
    if (utmMappings.length > 0) return;
    await utmLoadMappings();
  };

  function utmBuildLookup() {
    Object.keys(utmMapLookup).forEach(k => delete utmMapLookup[k]);
    utmMappings.forEach(m => {
      if (!utmMapLookup[m.utm_field]) utmMapLookup[m.utm_field] = {};
      utmMapLookup[m.utm_field][m.utm_value] = m.friendly_name;
    });
  }

  async function utmLoadMappings() {
    try {
      const res = await fetch(`${WA_API}/utm-mappings?action=list&token=${waToken()}`);
      utmMappings = await res.json();
      utmBuildLookup();
      utmRenderList();
    } catch (e) {
      console.error('[utm-mappings] load failed:', e);
    }
  }

  function utmRenderList() {
    const el = document.getElementById('utm-map-list');
    if (!utmMappings.length) {
      el.innerHTML = '<p style="color:var(--dim);text-align:center;padding:0.5rem;">No mappings yet. Add one above or import a CSV.</p>';
      return;
    }
    const groups = {};
    utmMappings.forEach(m => {
      if (!groups[m.utm_field]) groups[m.utm_field] = [];
      groups[m.utm_field].push(m);
    });
    const fieldLabels = { utm_campaign: 'Campaign', utm_source: 'Source', utm_medium: 'Medium', utm_content: 'Content', utm_term: 'Term', utm_adgroup: 'Ad Group' };
    let html = '';
    Object.keys(groups).sort().forEach(field => {
      html += `<div style="margin-bottom:0.75rem;"><h4 style="font-size:0.7rem;color:var(--dim);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.05em;">${fieldLabels[field] || field}</h4>`;
      html += '<table class="wa-table"><thead><tr><th>UTM Value</th><th>Friendly Name</th><th style="width:40px;"></th></tr></thead><tbody>';
      groups[field].forEach(m => {
        html += `<tr>
          <td style="font-family:monospace;font-size:0.7rem;color:var(--dim);" title="${m.utm_value}">${m.utm_value.length > 30 ? m.utm_value.slice(0, 28) + '…' : m.utm_value}</td>
          <td>${m.friendly_name}</td>
          <td><button onclick="utmDeleteMapping(${m.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:0.8rem;" title="Delete">&times;</button></td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    });
    el.innerHTML = html;
  }

  window.utmDeleteMapping = async function(id) {
    if (!confirm('Delete this mapping?')) return;
    try {
      await fetch(`${WA_API}/utm-mappings?action=delete&token=${waToken()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      utmMappings = utmMappings.filter(m => m.id !== id);
      utmBuildLookup();
      utmRenderList();
    } catch (e) { alert('Delete failed: ' + e.message); }
  };

  document.getElementById('utm-map-add-btn').addEventListener('click', () => {
    const form = document.getElementById('utm-map-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('utm-map-save-btn').addEventListener('click', async () => {
    const field = document.getElementById('utm-map-field').value;
    const value = document.getElementById('utm-map-value').value.trim();
    const name = document.getElementById('utm-map-name').value.trim();
    if (!value || !name) { alert('Both UTM value and friendly name are required'); return; }
    try {
      await fetch(`${WA_API}/utm-mappings?action=upsert&token=${waToken()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utm_field: field, utm_value: value, friendly_name: name }),
      });
      document.getElementById('utm-map-value').value = '';
      document.getElementById('utm-map-name').value = '';
      document.getElementById('utm-map-form').style.display = 'none';
      await utmLoadMappings();
    } catch (e) { alert('Save failed: ' + e.message); }
  });

  document.getElementById('utm-map-import-btn').addEventListener('click', () => {
    document.getElementById('utm-map-csv-file').click();
  });
  document.getElementById('utm-map-csv-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const rows = [];
    const defaultField = document.getElementById('utm-map-field').value;
    lines.forEach((line, i) => {
      if (i === 0 && line.toLowerCase().includes('field')) return; // skip header
      const parts = line.split(/[,\t]/);
      if (parts.length >= 3) {
        rows.push({ utm_field: parts[0].trim(), utm_value: parts[1].trim(), friendly_name: parts.slice(2).join(',').trim() });
      } else if (parts.length === 2) {
        rows.push({ utm_field: defaultField, utm_value: parts[0].trim(), friendly_name: parts[1].trim() });
      }
    });
    if (!rows.length) { alert('No valid rows found. Expected: field,value,name or value,name'); return; }
    try {
      await fetch(`${WA_API}/utm-mappings?action=bulk-upsert&token=${waToken()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      });
      alert(`Imported ${rows.length} mappings`);
      await utmLoadMappings();
    } catch (e) { alert('Import failed: ' + e.message); }
    e.target.value = '';
  });

  // ── Checkout Errors ──
  async function waLoadCheckoutErrors() {
    const el = document.getElementById('wa-checkout-errors');
    if (!el) return;
    try {
      const { data, error } = await db.from('checkout_errors').select('*').order('created_at', { ascending: false }).limit(50);
      if (error || !data || !data.length) {
        el.innerHTML = '<p style="color:var(--dim);text-align:center;padding:1rem;font-size:0.85rem;">No checkout errors</p>';
        return;
      }
      let html = '<table class="wa-table"><thead><tr><th>Time</th><th>Error</th><th>Code</th><th>Cart</th><th>Device</th><th>Browser</th><th>Country</th><th>Type</th></tr></thead><tbody>';
      data.forEach(e => {
        const time = new Date(e.created_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        let cartStr = '';
        try { const items = JSON.parse(e.cart || '[]'); cartStr = items.map(i => `${i.qty}x ${(i.id || '').slice(-8)}`).join(', '); } catch { cartStr = e.cart || ''; }
        const typeLabel = e.is_card_decline ? '<span style="color:var(--dim);">Card decline</span>' : '<span style="color:var(--red);">Error</span>';
        html += `<tr>
          <td style="white-space:nowrap;font-size:0.75rem;">${time}</td>
          <td style="font-size:0.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${(e.error_message || '').replace(/"/g, '&quot;')}">${e.error_message || '-'}</td>
          <td style="font-size:0.75rem;">${e.error_code || '-'}</td>
          <td style="font-size:0.75rem;">${cartStr || '-'}</td>
          <td style="font-size:0.75rem;">${e.device || '-'}</td>
          <td style="font-size:0.75rem;">${e.browser || '-'}</td>
          <td style="font-size:0.75rem;">${e.country || '-'}</td>
          <td style="font-size:0.75rem;">${typeLabel}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    } catch (err) {
      el.innerHTML = '<p style="color:var(--dim);text-align:center;padding:1rem;font-size:0.85rem;">No checkout errors</p>';
    }
  }

  // ── Abandonment Stats (Layer 1) ──
  function renderAbandonmentStats(stages) {
    const el = document.getElementById('wa-abandonment-stats');
    if (!stages || stages.length < 4) { el.style.display = 'none'; return; }
    const visitors = stages[0].count || 0;
    const atc = stages[1].count || 0;
    const checkout = stages[2].count || 0;
    const purchased = stages[3].count || 0;
    if (visitors === 0) { el.style.display = 'none'; return; }

    const browseAbandons = visitors - atc;
    const cartAbandons = atc - checkout;
    const checkoutAbandons = checkout - purchased;
    const overallDropoff = ((1 - purchased / visitors) * 100).toFixed(1);

    document.getElementById('wa-browse-abandon').innerHTML = `${browseAbandons} <span style="font-size:0.65rem;color:var(--dim);">(${(browseAbandons / visitors * 100).toFixed(0)}%)</span>`;
    document.getElementById('wa-cart-abandon').innerHTML = `${cartAbandons} <span style="font-size:0.65rem;color:var(--dim);">${atc > 0 ? '(' + (cartAbandons / atc * 100).toFixed(0) + '%)' : ''}</span>`;
    document.getElementById('wa-checkout-abandon').innerHTML = `${checkoutAbandons} <span style="font-size:0.65rem;color:var(--dim);">${checkout > 0 ? '(' + (checkoutAbandons / checkout * 100).toFixed(0) + '%)' : ''}</span>`;
    document.getElementById('wa-overall-abandon-rate').textContent = overallDropoff + '%';
    el.style.display = '';
  }

  // ── Full Funnel Visualisation Modal ──
  let waFmMode = 'conversions';
  let waFmData = null;
  let waFmProductsExpanded = false;
  let waFmProductPages = [];

  window.waOpenFunnelModal = async function() {
    const overlay = document.getElementById('wa-fm-overlay');
    const body = document.getElementById('wa-fm-body');
    overlay.classList.add('open');
    body.innerHTML = '<div class="wa-loading">Loading funnel data...</div>';
    waFmProductsExpanded = false;

    try {
      const { from, to } = waGetDates();

      // Define page groups
      const groups = [
        { label: 'Homepage', patterns: ['/'] },
        { label: 'Shop Page', patterns: ['/shop/', '/shop'] },
        { label: 'Cart', patterns: ['/cart/', '/cart'] },
        { label: 'Checkout', patterns: ['/checkout/', '/checkout'] },
      ];

      // Build product page patterns from existing traffic data
      const productPatterns = [];
      if (waTrafficData && waTrafficData.pages) {
        const excludePatterns = ['/', '/shop/', '/shop', '/cart/', '/cart', '/checkout/', '/checkout', '/pages/'];
        waTrafficData.pages.forEach(p => {
          if (p.name && !excludePatterns.includes(p.name) && !p.name.startsWith('/pages/') && p.visitors >= 2) {
            productPatterns.push(p.name);
          }
        });
      }
      if (productPatterns.length === 0) productPatterns.push('/shop/%');
      groups.push({ label: 'Product Pages', patterns: productPatterns });

      const data = await waFetch('analytics-dashboard', {
        site: waSite, from, to, metric: 'page_funnel',
        groups: JSON.stringify(groups)
      });

      // Build lookup by label
      const byLabel = {};
      (data || []).forEach(d => { byLabel[d.label] = d; });

      // Get funnel stages for purchased count
      const funnelData = await waFetch('analytics-dashboard', { site: waSite, from, to, metric: 'funnel_stages' });
      const purchased = funnelData ? (funnelData.purchased || 0) : 0;

      // Calculate total revenue from order data
      const siteOrders = (typeof filteredOrders !== 'undefined' ? filteredOrders : allOrders || []);
      const totalRev = siteOrders.reduce((s, o) => s + Number(o.total_value || 0), 0);

      // Revenue per page group from waRevMaps
      const revMap = waRevMaps ? waRevMaps.pathname || {} : {};
      function groupRev(patterns) {
        let rev = 0;
        patterns.forEach(p => {
          Object.keys(revMap).forEach(k => {
            if (k === p || (p.endsWith('%') && k.startsWith(p.slice(0, -1)))) rev += revMap[k] || 0;
          });
        });
        return rev;
      }

      // Assemble full data
      const labels = ['Homepage', 'Shop Page', 'Product Pages', 'Cart', 'Checkout'];
      waFmData = {};
      labels.forEach(lbl => {
        const d = byLabel[lbl] || { visitors: 0, views: 0, avg_duration: 0, bounce_rate: 0, entry_visitors: 0 };
        const g = groups.find(g => g.label === lbl);
        let rev = g ? groupRev(g.patterns) : 0;
        // Cart & Checkout revenue = total purchased revenue (everyone who bought went through these)
        if (lbl === 'Cart' || lbl === 'Checkout') rev = totalRev;
        waFmData[lbl] = { ...d, revenue: rev };
      });
      waFmData['Purchased'] = { visitors: purchased, views: purchased, avg_duration: 0, bounce_rate: 0, entry_visitors: 0, revenue: totalRev };

      // Store product-level page data for breakdown
      waFmProductPages = (waTrafficData && waTrafficData.pages || [])
        .filter(p => {
          const excludePatterns = ['/', '/shop/', '/shop', '/cart/', '/cart', '/checkout/', '/checkout'];
          return p.name && !excludePatterns.includes(p.name) && !p.name.startsWith('/pages/') && p.visitors >= 2;
        })
        .slice(0, 20)
        .map(p => ({
          name: p.name,
          shortName: p.name.replace(/^\/(shop\/)?/, '').replace(/\/$/, '') || p.name,
          visitors: p.visitors || 0,
          views: p.views || 0,
          bounce_rate: p.bounce_rate || 0,
          avg_duration: p.avg_duration || 0,
          revenue: (revMap[p.name] || 0),
        }));

      waFmRender();
    } catch (err) {
      console.error('Funnel modal error:', err);
      body.innerHTML = '<div class="wa-loading" style="color:var(--red);">Failed to load funnel data</div>';
    }
  };

  window.waCloseFunnelModal = function() {
    document.getElementById('wa-fm-overlay').classList.remove('open');
  };

  window.waFunnelToggle = function(mode) {
    waFmMode = mode;
    document.getElementById('wa-fm-tog-conv').classList.toggle('active', mode === 'conversions');
    document.getElementById('wa-fm-tog-rev').classList.toggle('active', mode === 'revenue');
    waFmRender();
  };

  window.waToggleProductBreakdown = function() {
    waFmProductsExpanded = !waFmProductsExpanded;
    waFmRender();
  };

  function waFmCard(label, data, opts = {}) {
    const visitors = data.visitors || 0;
    const bounce = data.bounce_rate || 0;
    const dur = data.avg_duration || 0;
    const rev = data.revenue || 0;
    // Entry %: share of TOTAL site visitors who entered at this page
    const totalEntries = ['Homepage', 'Shop Page', 'Product Pages', 'Cart', 'Checkout'].reduce((s, k) => s + ((waFmData[k] && waFmData[k].entry_visitors) || 0), 0) || 1;
    const entryPct = data.entry_visitors > 0 ? Math.round(data.entry_visitors / totalEntries * 100) : 0;
    // Conv rate: what % of THIS page's visitors went on to purchase
    const purchasedCount = (waFmData['Purchased'] && waFmData['Purchased'].visitors) || 0;
    let convRate = '0.0';
    if (visitors > 0 && purchasedCount > 0) {
      const raw = purchasedCount / visitors * 100;
      convRate = (isFinite(raw) ? Math.min(raw, 100) : 100).toFixed(1);
    }
    const convCount = waFmData['Purchased'].visitors || 0;
    const isHighlightRev = waFmMode === 'revenue';
    const clickable = opts.clickable ? ' clickable' : '';
    const centerClass = opts.center ? ' center-card' : '';
    const onClick = opts.onClick || '';

    let entryBadge = entryPct > 0 ? `<span class="entry-badge">${entryPct}% enter here</span>` : '';
    if (label === 'Purchased') entryBadge = '';

    let stats = '';
    if (label === 'Purchased') {
      stats = `<div class="wa-fm-stats">
        <div class="wa-fm-stat">Orders <span class="wa-fm-stat-val${isHighlightRev ? '' : ' highlight'}">${fmtNum(visitors)}</span></div>
        <div class="wa-fm-stat">Revenue <span class="wa-fm-stat-val${isHighlightRev ? ' highlight' : ''}">${fmt_money(rev)}</span></div>
      </div>`;
    } else {
      stats = `<div class="wa-fm-stats">
        <div class="wa-fm-stat">Users <span class="wa-fm-stat-val">${fmtNum(visitors)}</span></div>
        <div class="wa-fm-stat">Bounce <span class="wa-fm-stat-val">${bounce}%</span></div>
        <div class="wa-fm-stat">Avg Time <span class="wa-fm-stat-val">${fmtDuration(dur)}</span></div>
        <div class="wa-fm-stat">${isHighlightRev ? 'Revenue' : 'Conv Rate'} <span class="wa-fm-stat-val highlight">${isHighlightRev ? fmt_money(rev) : convRate + '%'}</span></div>
      </div>`;
    }

    return `<div class="wa-fm-card${centerClass}${clickable}" ${onClick ? `onclick="${onClick}"` : ''}>
      <div class="wa-fm-card-title">${label} ${entryBadge}</div>
      ${stats}
    </div>`;
  }

  function waFmConnector(fromData, toData, label) {
    const users = toData.visitors || 0;
    const dropPct = fromData.visitors > 0 ? ((1 - users / fromData.visitors) * 100).toFixed(0) : 0;
    return `<div class="wa-fm-center-connector">
      <div class="wa-fm-vline"></div>
      <div class="wa-fm-vline-label">${fmtNum(users)} users · ${dropPct}% drop</div>
      <div class="wa-fm-vline"></div>
    </div>`;
  }

  function waFmRender() {
    if (!waFmData) return;
    const body = document.getElementById('wa-fm-body');
    const d = waFmData;

    // Top row: Homepage, Shop, Product Pages
    let productsCard;
    if (waFmProductsExpanded && waFmProductPages) {
      // Expanded: radial nucleus layout around the Product Pages card
      const isRev = waFmMode === 'revenue';
      const pages = waFmProductPages.slice(0, 12);
      const maxVisitors = Math.max(...pages.map(p => p.visitors), 1);

      let orbits = '';
      pages.forEach((p, i) => {
        const angle = (i / pages.length) * 2 * Math.PI - Math.PI / 2;
        const radiusX = 180, radiusY = 140;
        const x = Math.cos(angle) * radiusX;
        const y = Math.sin(angle) * radiusY;
        const dotSize = 8 + (p.visitors / maxVisitors) * 20;
        const stat = isRev ? fmt_money(p.revenue) : fmtNum(p.visitors) + ' users';
        orbits += `<div class="wa-fm-orbit-dot" style="left:calc(50% + ${x.toFixed(0)}px);top:calc(50% + ${y.toFixed(0)}px);width:${dotSize.toFixed(0)}px;height:${dotSize.toFixed(0)}px;" title="${p.name}\n${p.visitors} users · ${p.bounce_rate}% bounce · ${fmtDuration(p.avg_duration)} avg\nRevenue: ${fmt_money(p.revenue)}">
          <span class="wa-fm-orbit-label">${p.shortName.length > 18 ? p.shortName.slice(0, 16) + '…' : p.shortName}<br><small>${stat}</small></span>
        </div>`;
      });

      productsCard = `<div style="flex:1;min-width:500px;max-width:700px;">
        <div class="wa-fm-nucleus" style="position:relative;height:380px;">
          <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:200px;">
            ${waFmCard('Product Pages', d['Product Pages'], { clickable: true, onClick: 'waToggleProductBreakdown()' })}
          </div>
          ${orbits}
        </div>
        <div style="text-align:center;"><button class="wa-fm-collapse-btn" onclick="event.stopPropagation();waToggleProductBreakdown()" style="margin-top:0.25rem;">Collapse</button></div>
      </div>`;
    } else {
      productsCard = `<div style="flex:1;max-width:280px;">${waFmCard('Product Pages', d['Product Pages'], { clickable: true, onClick: 'waToggleProductBreakdown()' })}</div>`;
    }

    // Build connector lines from top row to cart
    // Simple approach: 3 dotted lines converging
    const topCards = `<div class="wa-fm-top-row">
      <div style="flex:1;max-width:280px;">${waFmCard('Homepage', d['Homepage'])}</div>
      <div style="flex:1;max-width:280px;">${waFmCard('Shop Page', d['Shop Page'])}</div>
      ${productsCard}
    </div>`;

    // Connector: show cart visitors as the convergence
    const cartVisitors = d['Cart'].visitors || 0;
    const topMax = Math.max(d['Homepage'].visitors || 0, d['Shop Page'].visitors || 0, d['Product Pages'].visitors || 0, 1);
    const convText = `${fmtNum(cartVisitors)} users reach cart`;

    const connector1 = `<div class="wa-fm-center-connector">
      <div style="display:flex;justify-content:center;gap:4rem;width:100%;">
        <div class="wa-fm-vline" style="height:28px;"></div>
        <div class="wa-fm-vline" style="height:28px;"></div>
        <div class="wa-fm-vline" style="height:28px;"></div>
      </div>
      <div class="wa-fm-vline-label" style="font-size:0.7rem;font-weight:600;">${convText}</div>
    </div>`;

    // Cart card
    const cartCard = `<div class="wa-fm-center">${waFmCard('Cart', d['Cart'], { center: true })}</div>`;

    // Cart → Checkout connector
    const conn2 = waFmConnector(d['Cart'], d['Checkout']);

    // Checkout card
    const checkoutCard = `<div class="wa-fm-center">${waFmCard('Checkout', d['Checkout'], { center: true })}</div>`;

    // Checkout → Purchased connector
    const conn3 = waFmConnector(d['Checkout'], d['Purchased']);

    // Purchased card
    const purchasedCard = `<div class="wa-fm-center">${waFmCard('Purchased', d['Purchased'], { center: true })}</div>`;

    body.innerHTML = topCards + connector1 + cartCard + conn2 + checkoutCard + conn3 + purchasedCard;
  }

  // ── Abandoned Checkouts (Layer 2 — Stripe) ──
  let abandonedCheckouts = [];
  let acRecoveryTarget = null;
  const AC_BASE = '/.netlify/functions/abandoned-checkouts';
  const RC_BASE = '/.netlify/functions/send-recovery-email';

  document.getElementById('ac-load-btn').addEventListener('click', loadAbandonedCheckouts);
  document.getElementById('ac-days').addEventListener('change', loadAbandonedCheckouts);

  async function loadAbandonedCheckouts() {
    const tbody = document.getElementById('ac-table');
    const days = document.getElementById('ac-days').value;
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading abandoned checkouts...</td></tr>';

    try {
      const res = await fetch(`${AC_BASE}?days=${days}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      abandonedCheckouts = data.abandoned || [];
      const summary = data.summary || {};

      // Stats
      const statsEl = document.getElementById('ac-stats');
      document.getElementById('ac-total').textContent = summary.total || 0;
      document.getElementById('ac-lost-rev').textContent = '$' + ((summary.lost_revenue || 0) / 100).toFixed(2);
      document.getElementById('ac-contacted').textContent = summary.contacted || 0;
      document.getElementById('ac-recovered').textContent = summary.recovered || 0;
      statsEl.style.display = '';

      renderAbandonedTable();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="loading">Error: ${err.message}</td></tr>`;
    }
  }

  function renderAbandonedTable() {
    const tbody = document.getElementById('ac-table');
    if (!abandonedCheckouts.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="loading">No abandoned checkouts found.</td></tr>';
      document.getElementById('ac-select-all').checked = false;
      document.getElementById('ac-send-all-btn').style.display = 'none';
      return;
    }

    const statusColors = { new: 'var(--amber)', contacted: 'var(--blue)', recovered: 'var(--sage)', lost: 'var(--red)' };

    tbody.innerHTML = abandonedCheckouts.map((ac, idx) => {
      const date = new Date(ac.created * 1000).toLocaleString('en-NZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
      const items = (ac.line_items || []).map(li => `${li.quantity}x ${li.description}`).join(', ') || '-';
      const value = ac.amount_total ? '$' + (ac.amount_total / 100).toFixed(2) : '-';
      const color = statusColors[ac.status] || 'var(--muted)';
      const canSend = ac.status === 'new' && !ac.later_purchased;

      return `<tr>
        <td>${canSend ? `<input type="checkbox" class="ac-row-check" data-idx="${idx}" style="cursor:pointer;">` : ''}</td>
        <td style="white-space:nowrap;">${date}</td>
        <td>${ac.email}</td>
        <td>${ac.name || '-'}</td>
        <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${items}">${items}</td>
        <td style="text-align:right;">${value}</td>
        <td><span class="ship-status-badge" style="background:${color}22;color:${color};">${ac.later_purchased && ac.status === 'new' ? 'recovered' : ac.status}</span></td>
        <td>${canSend ? `<button onclick="previewRecoveryEmail(${idx})" style="background:var(--sage);color:#141210;border:none;padding:0.3rem 0.6rem;border-radius:4px;font-size:0.75rem;font-weight:600;cursor:pointer;white-space:nowrap;">Send Email</button>` : ''}</td>
      </tr>`;
    }).join('');
    updateAcBulkBtn();
  }

  function updateAcBulkBtn() {
    const checked = document.querySelectorAll('.ac-row-check:checked').length;
    const btn = document.getElementById('ac-send-all-btn');
    btn.style.display = checked > 0 ? '' : 'none';
    btn.textContent = `Send All Selected (${checked})`;
  }

  // Select all checkbox
  document.getElementById('ac-select-all').addEventListener('change', function() {
    document.querySelectorAll('.ac-row-check').forEach(cb => { cb.checked = this.checked; });
    updateAcBulkBtn();
  });

  // Individual checkbox changes
  document.getElementById('ac-table').addEventListener('change', function(e) {
    if (e.target.classList.contains('ac-row-check')) updateAcBulkBtn();
  });

  // Bulk send handler
  document.getElementById('ac-send-all-btn').addEventListener('click', async function() {
    const checkboxes = document.querySelectorAll('.ac-row-check:checked');
    if (checkboxes.length === 0) return;

    const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.idx));
    const btn = this;
    const statusEl = document.getElementById('ac-bulk-status');
    btn.disabled = true;

    // Get gmail account
    let accountId = null;
    if (commsAccounts.length === 0) {
      try {
        const d = await fetch('/.netlify/functions/gmail-auth?action=status&token=' + currentStaff.token).then(r => r.json());
        commsAccounts = d.accounts || [];
      } catch {}
    }
    const helloAcct = commsAccounts.find(a => a.email_address === 'hello@primalpantry.co.nz');
    accountId = helloAcct ? helloAcct.id : (commsAccounts[0] ? commsAccounts[0].id : null);
    if (!accountId) {
      statusEl.innerHTML = '<span style="color:var(--red);">No Gmail account connected</span>';
      btn.disabled = false;
      return;
    }

    let sent = 0, failed = 0;
    for (const idx of indices) {
      const ac = abandonedCheckouts[idx];
      if (!ac || ac.status !== 'new' || ac.later_purchased) { failed++; continue; }

      statusEl.textContent = `Sending ${sent + failed + 1} of ${indices.length}...`;
      const firstName = (ac.name || '').split(' ')[0] || 'there';
      const currencySymbol = '$';
      const total = ac.amount_total ? currencySymbol + (ac.amount_total / 100).toFixed(2) : '';
      const itemsHtml = (ac.line_items || []).map(li =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#2d2a26;">${li.description || 'Product'}</td><td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#6e6259;text-align:center;">${li.quantity || 1}</td><td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#2d2a26;text-align:right;">${currencySymbol}${((li.amount || 0) / 100).toFixed(2)}</td></tr>`
      ).join('');
      const subject = `${firstName}, your cart is still waiting for you`;
      const body = `<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="font-size:22px;color:#2d2a26;margin:0;">Primal Pantry</h1>
    <p style="font-size:12px;color:#9c9287;margin:4px 0 0;">Natural Tallow Skincare — Made in New Zealand</p>
  </div>
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e8e2da;">
    <h2 style="font-size:18px;color:#2d2a26;margin:0 0 16px;">Hey ${firstName},</h2>
    <p style="font-size:14px;color:#6e6259;line-height:1.6;margin:0 0 20px;">We noticed you were checking out some of our products but didn't quite finish your order — no stress at all!<br><br>Your items are still saved and ready to go. We handcraft everything in small batches here in Christchurch, so stock can move quickly — just wanted to make sure you don't miss out.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead><tr style="background:#f8f5f0;"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#9c9287;text-transform:uppercase;">Item</th><th style="padding:8px 12px;text-align:center;font-size:12px;color:#9c9287;text-transform:uppercase;">Qty</th><th style="padding:8px 12px;text-align:right;font-size:12px;color:#9c9287;text-transform:uppercase;">Price</th></tr></thead>
      <tbody>${itemsHtml}</tbody>
      ${total ? `<tfoot><tr><td colspan="2" style="padding:10px 12px;font-size:14px;font-weight:600;color:#2d2a26;">Total</td><td style="padding:10px 12px;font-size:14px;font-weight:600;color:#2d2a26;text-align:right;">${total}</td></tr></tfoot>` : ''}
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="https://www.primalpantry.co.nz/cart/?utm_source=email&utm_medium=recovery&utm_campaign=abandoned_cart&utm_content=${ac.session_id}" style="display:inline-block;background:#8CB47A;color:#141210;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Complete Your Order</a>
    </div>
    <p style="font-size:13px;color:#9c9287;line-height:1.5;margin:16px 0 0;text-align:center;">Questions? Just hit reply — we'd love to help.</p>
  </div>
  <div style="text-align:center;margin-top:16px;"><p style="font-size:11px;color:#bbb;">Primal Pantry · Christchurch, New Zealand</p></div>
</div>`;

      try {
        const res = await commsApi('send', { account_id: accountId, to: ac.email, subject, body, send_type: 'bulk' });
        if (res.success) {
          sent++;
          try { await fetch(AC_BASE + '?token=' + currentStaff.token + '&action=update_status&session_id=' + encodeURIComponent(ac.session_id) + '&status=contacted'); } catch {}
          ac.status = 'contacted';
          ac.contacted_at = new Date().toISOString();
        } else { failed++; }
      } catch { failed++; }
    }

    statusEl.innerHTML = `<span style="color:var(--sage);">${sent} sent</span>` + (failed > 0 ? ` · <span style="color:var(--red);">${failed} failed</span>` : '');
    btn.disabled = false;
    document.getElementById('ac-select-all').checked = false;
    renderAbandonedTable();
  });

  // ── Recovery Email Preview Modal ──
  let recoveryItemsHtml = '';
  let recoveryTotal = '';
  let recoveryAc = null;

  function buildRecoveryEmailHtml() {
    const greeting = document.getElementById('recovery-greeting').value;
    const message = document.getElementById('recovery-message').value;
    return `<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="font-size:22px;color:#2d2a26;margin:0;">Primal Pantry</h1>
    <p style="font-size:12px;color:#9c9287;margin:4px 0 0;">Natural Tallow Skincare — Made in New Zealand</p>
  </div>
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e8e2da;">
    <h2 style="font-size:18px;color:#2d2a26;margin:0 0 16px;">${esc(greeting)}</h2>
    <p style="font-size:14px;color:#6e6259;line-height:1.6;margin:0 0 20px;white-space:pre-line;">${esc(message)}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead><tr style="background:#f8f5f0;"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#9c9287;text-transform:uppercase;">Item</th><th style="padding:8px 12px;text-align:center;font-size:12px;color:#9c9287;text-transform:uppercase;">Qty</th><th style="padding:8px 12px;text-align:right;font-size:12px;color:#9c9287;text-transform:uppercase;">Price</th></tr></thead>
      <tbody>${recoveryItemsHtml}</tbody>
      ${recoveryTotal ? `<tfoot><tr><td colspan="2" style="padding:10px 12px;font-size:14px;font-weight:600;color:#2d2a26;">Total</td><td style="padding:10px 12px;font-size:14px;font-weight:600;color:#2d2a26;text-align:right;">${recoveryTotal}</td></tr></tfoot>` : ''}
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="https://www.primalpantry.co.nz/cart/" style="display:inline-block;background:#8CB47A;color:#141210;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Complete Your Order</a>
    </div>
    <p style="font-size:13px;color:#9c9287;line-height:1.5;margin:16px 0 0;text-align:center;">Questions? Just hit reply — we'd love to help.</p>
  </div>
  <div style="text-align:center;margin-top:16px;">
    <p style="font-size:11px;color:#bbb;">Primal Pantry · Christchurch, New Zealand</p>
  </div>
</div>`;
  }

  function updateRecoveryPreview() {
    document.getElementById('recovery-email-preview').innerHTML = buildRecoveryEmailHtml();
  }

  function previewRecoveryEmail(idx) {
    const ac = abandonedCheckouts[idx];
    if (!ac) return;
    recoveryAc = ac;

    const firstName = (ac.name || '').split(' ')[0] || 'there';
    const currencySymbol = '$';
    recoveryTotal = ac.amount_total ? currencySymbol + (ac.amount_total / 100).toFixed(2) : '';
    recoveryItemsHtml = (ac.line_items || []).map(li =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#2d2a26;">${li.description || 'Product'}</td><td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#6e6259;text-align:center;">${li.quantity || 1}</td><td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#2d2a26;text-align:right;">${currencySymbol}${((li.amount || 0) / 100).toFixed(2)}</td></tr>`
    ).join('');

    // Populate fields
    document.getElementById('recovery-to').value = ac.email;
    document.getElementById('recovery-subject').value = `${firstName}, your cart is still waiting for you`;
    document.getElementById('recovery-greeting').value = `Hey ${firstName},`;
    document.getElementById('recovery-message').value = `We noticed you were checking out some of our products but didn't quite finish your order — no stress at all!\n\nYour items are still saved and ready to go. We handcraft everything in small batches here in Christchurch, so stock can move quickly — just wanted to make sure you don't miss out.`;

    // Populate from dropdown and auto-select hello@primalpantry.co.nz
    const fromEl = document.getElementById('recovery-from');
    if (commsAccounts.length > 0) {
      fromEl.innerHTML = commsAccounts.map(a => '<option value="' + a.id + '">' + esc(a.email_address) + '</option>').join('');
      const helloAcct = commsAccounts.find(a => a.email_address === 'hello@primalpantry.co.nz');
      if (helloAcct) fromEl.value = helloAcct.id;
    } else {
      fetch('/.netlify/functions/gmail-auth?action=status&token=' + currentStaff.token)
        .then(r => r.json())
        .then(d => {
          commsAccounts = d.accounts || [];
          fromEl.innerHTML = commsAccounts.map(a => '<option value="' + a.id + '">' + esc(a.email_address) + '</option>').join('');
          const helloAcct = commsAccounts.find(a => a.email_address === 'hello@primalpantry.co.nz');
          if (helloAcct) fromEl.value = helloAcct.id;
        }).catch(() => {});
    }

    document.getElementById('recovery-result').textContent = '';
    updateRecoveryPreview();
    document.getElementById('recovery-email-modal').classList.add('open');
  }

  // Recovery modal close handlers
  document.getElementById('recovery-close').addEventListener('click', () => {
    document.getElementById('recovery-email-modal').classList.remove('open');
  });
  document.getElementById('recovery-cancel').addEventListener('click', () => {
    document.getElementById('recovery-email-modal').classList.remove('open');
  });
  document.getElementById('recovery-email-modal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open');
  });

  // Recovery modal send handler — sends via integrated Gmail
  document.getElementById('recovery-send').addEventListener('click', async () => {
    const accountId = parseInt(document.getElementById('recovery-from').value);
    const to = document.getElementById('recovery-to').value.trim();
    const subject = document.getElementById('recovery-subject').value.trim();
    const body = buildRecoveryEmailHtml();
    const resultEl = document.getElementById('recovery-result');
    const btn = document.getElementById('recovery-send');

    if (!accountId) { resultEl.innerHTML = '<span style="color:var(--red);">No Gmail account selected</span>'; return; }
    if (!to) { resultEl.innerHTML = '<span style="color:var(--red);">No recipient email</span>'; return; }

    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      const res = await commsApi('send', {
        account_id: accountId,
        to: to,
        subject: subject,
        body: body,
        send_type: 'direct',
      });

      if (res.success) {
        resultEl.innerHTML = '<span style="color:var(--sage);">Email sent!</span>';
        // Update abandoned checkout status
        try {
          await fetch(AC_BASE + '?token=' + currentStaff.token + '&action=update_status&session_id=' + encodeURIComponent(recoveryAc.session_id) + '&status=contacted');
        } catch {}
        recoveryAc.status = 'contacted';
        recoveryAc.contacted_at = new Date().toISOString();
        renderAbandonedTable();
        setTimeout(() => document.getElementById('recovery-email-modal').classList.remove('open'), 1200);
      } else {
        resultEl.innerHTML = '<span style="color:var(--red);">' + esc(res.error || 'Send failed') + '</span>';
      }
    } catch (e) {
      resultEl.innerHTML = '<span style="color:var(--red);">' + esc(e.message) + '</span>';
    }
    btn.disabled = false; btn.textContent = 'Send Email';
  });

  // Expose to global scope for onclick handlers
  window.previewRecoveryEmail = previewRecoveryEmail;
  window.updateRecoveryPreview = updateRecoveryPreview;

  // ── Country Heatmap ──
  // Simplified world map using country code → [lat, lng] centroids
  const COUNTRY_COORDS = {NZ:[-41,174],AU:[-25,134],US:[38,-97],GB:[54,-2],CA:[56,-106],DE:[51,10],FR:[47,2],JP:[36,138],CN:[35,105],IN:[21,78],BR:[-14,-51],ZA:[-29,24],MX:[23,-102],KR:[36,128],SG:[1.35,103.8],MY:[4,101],ID:[-5,120],TH:[15,100],PH:[13,122],VN:[16,108],TW:[24,121],HK:[22,114],AE:[24,54],SA:[24,45],IL:[31,35],IT:[43,12],ES:[40,-4],NL:[52,5],SE:[62,15],NO:[60,8],DK:[56,10],FI:[64,26],PL:[52,20],CZ:[50,15],AT:[47,14],CH:[47,8],BE:[50,4],IE:[53,-8],PT:[40,-8],RU:[62,105],UA:[49,32],AR:[-34,-64],CL:[-35,-71],CO:[4,-72],PE:[-10,-76],PK:[30,69],BD:[24,90],LK:[7,81],MM:[22,98],KH:[13,105],NP:[28,84]};

  function waRenderCountryMap(container, countryCounts, isRealtime) {
    const maxCount = Math.max(...Object.values(countryCounts), 1);
    // Use mercator-like projection for a simple inline map
    const W = 600, H = 300;
    const toX = lng => ((lng + 180) / 360) * W;
    const toY = lat => {
      const latR = lat * Math.PI / 180;
      const merc = Math.log(Math.tan(Math.PI / 4 + latR / 2));
      return (H / 2) - (merc * H / (2 * Math.PI)) * 0.9;
    };

    let svg = `<svg viewBox="0 0 ${W} ${H}" class="wa-map-svg" style="background:var(--bg);border-radius:8px;border:1px solid var(--border);">`;
    // Draw subtle grid lines
    for (let lng = -180; lng <= 180; lng += 60) {
      svg += `<line x1="${toX(lng)}" y1="0" x2="${toX(lng)}" y2="${H}" stroke="var(--border)" stroke-width="0.3" opacity="0.5"/>`;
    }
    for (let lat = -60; lat <= 80; lat += 30) {
      svg += `<line x1="0" y1="${toY(lat)}" x2="${W}" y2="${toY(lat)}" stroke="var(--border)" stroke-width="0.3" opacity="0.5"/>`;
    }

    // Draw dots for each country
    Object.entries(countryCounts).forEach(([code, count]) => {
      const coords = COUNTRY_COORDS[code];
      if (!coords) return;
      const x = toX(coords[1]);
      const y = toY(coords[0]);
      const intensity = count / maxCount;
      const r = isRealtime ? Math.max(5, intensity * 14) : Math.max(4, intensity * 12);
      const color = isRealtime ? '74,222,128' : '107,143,91';
      svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(${color},${0.4 + intensity * 0.5})" stroke="rgba(${color},0.8)" stroke-width="1">`;
      svg += `<title>${code}: ${count} visitor${count !== 1 ? 's' : ''}</title>`;
      svg += `</circle>`;
      if (isRealtime) {
        svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="rgba(${color},0.4)" stroke-width="1"><animate attributeName="r" from="${r}" to="${r + 8}" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite"/></circle>`;
      }
    });

    svg += '</svg>';
    const legendHtml = `<div class="wa-map-legend"><span>Fewer</span><div class="wa-map-legend-bar"></div><span>More</span></div>`;
    const mapDiv = document.createElement('div');
    mapDiv.innerHTML = svg + legendHtml;
    container.appendChild(mapDiv);
  }

  // Render historical country map after dashboard loads
  function waRenderHistoricalMap(countriesData) {
    const mapEl = document.getElementById('wa-country-map');
    if (!mapEl) return;
    if (!countriesData || !countriesData.length) {
      mapEl.innerHTML = '<p style="color:var(--dim);text-align:center;padding:1rem;font-size:0.85rem;">No location data</p>';
      return;
    }
    const counts = {};
    countriesData.forEach(c => { if (c.name && c.name.trim()) counts[c.name.trim()] = c.visitors || 0; });
    if (Object.keys(counts).length === 0) {
      mapEl.innerHTML = '<p style="color:var(--dim);text-align:center;padding:1rem;font-size:0.85rem;">No location data</p>';
      return;
    }
    mapEl.innerHTML = '';
    waRenderCountryMap(mapEl, counts, false);
  }

  // ── Funnel Filters ──
  let waFunnelFilterCol = '';
  let waFunnelFilterVal = '';

  document.getElementById('wa-funnel-filter-type').addEventListener('change', async function() {
    const col = this.value;
    waFunnelFilterCol = col;
    waFunnelFilterVal = '';
    const valSelect = document.getElementById('wa-funnel-filter-value');
    if (!col) {
      valSelect.style.display = 'none';
      valSelect.innerHTML = '';
      // Reload funnel without filter
      await waReloadFunnel();
      return;
    }
    // Populate value dropdown from traffic data
    let options = [];
    if (col === 'utm_source') {
      const data = waTrafficData.campaigns || [];
      // We need utm_source data — check if we have it cached or fetch it
      const { from, to } = waGetDates();
      const fp = {}; waFilters.forEach((f, i) => { fp['fc'+i] = f.col; fp['fv'+i] = f.val; });
      try {
        const srcData = await waFetch('analytics-dashboard', { site: waSite, from, to, ...fp, metric: 'campaigns', col: 'utm_source' });
        options = (srcData || []).map(r => r.name).filter(Boolean);
      } catch { options = []; }
    } else if (col === 'pathname') {
      options = (waTrafficData.pages || []).map(r => r.name).filter(Boolean);
    } else if (col === 'device_type') {
      options = (waTrafficData.devices || []).map(r => r.name).filter(Boolean);
    } else if (col === 'country') {
      options = (waTrafficData.countries || []).map(r => r.name).filter(Boolean);
    }
    valSelect.innerHTML = '<option value="">All</option>' + options.map(o => `<option value="${o.replace(/"/g,'&quot;')}">${col.startsWith('utm_') ? utmTranslate(col, o) : o}</option>`).join('');
    valSelect.style.display = '';
  });

  document.getElementById('wa-funnel-filter-value').addEventListener('change', async function() {
    waFunnelFilterVal = this.value;
    await waReloadFunnel();
  });

  async function waReloadFunnel() {
    const { from, to } = waGetDates();
    const fp = {}; waFilters.forEach((f, i) => { fp['fc'+i] = f.col; fp['fv'+i] = f.val; });
    // Add funnel-specific filter
    let extraIdx = waFilters.length;
    if (waFunnelFilterCol && waFunnelFilterVal) {
      fp['fc'+extraIdx] = waFunnelFilterCol;
      fp['fv'+extraIdx] = waFunnelFilterVal;
    }
    const base = { site: waSite, from, to, ...fp, metric: 'funnel' };
    const dims = Object.entries(waDimMap);
    const results = await Promise.allSettled(
      dims.map(([_, d]) => waFetch('analytics-dashboard', { ...base, col: d.col }))
    );
    // Get session-based funnel stages, fallback to events summary
    const filterParams = { site: waSite, from, to, ...fp };
    if (waFunnelFilterCol && waFunnelFilterVal) {
      filterParams['fc'+extraIdx] = waFunnelFilterCol;
      filterParams['fv'+extraIdx] = waFunnelFilterVal;
    }
    const [fsRes, summaryRes, eventsRes] = await Promise.allSettled([
      waFetch('analytics-dashboard', { ...filterParams, metric: 'funnel_stages' }),
      waFetch('analytics-dashboard', { ...filterParams, metric: 'summary' }),
      waFetch('analytics-dashboard', { ...filterParams, metric: 'events' }),
    ]);
    const fs = fsRes.status === 'fulfilled' ? fsRes.value : null;
    const summary = summaryRes.status === 'fulfilled' ? summaryRes.value : {};
    const evts = eventsRes.status === 'fulfilled' ? eventsRes.value : [];
    const hasFunnelRPC = fs && fs.visitors != null;
    const uv = summary.unique_visitors || 0;
    const evAtc = ((evts || []).find(e => e.event_name === 'add to cart') || {}).uniques || 0;
    const evCo = ((evts || []).find(e => e.event_name === 'proceed to checkout') || {}).uniques || 0;
    const evSale = ((evts || []).find(e => e.event_name === 'checkout completed') || {}).uniques || 0;
    const fVisitors = hasFunnelRPC ? fs.visitors : uv;
    const fAtc = hasFunnelRPC ? fs.atc : Math.min(evAtc, uv);
    const fCheckout = hasFunnelRPC ? fs.checkout : Math.min(evCo, Math.min(evAtc, uv));
    const fPurchased = hasFunnelRPC ? fs.purchased : Math.min(evSale, Math.min(evCo, Math.min(evAtc, uv)));

    const funnelStages = [
      { label: 'Visitors', count: fVisitors, color: '#6B8F5B' },
      { label: 'Add to Cart', count: fAtc, color: '#8CB47A' },
      { label: 'Checkout', count: fCheckout, color: '#D4A84B' },
      { label: 'Purchased', count: fPurchased, color: '#C0955A' },
    ];
    const funnelEl = document.getElementById('wa-funnel-viz');
    if (fVisitors > 0) {
      let fhtml = '<div class="wa-funnel">';
      funnelStages.forEach((st, i) => {
        const widthPct = fVisitors > 0 ? Math.max(15, (st.count / fVisitors) * 100) : 15;
        const dropPct = i > 0 ? ((1 - st.count / funnelStages[i - 1].count) * 100) : 0;
        const dropStr = i > 0 && funnelStages[i - 1].count > 0 ? `↓ ${dropPct.toFixed(0)}% drop` : '';
        if (i > 0) fhtml += '<div class="wa-funnel-arrow">→</div>';
        fhtml += `<div class="wa-funnel-stage"><div class="wa-funnel-bar" style="background:${st.color};width:${widthPct}%;min-width:60px;"><span class="wa-funnel-count">${st.count}</span><span class="wa-funnel-label">${st.label}</span></div>${dropStr ? `<div class="wa-funnel-drop">${dropStr}</div>` : ''}</div>`;
      });
      fhtml += '</div>';
      funnelEl.innerHTML = fhtml;
      funnelEl.style.display = '';
      renderAbandonmentStats(funnelStages);
    }

    // Update funnel stats
    const lpAtc = fVisitors > 0 ? (fAtc / fVisitors * 100).toFixed(1) : '0.0';
    const lpSale = fVisitors > 0 ? (fPurchased / fVisitors * 100).toFixed(1) : '0.0';
    const atcSale = fAtc > 0 ? (fPurchased / fAtc * 100).toFixed(1) : '0.0';
    document.getElementById('wa-lp-atc').textContent = lpAtc + '%';
    document.getElementById('wa-lp-sale').textContent = lpSale + '%';
    document.getElementById('wa-atc-sale').textContent = atcSale + '%';

    waFunnelData = {};
    dims.forEach(([tableId, dim], i) => {
      const data = results[i].status === 'fulfilled' ? results[i].value : [];
      const enriched = (data || []).map(r => ({
        ...r,
        _atc_rate: r.visitors > 0 ? (r.atc / r.visitors * 100).toFixed(1) : '0.0',
        _sale_rate: r.visitors > 0 ? (r.sales / r.visitors * 100).toFixed(1) : '0.0',
        _revenue: 0,
      }));
      waFunnelData[tableId] = enriched;
    });
    waRenderFunnelTables();
  }

  // Show/hide funnel filters when switching views
  const origSetView = window.waSetView;
  window.waSetView = async function(view) {
    document.getElementById('wa-funnel-filters').style.display = view === 'funnel' ? '' : 'none';
    return origSetView(view);
  };

  // Date range controls
  document.getElementById('wa-range').addEventListener('change', function() {
    const custom = this.value === 'custom';
    document.getElementById('wa-from').style.display = custom ? '' : 'none';
    document.getElementById('wa-to').style.display = custom ? '' : 'none';
    if (!custom) waLoadDashboard();
  });
  document.getElementById('wa-from').addEventListener('change', waLoadDashboard);
  document.getElementById('wa-to').addEventListener('change', waLoadDashboard);

  // Site selector
  document.getElementById('wa-site').addEventListener('change', function() {
    waSite = this.value;
    waLoadDashboard();
  });

  // Main init
  window.waInit = async function() {
    if (!waToken()) return;

    // Load sites list
    try {
      const sites = await waFetch('analytics-dashboard', { metric: 'sites' });
      const sel = document.getElementById('wa-site');
      sel.innerHTML = '';
      if (sites && sites.length > 0) {
        // Sort so PrimalPantry.co.nz is first (default)
        const preferred = 'PrimalPantry.co.nz';
        sites.sort((a, b) => a === preferred ? -1 : b === preferred ? 1 : a.localeCompare(b));
        sites.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s; opt.textContent = s;
          sel.appendChild(opt);
        });
        waSite = sites[0];
      } else {
        sel.innerHTML = '<option value="">No sites yet</option>';
        return;
      }
    } catch (err) {
      document.getElementById('wa-site').innerHTML = '<option value="">Error loading sites</option>';
      return;
    }

    waLoadDashboard();
    utmLoadMappings();
    loadAbandonedCheckouts();
  };
})();

// ── Manufacturing Tab ──
let mfgBatches = [];
let mfgLoaded = false;
let mfgEditingId = null;

function parseBatchNo(str) {
  const parts = str.split('-');
  return { a: parseInt(parts[0], 10), b: parseInt(parts[1], 10) };
}

function nextBatchNo(batches) {
  if (!batches.length) return { a: 17, b: 13 };
  let maxA = 0, maxB = 0;
  batches.forEach(b => {
    const p = parseBatchNo(b.batch_no);
    if (p.a > maxA || (p.a === maxA && p.b > maxB)) { maxA = p.a; maxB = p.b; }
  });
  maxB++;
  if (maxB > 99) { maxB = 0; maxA++; }
  if (maxA > 99) maxA = 0;
  return { a: maxA, b: maxB };
}

function padBatch(n) { return String(n).padStart(2, '0'); }

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function loadManufacturingTab() {
  if (mfgLoaded) return;
  const { data, error } = await db.from('manufacturing_batches').select('*').order('created_at', { ascending: false });
  if (error) {
    document.getElementById('mfg-table').innerHTML = `<tr><td colspan="6" class="loading">Error: ${error.message}</td></tr>`;
    return;
  }
  mfgBatches = data || [];
  mfgLoaded = true;
  renderMfgStats();
  renderMfgTable();
  renderQueuedBatches();
  prefillMfgForm();
}

function prefillMfgForm() {
  const today = new Date();
  document.getElementById('mfg-date').value = today.toISOString().split('T')[0];
  const exp = new Date(today);
  exp.setMonth(exp.getMonth() + 14);
  document.getElementById('mfg-exp').value = exp.toISOString().split('T')[0];
  const next = nextBatchNo(mfgBatches);
  document.getElementById('mfg-batch-a').value = padBatch(next.a);
  document.getElementById('mfg-batch-b').value = padBatch(next.b);
}

function renderMfgStats() {
  const stats = document.getElementById('manufacturing-stats');
  const total = mfgBatches.length;
  const totalQty = mfgBatches.reduce((s, b) => s + (b.quantity || 0), 0);
  const uniqueSkus = new Set(mfgBatches.map(b => b.product_sku)).size;
  const latest = mfgBatches.length ? mfgBatches[0].batch_no : '—';
  const awaitingStockCount = allOrders.filter(o => o.awaiting_sku).length;
  stats.innerHTML = `
    <div class="stat-card"><div class="label">Batches Produced</div><div class="value">${total}</div></div>
    <div class="stat-card"><div class="label">Units Produced</div><div class="value">${totalQty.toLocaleString()}</div></div>
    <div class="stat-card"><div class="label">Unique SKUs</div><div class="value">${uniqueSkus}</div></div>
    <div class="stat-card"><div class="label">Latest Batch</div><div class="value">${latest}</div></div>
    <div class="stat-card" style="cursor:pointer;${awaitingStockCount ? 'border-color:var(--amber);' : ''}" onclick="document.querySelectorAll('[data-mfg-panel]').forEach(b=>b.classList.toggle('active',b.dataset.mfgPanel==='batches'));document.querySelectorAll('[id^=\\'mfg-panel-\\']').forEach(p=>p.style.display=p.id==='mfg-panel-batches'?'':'none');"><div class="label">Awaiting Stock</div><div class="value" style="color:var(--amber);">${awaitingStockCount}</div><div class="sub">orders on hold</div></div>
  `;
}

function renderMfgTable() {
  const tbody = document.getElementById('mfg-table');
  if (!mfgBatches.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No batches yet. Add your first batch above.</td></tr>';
    return;
  }
  tbody.innerHTML = mfgBatches.map(b => {
    if (mfgEditingId === b.id) {
      const bp = parseBatchNo(b.batch_no);
      return `<tr data-id="${b.id}">
        <td><input type="date" class="mfg-inline-input" value="${b.production_date || ''}" data-field="date"></td>
        <td><input type="text" class="mfg-inline-input" value="${b.product_sku || ''}" data-field="sku"></td>
        <td><input type="number" class="mfg-inline-input" value="${b.quantity || ''}" data-field="qty" min="1" style="width:5rem;"></td>
        <td><input type="text" class="mfg-inline-input mfg-inline-batch" value="${padBatch(bp.a)}" data-field="ba" maxlength="2"><span class="batch-sep">-</span><input type="text" class="mfg-inline-input mfg-inline-batch" value="${padBatch(bp.b)}" data-field="bb" maxlength="2"></td>
        <td><input type="date" class="mfg-inline-input" value="${b.expiry_date || ''}" data-field="exp"></td>
        <td><button class="mfg-save-btn" onclick="saveMfgEdit(${b.id})">Save</button><button class="mfg-cancel-btn" onclick="cancelMfgEdit()">Cancel</button></td>
      </tr>`;
    }
    return `<tr data-id="${b.id}" class="clickable" onclick="startMfgEdit(${b.id})">
      <td>${formatDate(b.production_date)}</td>
      <td>${b.product_sku || ''}</td>
      <td>${b.quantity || ''}</td>
      <td>${b.batch_no}</td>
      <td>${formatDate(b.expiry_date)}</td>
      <td><button class="mfg-edit-btn" onclick="event.stopPropagation(); startMfgEdit(${b.id})">Edit</button></td>
    </tr>`;
  }).join('');
}

function startMfgEdit(id) {
  mfgEditingId = id;
  renderMfgTable();
}

function cancelMfgEdit() {
  mfgEditingId = null;
  renderMfgTable();
}

async function saveMfgEdit(id) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  const date = row.querySelector('[data-field="date"]').value;
  const sku = row.querySelector('[data-field="sku"]').value.trim();
  const qty = parseInt(row.querySelector('[data-field="qty"]').value, 10);
  const ba = row.querySelector('[data-field="ba"]').value.padStart(2, '0');
  const bb = row.querySelector('[data-field="bb"]').value.padStart(2, '0');
  const exp = row.querySelector('[data-field="exp"]').value;
  const batchNo = `${ba}-${bb}`;

  const { error } = await db.from('manufacturing_batches').update({
    production_date: date, product_sku: sku, quantity: qty, batch_no: batchNo, expiry_date: exp
  }).eq('id', id);

  if (error) { alert('Save failed: ' + error.message); return; }

  const idx = mfgBatches.findIndex(b => b.id === id);
  if (idx >= 0) Object.assign(mfgBatches[idx], { production_date: date, product_sku: sku, quantity: qty, batch_no: batchNo, expiry_date: exp });
  mfgEditingId = null;
  renderMfgStats();
  renderMfgTable();
}

document.getElementById('mfg-add-btn').addEventListener('click', async function() {
  const date = document.getElementById('mfg-date').value;
  const sku = document.getElementById('mfg-sku').value.trim();
  const qty = parseInt(document.getElementById('mfg-qty').value, 10);
  const ba = document.getElementById('mfg-batch-a').value.padStart(2, '0');
  const bb = document.getElementById('mfg-batch-b').value.padStart(2, '0');
  const exp = document.getElementById('mfg-exp').value;

  if (!date || !sku || !qty || !ba || !bb || !exp) { alert('Please fill in all fields.'); return; }

  const batchNo = `${ba}-${bb}`;
  this.disabled = true;
  this.textContent = 'Adding...';

  const { data, error } = await db.from('manufacturing_batches').insert({
    production_date: date, product_sku: sku, quantity: qty, batch_no: batchNo, expiry_date: exp
  }).select().single();

  this.disabled = false;
  this.textContent = '+ Add Batch';

  if (error) { alert('Error adding batch: ' + error.message); return; }

  mfgBatches.unshift(data);
  renderMfgStats();
  renderMfgTable();
  document.getElementById('mfg-sku').value = '';
  document.getElementById('mfg-qty').value = '';
  prefillMfgForm();
});

// Auto-advance batch-a to batch-b on input
document.getElementById('mfg-batch-a').addEventListener('input', function() {
  if (this.value.length === 2) document.getElementById('mfg-batch-b').focus();
});

// ── SKU Autocomplete ──
function getMfgSkuList() {
  const skus = new Set();
  allLineItems.forEach(li => { if (li.sku) skus.add(li.sku); });
  mfgBatches.forEach(b => { if (b.product_sku) skus.add(b.product_sku); });
  return [...skus].sort();
}

(function() {
  const input = document.getElementById('mfg-sku');
  const dropdown = document.getElementById('mfg-sku-dropdown');
  let activeIdx = -1;

  function showDropdown(filter) {
    const all = getMfgSkuList();
    const q = filter.toLowerCase();
    const matches = q ? all.filter(s => s.toLowerCase().includes(q)) : all;
    if (!matches.length) { dropdown.classList.remove('open'); return; }
    activeIdx = -1;
    dropdown.innerHTML = matches.map((s, i) => `<div class="mfg-sku-option" data-idx="${i}">${s}</div>`).join('');
    dropdown.classList.add('open');
  }

  function pick(val) {
    input.value = val;
    dropdown.classList.remove('open');
    document.getElementById('mfg-qty').focus();
  }

  input.addEventListener('input', () => showDropdown(input.value));
  input.addEventListener('focus', () => { if (input.value || getMfgSkuList().length) showDropdown(input.value); });

  input.addEventListener('keydown', function(e) {
    const items = dropdown.querySelectorAll('.mfg-sku-option');
    if (!items.length || !dropdown.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle('active', i === activeIdx)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); items.forEach((el, i) => el.classList.toggle('active', i === activeIdx)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(items[activeIdx].textContent); }
    else if (e.key === 'Escape') { dropdown.classList.remove('open'); }
  });

  dropdown.addEventListener('click', function(e) {
    const opt = e.target.closest('.mfg-sku-option');
    if (opt) pick(opt.textContent);
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.mfg-sku-wrap')) dropdown.classList.remove('open');
  });
})();

// ── Unit Costs (COGS) ──
let unitCosts = {};
let unitCostsLoaded = false;
let unitCostEditingSku = null;

async function loadUnitCosts() {
  if (unitCostsLoaded) return;
  try {
    const { data, error } = await db.from('product_unit_costs').select('*');
    if (error) { console.error('Unit costs error:', error); return; }
    unitCosts = {};
    (data || []).forEach(row => { unitCosts[row.sku] = row; });
  } catch (e) { console.error('Unit costs load failed:', e); }
  unitCostsLoaded = true;
}

function getFullSkuList() {
  const map = {};
  SHOP_PRODUCTS.forEach(p => { map[p.sku] = p.desc; });
  allLineItems.forEach(li => { if (li.sku && !map[li.sku]) map[li.sku] = li.description || li.sku; });
  mfgBatches.forEach(b => { if (b.product_sku && !map[b.product_sku]) map[b.product_sku] = b.product_sku; });
  return Object.entries(map).map(([sku, desc]) => ({ sku, desc })).sort((a, b) => a.sku.localeCompare(b.sku));
}

function renderUnitCostsTable() {
  const tbody = document.getElementById('unit-costs-table');
  const allSkus = getFullSkuList();
  if (!allSkus.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);">No products found</td></tr>'; return; }
  tbody.innerHTML = allSkus.map(({ sku, desc }) => {
    const c = unitCosts[sku] || {};
    const ing = Number(c.ingredients || 0), lab = Number(c.labor || 0), pkg = Number(c.packaging || 0);
    const total = ing + lab + pkg;
    if (unitCostEditingSku === sku) {
      return '<tr data-sku="' + sku + '">' +
        '<td><strong>' + sku + '</strong></td>' +
        '<td style="font-size:0.82rem;">' + desc + '</td>' +
        '<td><input type="number" step="0.01" min="0" class="mfg-inline-input" value="' + (ing || '') + '" data-field="ingredients" style="width:70px;"></td>' +
        '<td><input type="number" step="0.01" min="0" class="mfg-inline-input" value="' + (lab || '') + '" data-field="labor" style="width:70px;"></td>' +
        '<td><input type="number" step="0.01" min="0" class="mfg-inline-input" value="' + (pkg || '') + '" data-field="packaging" style="width:70px;"></td>' +
        '<td>--</td>' +
        '<td><button class="mfg-save-btn" onclick="saveUnitCost(\'' + sku + '\')">Save</button> ' +
        '<button class="mfg-edit-btn" onclick="cancelUnitCostEdit()">Cancel</button></td></tr>';
    }
    const dash = '<span style=color:var(--dim)>--</span>';
    return '<tr class="clickable" onclick="startUnitCostEdit(\'' + sku + '\')" style="cursor:pointer;">' +
      '<td><strong>' + sku + '</strong></td>' +
      '<td style="font-size:0.82rem;">' + desc + '</td>' +
      '<td>' + (ing > 0 ? '$' + ing.toFixed(2) : dash) + '</td>' +
      '<td>' + (lab > 0 ? '$' + lab.toFixed(2) : dash) + '</td>' +
      '<td>' + (pkg > 0 ? '$' + pkg.toFixed(2) : dash) + '</td>' +
      '<td style="font-weight:600;">' + (total > 0 ? '$' + total.toFixed(2) : dash) + '</td>' +
      '<td><button class="mfg-edit-btn" onclick="event.stopPropagation(); startUnitCostEdit(\'' + sku + '\')">Edit</button></td></tr>';
  }).join('');
}

function startUnitCostEdit(sku) {
  unitCostEditingSku = sku;
  renderUnitCostsTable();
  const row = document.querySelector('tr[data-sku="' + sku + '"]');
  if (row) { const inp = row.querySelector('input'); if (inp) inp.focus(); }
}

function cancelUnitCostEdit() { unitCostEditingSku = null; renderUnitCostsTable(); }

async function saveUnitCost(sku) {
  const row = document.querySelector('tr[data-sku="' + sku + '"]');
  if (!row) return;
  const ingredients = parseFloat(row.querySelector('[data-field="ingredients"]').value) || 0;
  const labor = parseFloat(row.querySelector('[data-field="labor"]').value) || 0;
  const packaging = parseFloat(row.querySelector('[data-field="packaging"]').value) || 0;
  try {
    const { data, error } = await db.from('product_unit_costs')
      .upsert({ sku, ingredients, labor, packaging, updated_at: new Date().toISOString() }, { onConflict: 'sku' })
      .select().single();
    if (error) { alert('Save failed: ' + error.message); return; }
    unitCosts[sku] = data;
    unitCostEditingSku = null;
    renderUnitCostsTable();
  } catch (err) {
    alert('Save failed: ' + (err.message || 'Network error'));
  }
}

function getOrderCOGS(orderId) {
  const items = allLineItems.filter(li => li.order_id === orderId);
  let cogs = 0;
  items.forEach(li => {
    const c = unitCosts[li.sku];
    if (c) cogs += (li.quantity || 1) * (Number(c.ingredients || 0) + Number(c.labor || 0) + Number(c.packaging || 0));
  });
  return cogs;
}

// SKU Performance table
let skuPerfSortCol = 'revenue';
let skuPerfSortAsc = false;

function renderSkuPerformance() {
  const tbody = document.getElementById('sku-performance-table');

  // Build per-SKU aggregates from filtered orders
  const filteredIds = new Set(filteredOrders.map(o => o.id));
  const refundedIds = new Set(filteredOrders.filter(o => (o.status || '').toLowerCase().includes('refund')).map(o => o.id));

  const skuMap = {};
  allLineItems.forEach(li => {
    if (!filteredIds.has(li.order_id)) return;
    const sku = li.sku || 'Unknown';
    if (!skuMap[sku]) skuMap[sku] = { sku, name: li.description || sku, units: 0, revenue: 0, refundUnits: 0, orderIds: new Set(), refundOrderIds: new Set() };
    const qty = li.quantity || 1;
    skuMap[sku].units += qty;
    skuMap[sku].revenue += qty * Number(li.unit_price || 0);
    skuMap[sku].orderIds.add(li.order_id);
    if (refundedIds.has(li.order_id)) {
      skuMap[sku].refundUnits += qty;
      skuMap[sku].refundOrderIds.add(li.order_id);
    }
  });

  let rows = Object.values(skuMap).map(s => ({
    sku: s.sku,
    name: s.name,
    units: s.units,
    revenue: s.revenue,
    refunds: s.refundOrderIds.size,
    refund_rate: s.orderIds.size > 0 ? (s.refundOrderIds.size / s.orderIds.size * 100) : 0,
  }));

  // Sort
  rows.sort((a, b) => {
    let av = a[skuPerfSortCol], bv = b[skuPerfSortCol];
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    if (av < bv) return skuPerfSortAsc ? -1 : 1;
    if (av > bv) return skuPerfSortAsc ? 1 : -1;
    return 0;
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No SKU data for this period.</td></tr>';
    return;
  }

  const maxRevenue = Math.max(...rows.map(r => r.revenue));
  tbody.innerHTML = rows.map(r => {
    const barW = maxRevenue > 0 ? (r.revenue / maxRevenue * 100) : 0;
    const rateColor = r.refund_rate > 10 ? 'var(--red)' : r.refund_rate > 5 ? 'var(--amber)' : 'var(--sage)';
    return `<tr>
      <td style="font-weight:600;white-space:nowrap;">${r.sku}</td>
      <td>${r.name}</td>
      <td style="text-align:right;">${r.units.toLocaleString()}</td>
      <td style="text-align:right;"><div style="display:flex;align-items:center;justify-content:flex-end;gap:0.5rem;">$${r.revenue.toFixed(2)} <span class="utm-bar" style="width:${barW}%;max-width:60px;"></span></div></td>
      <td style="text-align:right;">${r.refunds}</td>
      <td style="text-align:right;color:${rateColor};font-weight:600;">${r.refund_rate.toFixed(1)}%</td>
    </tr>`;
  }).join('');

  // Update sort indicators
  document.querySelectorAll('#sku-performance-table').forEach(() => {
    document.querySelectorAll('[data-sku-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.skuSort === skuPerfSortCol) {
        th.classList.add(skuPerfSortAsc ? 'sort-asc' : 'sort-desc');
      }
    });
  });
}

// SKU performance sort click handlers
document.querySelectorAll('[data-sku-sort]').forEach(th => {
  th.addEventListener('click', function() {
    const col = this.dataset.skuSort;
    if (skuPerfSortCol === col) skuPerfSortAsc = !skuPerfSortAsc;
    else { skuPerfSortCol = col; skuPerfSortAsc = col === 'sku'; }
    renderSkuPerformance();
  });
});

// Manufacturing sub-tab switching
const mfgPanels = ['batches', 'unit-costs', 'sku-performance', 'inventory', 'supplier-orders', 'stripe-products'];
document.querySelectorAll('#mfg-sub-tabs .wa-panel-tab').forEach(tab => {
  tab.addEventListener('click', function() {
    document.querySelectorAll('#mfg-sub-tabs .wa-panel-tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    const panel = this.dataset.mfgPanel;
    mfgPanels.forEach(p => {
      const el = document.getElementById('mfg-panel-' + p);
      if (el) el.style.display = p === panel ? '' : 'none';
    });
    if (panel === 'unit-costs') { loadUnitCosts().then(function() { renderUnitCostsTable(); }); }
    if (panel === 'sku-performance') { renderSkuPerformance(); }
    if (panel === 'inventory') { loadInventory(); }
    if (panel === 'supplier-orders') { loadSupplierOrders(); }
    if (panel === 'stripe-products') { loadStripeProducts(); }
  });
});

// ── Stripe Products Tab ──
let spProducts = [];
let spPricesCache = {}; // product_id -> prices array
let spLoaded = false;
let spExpandedProduct = null;
let spAddingPriceToProduct = null; // product_id currently showing inline price form
const SP_ENDPOINT = '/.netlify/functions/stripe-products';

async function spFetch(payload) {
  const token = currentStaff?.token;
  const res = await fetch(SP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...payload }),
  });
  return res.json();
}

async function loadStripeProducts(force) {
  if (spLoaded && !force) { renderStripeProducts(); return; }
  const tbody = document.getElementById('sp-products-table');
  tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading products from Stripe...</td></tr>';
  const res = await spFetch({ action: 'list-products' });
  if (res.error) {
    tbody.innerHTML = `<tr><td colspan="6" class="loading">Error: ${res.error}</td></tr>`;
    return;
  }
  spProducts = (res.products || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  spLoaded = true;
  spPricesCache = {};
  renderStripeProducts();
}

function renderStripeProducts() {
  const tbody = document.getElementById('sp-products-table');
  const query = (document.getElementById('sp-search')?.value || '').toLowerCase().trim();
  const filtered = query ? spProducts.filter(p => (p.name || '').toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query) || (p.id || '').toLowerCase().includes(query)) : spProducts;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="loading">${spProducts.length ? 'No products match your search.' : 'No products found in Stripe. Create one above.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const created = new Date(p.created * 1000).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
    const isExpanded = spExpandedProduct === p.id;
    const arrow = isExpanded ? '&#9660;' : '&#9654;';
    let row = `<tr class="sp-product-row" data-product-id="${p.id}" style="cursor:pointer;">
      <td style="text-align:center;color:var(--muted);font-size:0.75rem;">${arrow}</td>
      <td style="font-weight:600;">${esc(p.name)}</td>
      <td style="color:var(--muted);">${esc(p.description || '—')}</td>
      <td style="font-size:0.75rem;font-family:monospace;color:var(--dim);">${p.id}</td>
      <td>${created}</td>
      <td><button class="sp-add-price-btn" data-product-id="${p.id}" data-product-name="${esc(p.name)}" style="background:var(--card);border:1px solid var(--sage);color:var(--sage);padding:0.35rem 0.65rem;border-radius:5px;cursor:pointer;font-size:0.75rem;font-weight:600;white-space:nowrap;">+ Price</button></td>
    </tr>`;
    if (isExpanded) {
      const prices = spPricesCache[p.id];
      if (!prices) {
        row += `<tr class="sp-prices-row"><td></td><td colspan="5" style="padding:0.75rem;"><span class="loading">Loading prices...</span></td></tr>`;
      } else if (prices.length === 0) {
        row += `<tr class="sp-prices-row"><td></td><td colspan="5" style="padding:0.75rem;color:var(--muted);font-size:0.85rem;">No prices yet. Click "+ Price" to add one.</td></tr>`;
      } else {
        const priceRows = prices.map(pr => {
          const amt = (pr.unit_amount / 100).toFixed(2);
          const cur = (pr.currency || 'nzd').toUpperCase();
          const type = pr.recurring ? `${pr.recurring.interval}ly` : 'One-time';
          const label = pr.nickname || '—';
          return `<tr class="sp-prices-row" style="background:var(--bg);">
            <td></td>
            <td style="padding-left:1.5rem;font-size:0.85rem;color:var(--sage);">&#8627; ${esc(label)}</td>
            <td style="font-size:0.85rem;font-weight:600;">$${amt} ${cur}</td>
            <td style="font-size:0.75rem;font-family:monospace;color:var(--dim);">${pr.id}</td>
            <td style="font-size:0.85rem;color:var(--muted);">${type}</td>
            <td></td>
          </tr>`;
        }).join('');
        row += priceRows;
      }
    }
    // Inline price form for this product
    if (spAddingPriceToProduct === p.id) {
      row += spGetInlineFormRow(p.id, p.name);
    }
    return row;
  }).join('');

  // Attach click handlers for expand/collapse
  document.querySelectorAll('.sp-product-row').forEach(row => {
    row.addEventListener('click', async function(e) {
      if (e.target.closest('.sp-add-price-btn')) return;
      const pid = this.dataset.productId;
      if (spExpandedProduct === pid) {
        spExpandedProduct = null;
      } else {
        spExpandedProduct = pid;
        if (!spPricesCache[pid]) {
          renderStripeProducts();
          const res = await spFetch({ action: 'list-prices', product_id: pid });
          spPricesCache[pid] = res.prices || [];
        }
      }
      renderStripeProducts();
    });
  });

  // Attach click handlers for "+ Price" buttons
  document.querySelectorAll('.sp-add-price-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const pid = this.dataset.productId;
      spAddingPriceToProduct = spAddingPriceToProduct === pid ? null : pid;
      // Also expand the product to show existing prices
      if (spAddingPriceToProduct) spExpandedProduct = pid;
      renderStripeProducts();
    });
  });

  // Attach inline price form handlers
  const inlineCreateBtn = document.getElementById('sp-inline-create-btn');
  if (inlineCreateBtn) {
    inlineCreateBtn.addEventListener('click', spHandleInlineCreatePrice);
  }
  const inlineCancelBtn = document.getElementById('sp-inline-cancel-btn');
  if (inlineCancelBtn) {
    inlineCancelBtn.addEventListener('click', () => { spAddingPriceToProduct = null; renderStripeProducts(); });
  }
}

function spGetInlineFormRow(productId, productName) {
  const selStyle = 'background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:5px;padding:0.35rem;font-size:0.8rem;';
  const inpStyle = 'background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:5px;padding:0.35rem 0.5rem;font-size:0.8rem;width:100%;';
  return `<tr class="sp-inline-form-row" style="background:var(--bg);">
    <td colspan="6" style="padding:0.75rem;">
      <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;color:var(--sage);">New price for ${esc(productName)}</div>
      <input type="hidden" id="sp-inline-product-id" value="${productId}">
      <input type="hidden" id="sp-inline-product-name" value="${esc(productName)}">
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;">
        <div style="min-width:80px;"><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Amount ($)</div><input type="number" id="sp-inline-amount" placeholder="29.95" step="0.01" min="0" oninput="var dp=document.getElementById('sp-inline-display-price');if(!dp.dataset.manual)dp.value=this.value;" style="${inpStyle}width:80px;"></div>
        <div style="min-width:70px;"><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Currency</div><select id="sp-inline-currency" style="${selStyle}"><option value="nzd">NZD</option><option value="aud">AUD</option><option value="usd">USD</option></select></div>
        <div style="flex:1;min-width:120px;"><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Variant Code</div><input type="text" id="sp-inline-nickname" placeholder="e.g. VM120, F250" style="${inpStyle}" title="Used as Stripe price description and variant identifier in orders"></div>
        <div style="min-width:80px;"><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Type</div><select id="sp-inline-type" style="${selStyle}"><option value="one_time">One-time</option><option value="month">Monthly</option><option value="week">Weekly</option><option value="year">Yearly</option></select></div>
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);">
        <div style="font-size:0.7rem;color:var(--muted);font-weight:600;width:100%;">Catalog Metadata</div>
        <div><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Category</div><select id="sp-inline-category" style="${selStyle}"><option value="tallow">tallow</option><option value="broth">broth</option></select></div>
        <div style="min-width:90px;"><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Product Type</div><input type="text" id="sp-inline-product-type" placeholder="balm" style="${inpStyle}width:90px;"></div>
        <div style="min-width:70px;"><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Size</div><input type="text" id="sp-inline-size" placeholder="120ml" style="${inpStyle}width:70px;"></div>
        <div><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Order Type</div><select id="sp-inline-order-type" style="${selStyle}"><option value="single">single</option><option value="pack">pack</option><option value="monthly">monthly</option><option value="quarterly">quarterly</option></select></div>
        <div><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Market</div><select id="sp-inline-market" style="${selStyle}"><option value="NZ">NZ</option><option value="AU">AU</option></select></div>
        <div style="min-width:80px;"><div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px;">Display $</div><input type="number" id="sp-inline-display-price" placeholder="29.95" step="0.01" min="0" oninput="this.dataset.manual='1'" style="${inpStyle}width:80px;"></div>
      </div>
      <div style="display:flex;gap:0.5rem;margin-top:0.65rem;">
        <button id="sp-inline-create-btn" class="mfg-add-btn" style="font-size:0.8rem;padding:0.4rem 0.75rem;">Create Price</button>
        <button id="sp-inline-cancel-btn" style="background:var(--card);border:1px solid var(--border);color:var(--muted);padding:0.4rem 0.75rem;border-radius:6px;cursor:pointer;font-size:0.8rem;">Cancel</button>
      </div>
    </td>
  </tr>`;
}

async function spHandleInlineCreatePrice() {
  const btn = document.getElementById('sp-inline-create-btn');
  const product_id = document.getElementById('sp-inline-product-id').value;
  const amount = parseFloat(document.getElementById('sp-inline-amount').value);
  const currency = document.getElementById('sp-inline-currency').value;
  const nickname = document.getElementById('sp-inline-nickname').value.trim();
  const priceType = document.getElementById('sp-inline-type').value;

  if (!product_id) { alert('No product selected'); return; }
  if (isNaN(amount) || amount < 0) { alert('Enter a valid price amount'); return; }

  const unit_amount = Math.round(amount * 100);
  const payload = { action: 'create-price', product_id, unit_amount, currency };
  if (nickname) payload.nickname = nickname;
  if (priceType !== 'one_time') payload.recurring_interval = priceType;

  // Include catalog metadata — variant code comes from the nickname field
  const metaPT = document.getElementById('sp-inline-product-type').value.trim();
  const metaSize = document.getElementById('sp-inline-size').value.trim();
  if (metaPT && nickname && metaSize) {
    payload.category = document.getElementById('sp-inline-category').value;
    payload.product_type = metaPT;
    payload.variant = nickname;
    payload.size = metaSize;
    payload.order_type = document.getElementById('sp-inline-order-type').value;
    payload.market = document.getElementById('sp-inline-market').value;
    payload.display_price = document.getElementById('sp-inline-display-price').value || amount || null;
    payload.product_name = document.getElementById('sp-inline-product-name').value;
  }

  btn.disabled = true; btn.textContent = 'Creating...';
  const res = await spFetch(payload);
  btn.disabled = false; btn.textContent = 'Create Price';
  if (res.error) { alert('Error: ' + res.error); return; }

  spAddingPriceToProduct = null;
  delete spPricesCache[product_id];
  spExpandedProduct = product_id;
  const priceRes = await spFetch({ action: 'list-prices', product_id });
  spPricesCache[product_id] = priceRes.prices || [];
  spCatalogLoaded = false;
  renderStripeProducts();
}

// New Product form
document.getElementById('sp-new-product-btn').addEventListener('click', () => {
  document.getElementById('sp-new-product-form').style.display = '';
  spAddingPriceToProduct = null;
  document.getElementById('sp-prod-name').value = '';
  document.getElementById('sp-prod-desc').value = '';
  document.getElementById('sp-prod-name').focus();
});
document.getElementById('sp-cancel-product-btn').addEventListener('click', () => {
  document.getElementById('sp-new-product-form').style.display = 'none';
});

document.getElementById('sp-create-product-btn').addEventListener('click', async () => {
  const btn = document.getElementById('sp-create-product-btn');
  const name = document.getElementById('sp-prod-name').value.trim();
  const description = document.getElementById('sp-prod-desc').value.trim();
  if (!name) { alert('Product name is required'); return; }
  btn.disabled = true; btn.textContent = 'Creating...';
  const res = await spFetch({ action: 'create-product', name, description });
  btn.disabled = false; btn.textContent = 'Create Product';
  if (res.error) { alert('Error: ' + res.error); return; }
  document.getElementById('sp-new-product-form').style.display = 'none';
  spLoaded = false;
  await loadStripeProducts(true);
});

// Refresh button
document.getElementById('sp-refresh-btn').addEventListener('click', () => {
  loadStripeProducts(true);
});

// Search filter
document.getElementById('sp-search').addEventListener('input', () => {
  if (spLoaded) renderStripeProducts();
});

// ── Stripe Products: View Switching, YAML Generator, Form Builder ──
let spCatalog = [];
let spCatalogLoaded = false;
let spCurrentView = 'stripe';

// View toggle
document.querySelectorAll('.sp-view-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.sp-view-btn').forEach(b => {
      b.style.background = 'var(--card)'; b.style.color = 'var(--text)'; b.style.border = '1px solid var(--border)';
    });
    this.style.background = 'var(--sage)'; this.style.color = '#fff'; this.style.border = 'none';
    spCurrentView = this.id.replace('sp-view-', '');
    document.getElementById('sp-stripe-view').style.display = spCurrentView === 'stripe' ? '' : 'none';
    document.getElementById('sp-yaml-view').style.display = spCurrentView === 'yaml' ? '' : 'none';
    document.getElementById('sp-formbuilder-view').style.display = spCurrentView === 'formbuilder' ? '' : 'none';
    if (spCurrentView === 'yaml') loadAndGenerateYaml();
    if (spCurrentView === 'formbuilder') loadFormBuilder();
  });
});

// ── YAML Generator ──
async function loadCatalog(force) {
  if (spCatalogLoaded && !force) return;
  const { data, error } = await db.from('product_price_map').select('*').order('category,product_type,variant,size');
  if (error) { console.error('Catalog load error:', error); return; }
  spCatalog = data || [];
  spCatalogLoaded = true;
}

async function loadAndGenerateYaml() {
  await loadCatalog();
  document.getElementById('sp-yaml-output').textContent = spCatalog.length ? generatePricingYaml(spCatalog) : '# No catalog entries yet.\n# Create prices with catalog metadata to generate YAML.';
}

function generatePricingYaml(rows) {
  // Build nested: category.ids.product_type.order_type.variant.size.market = price_id
  const tree = {};
  for (const r of rows) {
    const { category, product_type, order_type, variant, size, market, stripe_price_id } = r;
    if (!tree[category]) tree[category] = {};
    if (!tree[category][product_type]) tree[category][product_type] = {};
    if (!tree[category][product_type][order_type]) tree[category][product_type][order_type] = {};
    if (!tree[category][product_type][order_type][variant]) tree[category][product_type][order_type][variant] = {};
    if (!tree[category][product_type][order_type][variant][size]) tree[category][product_type][order_type][variant][size] = {};
    tree[category][product_type][order_type][variant][size][market] = stripe_price_id;
  }

  // Build display pricing: category.pricing.product_type[] = { size, prices: { market: { order_label: price } } }
  const displayTree = {};
  const labelMap = { single: 'single_purchase', monthly: 'recurring_monthly', quarterly: 'recurring_quarterly', pack: 'three_pack' };
  for (const r of rows) {
    if (!r.display_price) continue;
    const { category, product_type, size, market, order_type } = r;
    if (!displayTree[category]) displayTree[category] = {};
    if (!displayTree[category][product_type]) displayTree[category][product_type] = {};
    if (!displayTree[category][product_type][size]) displayTree[category][product_type][size] = {};
    if (!displayTree[category][product_type][size][market]) displayTree[category][product_type][size][market] = {};
    displayTree[category][product_type][size][market][labelMap[order_type] || order_type] = Number(r.display_price);
  }

  // Serialize
  let out = '';
  for (const cat of Object.keys(tree).sort()) {
    out += `${cat}:\n  ids:\n`;
    for (const pt of Object.keys(tree[cat]).sort()) {
      out += `    ${pt}:\n`;
      for (const ot of Object.keys(tree[cat][pt]).sort()) {
        out += `      ${ot}:\n`;
        for (const v of Object.keys(tree[cat][pt][ot]).sort()) {
          out += `        ${v}:\n`;
          for (const sz of Object.keys(tree[cat][pt][ot][v]).sort()) {
            out += `          ${sz}:\n`;
            for (const mkt of Object.keys(tree[cat][pt][ot][v][sz]).sort()) {
              out += `            ${mkt}: "${tree[cat][pt][ot][v][sz][mkt]}"\n`;
            }
          }
        }
      }
    }
    // Display pricing section
    if (displayTree[cat]) {
      out += `  pricing:\n`;
      for (const pt of Object.keys(displayTree[cat]).sort()) {
        out += `    ${pt}:\n`;
        for (const sz of Object.keys(displayTree[cat][pt]).sort()) {
          out += `      - size: "${sz}"\n        prices:\n`;
          for (const mkt of Object.keys(displayTree[cat][pt][sz]).sort()) {
            out += `          ${mkt}:\n`;
            for (const lbl of Object.keys(displayTree[cat][pt][sz][mkt]).sort()) {
              out += `            ${lbl}: ${displayTree[cat][pt][sz][mkt][lbl]}\n`;
            }
          }
        }
      }
    }
    out += '\n';
  }
  return out;
}

document.getElementById('sp-copy-yaml').addEventListener('click', () => {
  const yaml = document.getElementById('sp-yaml-output').textContent;
  navigator.clipboard.writeText(yaml).then(() => {
    const btn = document.getElementById('sp-copy-yaml');
    btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy to Clipboard', 2000);
  });
});

// ── Form Builder ──
async function loadFormBuilder() {
  await loadCatalog();
  // Also need Stripe products loaded for the dropdown
  if (!spLoaded) await loadStripeProducts();

  const select = document.getElementById('sp-fb-product-select');
  // Get unique stripe_product_ids from catalog
  const catalogProductIds = [...new Set(spCatalog.map(r => r.stripe_product_id))];
  const opts = catalogProductIds.map(pid => {
    const name = spCatalog.find(r => r.stripe_product_id === pid)?.product_name || pid;
    const spProd = spProducts.find(p => p.id === pid);
    const displayName = spProd ? spProd.name : name;
    return `<option value="${pid}">${esc(displayName)}</option>`;
  }).join('');
  select.innerHTML = '<option value="">-- Select a product --</option>' + opts;

  renderFormBuilder();
}

document.getElementById('sp-fb-product-select').addEventListener('change', renderFormBuilder);

function renderFormBuilder() {
  const pid = document.getElementById('sp-fb-product-select').value;
  const entriesDiv = document.getElementById('sp-fb-entries');
  const outputPre = document.getElementById('sp-form-output');

  if (!pid) {
    entriesDiv.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;">Select a product to see its catalog entries and generate a form.</p>';
    outputPre.textContent = '';
    return;
  }

  const entries = spCatalog.filter(r => r.stripe_product_id === pid);
  if (!entries.length) {
    entriesDiv.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;">No catalog entries for this product. Add prices with metadata first.</p>';
    outputPre.textContent = '';
    return;
  }

  // Show entries table
  entriesDiv.innerHTML = `<table style="margin-bottom:1rem;"><thead><tr><th>Variant</th><th>Size</th><th>Order Type</th><th>Market</th><th>Price</th><th>Price ID</th></tr></thead><tbody>${
    entries.map(r => `<tr>
      <td>${esc(r.variant)}</td>
      <td>${esc(r.size)}</td>
      <td>${esc(r.order_type)}</td>
      <td>${esc(r.market)}</td>
      <td>$${r.display_price || (r.unit_amount / 100).toFixed(2)}</td>
      <td style="font-size:0.75rem;font-family:monospace;color:var(--dim);">${r.stripe_price_id}</td>
    </tr>`).join('')
  }</tbody></table>`;

  // Generate form HTML
  outputPre.textContent = generateFormHtml(entries);
}

function generateFormHtml(entries) {
  const productName = entries[0]?.product_name || 'Product';
  const category = entries[0]?.category || 'tallow';
  const productType = entries[0]?.product_type || 'product';

  // Extract unique values
  const variants = [...new Set(entries.map(r => r.variant))];
  const sizes = [...new Set(entries.map(r => r.size))];
  const orderTypes = [...new Set(entries.map(r => r.order_type))];
  const defaultPrice = entries[0]?.display_price || (entries[0]?.unit_amount / 100).toFixed(2);

  // Build hidden form radios
  let formInputs = '';
  variants.forEach((v, i) => {
    formInputs += `    <input type="radio" id="${v}" name="flavor" value="${v}"${i === 0 ? ' checked' : ''}>\n`;
  });
  orderTypes.forEach((ot, i) => {
    formInputs += `    <input type="radio" id="${ot}" name="orderType" value="${ot}"${i === 0 ? ' checked' : ''}>\n`;
  });
  sizes.forEach((sz, i) => {
    formInputs += `    <input type="radio" id="size${sz}" name="size" value="${sz}"${i === 0 ? ' checked' : ''}>\n`;
  });

  // Build purchase options
  const orderTypeLabels = { single: 'Single', pack: '3 Pack', monthly: 'Monthly', quarterly: 'Quarterly' };
  let purchaseOpts = '';
  if (orderTypes.length > 1) {
    purchaseOpts = `<div class="purchase-options" style="flex-direction:row;gap:8px;">\n`;
    orderTypes.forEach((ot, i) => {
      const label = orderTypeLabels[ot] || ot;
      purchaseOpts += `    <label class="purchase-option${i === 0 ? ' selected' : ''}" data-value="${ot}" style="flex:1;padding:8.5px 10px;">\n`;
      purchaseOpts += `        <div class="option-left" style="gap:6px;white-space:nowrap;">\n`;
      purchaseOpts += `            <div class="option-radio" style="width:14px;height:14px;"><div class="dot-inner" style="width:7px;height:7px;"></div></div>\n`;
      purchaseOpts += `            <div class="option-label" style="font-size:13px;">${label}</div>\n`;
      purchaseOpts += `        </div>\n`;
      purchaseOpts += `    </label>\n`;
    });
    purchaseOpts += `</div>\n`;
  }

  // Build size pills
  let sizePills = '';
  if (sizes.length > 1) {
    sizePills = `<div class="pp-selector-group" id="wrap-sizes">\n    <div class="pp-selector-label">Size</div>\n    <div class="scent-pills">\n`;
    sizes.forEach((sz, i) => {
      sizePills += `        <div class="scent-pill${i === 0 ? ' active' : ''}" data-size="${sz}">${sz}</div>\n`;
    });
    sizePills += `    </div>\n</div>\n`;
  }

  // Build variant/scent pills
  let variantPills = '';
  if (variants.length > 1) {
    variantPills = `<div class="pp-selector-group">\n    <div class="pp-selector-label">Scent</div>\n    <div class="scent-pills" style="flex-wrap:nowrap;gap:6px;">\n`;
    variants.forEach((v, i) => {
      const displayName = v.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      variantPills += `        <div class="scent-pill${i === 0 ? ' active' : ''}" data-flavor="${v}" style="font-size:12px;padding:5px 10px;">${displayName}</div>\n`;
    });
    variantPills += `    </div>\n</div>\n`;
  }

  // Build price map JS object
  // Structure: { order_type: { variant: { size: { market: "price_id" } } } }
  const priceMap = {};
  entries.forEach(r => {
    if (!priceMap[r.order_type]) priceMap[r.order_type] = {};
    if (!priceMap[r.order_type][r.variant]) priceMap[r.order_type][r.variant] = {};
    if (!priceMap[r.order_type][r.variant][r.size]) priceMap[r.order_type][r.variant][r.size] = {};
    priceMap[r.order_type][r.variant][r.size][r.market] = r.stripe_price_id;
  });

  // Build display price map
  const displayPriceMap = {};
  entries.filter(r => r.display_price).forEach(r => {
    const key = `${r.order_type}|${r.variant}|${r.size}`;
    displayPriceMap[key] = Number(r.display_price);
  });

  let html = '';
  html += `<!-- ═══ PRODUCT FORM: ${productName} ═══ -->\n`;
  html += `<!-- Generated by OSO Dashboard — paste into your product page template -->\n\n`;

  // Pricing display
  html += `<div class="pp-pricing-section">\n`;
  html += `    <span class="pp-price-main"><span id="price">$${defaultPrice}</span></span>\n`;
  html += `    <p class="afterpay-note">or 4 interest free payments of $<span id="afterpay_price">${(defaultPrice / 4).toFixed(2)}</span> with <img src="/img/afterpay.webp" class="d-inline" height="18" alt="afterpay"></p>\n`;
  html += `</div>\n\n`;

  // Hidden form
  html += `<form id="productForm" autocomplete="off" style="display:none;">\n${formInputs}</form>\n\n`;

  // Purchase options
  if (purchaseOpts) html += purchaseOpts + '\n';

  // Size pills
  if (sizePills) html += sizePills + '\n';

  // Variant pills
  if (variantPills) html += variantPills + '\n';

  // Stock indicator
  html += `<div class="stock-indicator">\n    <span class="stock-dot"></span> In Stock · Ships within 1–3 business days\n</div>\n\n`;

  // Action row
  html += `<div class="action-row">\n`;
  html += `    <div class="pp-qty-selector">\n`;
  html += `        <button type="button" class="btn-decrease">−</button>\n`;
  html += `        <input type="number" class="form-control" id="quantityAll" name="quantity" min="1" value="1" readonly>\n`;
  html += `        <button type="button" class="btn-increase">+</button>\n`;
  html += `    </div>\n`;
  html += `    <button class="btn-add-to-cart buy-now" type="button" data-price-id="" data-quantity-id="quantityAll">\n`;
  html += `        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="position:relative;z-index:1;"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>\n`;
  html += `        <span style="position:relative;z-index:1;">Add To Cart — $<span id="cartPriceDisplay">${defaultPrice}</span></span>\n`;
  html += `    </button>\n`;
  html += `</div>\n\n`;

  html += `<p class="sub-cta">Money back guarantee · Speedy NZ-wide shipping</p>\n\n`;

  // Guarantee bar
  html += `<div class="guarantee-bar">\n`;
  html += `    <div class="guarantee-item"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>NZ Made</div>\n`;
  html += `    <div class="guarantee-item"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>Gentle on Skin</div>\n`;
  html += `    <div class="guarantee-item"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>Money Back</div>\n`;
  html += `</div>\n\n`;

  // JavaScript
  html += `<script>\n`;
  html += `// Price data from pricing-new.yaml via Hugo\n`;
  html += `const pricingNewData = JSON.parse('{{ .Site.Data.pricing_new | jsonify }}');\n`;
  html += `const productPrices = pricingNewData?.${category}?.ids?.${productType} || {};\n`;
  html += `const country_code = window.country_code || 'NZ';\n\n`;

  // Display price map
  if (Object.keys(displayPriceMap).length) {
    html += `const displayPrices = ${JSON.stringify(displayPriceMap, null, 2)};\n\n`;
  }

  // updatePriceId
  html += `function updatePriceId() {\n`;
  html += `    const size = document.querySelector('input[name="size"]:checked')?.value || '${sizes[0]}';\n`;
  html += `    const flavor = document.querySelector('input[name="flavor"]:checked')?.value || '${variants[0]}';\n`;
  html += `    const orderType = document.querySelector('input[name="orderType"]:checked')?.value || '${orderTypes[0]}';\n`;
  html += `    try {\n`;
  html += `        const priceId = productPrices?.[orderType]?.[flavor]?.[size]?.[country_code] || '';\n`;
  html += `        document.querySelector('.buy-now')?.setAttribute('data-price-id', priceId);\n`;
  html += `    } catch(e) { console.error('Price ID lookup error:', e); }\n`;

  if (Object.keys(displayPriceMap).length) {
    html += `    const dpKey = orderType + '|' + flavor + '|' + size;\n`;
    html += `    const dp = displayPrices[dpKey];\n`;
    html += `    if (dp) {\n`;
    html += `        document.getElementById('price').textContent = '$' + dp.toFixed(2);\n`;
    html += `        document.getElementById('afterpay_price').textContent = (dp / 4).toFixed(2);\n`;
    html += `        document.getElementById('cartPriceDisplay').textContent = dp.toFixed(2);\n`;
    html += `    }\n`;
  }

  html += `}\n\n`;

  // handleAddToCart
  html += `function handleAddToCart(event) {\n`;
  html += `    event.preventDefault();\n`;
  html += `    const button = event.target.closest('.buy-now');\n`;
  html += `    const priceId = button.getAttribute('data-price-id');\n`;
  html += `    if (!priceId) { alert('Please select valid options before adding to cart.'); return; }\n`;
  html += `    const size = document.querySelector('input[name="size"]:checked')?.value || '${sizes[0]}';\n`;
  html += `    const flavor = document.querySelector('input[name="flavor"]:checked')?.value || '${variants[0]}';\n`;
  html += `    const orderType = document.querySelector('input[name="orderType"]:checked')?.value || '${orderTypes[0]}';\n`;
  html += `    const unitPrice = parseFloat(document.getElementById('price')?.textContent?.replace('$','')) || 0;\n`;
  html += `    const quantity = parseInt(document.getElementById('quantityAll')?.value) || 1;\n`;
  html += `    const cart = JSON.parse(localStorage.getItem('cartV2')) || [];\n`;
  html += `    cart.push({ priceId, title: '${productName.replace(/'/g, "\\'")}', size, flavor, orderType, quantity, unitPrice, eligibleForDiscount: false });\n`;
  html += `    localStorage.setItem('cartV2', JSON.stringify(cart));\n`;
  html += `    alert('Item added to cart!');\n`;
  html += `}\n\n`;

  // Init
  html += `document.addEventListener('DOMContentLoaded', function() {\n`;
  html += `    document.getElementById('productForm').addEventListener('change', updatePriceId);\n`;
  html += `    updatePriceId();\n`;
  html += `    document.querySelector('.buy-now')?.addEventListener('click', handleAddToCart);\n\n`;

  // Quantity buttons
  html += `    document.querySelector('.btn-increase')?.addEventListener('click', () => {\n`;
  html += `        const q = document.getElementById('quantityAll'); q.value = Math.min(10, (parseInt(q.value)||1) + 1);\n`;
  html += `    });\n`;
  html += `    document.querySelector('.btn-decrease')?.addEventListener('click', () => {\n`;
  html += `        const q = document.getElementById('quantityAll'); q.value = Math.max(1, (parseInt(q.value)||1) - 1);\n`;
  html += `    });\n\n`;

  // Size pill click handlers
  if (sizes.length > 1) {
    html += `    document.querySelectorAll('[data-size]').forEach(pill => {\n`;
    html += `        pill.addEventListener('click', function() {\n`;
    html += `            document.querySelectorAll('[data-size]').forEach(p => p.classList.remove('active'));\n`;
    html += `            this.classList.add('active');\n`;
    html += `            document.getElementById('size' + this.dataset.size).checked = true;\n`;
    html += `            document.getElementById('productForm').dispatchEvent(new Event('change'));\n`;
    html += `        });\n`;
    html += `    });\n\n`;
  }

  // Variant pill click handlers
  if (variants.length > 1) {
    html += `    document.querySelectorAll('[data-flavor]').forEach(pill => {\n`;
    html += `        pill.addEventListener('click', function() {\n`;
    html += `            document.querySelectorAll('[data-flavor]').forEach(p => p.classList.remove('active'));\n`;
    html += `            this.classList.add('active');\n`;
    html += `            document.getElementById(this.dataset.flavor).checked = true;\n`;
    html += `            document.getElementById('productForm').dispatchEvent(new Event('change'));\n`;
    html += `        });\n`;
    html += `    });\n\n`;
  }

  // Purchase option click handlers
  if (orderTypes.length > 1) {
    html += `    document.querySelectorAll('.purchase-option').forEach(opt => {\n`;
    html += `        opt.addEventListener('click', function() {\n`;
    html += `            document.querySelectorAll('.purchase-option').forEach(o => o.classList.remove('selected'));\n`;
    html += `            this.classList.add('selected');\n`;
    html += `            document.getElementById(this.dataset.value).checked = true;\n`;
    html += `            document.getElementById('productForm').dispatchEvent(new Event('change'));\n`;
    html += `        });\n`;
    html += `    });\n`;
  }

  html += `});\n`;
  html += `<\/script>\n`;
  html += `<!-- ═══ END PRODUCT FORM ═══ -->\n`;

  return html;
}

document.getElementById('sp-copy-form').addEventListener('click', () => {
  const html = document.getElementById('sp-form-output').textContent;
  navigator.clipboard.writeText(html).then(() => {
    const btn = document.getElementById('sp-copy-form');
    btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy HTML', 2000);
  });
});

// ── Inventory Tab ──
let invBaselines = {};
let invReorderPoints = {};
let invLoaded = false;

async function loadInventory() {
  if (invLoaded) { renderInventory(); return; }
  try {
    const [blRes, rpRes] = await Promise.all([
      db.from('inventory_baselines').select('*').order('counted_at', { ascending: false }),
      db.from('inventory_reorder_points').select('*'),
    ]);
    // Keep only the latest baseline per SKU
    invBaselines = {};
    (blRes.data || []).forEach(row => {
      if (!invBaselines[row.sku]) invBaselines[row.sku] = row;
    });
    invReorderPoints = {};
    (rpRes.data || []).forEach(row => { invReorderPoints[row.sku] = row; });
    invLoaded = true;
    renderInventory();
  } catch (e) {
    document.getElementById('inventory-table').innerHTML = `<tr><td colspan="9" class="loading">Error: ${e.message}</td></tr>`;
  }
}

function renderInventory() {
  const tbody = document.getElementById('inventory-table');
  const statsEl = document.getElementById('inventory-stats');

  // Get all known SKUs
  const skuMap = {};
  SHOP_PRODUCTS.forEach(p => { skuMap[p.sku] = p.desc; });
  allLineItems.forEach(li => { if (li.sku && !skuMap[li.sku]) skuMap[li.sku] = li.description || li.sku; });
  mfgBatches.forEach(b => { if (b.product_sku && !skuMap[b.product_sku]) skuMap[b.product_sku] = b.product_sku; });

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

  const rows = Object.entries(skuMap).map(([sku, name]) => {
    const baseline = invBaselines[sku];
    const baselineQty = baseline ? baseline.quantity : 0;
    const baselineDate = baseline ? baseline.counted_at : '1970-01-01T00:00:00Z';

    // Manufactured since baseline
    const manufactured = mfgBatches
      .filter(b => b.product_sku === sku && b.created_at > baselineDate)
      .reduce((s, b) => s + (b.quantity || 0), 0);

    // Sold since baseline
    const soldSinceBaseline = allLineItems
      .filter(li => {
        if (li.sku !== sku) return false;
        const order = allOrders.find(o => o.id === li.order_id);
        return order && new Date(order.created_at || order.order_date) > new Date(baselineDate);
      })
      .reduce((s, li) => s + (li.quantity || 1), 0);

    const currentStock = baselineQty + manufactured - soldSinceBaseline;

    // Sold in last 30 days
    const sold30d = allLineItems
      .filter(li => {
        if (li.sku !== sku) return false;
        const order = allOrders.find(o => o.id === li.order_id);
        return order && new Date(order.created_at || order.order_date) >= thirtyDaysAgo;
      })
      .reduce((s, li) => s + (li.quantity || 1), 0);

    const avgDailySales = sold30d / 30;
    const daysRemaining = avgDailySales > 0 ? Math.round(currentStock / avgDailySales) : currentStock > 0 ? 999 : 0;
    const sellThrough = (baselineQty + manufactured) > 0 ? (soldSinceBaseline / (baselineQty + manufactured) * 100) : 0;
    const rp = invReorderPoints[sku];
    const reorderPoint = rp ? rp.reorder_point : '-';
    const reorderPointNum = rp ? rp.reorder_point : null;

    let status = 'ok', statusLabel = 'OK', statusColor = 'var(--sage)';
    if (currentStock <= 0) { status = 'out'; statusLabel = 'Out of Stock'; statusColor = 'var(--red)'; }
    else if (reorderPointNum !== null && currentStock <= reorderPointNum) { status = 'low'; statusLabel = 'Low Stock'; statusColor = 'var(--amber)'; }
    else if (reorderPointNum !== null && currentStock <= reorderPointNum * 1.5) { status = 'warning'; statusLabel = 'Warning'; statusColor = 'var(--honey)'; }

    return { sku, name, currentStock, manufactured, sold30d, sellThrough, daysRemaining, reorderPoint, status, statusLabel, statusColor, hasBaseline: !!baseline };
  });

  // Sort: critical first, then low, then ok
  const statusOrder = { out: 0, low: 1, warning: 2, ok: 3 };
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.sku.localeCompare(b.sku));

  // Stats
  const lowCount = rows.filter(r => r.status === 'low' || r.status === 'warning').length;
  const outCount = rows.filter(r => r.status === 'out').length;
  const trackedCount = rows.filter(r => r.hasBaseline).length;
  statsEl.innerHTML = `
    <div class="stat-card"><div class="label">SKUs Tracked</div><div class="value">${trackedCount}</div><div class="sub">with stock counts</div></div>
    <div class="stat-card"><div class="label">Low Stock</div><div class="value" style="color:var(--amber)">${lowCount}</div><div class="sub">approaching reorder</div></div>
    <div class="stat-card"><div class="label">Out of Stock</div><div class="value" style="color:var(--red)">${outCount}</div><div class="sub">needs attention</div></div>
    <div class="stat-card"><div class="label">Total SKUs</div><div class="value">${rows.length}</div></div>
  `;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">No products found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const stockStyle = r.currentStock <= 0 ? 'color:var(--red);font-weight:700;' : '';
    const rpDisplay = r.reorderPoint === '-' ? `<span style="color:var(--dim);cursor:pointer;" onclick="editReorderPoint('${r.sku}')" title="Click to set">Set</span>` : `<span style="cursor:pointer;" onclick="editReorderPoint('${r.sku}')">${r.reorderPoint}</span>`;
    return `<tr>
      <td style="font-weight:600;">${r.sku}</td>
      <td>${r.name}</td>
      <td style="text-align:right;${stockStyle}">${r.hasBaseline ? r.currentStock : '<span style="color:var(--dim)">—</span>'}</td>
      <td style="text-align:right;">${r.manufactured}</td>
      <td style="text-align:right;">${r.sold30d}</td>
      <td style="text-align:right;">${r.sellThrough.toFixed(1)}%</td>
      <td style="text-align:right;">${r.hasBaseline ? (r.daysRemaining >= 999 ? '∞' : r.daysRemaining + 'd') : '—'}</td>
      <td style="text-align:right;">${rpDisplay}</td>
      <td><span class="ship-status-badge" style="background:${r.statusColor}22;color:${r.statusColor};">${r.statusLabel}</span></td>
    </tr>`;
  }).join('');
}

// Stock count modal
document.getElementById('inv-stock-count-btn').addEventListener('click', function() {
  const sku = prompt('Enter SKU to set stock count for:');
  if (!sku) return;
  const qty = prompt('Enter current stock quantity for ' + sku + ':');
  if (qty === null || qty === '') return;
  const quantity = parseInt(qty, 10);
  if (isNaN(quantity) || quantity < 0) { alert('Invalid quantity.'); return; }
  const notes = prompt('Notes (optional):') || '';
  db.from('inventory_baselines').insert({ sku, quantity, notes }).then(({ error }) => {
    if (error) { alert('Error: ' + error.message); return; }
    invBaselines[sku] = { sku, quantity, counted_at: new Date().toISOString(), notes };
    renderInventory();
  });
});

function editReorderPoint(sku) {
  const current = invReorderPoints[sku];
  const val = prompt('Set reorder point for ' + sku + ':', current ? current.reorder_point : '10');
  if (val === null) return;
  const point = parseInt(val, 10);
  if (isNaN(point) || point < 0) { alert('Invalid number.'); return; }
  const reorderQty = prompt('Reorder quantity (how many to order):', current ? current.reorder_qty : '50');
  const qty = parseInt(reorderQty, 10) || 50;
  db.from('inventory_reorder_points').upsert({ sku, reorder_point: point, reorder_qty: qty }, { onConflict: 'sku' }).then(({ error }) => {
    if (error) { alert('Error: ' + error.message); return; }
    invReorderPoints[sku] = { sku, reorder_point: point, reorder_qty: qty };
    renderInventory();
  });
}

// ── Supplier Orders Tab ──
let supplierOrders = [];
let soLoaded = false;
let soEditingId = null;

async function loadSupplierOrders() {
  if (soLoaded) { renderSupplierOrders(); return; }
  try {
    const { data, error } = await db.from('supplier_orders').select('*').order('requested_at', { ascending: false });
    if (error) throw error;
    supplierOrders = data || [];
    soLoaded = true;
    renderSupplierOrders();
  } catch (e) {
    document.getElementById('supplier-orders-table').innerHTML = `<tr><td colspan="9" class="loading">Error: ${e.message}</td></tr>`;
  }
}

function renderSupplierOrders() {
  const tbody = document.getElementById('supplier-orders-table');
  const statsEl = document.getElementById('supplier-stats');
  const filterVal = document.getElementById('so-status-filter').value;

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const pending = supplierOrders.filter(o => o.status === 'requested').length;
  const ordered = supplierOrders.filter(o => o.status === 'ordered' || o.status === 'shipped').length;
  const receivedMonth = supplierOrders.filter(o => o.status === 'received' && o.received_at >= monthStart).length;
  const totalSpend = supplierOrders.filter(o => o.cost).reduce((s, o) => s + Number(o.cost), 0);

  statsEl.innerHTML = `
    <div class="stat-card"><div class="label">Pending Requests</div><div class="value" style="color:var(--amber)">${pending}</div></div>
    <div class="stat-card"><div class="label">In Transit</div><div class="value" style="color:var(--sage)">${ordered}</div></div>
    <div class="stat-card"><div class="label">Received (Month)</div><div class="value">${receivedMonth}</div></div>
    <div class="stat-card"><div class="label">Total Spend</div><div class="value">$${totalSpend.toFixed(2)}</div></div>
  `;

  let filtered = supplierOrders;
  if (filterVal) filtered = filtered.filter(o => o.status === filterVal);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">No supplier orders found.</td></tr>';
    return;
  }

  const statusColors = { requested: 'var(--amber)', ordered: 'var(--blue)', shipped: 'var(--sage)', received: 'var(--cyan)' };

  tbody.innerHTML = filtered.map(o => {
    const color = statusColors[o.status] || 'var(--muted)';
    const date = o.requested_at ? new Date(o.requested_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
    const tracking = o.tracking_number ? (o.tracking_url ? `<a class="tracking-link" href="${o.tracking_url}" target="_blank">${o.tracking_number}</a>` : o.tracking_number) : '-';
    const cost = o.cost ? '$' + Number(o.cost).toFixed(2) : '-';

    if (soEditingId === o.id) {
      return `<tr data-id="${o.id}">
        <td>${o.item_name}</td>
        <td>${o.supplier_name || '-'}</td>
        <td>${o.quantity || '-'}</td>
        <td><select class="filter-select so-edit-status" style="padding:0.3rem;">
          <option value="requested" ${o.status === 'requested' ? 'selected' : ''}>Requested</option>
          <option value="ordered" ${o.status === 'ordered' ? 'selected' : ''}>Ordered</option>
          <option value="shipped" ${o.status === 'shipped' ? 'selected' : ''}>Shipped</option>
          <option value="received" ${o.status === 'received' ? 'selected' : ''}>Received</option>
        </select></td>
        <td>${o.requested_by || '-'}</td>
        <td>${date}</td>
        <td><input type="text" class="mfg-inline-input so-edit-tracking" value="${o.tracking_number || ''}" placeholder="Tracking #" style="width:8rem;"></td>
        <td><input type="number" class="mfg-inline-input so-edit-cost" value="${o.cost || ''}" placeholder="Cost" step="0.01" style="width:5rem;"></td>
        <td><button class="mfg-save-btn" onclick="saveSupplierEdit(${o.id})">Save</button><button class="mfg-cancel-btn" onclick="cancelSupplierEdit()">Cancel</button></td>
      </tr>`;
    }

    return `<tr class="clickable" onclick="startSupplierEdit(${o.id})">
      <td>${o.item_name}</td>
      <td>${o.supplier_name || '-'}</td>
      <td>${o.quantity || '-'}</td>
      <td><span class="ship-status-badge" style="background:${color}22;color:${color};">${o.status}</span></td>
      <td>${o.requested_by || '-'}</td>
      <td>${date}</td>
      <td>${tracking}</td>
      <td>${cost}</td>
      <td><button class="mfg-edit-btn" onclick="event.stopPropagation(); startSupplierEdit(${o.id})">Edit</button></td>
    </tr>`;
  }).join('');
}

function startSupplierEdit(id) {
  soEditingId = id;
  renderSupplierOrders();
}

function cancelSupplierEdit() {
  soEditingId = null;
  renderSupplierOrders();
}

async function saveSupplierEdit(id) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;
  const status = row.querySelector('.so-edit-status').value;
  const tracking_number = row.querySelector('.so-edit-tracking').value.trim() || null;
  const costVal = row.querySelector('.so-edit-cost').value;
  const cost = costVal ? Number(costVal) : null;

  const updates = { status, tracking_number, cost };
  if (status === 'ordered' && !supplierOrders.find(o => o.id === id)?.ordered_at) updates.ordered_at = new Date().toISOString();
  if (status === 'received' && !supplierOrders.find(o => o.id === id)?.received_at) updates.received_at = new Date().toISOString();

  const { error } = await db.from('supplier_orders').update(updates).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  const order = supplierOrders.find(o => o.id === id);
  if (order) Object.assign(order, updates);
  soEditingId = null;
  renderSupplierOrders();
}

// Add supplier order
document.getElementById('so-add-btn').addEventListener('click', async function() {
  const item_name = document.getElementById('so-item').value.trim();
  const supplier_name = document.getElementById('so-supplier').value.trim() || null;
  const quantity = document.getElementById('so-qty').value.trim() || null;
  const notes = document.getElementById('so-notes').value.trim() || null;
  if (!item_name) { alert('Item name is required.'); return; }

  const requested_by = currentStaff ? currentStaff.name : 'Unknown';
  const { data, error } = await db.from('supplier_orders').insert({ item_name, supplier_name, quantity, notes, requested_by }).select().single();
  if (error) { alert('Error: ' + error.message); return; }
  supplierOrders.unshift(data);
  document.getElementById('so-item').value = '';
  document.getElementById('so-supplier').value = '';
  document.getElementById('so-qty').value = '';
  document.getElementById('so-notes').value = '';
  renderSupplierOrders();
});

document.getElementById('so-status-filter').addEventListener('change', () => { renderSupplierOrders(); });

// ── Marketing Tab ──
let mktInited = false;
let mktAllCampaigns = [];
let mktCampaignPage = 1;
let mktGmcPage = 1;
let mktGadsPage = 1;
let mktGadsCampaigns = [];
let mktChangelogData = [];
let mktChangelogPage = 1;
let mktSourcePage = 1;
let mktCreativePage = 1;
let mktSourceData = [];
let mktCreativeData = [];
function mktApi(ep, p) { p = p || {}; p.token = currentStaff.token; return fetch('/.netlify/functions/' + ep + '?' + new URLSearchParams(p)).then(r => r.json()); }
function mktStatCard(label, value, sub, sp, color) { color = color || 'var(--sage)'; const mx = Math.max(...sp, 0.01); const sk = '<div class="sparkline">' + sp.map(v => '<div class="spark-bar" style="height:' + Math.max(1,(v/mx)*24) + 'px;background:' + (v > 0 ? color : 'var(--border)') + '"></div>').join('') + '</div>'; return '<div class="stat-card"><div class="label">' + label + '</div><div class="value" style="color:' + color + '">' + value + '</div><div class="sub" style="color:var(--dim);">' + sub + '</div>' + sk + '</div>'; }
function mktPill(p) { const c = { facebook: { bg:'rgba(66,103,178,0.15)', fg:'#6d8dc7' }, google: { bg:'rgba(66,133,244,0.15)', fg:'#6ba3f7' }, instagram: { bg:'rgba(225,48,108,0.15)', fg:'#e1306c' }, email: { bg:'rgba(140,180,122,0.15)', fg:'var(--sage)' } }; const x = c[p] || { bg:'rgba(156,146,135,0.15)', fg:'var(--muted)' }; return '<span class="source-pill" style="background:' + x.bg + ';color:' + x.fg + '">' + p + '</span>'; }
function renderMktFunnel(vi,at,ch,pu) { const cols = ['var(--sage)','#a3c995','var(--honey)','var(--blush)']; const st = [{l:'Visitors',c:vi},{l:'Add to Cart',c:at},{l:'Checkout',c:ch},{l:'Purchase',c:pu}]; let h = '<div class="mkt-funnel">'; st.forEach((s,i) => { const dr = i > 0 ? ((1-s.c/st[i-1].c)*100).toFixed(0)+'% drop' : ''; h += '<div class="mkt-funnel-stage"><div class="mkt-funnel-bar" style="background:'+cols[i]+'"><span class="mkt-funnel-count" style="color:#fff">'+s.c.toLocaleString()+'</span><span class="mkt-funnel-label">'+s.l+'</span></div>'+(dr?'<div class="mkt-funnel-drop">'+dr+'</div>':'')+'</div>'; if(i<st.length-1) h+='<div class="mkt-funnel-arrow">\u2192</div>'; }); return h+'</div>'; }
function renderMktCT(filter) { mktCampaignPage = 1; renderMktCTPaged(filter); }
function renderMktCTPaged(filter) { const fl = filter ? mktAllCampaigns.filter(c => (c.name+c.platform).toLowerCase().includes(filter)) : mktAllCampaigns; const start = (mktCampaignPage - 1) * PAGE_SIZE; const page = fl.slice(start, start + PAGE_SIZE); document.getElementById('mkt-campaign-table').innerHTML = page.map(c => { const roas = c.spend>0?(c.conversions_value/c.spend).toFixed(1)+'x':'-'; const cpa = c.conversions>0&&c.spend>0?'$'+(c.spend/c.conversions).toFixed(2):'-'; return '<tr><td>'+c.name+'</td><td>'+mktPill(c.platform)+'</td><td>$'+c.spend.toFixed(2)+'</td><td>'+(c.impressions||0).toLocaleString()+'</td><td>'+(c.clicks||0).toLocaleString()+'</td><td>$'+c.conversions_value.toFixed(2)+'</td><td>'+roas+'</td><td>'+(c.conversions||0)+'</td><td>'+cpa+'</td></tr>'; }).join('') || '<tr><td colspan="9" class="loading">No campaign data</td></tr>'; renderPagination('mkt-campaign-pagination', mktCampaignPage, fl.length, p => { mktCampaignPage = p; renderMktCTPaged(filter); }); }
// ── Marketing: resolve order source (with gclid/fbclid fallback) ──
function mktGetOrderSource(o) {
  return resolveOrderSource(o).toLowerCase() || 'direct';
}
function mktGetOrderCreative(o) {
  return o.utm_content || getUtmFromUrl(o.thank_you_url, 'utm_content') || '';
}

// ── Marketing: build blended source data ──
function buildMktSourceData(orders, trafficBySource, fbCampaigns, gCampaigns) {
  const bySource = {};
  orders.forEach(o => {
    const src = mktGetOrderSource(o);
    if (!bySource[src]) bySource[src] = { sales: 0, revenue: 0 };
    bySource[src].sales++;
    bySource[src].revenue += Number(o.total_value || 0);
  });
  const adspendMap = {};
  (fbCampaigns || []).forEach(c => { adspendMap['facebook'] = (adspendMap['facebook'] || 0) + c.spend; });
  (gCampaigns || []).forEach(c => { adspendMap['google'] = (adspendMap['google'] || 0) + c.spend; });
  const trafficMap = {};
  (trafficBySource || []).forEach(r => { trafficMap[(r.name || '').toLowerCase() || 'direct'] = r.visitors || 0; });
  const allSources = new Set([...Object.keys(bySource), ...Object.keys(trafficMap)]);
  const rows = [];
  allSources.forEach(src => {
    const sales = bySource[src]?.sales || 0;
    const revenue = bySource[src]?.revenue || 0;
    const traffic = trafficMap[src] || 0;
    const adspend = adspendMap[src] || 0;
    rows.push({ source: src, traffic, sales, revenue, adspend, cpa: sales > 0 && adspend > 0 ? adspend / sales : 0, roas: adspend > 0 ? revenue / adspend : 0 });
  });
  return rows.sort((a, b) => b.revenue - a.revenue);
}

// ── Marketing: build blended creative data ──
function buildMktCreativeData(orders, trafficByContent) {
  const byCreative = {};
  orders.forEach(o => {
    const cr = mktGetOrderCreative(o) || '(none)';
    if (!byCreative[cr]) byCreative[cr] = { sales: 0, revenue: 0 };
    byCreative[cr].sales++;
    byCreative[cr].revenue += Number(o.total_value || 0);
  });
  const trafficMap = {};
  (trafficByContent || []).forEach(r => { trafficMap[r.name || '(none)'] = r.visitors || 0; });
  const allCreatives = new Set([...Object.keys(byCreative), ...Object.keys(trafficMap)]);
  const rows = [];
  allCreatives.forEach(cr => {
    const sales = byCreative[cr]?.sales || 0;
    const revenue = byCreative[cr]?.revenue || 0;
    const traffic = trafficMap[cr] || 0;
    rows.push({ creative: cr, traffic, sales, revenue, adspend: 0, cpa: 0, roas: 0 });
  });
  return rows.sort((a, b) => b.revenue - a.revenue);
}

// ── Marketing: render source table ──
function renderMktSourceTable() {
  const start = (mktSourcePage - 1) * PAGE_SIZE;
  const page = mktSourceData.slice(start, start + PAGE_SIZE);
  document.getElementById('mkt-source-table').innerHTML = page.map(r => {
    const display = utmTranslate('utm_source', r.source);
    return '<tr><td>' + mktPill(display) + '</td>'
      + '<td>' + r.traffic.toLocaleString() + '</td>'
      + '<td>' + r.sales + '</td>'
      + '<td>$' + r.revenue.toFixed(2) + '</td>'
      + '<td>' + (r.adspend > 0 ? '$' + r.adspend.toFixed(2) : '-') + '</td>'
      + '<td>' + (r.cpa > 0 ? '$' + r.cpa.toFixed(2) : '-') + '</td>'
      + '<td>' + (r.roas > 0 ? r.roas.toFixed(1) + 'x' : '-') + '</td></tr>';
  }).join('') || '<tr><td colspan="7" class="loading">No source data</td></tr>';
  renderPagination('mkt-source-pagination', mktSourcePage, mktSourceData.length, p => { mktSourcePage = p; renderMktSourceTable(); });
}

// ── Marketing: render creative table ──
function renderMktCreativeTable() {
  const start = (mktCreativePage - 1) * PAGE_SIZE;
  const page = mktCreativeData.slice(start, start + PAGE_SIZE);
  document.getElementById('mkt-creative-table').innerHTML = page.map(r => {
    const display = utmTranslateAny(r.creative);
    return '<tr><td>' + esc(display) + '</td>'
      + '<td>' + r.traffic.toLocaleString() + '</td>'
      + '<td>' + r.sales + '</td>'
      + '<td>$' + r.revenue.toFixed(2) + '</td>'
      + '<td>-</td><td>-</td><td>-</td></tr>';
  }).join('') || '<tr><td colspan="7" class="loading">No creative data</td></tr>';
  renderPagination('mkt-creative-pagination', mktCreativePage, mktCreativeData.length, p => { mktCreativePage = p; renderMktCreativeTable(); });
}

// ── Marketing: enhanced Google Ads table ──
function renderMktGads() {
  const [from, to] = getDateRange();
  const googleOrders = allOrders.filter(o => o.order_date >= from && o.order_date <= to && mktGetOrderSource(o) === 'google');
  const start = (mktGadsPage - 1) * PAGE_SIZE;
  const page = mktGadsCampaigns.slice(start, start + PAGE_SIZE);
  document.getElementById('mkt-gads-table').innerHTML = page.map(c => {
    const roas = c.spend > 0 ? (c.conversions_value / c.spend).toFixed(1) + 'x' : '-';
    const nameLower = c.name.toLowerCase();
    const cId = String(c.id || '');
    const utmSales = googleOrders.filter(o => {
      const camp = resolveOrderCampaign(o).toLowerCase();
      const gadId = getOrderParam(o, 'gad_campaignid');
      // Match by campaign name, translated name, or gad_campaignid
      return camp === nameLower || utmTranslate('utm_campaign', camp).toLowerCase() === nameLower || (gadId && gadId === cId);
    }).length;
    return '<tr><td>' + esc(c.name) + '</td>'
      + '<td>$' + (c.conversions_value || 0).toFixed(2) + '</td>'
      + '<td>$' + c.spend.toFixed(2) + '</td>'
      + '<td>' + roas + '</td>'
      + '<td>' + (c.clicks || 0).toLocaleString() + '</td>'
      + '<td>' + utmSales + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="loading">No Google Ads data</td></tr>';
  renderPagination('mkt-gads-pagination', mktGadsPage, mktGadsCampaigns.length, p => { mktGadsPage = p; renderMktGads(); });
}

// ── Marketing: regional performance table ──
async function renderMktRegionTable(orders, fbC, gC, gSt) {
  const tbody = document.getElementById('mkt-region-table');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading regional data\u2026</td></tr>';

  const tok = encodeURIComponent(currentStaff.token);
  const [from, to] = getDateRange();

  // Fetch FB and Google region breakdowns in parallel
  const [fbGeo, gGeo] = await Promise.all([
    fetch(`/.netlify/functions/facebook-campaigns?token=${tok}&from=${from}&to=${to}&geo=region`).then(r => r.json()).catch(() => ({ regions: [] })),
    (gSt.connected && gSt.adsCustomerId)
      ? fetch(`/.netlify/functions/google-ads?token=${tok}&from=${from}&to=${to}&geo=region`).then(r => r.json()).catch(() => ({ regions: [] }))
      : { regions: [] },
  ]);

  // Build order revenue by region (from city → region mapping)
  const cityToRegion = {};
  Object.keys(NZ_CITIES).forEach(city => {
    // Map cities to their region based on proximity to region centroids
    let bestRegion = '', bestDist = Infinity;
    const cc = NZ_CITIES[city];
    Object.entries(NZ_REGIONS).forEach(([rName, rc]) => {
      if (rName.includes(' region')) return; // skip duplicates
      const d = Math.abs(cc[0] - rc[0]) + Math.abs(cc[1] - rc[1]);
      if (d < bestDist) { bestDist = d; bestRegion = rName; }
    });
    cityToRegion[city] = bestRegion;
  });

  const regionData = {};
  const ensureRegion = (name) => {
    const key = name.toLowerCase().replace(/ region$/i, '').trim();
    if (!regionData[key]) regionData[key] = { name: name, orders: 0, revenue: 0, fbSpend: 0, gSpend: 0 };
    return regionData[key];
  };

  // Orders by region
  orders.forEach(o => {
    const city = (o.city || '').toLowerCase().trim();
    const region = cityToRegion[city];
    if (!region) return;
    const r = ensureRegion(region);
    r.orders++;
    r.revenue += Number(o.total_value || 0);
  });

  // FB spend by region
  (fbGeo.regions || []).forEach(r => {
    const d = ensureRegion(r.region);
    d.fbSpend += r.spend;
  });

  // Google spend by region
  (gGeo.regions || []).forEach(r => {
    const d = ensureRegion(r.region);
    d.gSpend += r.spend;
  });

  const rows = Object.values(regionData)
    .filter(r => r.orders > 0 || r.fbSpend > 0 || r.gSpend > 0)
    .sort((a, b) => b.revenue - a.revenue);

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No regional data</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const totalSpend = r.fbSpend + r.gSpend;
    const roas = totalSpend > 0 ? (r.revenue / totalSpend).toFixed(1) + 'x' : '-';
    const name = r.name.charAt(0).toUpperCase() + r.name.slice(1);
    return '<tr>'
      + '<td>' + esc(name) + '</td>'
      + '<td>' + r.orders + '</td>'
      + '<td>$' + r.revenue.toFixed(2) + '</td>'
      + '<td>' + (r.fbSpend > 0 ? '$' + r.fbSpend.toFixed(2) : '-') + '</td>'
      + '<td>' + (r.gSpend > 0 ? '$' + r.gSpend.toFixed(2) : '-') + '</td>'
      + '<td>' + (totalSpend > 0 ? '$' + totalSpend.toFixed(2) : '-') + '</td>'
      + '<td>' + roas + '</td>'
      + '</tr>';
  }).join('');
}

// ── Marketing: sales by source over time chart ──
function renderMktSourceTimeChart(orders) {
  const dateSourceMap = {};
  const sourceTotals = {};
  orders.forEach(o => {
    const d = o.order_date;
    const src = mktGetOrderSource(o);
    sourceTotals[src] = (sourceTotals[src] || 0) + 1;
    if (!dateSourceMap[d]) dateSourceMap[d] = {};
    dateSourceMap[d][src] = (dateSourceMap[d][src] || 0) + 1;
  });
  const sortedDates = Object.keys(dateSourceMap).sort().slice(-30);
  const labels = sortedDates.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }));
  const palette = ['#8CB47A','#D4A84B','#6d8dc7','#e1306c','#6ba3f7','#DBBFA8','#e06050','#a3c995','#c4b09a','#d4b88a'];
  const topSources = Object.entries(sourceTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  const datasets = topSources.map((src, i) => ({
    label: utmTranslate('utm_source', src),
    data: sortedDates.map(d => dateSourceMap[d]?.[src] || 0),
    borderColor: palette[i % palette.length],
    backgroundColor: 'transparent',
    tension: 0.4, pointRadius: 2, borderWidth: 2,
  }));
  if (charts.mktSourceTime) charts.mktSourceTime.destroy();
  charts.mktSourceTime = new Chart(document.getElementById('mkt-source-time-chart'), {
    type: 'line', data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' } } } },
      scales: { y: { ticks: { color: '#9c9287', stepSize: 1 }, grid: { color: '#252220' }, title: { display: true, text: 'Sales', color: '#6e6259', font: { size: 10 } } },
        x: { ticks: { color: '#9c9287', maxTicksLimit: 15, font: { size: 10 } }, grid: { display: false } } },
    },
  });
  // Pie chart
  if (charts.mktSourcePie) charts.mktSourcePie.destroy();
  charts.mktSourcePie = new Chart(document.getElementById('mkt-source-pie-chart'), {
    type: 'doughnut',
    data: { labels: topSources.map(s => utmTranslate('utm_source', s)), datasets: [{ data: topSources.map(s => sourceTotals[s]), backgroundColor: topSources.map((_, i) => palette[i % palette.length]), borderColor: '#1e1b18', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' }, padding: 8, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed + ' sales' } } } },
  });
}

// ── Marketing: sales by creative over time chart ──
function renderMktCreativeTimeChart(orders) {
  const dateCreativeMap = {};
  const creativeTotals = {};
  orders.forEach(o => {
    const d = o.order_date;
    const cr = mktGetOrderCreative(o) || '(none)';
    creativeTotals[cr] = (creativeTotals[cr] || 0) + 1;
    if (!dateCreativeMap[d]) dateCreativeMap[d] = {};
    dateCreativeMap[d][cr] = (dateCreativeMap[d][cr] || 0) + 1;
  });
  const sortedDates = Object.keys(dateCreativeMap).sort().slice(-30);
  const labels = sortedDates.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }));
  const palette = ['#D4A84B','#8CB47A','#6d8dc7','#e1306c','#6ba3f7','#DBBFA8','#e06050','#a3c995','#c4b09a','#d4b88a'];
  const topCreatives = Object.entries(creativeTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  const datasets = topCreatives.map((cr, i) => ({
    label: utmTranslateAny(cr),
    data: sortedDates.map(d => dateCreativeMap[d]?.[cr] || 0),
    borderColor: palette[i % palette.length],
    backgroundColor: 'transparent',
    tension: 0.4, pointRadius: 2, borderWidth: 2,
  }));
  if (charts.mktCreativeTime) charts.mktCreativeTime.destroy();
  charts.mktCreativeTime = new Chart(document.getElementById('mkt-creative-time-chart'), {
    type: 'line', data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' } } } },
      scales: { y: { ticks: { color: '#9c9287', stepSize: 1 }, grid: { color: '#252220' }, title: { display: true, text: 'Sales', color: '#6e6259', font: { size: 10 } } },
        x: { ticks: { color: '#9c9287', maxTicksLimit: 15, font: { size: 10 } }, grid: { display: false } } },
    },
  });
  // Pie chart
  if (charts.mktCreativePie) charts.mktCreativePie.destroy();
  charts.mktCreativePie = new Chart(document.getElementById('mkt-creative-pie-chart'), {
    type: 'doughnut',
    data: { labels: topCreatives.map(c => utmTranslateAny(c)), datasets: [{ data: topCreatives.map(c => creativeTotals[c]), backgroundColor: topCreatives.map((_, i) => palette[i % palette.length]), borderColor: '#1e1b18', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#9c9287', font: { size: 11, family: 'DM Sans' }, padding: 8, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed + ' sales' } } } },
  });
}
function renderMktGmc(products) { const start = (mktGmcPage - 1) * PAGE_SIZE; const page = products.slice(start, start + PAGE_SIZE); document.getElementById('mkt-gmc-table').innerHTML = page.map(p => { const iss = p.issues.length>0?p.issues.map(i=>i.description).join('; '):'-'; const rc = p.status==='disapproved'?' style="background:rgba(224,96,80,0.08);"':''; return '<tr'+rc+'><td>'+p.title+'</td><td><span class="dummy-badge '+p.status+'">'+p.status.charAt(0).toUpperCase()+p.status.slice(1)+'</span></td><td>'+iss+'</td></tr>'; }).join(''); renderPagination('mkt-gmc-pagination', mktGmcPage, products.length, p => { mktGmcPage = p; renderMktGmc(products); }); }
// ── Marketing: Learning Phase Widget ──
function renderLearningPhaseWidget(campaigns) {
  const learning = campaigns.filter(c => c.primary_status === 'LEARNING');
  const count = learning.length;
  const color = count > 0 ? 'var(--amber)' : 'var(--sage)';
  const label = count > 0 ? count + ' campaign' + (count > 1 ? 's' : '') : 'None';
  const sub = count > 0 ? 'in learning phase' : 'all stable';
  // Return a clickable stat card
  const detailHtml = count > 0 ? learning.map(c => {
    const reasons = (c.primary_status_reasons || []).join(', ') || 'optimizing';
    return '<div style="padding:0.3rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;"><strong>' + esc(c.name) + '</strong><br><span style="color:var(--dim);">' + esc(reasons) + '</span></div>';
  }).join('') : '';
  return '<div class="stat-card" style="cursor:' + (count > 0 ? 'pointer' : 'default') + ';" onclick="this.querySelector(\'.lp-detail\').style.display=this.querySelector(\'.lp-detail\').style.display===\'none\'?\'block\':\'none\'">'
    + '<div class="label">Learning Phase</div>'
    + '<div class="value" style="color:' + color + '">' + label + '</div>'
    + '<div class="sub" style="color:var(--dim);">' + sub + '</div>'
    + '<div class="lp-detail" style="display:none;margin-top:0.5rem;max-height:150px;overflow-y:auto;">' + detailHtml + '</div>'
    + '</div>';
}

// ── Marketing: Changelog ──
async function loadMktChangelog() {
  try {
    const res = await db.from('site_changelogs').select('*').eq('site_key', 'primalpantry').order('deployed_at', { ascending: false }).limit(20);
    mktChangelogData = res.data || [];
  } catch (e) { mktChangelogData = []; }
  mktChangelogPage = 1;
  renderMktChangelog();
  renderMktCooldownBanner();
}

function renderMktChangelog() {
  const start = (mktChangelogPage - 1) * PAGE_SIZE;
  const page = mktChangelogData.slice(start, start + PAGE_SIZE);
  const tbody = document.getElementById('mkt-changelog-table');
  if (page.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">No changes recorded yet</td></tr>';
    renderPagination('mkt-changelog-pagination', 1, 0, () => {});
    return;
  }
  tbody.innerHTML = page.map(r => {
    const date = new Date(r.deployed_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const files = (r.files_changed || []).length;
    const fileStr = files + ' file' + (files !== 1 ? 's' : '');
    // Cooldown status
    let statusHtml;
    if (!r.is_funnel_related) {
      statusHtml = '<span style="color:var(--dim);">—</span>';
    } else if (r.cooldown_complete) {
      statusHtml = '<span class="ship-status-badge" style="background:rgba(140,180,122,0.15);color:var(--sage);">Complete</span>';
    } else {
      const daysSince = Math.floor((Date.now() - new Date(r.deployed_at).getTime()) / 86400000);
      const conv = r.cooldown_conversions || 0;
      statusHtml = '<span class="ship-status-badge" style="background:rgba(212,168,75,0.15);color:var(--honey);">Cooldown (' + conv + '/50 conv · ' + daysSince + '/7d)</span>';
    }
    // Before/after metrics (normalize 30-day baseline to 7-day)
    const bV = Math.round((r.baseline_visitors || 0) / 30 * 7);
    const bA = Math.round((r.baseline_atc || 0) / 30 * 7);
    const bC = Math.round((r.baseline_conv || 0) / 30 * 7);
    const pV = r.post_visitors; const pA = r.post_atc; const pC = r.post_conv;
    const hasPost = pV !== null && pV !== undefined;
    const arrow = (b, a) => { if (!hasPost) return ''; const d = a - b; return d > 0 ? ' <span style="color:var(--sage);">↑</span>' : d < 0 ? ' <span style="color:var(--red);">↓</span>' : ''; };
    const bAtcPct = bV > 0 ? (bA / bV * 100).toFixed(1) + '%' : '-';
    const pAtcPct = hasPost && pV > 0 ? (pA / pV * 100).toFixed(1) + '%' : '-';
    const bConvPct = bV > 0 ? (bC / bV * 100).toFixed(1) + '%' : '-';
    const pConvPct = hasPost && pV > 0 ? (pC / pV * 100).toFixed(1) + '%' : '-';
    const metric = (b, p) => hasPost ? b + ' → ' + p + arrow(b, p) : String(b);
    const metricPct = (bPct, pPct, bNum, pNum) => hasPost ? bPct + ' → ' + pPct + arrow(parseFloat(bPct), parseFloat(pPct)) : bPct;
    const rc = r.is_funnel_related ? ' style="background:rgba(212,168,75,0.05);"' : '';
    return '<tr' + rc + ' class="clickable" onclick="expandChangelog(' + r.id + ')" title="Click for details">'
      + '<td style="white-space:nowrap;">' + date + '</td>'
      + '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.commit_message || 'Deploy') + '</td>'
      + '<td>' + fileStr + '</td>'
      + '<td>' + statusHtml + '</td>'
      + '<td>' + metric(bV, hasPost ? pV : 0) + '</td>'
      + '<td>' + metric(bA, hasPost ? pA : 0) + '</td>'
      + '<td>' + metricPct(bAtcPct, pAtcPct, bA, pA) + '</td>'
      + '<td>' + metric(bC, hasPost ? pC : 0) + '</td>'
      + '<td>' + metricPct(bConvPct, pConvPct, bC, pC) + '</td>'
      + '</tr>';
  }).join('');
  renderPagination('mkt-changelog-pagination', mktChangelogPage, mktChangelogData.length, p => { mktChangelogPage = p; renderMktChangelog(); });
}

function expandChangelog(id) {
  const r = mktChangelogData.find(c => c.id === id);
  if (!r) return;
  const existing = document.getElementById('changelog-detail-' + id);
  if (existing) { existing.remove(); return; }
  const files = (r.files_changed || []).map(f => '<li>' + esc(f) + '</li>').join('') || '<li>No file details available</li>';
  const row = document.querySelector('#mkt-changelog-table tr[onclick*="' + id + '"]');
  if (!row) return;
  const detail = document.createElement('tr');
  detail.id = 'changelog-detail-' + id;
  detail.innerHTML = '<td colspan="9" style="background:var(--bg);padding:1rem;">'
    + '<div style="display:flex;gap:2rem;flex-wrap:wrap;">'
    + '<div><strong>Commit:</strong> ' + esc(r.commit_message || '-') + '<br><strong>SHA:</strong> ' + (r.commit_sha ? r.commit_sha.slice(0, 8) : '-') + '</div>'
    + '<div><strong>Files changed:</strong><ul style="margin:0.25rem 0 0 1rem;font-size:0.8rem;">' + files + '</ul></div>'
    + '</div></td>';
  row.after(detail);
}

function renderMktCooldownBanner() {
  const banner = document.getElementById('mkt-cooldown-banner');
  const textEl = document.getElementById('mkt-cooldown-text');
  const activeCooldowns = mktChangelogData.filter(r => r.is_funnel_related && !r.cooldown_complete);
  if (activeCooldowns.length === 0) { banner.style.display = 'none'; return; }
  const latest = activeCooldowns[0]; // most recent
  const daysSince = Math.floor((Date.now() - new Date(latest.deployed_at).getTime()) / 86400000);
  const daysLeft = Math.max(0, 7 - daysSince);
  const conv = latest.cooldown_conversions || 0;
  const convLeft = Math.max(0, 50 - conv);
  textEl.innerHTML = convLeft + ' conversions or ' + daysLeft + ' days remaining. Wait before making more funnel changes.';
  banner.style.display = 'block';
}

// ── Page Drill-Down Modal ──
async function openPageModal(pathname) {
  const modal = document.getElementById('wa-page-modal');
  document.getElementById('wa-page-modal-title').textContent = pathname;
  document.getElementById('wa-page-modal-stats').innerHTML = '<div class="wa-loading">Loading...</div>';
  document.getElementById('wa-page-modal-changelog').innerHTML = '<tr><td colspan="5" class="loading">Loading...</td></tr>';
  modal.classList.add('open');

  // Fetch page funnel stats
  try {
    const token = currentStaff ? currentStaff.token : '';
    const [from, to] = getDateRange();
    const params = new URLSearchParams({ token, site: 'PrimalPantry.co.nz', from, to, metric: 'funnel', col: 'pathname' });
    const res = await fetch('/.netlify/functions/analytics-dashboard?' + params);
    const data = await res.json();
    const pageData = (Array.isArray(data) ? data : []).find(p => p.name === pathname);
    if (pageData) {
      const atcPct = pageData.visitors > 0 ? (pageData.atc / pageData.visitors * 100).toFixed(1) : '0';
      const convPct = pageData.visitors > 0 ? (pageData.sales / pageData.visitors * 100).toFixed(1) : '0';
      const rev = pageData._revenue || 0;
      document.getElementById('wa-page-modal-stats').innerHTML = [
        '<div class="wa-stat"><div class="wa-val">' + (pageData.visitors || 0).toLocaleString() + '</div><div class="wa-lbl">Visits</div></div>',
        '<div class="wa-stat"><div class="wa-val">' + (pageData.atc || 0) + '</div><div class="wa-lbl">ATC</div></div>',
        '<div class="wa-stat"><div class="wa-val">' + atcPct + '%</div><div class="wa-lbl">ATC%</div></div>',
        '<div class="wa-stat"><div class="wa-val">' + (pageData.sales || 0) + '</div><div class="wa-lbl">Conv</div></div>',
        '<div class="wa-stat"><div class="wa-val">' + convPct + '%</div><div class="wa-lbl">Conv%</div></div>',
        '<div class="wa-stat"><div class="wa-val">$' + Number(rev).toFixed(2) + '</div><div class="wa-lbl">Revenue</div></div>',
      ].join('');
    } else {
      document.getElementById('wa-page-modal-stats').innerHTML = '<span style="color:var(--dim);">No funnel data for this page</span>';
    }
  } catch (e) {
    document.getElementById('wa-page-modal-stats').innerHTML = '<span style="color:var(--dim);">Error loading stats</span>';
  }

  // Fetch changelog for this page
  try {
    const res = await db.from('site_changelogs').select('*').eq('site_key', 'primalpantry').contains('funnel_pages', [pathname]).order('deployed_at', { ascending: false }).limit(20);
    let changes = res.data || [];
    // Also include changes that affect all pages (funnel_pages contains '*')
    const res2 = await db.from('site_changelogs').select('*').eq('site_key', 'primalpantry').contains('funnel_pages', ['*']).order('deployed_at', { ascending: false }).limit(20);
    let allPageChanges = res2.data || [];
    const allChanges = [...changes, ...allPageChanges].filter((v, i, a) => a.findIndex(x => x.id === v.id) === i).sort((a, b) => new Date(b.deployed_at) - new Date(a.deployed_at));

    if (allChanges.length === 0) {
      document.getElementById('wa-page-modal-changelog').innerHTML = '<tr><td colspan="5" class="loading">No changes recorded for this page</td></tr>';
    } else {
      document.getElementById('wa-page-modal-changelog').innerHTML = allChanges.slice(0, 10).map(r => {
        const date = new Date(r.deployed_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
        const files = (r.files_changed || []).slice(0, 3).join(', ') + ((r.files_changed || []).length > 3 ? '...' : '');
        const bV7 = Math.round((r.baseline_visitors || 0) / 30 * 7);
        const bA7 = Math.round((r.baseline_atc || 0) / 30 * 7);
        const bC7 = Math.round((r.baseline_conv || 0) / 30 * 7);
        const hasPost = r.post_visitors !== null && r.post_visitors !== undefined;
        const beforeStr = bV7 + ' vis · ' + bA7 + ' atc · ' + bC7 + ' conv';
        const afterStr = hasPost ? r.post_visitors + ' vis · ' + r.post_atc + ' atc · ' + r.post_conv + ' conv' : 'Pending...';
        const arrow = (b, a) => a > b ? '↑' : a < b ? '↓' : '→';
        const afterColor = hasPost ? (r.post_conv >= bC7 ? 'var(--sage)' : 'var(--red)') : 'var(--dim)';
        return '<tr><td style="white-space:nowrap;">' + date + '</td><td>' + esc(r.commit_message || 'Deploy') + '</td><td style="font-size:0.75rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;">' + esc(files) + '</td><td style="font-size:0.75rem;">' + beforeStr + '</td><td style="font-size:0.75rem;color:' + afterColor + ';">' + afterStr + '</td></tr>';
      }).join('');
    }
  } catch (e) {
    document.getElementById('wa-page-modal-changelog').innerHTML = '<tr><td colspan="5" class="loading">Error loading changelog</td></tr>';
  }
}

// Close page modal
document.getElementById('wa-page-modal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
document.getElementById('wa-page-modal-close').addEventListener('click', function() { document.getElementById('wa-page-modal').classList.remove('open'); });

let mktLastLoaded = 0;
let mktLastDateRange = '';
async function loadMarketingTab() {
  if (typeof utmEnsureLoaded === 'function') await utmEnsureLoaded();
  const [from, to] = getDateRange();
  const dateKey = from + '|' + to;
  // Cache for 5 minutes unless date range changed
  if (mktInited && mktLastLoaded && dateKey === mktLastDateRange && Date.now() - mktLastLoaded < 300000) return;
  if (!mktInited) {
    mktInited = true;
    document.getElementById('mkt-campaign-search').addEventListener('input', function() { renderMktCT(this.value.toLowerCase().trim()); });
    document.getElementById('mkt-google-connect-btn').addEventListener('click', () => {
      mktApi('google-auth', { action: 'authorize' }).then(d => {
        if (d.url) window.open(d.url, 'google-auth', 'width=600,height=700');
        else { console.error('Google auth response:', d); alert('Failed to start Google auth: ' + (d.error || 'no URL returned')); }
      }).catch(e => { console.error('Google auth error:', e); alert('Failed to connect Google: ' + e.message); });
    });
    window.addEventListener('message', e => { if (e.data && e.data.googleConnected) loadMarketingTab(); });
    document.getElementById('mkt-save-ids-btn').addEventListener('click', () => { mktApi('google-auth', { action: 'save_ids', ads_customer_id: document.getElementById('mkt-ads-customer-id').value.trim(), merchant_id: document.getElementById('mkt-merchant-id').value.trim() }).then(() => loadMarketingTab()); });
    document.getElementById('mkt-google-disconnect-btn').addEventListener('click', () => { if (!confirm('Disconnect Google?')) return; mktApi('google-auth', { action: 'disconnect' }).then(() => loadMarketingTab()); });
    document.querySelectorAll('#tab-marketing .chart-card').forEach(card => { card.addEventListener('click', function(e) { if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return; this.classList.toggle('expanded'); const canvas = this.querySelector('canvas'); if (canvas) { const ci = Object.values(charts).find(c => c.canvas === canvas); if (ci) setTimeout(() => ci.resize(), 350); } }); });
  }
  document.getElementById('marketing-stats-grid').innerHTML = '<div class="loading" style="grid-column:1/-1;">Loading marketing data\u2026</div>';
  document.getElementById('mkt-campaign-table').innerHTML = '<tr><td colspan="9" class="loading">Loading\u2026</td></tr>';
  const gSt = await mktApi('google-auth', { action: 'status' }).catch(() => ({ connected: false }));
  const gBanner = document.getElementById('mkt-google-banner'), gIds = document.getElementById('mkt-google-ids');
  if (gSt.connected) { gBanner.style.display = 'none'; gIds.style.display = 'block'; document.getElementById('mkt-google-status').innerHTML = '<span style="color:var(--sage);">\u25cf Connected</span>'; if (gSt.adsCustomerId) document.getElementById('mkt-ads-customer-id').value = gSt.adsCustomerId; if (gSt.merchantId) document.getElementById('mkt-merchant-id').value = gSt.merchantId; }
  else { gBanner.style.display = 'flex'; gIds.style.display = 'none'; document.getElementById('mkt-google-status').innerHTML = '<span style="color:var(--dim);">\u25cb Not connected</span>'; }
  const [fbC, gC, fbD, gD, gmcD, trafficBySource, trafficByContent] = await Promise.all([
    mktApi('facebook-campaigns', { from, to }).catch(() => ({ campaigns: [] })),
    gSt.connected && gSt.adsCustomerId ? mktApi('google-ads', { from, to }).catch(() => ({ campaigns: [] })) : { campaigns: [] },
    mktApi('facebook-campaigns', { from, to, daily: '1' }).catch(() => ({ daily: [] })),
    gSt.connected && gSt.adsCustomerId ? mktApi('google-ads', { from, to, daily: '1' }).catch(() => ({ daily: [] })) : { daily: [] },
    gSt.connected && gSt.merchantId ? mktApi('google-merchant', {}).catch(() => ({ products: [] })) : { products: [] },
    mktApi('analytics-dashboard', { site: 'PrimalPantry.co.nz', from, to, metric: 'campaigns', col: 'utm_source' }).catch(() => []),
    mktApi('analytics-dashboard', { site: 'PrimalPantry.co.nz', from, to, metric: 'campaigns', col: 'utm_content' }).catch(() => []),
  ]);
  mktAllCampaigns = [...(fbC.campaigns||[]).map(c=>({...c,platform:'facebook'})), ...(gC.campaigns||[]).map(c=>({...c,platform:'google'}))].sort((a,b)=>b.spend-a.spend);
  mktGadsCampaigns = (gC.campaigns||[]).sort((a,b)=>b.spend-a.spend);
  const tSpend = mktAllCampaigns.reduce((s,c)=>s+c.spend,0), tRev = mktAllCampaigns.reduce((s,c)=>s+c.conversions_value,0);
  const tClicks = mktAllCampaigns.reduce((s,c)=>s+c.clicks,0), tConv = mktAllCampaigns.reduce((s,c)=>s+c.conversions,0);
  const tImpr = mktAllCampaigns.reduce((s,c)=>s+c.impressions,0);
  const gSpend = mktGadsCampaigns.reduce((s,c)=>s+c.spend,0), gConv = mktGadsCampaigns.reduce((s,c)=>s+c.conversions,0), gCPA = gConv>0?gSpend/gConv:0;
  const byDate = {}; (fbD.daily||[]).concat(gD.daily||[]).forEach(d => { if (!byDate[d.date]) byDate[d.date] = {spend:0,rev:0}; byDate[d.date].spend += d.spend; byDate[d.date].rev += d.conversions_value; });
  const sortedDates = Object.keys(byDate).sort();
  const spSpark = sortedDates.map(d=>byDate[d].spend), rvSpark = sortedDates.map(d=>byDate[d].rev), roSpark = sortedDates.map(d=>byDate[d].spend>0?byDate[d].rev/byDate[d].spend:0);
  document.getElementById('marketing-stats-grid').innerHTML = [
    mktStatCard('Total Ad Spend','$'+tSpend.toFixed(2),tImpr.toLocaleString()+' impressions',spSpark.length>1?spSpark:[0],'var(--honey)'),
    mktStatCard('ROAS',tSpend>0?(tRev/tSpend).toFixed(1)+'x':'-','return on ad spend',roSpark.length>1?roSpark:[0],'var(--sage)'),
    mktStatCard('CAC',tConv>0?'$'+(tSpend/tConv).toFixed(2):'-',tConv+' conversions',spSpark.length>1?spSpark:[0],'var(--blush)'),
    mktStatCard('Paid Revenue','$'+tRev.toFixed(2),tClicks.toLocaleString()+' clicks',rvSpark.length>1?rvSpark:[0],'var(--green)'),
    mktStatCard('Blended CVR',tClicks>0?(tConv/tClicks*100).toFixed(1)+'%':'-','clicks to conversion',roSpark.length>1?roSpark:[0],'var(--cyan)'),
    mktStatCard('Avg CPC',tClicks>0?'$'+(tSpend/tClicks).toFixed(2):'-','cost per click',spSpark.length>1?spSpark:[0],'var(--purple)'),
    mktStatCard('Google Ads Spend','$'+gSpend.toFixed(2),gConv+' conv · CPA '+(gCPA>0?'$'+gCPA.toFixed(2):'-'),spSpark.length>1?spSpark:[0],'#4285F4'),
    renderLearningPhaseWidget(gC.campaigns||[]),
  ].join('');
  const fbSp=(fbC.campaigns||[]).reduce((s,c)=>s+c.spend,0),gSp=(gC.campaigns||[]).reduce((s,c)=>s+c.spend,0);const chL=[],chD=[],chC=[];if(fbSp>0){chL.push('Facebook');chD.push(fbSp);chC.push('#4267B2');}if(gSp>0){chL.push('Google Ads');chD.push(gSp);chC.push('#4285F4');}if(!chL.length){chL.push('No data');chD.push(1);chC.push('#332d27');}
  if(charts.mktChannel)charts.mktChannel.destroy();
  charts.mktChannel = new Chart(document.getElementById('mkt-channel-chart'),{type:'doughnut',data:{labels:chL,datasets:[{data:chD,backgroundColor:chC,borderColor:'#1e1b18',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:'#9c9287',font:{size:11,family:'DM Sans'},padding:12}},tooltip:{callbacks:{label:ctx=>ctx.label+': $'+ctx.parsed.toLocaleString(undefined,{minimumFractionDigits:2})}}}}});
  const lbls=sortedDates.map(d=>{const dt=new Date(d+'T00:00:00');return dt.toLocaleDateString('en-NZ',{day:'numeric',month:'short'});});
  if(charts.mktSpendRev)charts.mktSpendRev.destroy();
  charts.mktSpendRev = new Chart(document.getElementById('mkt-spend-rev-chart'),{type:'line',data:{labels:lbls,datasets:[{label:'Ad Spend',data:spSpark,borderColor:'var(--honey)',backgroundColor:'rgba(212,168,75,0.15)',fill:true,tension:0.4,pointRadius:2,borderWidth:2,yAxisID:'y'},{label:'Revenue',data:rvSpark,borderColor:'var(--sage)',backgroundColor:'transparent',fill:false,tension:0.4,pointRadius:2,borderWidth:2,borderDash:[5,3],yAxisID:'y1'}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#9c9287',font:{size:11,family:'DM Sans'}}}},scales:{y:{type:'linear',position:'left',ticks:{color:'#9c9287',callback:v=>'$'+v.toFixed(0)},grid:{color:'#252220'},title:{display:true,text:'Spend',color:'#6e6259',font:{size:10}}},y1:{type:'linear',position:'right',ticks:{color:'#9c9287',callback:v=>'$'+v.toFixed(0)},grid:{display:false},title:{display:true,text:'Revenue',color:'#6e6259',font:{size:10}}},x:{ticks:{color:'#9c9287',maxTicksLimit:10,font:{size:10}},grid:{display:false}}}}});
  if(charts.mktRoas)charts.mktRoas.destroy();
  charts.mktRoas = new Chart(document.getElementById('mkt-roas-chart'),{type:'line',data:{labels:lbls,datasets:[{label:'ROAS',data:roSpark,borderColor:'var(--sage)',backgroundColor:'rgba(140,180,122,0.15)',fill:true,tension:0.4,pointRadius:2,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>'ROAS: '+ctx.parsed.y.toFixed(1)+'x'}}},scales:{y:{ticks:{color:'#9c9287',callback:v=>v.toFixed(1)+'x'},grid:{color:'#252220'}},x:{ticks:{color:'#9c9287',maxTicksLimit:10,font:{size:10}},grid:{display:false}}}}});
  try{const fr=await mktApi('analytics-dashboard',{site:'PrimalPantry.co.nz',from,to,metric:'funnel_stages'});if(Array.isArray(fr)&&fr.length>0){const f=fr[0];document.getElementById('mkt-funnel-container').innerHTML=renderMktFunnel(f.visitors||0,f.add_to_cart||0,f.checkout||0,f.purchase||0);}else{document.getElementById('mkt-funnel-container').innerHTML='<div class="loading">No funnel data</div>';}}catch(e){document.getElementById('mkt-funnel-container').innerHTML='<div class="loading">Funnel unavailable</div>';}
  mktCampaignPage = 1; renderMktCT('');
  // Blended source + creative tables and charts
  const mktOrders = allOrders.filter(o => o.order_date >= from && o.order_date <= to);
  mktSourceData = buildMktSourceData(mktOrders, trafficBySource, fbC.campaigns, gC.campaigns);
  mktSourcePage = 1; renderMktSourceTable();
  mktCreativeData = buildMktCreativeData(mktOrders, trafficByContent);
  mktCreativePage = 1; renderMktCreativeTable();
  renderMktSourceTimeChart(mktOrders);
  renderMktCreativeTimeChart(mktOrders);
  mktGadsPage = 1; renderMktGads();
  // Regional performance table
  renderMktRegionTable(mktOrders, fbC, gC, gSt);
  try{const lr=await mktApi('analytics-dashboard',{site:'PrimalPantry.co.nz',from,to,metric:'entry_pages'});if(Array.isArray(lr)&&lr.length>0){document.getElementById('mkt-landing-table').innerHTML=lr.slice(0,10).map(l=>{const pg=l.value||l.pathname||'-';return '<tr style="cursor:pointer;" onclick="openPageModal(\''+pg.replace(/'/g,"\\'")+'\')""><td>'+pg+'</td><td>'+(l.visitors||l.count||0)+'</td><td>-</td><td>-</td><td>-</td><td>'+(l.bounce_rate?l.bounce_rate.toFixed(1)+'%':'-')+'</td></tr>';}).join('');}}catch(e){}
  const gmcP=gmcD.products||[];const gmcTbl=document.getElementById('mkt-gmc-table'),gmcWrap=document.getElementById('mkt-gmc-table-wrap'),gmcLoad=document.getElementById('mkt-gmc-loading');
  if(gmcP.length>0){mktGmcPage=1;gmcWrap.style.display='table';gmcLoad.style.display='none';renderMktGmc(gmcP);}
  else if(gSt.connected&&gSt.merchantId){gmcLoad.textContent=gmcD.error||'No products found';gmcLoad.style.display='block';gmcWrap.style.display='none';}
  else{gmcLoad.textContent=gSt.connected?'Enter your Merchant Center ID above':'Connect Google to view product statuses';gmcLoad.style.display='block';gmcWrap.style.display='none';}
  mktLastLoaded = Date.now();
  mktLastDateRange = from + '|' + to;
  // Load competitors section
  loadCompetitorsSection();
  // Load changelog
  loadMktChangelog();
}

// ── Communications Tab ──

let commsInited = false;
let commsThreads = [];
let commsActiveThread = null;
let commsAccounts = [];

function commsApi(action, params = {}) {
  params.action = action;
  params.token = currentStaff.token;
  return fetch('/.netlify/functions/google-gmail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).then(r => r.json());
}

function commsTimeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd';
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
}

function renderCommsAccounts() {
  const bar = document.getElementById('comms-accounts-bar');
  const isAdmin = currentStaff && (currentStaff.role === 'owner' || currentStaff.role === 'admin');
  if (commsAccounts.length === 0) {
    bar.innerHTML = '<span style="color:var(--dim);">No Gmail accounts connected</span>' +
      (isAdmin ? ' <button class="comms-connect-btn" id="comms-connect-btn">Connect Gmail</button>' : '');
  } else {
    bar.innerHTML = commsAccounts.map(a =>
      '<span class="comms-account-pill">' + esc(a.email_address) +
      (isAdmin ? ' <span class="acct-x" onclick="disconnectGmailAccount(' + a.id + ')">&times;</span>' : '') +
      '</span>'
    ).join('') +
    (isAdmin ? ' <button class="comms-connect-btn" id="comms-connect-btn" style="font-size:0.65rem;padding:0.2rem 0.5rem;">+ Add</button>' : '');
  }
  // Re-bind connect button
  const btn = document.getElementById('comms-connect-btn');
  if (btn) btn.addEventListener('click', connectGmailAccount);
  // Populate from dropdowns
  const fromOpts = commsAccounts.map(a => '<option value="' + a.id + '">' + esc(a.email_address) + '</option>').join('');
  document.getElementById('comms-reply-from').innerHTML = fromOpts;
  document.getElementById('compose-from').innerHTML = fromOpts;
  // Populate inbox filter dropdown
  const inboxSel = document.getElementById('comms-inbox-filter');
  if (inboxSel) {
    const current = inboxSel.value;
    inboxSel.innerHTML = '<option value="all">All Inboxes</option>' + commsAccounts.map(a => '<option value="' + a.id + '">' + esc(a.email_address) + '</option>').join('');
    inboxSel.value = current;
  }
}

let commsFilter = 'all';
let commsInboxFilter = 'all';
let commsChannelFilter = 'all';
let commsFolder = 'inbox';
let commsMacros = [];
let commsStaffList = [];
let commsPrompts = [];

function commsDateLabel(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const weekAgo = new Date(today - 604800000);
  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  if (d >= weekAgo) return 'This Week';
  return 'Older';
}

function renderCommsThreadList(searchFilter) {
  const list = document.getElementById('comms-thread-list');
  let threads = commsThreads;
  // Filter by inbox
  if (commsInboxFilter && commsInboxFilter !== 'all') {
    const aid = parseInt(commsInboxFilter);
    threads = threads.filter(t => t.account_id === aid);
  }
  if (searchFilter) {
    const q = searchFilter.toLowerCase();
    threads = threads.filter(t =>
      (t.customer_name || '').toLowerCase().includes(q) ||
      (t.customer_email || '').toLowerCase().includes(q) ||
      (t.last_subject || '').toLowerCase().includes(q)
    );
  }
  if (threads.length === 0) {
    const emptyMsg = commsAccounts.length === 0 ? 'Connect a Gmail account to start' : commsFolder === 'sent' ? 'No sent emails' : commsFolder === 'archived' ? 'No archived conversations' : 'Inbox empty';
    list.innerHTML = '<div class="comms-empty">' + emptyMsg + '</div>';
    return;
  }
  // Update inbox count badge
  if (commsFolder === 'inbox') {
    const unread = threads.reduce((s, t) => s + (t.unread_count || 0), 0);
    const countEl = document.getElementById('comms-inbox-count');
    if (countEl) countEl.textContent = unread > 0 ? '(' + unread + ')' : '';
  }
  // Group by date
  let lastGroup = '';
  let html = '';
  for (const t of threads) {
    const group = commsDateLabel(t.last_date);
    if (group !== lastGroup) {
      lastGroup = group;
      html += '<div class="comms-date-group">' + group + '</div>';
    }
    const isActive = commsActiveThread && commsActiveThread.thread_id === t.thread_id;
    const ch = t.channel || 'email';
    const chLabels = { email: 'Email', facebook: 'FB', instagram: 'IG', livechat: 'Chat' };
    const dotClass = t.contact_type === 'supplier' ? 'comms-dot-supplier' : t.contact_type === 'wholesaler' ? 'comms-dot-wholesaler' : '';
    const showDot = t.unread_count > 0;
    html += '<div class="comms-thread-item channel-' + ch + (isActive ? ' active' : '') + (t.unread_count > 0 ? ' unread' : '') + '" onclick="openCommsThread(\'' + (t.thread_id || '').replace(/'/g, "\\'") + '\')">'
      + '<div class="comms-thread-name">'
      + (showDot ? '<span class="comms-unread-dot ' + dotClass + '"></span>' : '')
      + '<span>' + (commsFolder === 'sent' ? 'To: ' : '') + esc(t.customer_name || t.customer_email || 'Unknown')
      + '<span class="comms-channel-badge ch-' + ch + '">' + chLabels[ch] + '</span>'
      + '</span>'
      + '<span class="comms-thread-time">' + commsTimeAgo(t.last_date)
      + (t.order_flagged ? ' <svg class="comms-order-flag" viewBox="0 0 24 24" fill="none" stroke="#e06050" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' : '')
      + '</span>'
      + '</div>'
      + '<div class="comms-thread-subject">'
      + (t.contact_type !== 'customer' ? '<span class="comms-type-badge ' + t.contact_type + '">' + t.contact_type + '</span> ' : '')
      + esc(t.last_subject || t.last_snippet || '(no subject)') + '</div>'
      + '<div class="comms-thread-snippet">' + esc(t.last_snippet || '') + '</div>'
      + '</div>';
  }
  list.innerHTML = html;
}

async function renderCommsPrompts() {
  const area = document.getElementById('comms-prompts-area');
  try {
    const data = await commsApi('get_prompts', {});
    commsPrompts = data.prompts || [];
  } catch { commsPrompts = []; }
  if (commsPrompts.length === 0) { area.innerHTML = ''; return; }
  area.innerHTML = commsPrompts.map(p => {
    const fromName = (p.email_from || '').split('<')[0].trim() || 'Unknown';
    return '<div class="comms-prompt-bubble" onclick="openPromptThread(\'' + (p.thread_id || '').replace(/'/g, "\\'") + '\',' + p.id + ')">'
      + '<div class="comms-prompt-from">Prompted by ' + esc(p.from_staff) + '</div>'
      + '<div class="comms-prompt-subject">' + esc(fromName) + ' — ' + esc(p.email_subject || '(no subject)') + '</div>'
      + '<div class="comms-prompt-snippet">' + esc(p.email_snippet || '') + '</div>'
      + (p.note ? '<div class="comms-prompt-meta">Note: ' + esc(p.note) + '</div>' : '')
      + '</div>';
  }).join('');
}

async function openPromptThread(threadId, promptId) {
  // Dismiss the prompt
  commsApi('dismiss_prompt', { prompt_id: promptId }).catch(() => {});
  // Remove from UI
  commsPrompts = commsPrompts.filter(p => p.id !== promptId);
  renderCommsPrompts();
  // Open the thread
  if (threadId) openCommsThread(threadId);
}

async function openCommsThread(threadId) {
  commsActiveThread = commsThreads.find(t => t.thread_id === threadId) || { thread_id: threadId };
  renderCommsThreadList();

  const header = document.getElementById('comms-thread-header');
  const messagesEl = document.getElementById('comms-messages');
  const replyBox = document.getElementById('comms-reply-box');

  header.style.display = 'flex';
  const ct = commsActiveThread.contact_type || 'customer';
  const isFlagged = commsActiveThread.order_flagged || false;

  // Load staff list for prompt dropdown if not loaded
  if (commsStaffList.length === 0) {
    commsApi('get_staff_list', {}).then(d => { commsStaffList = d.staff || []; }).catch(() => {});
  }

  header.innerHTML = '<div>'
    + '<strong>' + esc(commsActiveThread.customer_name || commsActiveThread.customer_email || 'Unknown') + '</strong> '
    + '<span style="color:var(--dim);font-size:0.8rem;">' + esc(commsActiveThread.customer_email || '') + '</span> '
    + '<span class="comms-type-badge ' + ct + '">' + ct + '</span>'
    + '</div>'
    + '<div class="comms-header-actions">'
    + '<label><input type="checkbox" id="comms-order-flag" ' + (isFlagged ? 'checked' : '') + ' onchange="toggleOrderFlag(this.checked)"> Order</label>'
    + '<button id="comms-prompt-btn" onclick="showPromptDropdown()">Prompt</button>'
    + '<button onclick="archiveThread()" style="font-size:0.7rem;">Archive</button>'
    + '</div>';

  messagesEl.innerHTML = '<div class="comms-empty">Loading...</div>';

  try {
    const data = await commsApi('thread_messages', { thread_id: threadId });
    const msgs = data.messages || [];

    if (msgs.length === 0) {
      messagesEl.innerHTML = '<div class="comms-empty">No messages in this thread</div>';
      replyBox.style.display = 'none';
      return;
    }

    // Pre-compute response times: for each outbound, find the most recent prior inbound
    const responseTimes = msgs.map((m, idx) => {
      if (m.direction !== 'outbound') return '';
      for (let j = idx - 1; j >= 0; j--) {
        if (msgs[j].direction === 'inbound') return responseTimePill(msgs[j].date, m.date);
      }
      return '';
    });

    messagesEl.innerHTML = msgs.map((m, idx) => {
      const isOut = m.direction === 'outbound';
      const timeStr = new Date(m.date).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const fromName = (m.from_address || '').split('<')[0].trim();
      const toName = (m.to_address || '').split('<')[0].trim();

      // Gmail-like expandable header
      let headerHtml = '<div class="comms-email-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;">'
        + '<span style="font-weight:600;font-size:0.85rem;">' + esc(fromName || m.from_address || '') + '</span>'
        + '<span style="font-size:0.7rem;color:var(--dim);">' + timeStr + '</span>'
        + '</div>'
        + '<div style="font-size:0.75rem;color:var(--muted);margin-top:0.1rem;">' + esc(m.subject || '') + '</div>'
        + '</div>';

      // Expandable detail (hidden by default except last message)
      let detailHtml = '<div class="comms-email-detail" style="display:' + (idx === msgs.length - 1 ? 'block' : 'none') + ';">'
        + '<div><span>From: ' + esc(m.from_address || '') + '</span></div>'
        + '<div><span>To: ' + esc(m.to_address || '') + '</span></div>'
        + (m.cc ? '<div><span>CC: ' + esc(m.cc) + '</span></div>' : '')
        + '<div><span>Date: ' + timeStr + '</span></div>'
        + '</div>';

      // Body - render HTML if available
      let bodyHtml;
      if (m.body_html && m.body_html.trim()) {
        bodyHtml = '<div class="comms-msg-body" style="margin-top:0.5rem;">'
          + '<iframe class="comms-html-frame" srcdoc="' + m.body_html.replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '" sandbox="allow-same-origin" onload="this.style.height=Math.min(this.contentWindow.document.body.scrollHeight+20,600)+\'px\'"></iframe>'
          + '</div>';
      } else {
        let displayText = m.body_text || '';
        if (displayText.length > 3000) displayText = displayText.slice(0, 3000) + '...';
        bodyHtml = '<div style="margin-top:0.5rem;white-space:pre-wrap;font-size:0.85rem;line-height:1.6;">' + esc(displayText) + '</div>';
      }

      return '<div class="comms-msg ' + (isOut ? 'outbound' : 'inbound') + '" style="max-width:100%;">'
        + '<div class="comms-msg-bubble" style="border-radius:8px;">'
        + headerHtml
        + detailHtml
        + bodyHtml
        + '</div>'
        + '<div class="comms-msg-meta">'
        + (isOut && m.staff_name ? '<span class="comms-staff-badge">' + esc(m.staff_name) + '</span>' : '')
        + (isOut ? '<span style="color:var(--sage);">Sent</span>' + responseTimes[idx] : '')
        + '</div>'
        + '</div>';
    }).join('');

    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Show reply box with quoted text
    replyBox.style.display = 'block';
    const lastMsg = msgs[msgs.length - 1];
    const quoteFrom = (lastMsg.from_address || '').split('<')[0].trim();
    const quoteDate = new Date(lastMsg.date).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const quoteText = (lastMsg.body_text || '').split('\n').map(l => '> ' + l).join('\n');
    commsActiveThread._quoteBlock = '\n\nOn ' + quoteDate + ', ' + quoteFrom + ' wrote:\n' + quoteText;
    document.getElementById('comms-reply-text').value = '';

    if (lastMsg.account_id) {
      document.getElementById('comms-reply-from').value = lastMsg.account_id;
    }

    // Mark unread messages as read
    for (const m of msgs) {
      if (!m.is_read && m.direction === 'inbound' && m.gmail_id && m.account_id) {
        commsApi('mark_read', { message_id: m.gmail_id, account_id: m.account_id }).catch(() => {});
      }
    }
  } catch (e) {
    messagesEl.innerHTML = '<div class="comms-empty">Failed to load messages</div>';
  }
}

function toggleOrderFlag(checked) {
  if (!commsActiveThread) return;
  commsApi('flag_order', { thread_id: commsActiveThread.thread_id, flagged: checked }).catch(() => {});
  commsActiveThread.order_flagged = checked;
  // Update thread list
  const t = commsThreads.find(t => t.thread_id === commsActiveThread.thread_id);
  if (t) t.order_flagged = checked;
  renderCommsThreadList();
}

function showPromptDropdown() {
  const btn = document.getElementById('comms-prompt-btn');
  // If dropdown already exists, remove it
  const existing = document.getElementById('comms-prompt-dropdown');
  if (existing) { existing.remove(); return; }

  const dd = document.createElement('div');
  dd.id = 'comms-prompt-dropdown';
  dd.style.cssText = 'position:absolute;right:0;top:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:0.25rem;z-index:99;min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
  if (commsStaffList.length === 0) {
    dd.innerHTML = '<div style="padding:0.5rem;color:var(--dim);font-size:0.8rem;">Loading staff...</div>';
    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(dd);
    commsApi('get_staff_list', {}).then(d => {
      commsStaffList = d.staff || [];
      showPromptDropdown(); // Retry
    });
    return;
  }
  dd.innerHTML = commsStaffList.map(s =>
    '<div style="padding:0.4rem 0.6rem;cursor:pointer;font-size:0.8rem;border-radius:4px;" onmouseover="this.style.background=\'rgba(220,120,160,0.15)\'" onmouseout="this.style.background=\'none\'" onclick="sendPrompt(' + s.id + ',\'' + esc(s.display_name || '').replace(/'/g, "\\'") + '\')">'
    + esc(s.display_name || 'Staff #' + s.id) + ' <span style="color:var(--dim);font-size:0.7rem;">' + s.role + '</span></div>'
  ).join('');
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(dd);
  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closeDD(e) {
      if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('click', closeDD); }
    });
  }, 50);
}

async function sendPrompt(staffId, staffName) {
  if (!commsActiveThread) return;
  const dd = document.getElementById('comms-prompt-dropdown');
  if (dd) dd.remove();
  try {
    await commsApi('prompt', { thread_id: commsActiveThread.thread_id, to_staff_id: staffId });
    const btn = document.getElementById('comms-prompt-btn');
    btn.textContent = 'Prompted ' + staffName;
    btn.style.color = '#dc78a0';
    btn.style.borderColor = '#dc78a0';
    btn.style.background = 'rgba(220,120,160,0.12)';
    // Don't reset — stays pink until thread changes
  } catch (e) { alert('Failed to prompt: ' + e.message); }
}

async function archiveThread() {
  if (!commsActiveThread) return;
  if (!confirm('Archive this conversation?')) return;
  try {
    await commsApi('flag_archive', { thread_id: commsActiveThread.thread_id, archived: true });
    commsThreads = commsThreads.filter(t => t.thread_id !== commsActiveThread.thread_id);
    commsActiveThread = null;
    renderCommsThreadList();
    document.getElementById('comms-thread-header').style.display = 'none';
    document.getElementById('comms-messages').innerHTML = '<div class="comms-empty">Select a conversation to view messages</div>';
    document.getElementById('comms-reply-box').style.display = 'none';
  } catch (e) { alert('Failed to archive: ' + e.message); }
}

// Check for pending prompts on any tab load and show badge on Comms nav
async function checkCommsPrompts() {
  try {
    const data = await commsApi('get_prompts', {});
    const prompts = data.prompts || [];
    const count = prompts.length;

    // Badge on Comms nav
    const navBtn = document.querySelector('[data-tab="comms"]');
    if (navBtn) {
      let badge = navBtn.querySelector('.comms-nav-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'comms-nav-badge';
          badge.style.cssText = 'background:#dc78a0;color:#fff;font-size:0.6rem;font-weight:700;padding:0.1rem 0.35rem;border-radius:8px;margin-left:0.4rem;';
          navBtn.appendChild(badge);
        }
        badge.textContent = count;
      } else if (badge) {
        badge.remove();
      }
    }

    // Inject into Claude chat bubble as pink messages
    const fab = document.getElementById('claude-fab');
    const chatMsgs = document.getElementById('claude-messages');
    if (count > 0 && chatMsgs && fab) {
      fab.classList.add('has-prompts');
      // Remove old prompt messages
      chatMsgs.querySelectorAll('.claude-msg.prompt').forEach(el => el.remove());
      // Add each prompt as a pink bubble
      for (const p of prompts) {
        const fromName = (p.email_from || '').split('<')[0].trim() || 'Unknown';
        const div = document.createElement('div');
        div.className = 'claude-msg prompt';
        div.innerHTML = '<div class="claude-bubble" onclick="handlePromptClick(\'' + (p.thread_id || '').replace(/'/g, "\\'") + '\',' + p.id + ')">'
          + '<div class="prompt-label">Email from ' + esc(p.from_staff) + '</div>'
          + '<div class="prompt-subject">' + esc(fromName) + ' — ' + esc(p.email_subject || '(no subject)') + '</div>'
          + '<div style="font-size:0.75rem;color:var(--dim);margin-top:0.15rem;">' + esc((p.email_snippet || '').slice(0, 100)) + '</div>'
          + (p.note ? '<div style="font-size:0.7rem;color:#dc78a0;margin-top:0.2rem;">Note: ' + esc(p.note) + '</div>' : '')
          + '<div style="font-size:0.65rem;color:var(--dim);margin-top:0.25rem;">Click to view</div>'
          + '</div>';
        chatMsgs.appendChild(div);
      }
      chatMsgs.scrollTop = chatMsgs.scrollHeight;
      // Auto-open the panel
      const panel = document.getElementById('claude-panel');
      if (panel && !panel.classList.contains('open')) {
        panel.classList.add('open');
        fab.classList.add('open');
      }
    } else if (fab) {
      fab.classList.remove('has-prompts');
    }
  } catch {}
}

function handlePromptClick(threadId, promptId) {
  // Dismiss prompt
  commsApi('dismiss_prompt', { prompt_id: promptId }).catch(() => {});
  // Remove the bubble
  document.querySelectorAll('.claude-msg.prompt').forEach(el => el.remove());
  // Switch to Comms tab and open the thread
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const commsNav = document.querySelector('[data-tab="comms"]');
  if (commsNav) commsNav.classList.add('active');
  document.getElementById('tab-comms').classList.add('active');
  activeTab = 'comms';
  document.querySelector('.filter-bar').style.display = 'none';
  loadCommsTab().then(() => { if (threadId) openCommsThread(threadId); });
  // Close claude panel
  document.getElementById('claude-panel').classList.remove('open');
  document.getElementById('claude-fab').classList.remove('open');
  document.getElementById('claude-fab').classList.remove('has-prompts');
  checkCommsPrompts();
}

async function loadCommsTab() {
  if (!commsInited) {
    commsInited = true;
    document.getElementById('comms-search').addEventListener('input', function() {
      renderCommsThreadList(this.value.trim());
    });
    document.getElementById('comms-compose-btn').addEventListener('click', () => openComposeModal({}));
    document.getElementById('comms-reply-send').addEventListener('click', sendCommsReply);
    // Reply All button
    document.getElementById('comms-reply-all-btn').addEventListener('click', () => {
      if (!commsActiveThread) return;
      openComposeModal({
        to: commsActiveThread.customer_email || '',
        subject: (commsActiveThread.last_subject || '').startsWith('Re:') ? commsActiveThread.last_subject : 'Re: ' + (commsActiveThread.last_subject || ''),
        threadId: commsActiveThread.thread_id,
        body: commsActiveThread._quoteBlock || '',
      });
    });
    // Forward button
    document.getElementById('comms-forward-btn').addEventListener('click', () => {
      if (!commsActiveThread) return;
      openComposeModal({
        subject: 'Fwd: ' + (commsActiveThread.last_subject || ''),
        body: commsActiveThread._quoteBlock || '',
      });
    });
    // Folder buttons
    document.querySelectorAll('#comms-folder-bar .comms-filter-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('#comms-folder-bar .comms-filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        commsFolder = this.dataset.folder;
        loadCommsThreads();
      });
    });
    // Contact type filter buttons
    document.querySelectorAll('#comms-filter-bar .comms-filter-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('#comms-filter-bar .comms-filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        commsFilter = this.dataset.filter;
        loadCommsThreads();
      });
    });
    document.getElementById('comms-inbox-filter').addEventListener('change', function() {
      commsInboxFilter = this.value;
      loadCommsThreads();
    });
    // Channel filter buttons
    document.querySelectorAll('#comms-channel-bar .comms-filter-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('#comms-channel-bar .comms-filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        commsChannelFilter = this.dataset.channel;
        // Show/hide inbox dropdown (only relevant for email)
        document.getElementById('comms-inbox-filter').parentElement.style.display = (commsChannelFilter === 'all' || commsChannelFilter === 'email') ? '' : 'none';
        loadCommsThreads();
      });
    });
    window.addEventListener('message', e => { if (e.data && e.data.gmailConnected) loadCommsTab(); });
  }

  try {
    const acctData = await fetch('/.netlify/functions/gmail-auth?action=status&token=' + currentStaff.token).then(r => r.json());
    commsAccounts = acctData.accounts || [];
  } catch { commsAccounts = []; }
  renderCommsAccounts();

  // Load prompts for this staff member
  renderCommsPrompts();

  if (commsAccounts.length > 0) {
    // Load threads first from existing data (fast)
    await loadCommsThreads();
    // Then sync in background (slow) and refresh
    commsApi('sync', { maxResults: 15 }).then(() => loadCommsThreads()).catch(e => console.error('Comms sync error:', e));
  }
}

async function loadCommsThreads() {
  try {
    const data = await commsApi('threads', { limit: 50, filter: commsFilter, channel: commsChannelFilter, folder: commsFolder });
    commsThreads = data.threads || [];
    renderCommsThreadList();
  } catch (e) {
    console.error('Comms threads error:', e);
    document.getElementById('comms-thread-list').innerHTML = '<div class="comms-empty">Failed to load threads</div>';
  }
}

async function sendCommsReply() {
  if (!commsActiveThread) return;
  const textEl = document.getElementById('comms-reply-text');
  let text = textEl.value.trim();
  if (!text) return;

  const ch = commsActiveThread.channel || 'email';
  const btn = document.getElementById('comms-reply-send');
  btn.disabled = true; btn.textContent = 'Sending...';

  try {
    if (ch === 'facebook' || ch === 'instagram') {
      // Extract recipient ID from thread_id (format: facebook_PSID or instagram_IGSID)
      const recipientId = (commsActiveThread.thread_id || '').replace(/^(facebook|instagram)_/, '');
      await fetch('/.netlify/functions/meta-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentStaff.token, platform: ch, recipient_id: recipientId, text, thread_id: commsActiveThread.thread_id }),
      }).then(r => r.json());
    } else {
      // Email send (existing)
      const accountId = parseInt(document.getElementById('comms-reply-from').value);
      if (!accountId) { btn.disabled = false; btn.textContent = 'Send'; return; }
      if (commsActiveThread._quoteBlock) text += commsActiveThread._quoteBlock;
      const lastSubject = commsActiveThread.last_subject || '';
      const subject = lastSubject.startsWith('Re:') ? lastSubject : 'Re: ' + lastSubject;
      await commsApi('send', {
        account_id: accountId,
        to: commsActiveThread.customer_email || '',
        subject: subject,
        body: text,
        threadId: commsActiveThread.thread_id,
      });
    }
    textEl.value = '';
    await openCommsThread(commsActiveThread.thread_id);
    await loadCommsThreads();
  } catch (e) { alert('Failed to send: ' + e.message); }

  btn.disabled = false; btn.textContent = 'Send';
}

function connectGmailAccount() {
  fetch('/.netlify/functions/gmail-auth?action=authorize&token=' + currentStaff.token)
    .then(r => r.json())
    .then(d => { if (d.url) window.open(d.url, 'gmail-auth', 'width=600,height=700'); });
}

async function disconnectGmailAccount(id) {
  if (!confirm('Disconnect this Gmail account?')) return;
  await fetch('/.netlify/functions/gmail-auth?action=disconnect&token=' + currentStaff.token + '&id=' + id);
  loadCommsTab();
}

// ── Email Compose Modal ──

function openComposeModal(opts) {
  opts = opts || {};
  const modal = document.getElementById('email-compose-modal');
  document.getElementById('compose-to').value = opts.to || '';
  document.getElementById('compose-subject').value = opts.subject || '';
  document.getElementById('compose-cc').value = opts.cc || '';
  document.getElementById('compose-bcc').value = opts.bcc || '';
  document.getElementById('compose-body').value = opts.body || '';
  document.getElementById('compose-title').textContent = opts.threadId ? 'Reply' : 'Compose Email';
  document.getElementById('compose-result').textContent = '';
  document.getElementById('compose-send-type').value = opts.sendType || 'direct';
  modal.dataset.threadId = opts.threadId || '';

  // Populate from dropdown if not already done
  if (commsAccounts.length > 0) {
    document.getElementById('compose-from').innerHTML = commsAccounts.map(a =>
      '<option value="' + a.id + '">' + esc(a.email_address) + '</option>'
    ).join('');
    if (opts.accountId) document.getElementById('compose-from').value = opts.accountId;
  } else {
    // Try loading accounts
    fetch('/.netlify/functions/gmail-auth?action=status&token=' + currentStaff.token)
      .then(r => r.json())
      .then(d => {
        commsAccounts = d.accounts || [];
        document.getElementById('compose-from').innerHTML = commsAccounts.map(a =>
          '<option value="' + a.id + '">' + esc(a.email_address) + '</option>'
        ).join('');
      }).catch(() => {});
  }

  modal.classList.add('open');
}

document.getElementById('compose-close').addEventListener('click', () => {
  document.getElementById('email-compose-modal').classList.remove('open');
});
document.getElementById('compose-cancel').addEventListener('click', () => {
  document.getElementById('email-compose-modal').classList.remove('open');
});
document.getElementById('email-compose-modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});

document.getElementById('compose-send').addEventListener('click', async () => {
  const modal = document.getElementById('email-compose-modal');
  const accountId = parseInt(document.getElementById('compose-from').value);
  const to = document.getElementById('compose-to').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const body = document.getElementById('compose-body').value.trim();

  if (!to) { document.getElementById('compose-result').innerHTML = '<span style="color:var(--red);">To address required</span>'; return; }
  if (!accountId) { document.getElementById('compose-result').innerHTML = '<span style="color:var(--red);">No Gmail account connected</span>'; return; }

  const btn = document.getElementById('compose-send');
  btn.disabled = true; btn.textContent = 'Sending...';

  try {
    const res = await commsApi('send', {
      account_id: accountId,
      to: to,
      cc: document.getElementById('compose-cc').value.trim(),
      bcc: document.getElementById('compose-bcc').value.trim(),
      subject: subject,
      body: body,
      threadId: modal.dataset.threadId || undefined,
      send_type: document.getElementById('compose-send-type').value,
    });

    if (res.success) {
      document.getElementById('compose-result').innerHTML = '<span style="color:var(--sage);">Email sent!</span>';
      setTimeout(() => modal.classList.remove('open'), 1000);
      // Refresh comms tab if active
      if (activeTab === 'comms') {
        const data = await commsApi('threads', { limit: 50 });
        commsThreads = data.threads || [];
        renderCommsThreadList();
        if (commsActiveThread) openCommsThread(commsActiveThread.thread_id);
      }
    } else {
      document.getElementById('compose-result').innerHTML = '<span style="color:var(--red);">' + esc(res.error || 'Send failed') + '</span>';
    }
  } catch (e) {
    document.getElementById('compose-result').innerHTML = '<span style="color:var(--red);">' + esc(e.message) + '</span>';
  }

  btn.disabled = false; btn.textContent = 'Send';
});

// ── Settings Tab ──

let settingsInited = false;
let settingsActiveTab = 'suppliers';

async function loadSettingsTab() {
  if (!settingsInited) {
    settingsInited = true;
    // Sub-tab switching
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        settingsActiveTab = this.dataset.settingsTab;
        document.querySelectorAll('.settings-panel').forEach(p => p.style.display = 'none');
        document.getElementById('settings-' + settingsActiveTab).style.display = 'block';
        if (settingsActiveTab === 'suppliers') loadSuppliers();
        else if (settingsActiveTab === 'macros') loadMacros();
      });
    });
    // Add macro
    document.getElementById('macro-add-btn').addEventListener('click', async () => {
      const name = document.getElementById('macro-name').value.trim();
      const content = document.getElementById('macro-content').value.trim();
      if (!name || !content) return;
      const btn = document.getElementById('macro-add-btn');
      btn.disabled = true; btn.textContent = 'Adding...';
      try {
        await fetch('/.netlify/functions/dashboard-data', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: currentStaff.token, table: 'macros', operation: 'insert', params: { body: { name, content, created_by: currentStaff.id } } }),
        });
        document.getElementById('macro-name').value = '';
        document.getElementById('macro-content').value = '';
        await loadMacros();
      } catch (e) { alert('Error: ' + e.message); }
      btn.disabled = false; btn.textContent = 'Add Macro';
    });
    // Add supplier
    document.getElementById('sup-add-btn').addEventListener('click', async () => {
      const name = document.getElementById('sup-name').value.trim();
      if (!name) return;
      const btn = document.getElementById('sup-add-btn');
      btn.disabled = true; btn.textContent = 'Adding...';
      try {
        await fetch('/.netlify/functions/suppliers?token=' + currentStaff.token, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'suppliers', name,
            contact_name: document.getElementById('sup-contact').value.trim(),
            email: document.getElementById('sup-email').value.trim(),
            phone: document.getElementById('sup-phone').value.trim(),
            website: document.getElementById('sup-website').value.trim(),
            payment_terms: document.getElementById('sup-terms').value.trim(),
            address: document.getElementById('sup-address').value.trim(),
            notes: document.getElementById('sup-notes').value.trim(),
          }),
        });
        ['sup-name','sup-contact','sup-email','sup-phone','sup-website','sup-terms','sup-address','sup-notes'].forEach(id => {
          const el = document.getElementById(id);
          if (el.tagName === 'TEXTAREA') el.value = ''; else el.value = '';
        });
        await loadSuppliers();
      } catch (e) { alert('Error: ' + e.message); }
      btn.disabled = false; btn.textContent = 'Add Supplier';
    });
  }
  if (settingsActiveTab === 'suppliers') loadSuppliers();
  else if (settingsActiveTab === 'macros') loadMacros();
}

function renderEntityTable(tableId, data, type) {
  const tbl = document.getElementById(tableId);
  // Show/hide Xero sync buttons
  const supSync = document.getElementById('sup-xero-sync');
  const rcSync = document.getElementById('rc-xero-sync');
  if (supSync) supSync.style.display = xeroConnected ? '' : 'none';
  if (rcSync) rcSync.style.display = xeroConnected ? '' : 'none';

  const displayType = type === 'wholesalers' ? 'retailers' : type;
  if (!data || data.length === 0) {
    tbl.innerHTML = '<tr><td colspan="6" class="loading">No ' + displayType + ' added yet</td></tr>';
    return;
  }
  tbl.innerHTML = data.map(s => {
    const xeroBadge = s.xero_contact_id ? ' <span style="font-size:0.6rem;background:var(--sage);color:var(--bg);padding:1px 5px;border-radius:4px;margin-left:4px;vertical-align:middle;">XERO</span>' : '';
    return '<tr>'
      + '<td style="font-weight:500;">' + esc(s.name) + xeroBadge + '</td>'
      + '<td>' + esc(s.contact_name || '-') + '</td>'
      + '<td>' + (s.email ? '<a href="mailto:' + esc(s.email) + '" style="color:var(--sage);">' + esc(s.email) + '</a>' : '-') + '</td>'
      + '<td>' + esc(s.phone || '-') + '</td>'
      + '<td>' + esc(s.payment_terms || '-') + '</td>'
      + '<td><button class="delete-btn" onclick="deleteEntity(' + s.id + ',\'' + type + '\')" style="font-size:0.7rem;padding:3px 8px;">Remove</button></td>'
      + '</tr>';
  }).join('');
}

async function ensureXeroStatus() {
  if (xeroConnected) return;
  try {
    const res = await fetch('/.netlify/functions/xero-status?token=' + currentStaff.token);
    const status = await res.json();
    xeroConnected = status.connected || false;
  } catch { xeroConnected = false; }
}

async function loadSuppliers() {
  try {
    await ensureXeroStatus();
    const res = await fetch('/.netlify/functions/suppliers?token=' + currentStaff.token + '&type=suppliers');
    const data = await res.json();
    renderEntityTable('sup-table', data.suppliers || [], 'suppliers');
  } catch { document.getElementById('sup-table').innerHTML = '<tr><td colspan="6" class="loading">Failed to load</td></tr>'; }
}

async function deleteEntity(id, type) {
  const delLabel = type === 'wholesalers' ? 'retailer' : type.slice(0, -1);
  if (!confirm('Remove this ' + delLabel + '?')) return;
  try {
    await fetch('/.netlify/functions/suppliers?token=' + currentStaff.token + '&id=' + id + '&type=' + type, { method: 'DELETE' });
    if (type === 'suppliers') loadSuppliers(); else loadRetailCustomersList();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── Macros ──

async function loadMacros() {
  try {
    const res = await fetch('/.netlify/functions/dashboard-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentStaff.token, table: 'macros', operation: 'select', params: { select: '*', eq: ['active', 'true'], order: 'name.asc' } }),
    });
    const data = await res.json();
    commsMacros = data.data || [];
    const tbl = document.getElementById('macro-table');
    if (commsMacros.length === 0) {
      tbl.innerHTML = '<tr><td colspan="3" class="loading">No macros added yet</td></tr>';
      return;
    }
    tbl.innerHTML = commsMacros.map(m => '<tr>'
      + '<td style="font-weight:500;">' + esc(m.name) + '</td>'
      + '<td style="color:var(--dim);font-size:0.8rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(m.content.slice(0, 80)) + '</td>'
      + '<td><button class="delete-btn" onclick="deleteMacro(' + m.id + ')" style="font-size:0.7rem;padding:3px 8px;">Remove</button></td>'
      + '</tr>').join('');
  } catch { document.getElementById('macro-table').innerHTML = '<tr><td colspan="3" class="loading">Failed to load</td></tr>'; }
}

async function deleteMacro(id) {
  if (!confirm('Delete this macro?')) return;
  try {
    await fetch('/.netlify/functions/dashboard-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentStaff.token, table: 'macros', operation: 'update', params: { eq: ['id', String(id)], body: { active: false } } }),
    });
    await loadMacros();
  } catch (e) { alert('Error: ' + e.message); }
}

let macroModalTarget = '';

function toggleMacroDropdown(targetTextareaId) {
  macroModalTarget = targetTextareaId;
  const modal = document.getElementById('macro-modal');

  // Load macros if not loaded
  if (commsMacros.length === 0) {
    fetch('/.netlify/functions/dashboard-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentStaff.token, table: 'macros', operation: 'select', params: { select: '*', eq: ['active', 'true'], order: 'name.asc' } }),
    }).then(r => r.json()).then(data => {
      commsMacros = data.data || [];
      renderMacroModal();
    });
  } else {
    renderMacroModal();
  }
  modal.classList.add('open');
}

function renderMacroModal() {
  const list = document.getElementById('macro-modal-list');
  if (commsMacros.length === 0) {
    list.innerHTML = '<div style="padding:1.5rem;color:var(--dim);text-align:center;font-size:0.85rem;">No macros yet. Create one below.</div>';
  } else {
    list.innerHTML = commsMacros.map(m =>
      '<div class="comms-macro-item" style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;" data-macro-id="' + m.id + '">'
      + '<div style="flex:1;cursor:pointer;" onclick="insertMacro(' + m.id + ')">'
      + '<div class="macro-name">' + esc(m.name) + '</div>'
      + '<div class="macro-preview" style="white-space:normal;">' + esc(m.content.slice(0, 120)) + (m.content.length > 120 ? '...' : '') + '</div>'
      + '</div>'
      + '<button onclick="deleteMacroFromModal(' + m.id + ')" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:0.9rem;padding:0.2rem;" title="Delete">&times;</button>'
      + '</div>'
    ).join('');
  }
  // Reset create form
  document.getElementById('macro-modal-name').value = '';
  document.getElementById('macro-modal-content').value = '';
  document.getElementById('macro-modal-create-form').style.display = 'none';
}

function insertMacro(macroId) {
  const macro = commsMacros.find(m => m.id === macroId);
  if (!macro || !macroModalTarget) return;
  const textarea = document.getElementById(macroModalTarget);
  const start = textarea.selectionStart;
  const before = textarea.value.substring(0, start);
  const after = textarea.value.substring(textarea.selectionEnd);
  textarea.value = before + macro.content + after;
  textarea.selectionStart = textarea.selectionEnd = start + macro.content.length;
  textarea.focus();
  document.getElementById('macro-modal').classList.remove('open');
}

async function deleteMacroFromModal(id) {
  if (!confirm('Delete this macro?')) return;
  try {
    await fetch('/.netlify/functions/dashboard-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentStaff.token, table: 'macros', operation: 'update', params: { body: { active: false }, eq: ['id', id] } }),
    });
    commsMacros = commsMacros.filter(m => m.id !== id);
    renderMacroModal();
    if (typeof loadMacros === 'function') loadMacros();
  } catch (e) { console.error('Delete macro error:', e); }
}

async function createMacroFromModal() {
  const name = document.getElementById('macro-modal-name').value.trim();
  const content = document.getElementById('macro-modal-content').value.trim();
  if (!name || !content) { alert('Name and content are required'); return; }
  const btn = document.getElementById('macro-modal-save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    await fetch('/.netlify/functions/dashboard-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentStaff.token, table: 'macros', operation: 'insert', params: { body: { name, content, created_by: currentStaff.id } } }),
    });
    // Reload macros
    const data = await fetch('/.netlify/functions/dashboard-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentStaff.token, table: 'macros', operation: 'select', params: { select: '*', eq: ['active', 'true'], order: 'name.asc' } }),
    }).then(r => r.json());
    commsMacros = data.data || [];
    renderMacroModal();
    if (typeof loadMacros === 'function') loadMacros();
  } catch (e) { console.error('Create macro error:', e); }
  btn.disabled = false; btn.textContent = 'Save';
}

async function syncFromXero(type) {
  const btnId = type === 'suppliers' ? 'sup-xero-sync' : 'rc-xero-sync';
  const btn = document.getElementById(btnId);
  btn.disabled = true; btn.textContent = 'Syncing...';
  try {
    const res = await fetch('/.netlify/functions/xero-sync-contacts?token=' + currentStaff.token + '&action=import');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    const imp = data.imported || {};
    alert('Imported ' + (imp.suppliers || 0) + ' suppliers and ' + (imp.wholesalers || 0) + ' retailers from Xero');
    loadSuppliers();
    loadRetailCustomersList();
  } catch (e) { alert('Sync error: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Sync from Xero';
}

// ── Competitor Tracking ──

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

let compInited = false;
let compData = { competitors: [], recent_changes: [] };

function compTypeBadge(type) {
  const map = {
    title: { bg:'rgba(66,133,244,0.15)', fg:'#6ba3f7', label:'Title' },
    meta: { bg:'rgba(140,180,122,0.15)', fg:'var(--sage)', label:'SEO' },
    hero: { bg:'rgba(212,168,75,0.15)', fg:'var(--honey)', label:'Hero' },
    pricing: { bg:'rgba(224,96,80,0.15)', fg:'#e06050', label:'Pricing' },
    products: { bg:'rgba(180,140,210,0.15)', fg:'#b48cd2', label:'Products' },
    new_pages: { bg:'rgba(80,180,200,0.15)', fg:'#50b4c8', label:'New Pages' },
    content: { bg:'rgba(156,146,135,0.15)', fg:'var(--muted)', label:'Content' },
  };
  const s = map[type] || map.content;
  return '<span class="source-pill" style="background:'+s.bg+';color:'+s.fg+'">'+s.label+'</span>';
}

function renderCompList() {
  const tbl = document.getElementById('comp-list-table');
  if (!compData.competitors || compData.competitors.length === 0) {
    tbl.innerHTML = '<tr><td colspan="5" class="loading">No competitors added yet. Add one above.</td></tr>';
    return;
  }
  tbl.innerHTML = compData.competitors.map(c => {
    const lastCheck = c.last_checked ? new Date(c.last_checked).toLocaleDateString('en-NZ', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Never';
    return '<tr>'
      + '<td style="font-weight:500;">'+esc(c.name)+'</td>'
      + '<td><a href="'+esc(c.url)+'" target="_blank" rel="noopener" style="color:var(--sage);text-decoration:underline;">'+esc(c.url.replace(/^https?:\/\//,''))+'</a></td>'
      + '<td style="color:var(--muted);font-size:0.8rem;">'+lastCheck+'</td>'
      + '<td>'+(c.change_count > 0 ? '<span style="background:rgba(224,96,80,0.15);color:#e06050;padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:600;">'+c.change_count+'</span>' : '<span style="color:var(--dim);font-size:0.8rem;">0</span>')+'</td>'
      + '<td><button class="delete-btn" onclick="deleteCompetitor('+c.id+')" style="font-size:0.7rem;padding:3px 8px;">Remove</button></td>'
      + '</tr>';
  }).join('');
  document.getElementById('mkt-comp-count').textContent = compData.competitors.length + ' tracked';
}

function renderCompChanges(filter) {
  const tbl = document.getElementById('comp-changes-table');
  let changes = compData.recent_changes || [];
  if (filter && filter !== 'all') {
    const fid = parseInt(filter);
    changes = changes.filter(c => c.competitor_id === fid);
  }
  if (changes.length === 0) {
    tbl.innerHTML = '<tr><td colspan="4" class="loading">No changes detected yet</td></tr>';
    return;
  }
  // Map competitor names
  const nameMap = {};
  (compData.competitors || []).forEach(c => { nameMap[c.id] = c.name; });
  tbl.innerHTML = changes.map(c => {
    const dt = new Date(c.detected_at);
    const dateStr = dt.toLocaleDateString('en-NZ', { day:'numeric', month:'short', year:'numeric' });
    return '<tr' + (c.change_type === 'pricing' ? ' style="background:rgba(224,96,80,0.05);"' : '') + '>'
      + '<td style="color:var(--muted);font-size:0.8rem;white-space:nowrap;">'+dateStr+'</td>'
      + '<td style="font-weight:500;">'+esc(nameMap[c.competitor_id] || 'Unknown')+'</td>'
      + '<td>'+compTypeBadge(c.change_type)+'</td>'
      + '<td style="font-size:0.85rem;">'+esc(c.summary)+'</td>'
      + '</tr>';
  }).join('');
}

async function loadCompetitorsSection() {
  if (!compInited) {
    compInited = true;
    document.getElementById('comp-add-btn').addEventListener('click', addCompetitor);
    document.getElementById('comp-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') addCompetitor(); });
    document.getElementById('comp-url-input').addEventListener('keydown', e => { if (e.key === 'Enter') addCompetitor(); });
    document.getElementById('comp-filter').addEventListener('change', function() { renderCompChanges(this.value); });
  }
  try {
    compData = await mktApi('competitors', {});
    renderCompList();
    // Populate filter dropdown
    const sel = document.getElementById('comp-filter');
    const current = sel.value;
    sel.innerHTML = '<option value="all">All Competitors</option>' + (compData.competitors || []).map(c => '<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
    sel.value = current;
    renderCompChanges(sel.value);
  } catch (e) {
    document.getElementById('comp-list-table').innerHTML = '<tr><td colspan="5" class="loading">Failed to load competitors</td></tr>';
  }
}

async function addCompetitor() {
  const nameEl = document.getElementById('comp-name-input');
  const urlEl = document.getElementById('comp-url-input');
  const name = nameEl.value.trim();
  const url = urlEl.value.trim();
  if (!name || !url) return;
  const btn = document.getElementById('comp-add-btn');
  btn.disabled = true; btn.textContent = 'Adding...';
  try {
    await fetch('/.netlify/functions/competitors?token=' + currentStaff.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url }),
    });
    nameEl.value = ''; urlEl.value = '';
    await loadCompetitorsSection();
  } catch (e) { console.error('Add competitor error:', e); }
  btn.disabled = false; btn.textContent = 'Add Competitor';
}

async function deleteCompetitor(id) {
  if (!confirm('Remove this competitor?')) return;
  try {
    await fetch('/.netlify/functions/competitors?token=' + currentStaff.token + '&id=' + id, { method: 'DELETE' });
    await loadCompetitorsSection();
  } catch (e) { console.error('Delete competitor error:', e); }
}

async function runCompetitorCheck() {
  const btn = document.getElementById('comp-run-check-btn');
  btn.disabled = true; btn.textContent = 'Checking...';
  try {
    const res = await fetch('/.netlify/functions/competitor-check?token=' + currentStaff.token);
    if (!res.ok) throw new Error('Check failed: ' + res.status);
    await loadCompetitorsSection();
    btn.textContent = 'Done!';
    setTimeout(() => { btn.textContent = 'Run Check Now'; btn.disabled = false; }, 2000);
  } catch (e) {
    console.error('Competitor check error:', e);
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Run Check Now'; btn.disabled = false; }, 2000);
  }
}

// ── Finance Tab ──

let financeLoaded = false;
let xeroConnected = false;
const xeroCache = {};
const XERO_CACHE_TTL = 5 * 60 * 1000; // 5 min for reports
const XERO_TXN_CACHE_TTL = 2 * 60 * 1000; // 2 min for transactions

function finToken() {
  return currentStaff ? currentStaff.token : '';
}

async function xeroFetch(endpoint, params = {}) {
  const cacheKey = endpoint + '_' + JSON.stringify(params);
  const cached = xeroCache[cacheKey];
  const ttl = endpoint.includes('Transaction') || endpoint === 'Invoices' ? XERO_TXN_CACHE_TTL : XERO_CACHE_TTL;
  if (cached && Date.now() - cached.at < ttl) return cached.data;

  params.token = finToken();
  params.endpoint = endpoint;
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/.netlify/functions/xero-api?${qs}`);
  if (res.status === 401) { throw new Error('Session expired'); }
  if (res.status === 403) { xeroConnected = false; throw new Error('Xero not connected'); }
  if (!res.ok) throw new Error('Xero API error ' + res.status);
  const data = await res.json();
  xeroCache[cacheKey] = { data, at: Date.now() };
  return data;
}

function xeroStartAuth() {
  const token = finToken();
  fetch(`/.netlify/functions/xero-auth?action=authorize&token=${token}`)
    .then(r => r.json())
    .then(data => {
      if (data.url) {
        const popup = window.open(data.url, 'xero-auth', 'width=600,height=700');
        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.xeroConnected) {
            window.removeEventListener('message', handler);
            xeroConnected = true;
            loadFinanceTab();
          }
        });
      } else {
        alert(data.error || 'Failed to start Xero auth');
      }
    })
    .catch(err => alert('Auth error: ' + err.message));
}

async function xeroDisconnect() {
  if (!confirm('Disconnect Xero? You can reconnect later.')) return;
  const token = finToken();
  await fetch('/.netlify/functions/xero-disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  xeroConnected = false;
  Object.keys(xeroCache).forEach(k => delete xeroCache[k]);
  loadFinanceTab();
}

function xeroRefreshAll() {
  Object.keys(xeroCache).forEach(k => delete xeroCache[k]);
  loadFinanceTab();
}

// ── Xero response parsers ──

function parseXeroPnlMonthly(report) {
  // Xero Reports/ProfitAndLoss with periods=11&timeframe=MONTH returns columns per month
  const rows = report.Reports ? report.Reports[0].Rows : [];
  const headers = rows.find(r => r.RowType === 'Header');
  if (!headers) return null;

  const months = [];
  const labels = headers.Cells.slice(1).map(c => c.Value); // month labels

  let revenueRow = null, expenseRow = null;
  for (const section of rows) {
    if (section.RowType === 'Section') {
      const title = (section.Title || '').toLowerCase();
      if (title.includes('revenue') || title.includes('income')) {
        // Find the section total (last row in Rows array is usually the total)
        const totalRow = section.Rows ? section.Rows[section.Rows.length - 1] : null;
        if (totalRow && totalRow.RowType === 'SummaryRow') revenueRow = totalRow;
      }
      if (title.includes('expense') || title.includes('operating')) {
        const totalRow = section.Rows ? section.Rows[section.Rows.length - 1] : null;
        if (totalRow && totalRow.RowType === 'SummaryRow') expenseRow = totalRow;
      }
    }
  }

  if (!revenueRow || !expenseRow) return null;

  for (let i = 0; i < labels.length; i++) {
    const rev = Math.abs(parseFloat(revenueRow.Cells[i + 1].Value) || 0);
    const exp = Math.abs(parseFloat(expenseRow.Cells[i + 1].Value) || 0);
    months.push({ label: labels[i], revenue: Math.round(rev), expenses: Math.round(exp) });
  }
  return months;
}

function parseXeroPnlDetail(report) {
  const rows = report.Reports ? report.Reports[0].Rows : [];
  const detail = [];

  for (const section of rows) {
    if (section.RowType === 'Section' && section.Title) {
      detail.push({ type: 'section', label: section.Title });
      if (section.Rows) {
        for (const row of section.Rows) {
          if (row.RowType === 'Row' && row.Cells) {
            const label = row.Cells[0].Value;
            const amount = parseFloat(row.Cells[row.Cells.length - 1].Value) || 0;
            detail.push({ type: 'row', label, amount });
          } else if (row.RowType === 'SummaryRow' && row.Cells) {
            const label = row.Cells[0].Value || 'Total';
            const amount = parseFloat(row.Cells[row.Cells.length - 1].Value) || 0;
            detail.push({ type: 'total', label, amount });
          }
        }
      }
    }
    if (section.RowType === 'Row' && section.Cells) {
      const label = section.Cells[0].Value;
      const amount = parseFloat(section.Cells[section.Cells.length - 1].Value) || 0;
      if (label && label.toLowerCase().includes('profit')) {
        detail.push({ type: 'total', label, amount });
      }
    }
  }
  return detail.length > 0 ? detail : null;
}

function parseXeroBankSummary(report) {
  const rows = report.Reports ? report.Reports[0].Rows : [];
  const banks = [];
  for (const section of rows) {
    if (section.RowType === 'Section' && section.Rows) {
      for (const row of section.Rows) {
        if (row.RowType === 'Row' && row.Cells) {
          const name = row.Cells[0].Value;
          const balance = parseFloat(row.Cells[row.Cells.length - 1].Value) || 0;
          if (name) banks.push({ name, balance });
        }
      }
    }
  }
  return banks.length > 0 ? banks : null;
}

function parseXeroBankTransactions(data) {
  const txns = (data.BankTransactions || []).slice(0, 30).map(t => ({
    date: (t.Date || '').replace(/\/Date\((\d+)\)\//, (_, ms) => new Date(+ms).toISOString().split('T')[0]),
    description: (t.Contact ? t.Contact.Name + ' — ' : '') + ((t.LineItems && t.LineItems[0]) ? t.LineItems[0].Description || '' : ''),
    account: t.BankAccount ? t.BankAccount.Name : '',
    amount: t.Type === 'RECEIVE' ? Math.abs(t.Total || 0) : -Math.abs(t.Total || 0),
  }));
  return txns.length > 0 ? txns : null;
}

function parseXeroInvoices(data, type) {
  const now = new Date();
  return (data.Invoices || []).map(inv => {
    const dueDate = (inv.DueDateString || inv.DueDate || '').replace(/\/Date\((\d+)\)\//, (_, ms) => new Date(+ms).toISOString().split('T')[0]);
    const due = new Date(dueDate);
    const isOverdue = due < now && inv.AmountDue > 0;
    return {
      number: inv.InvoiceNumber || inv.InvoiceID,
      contact: inv.Contact ? inv.Contact.Name : '',
      dueDate,
      amount: inv.AmountDue || 0,
      status: isOverdue ? 'overdue' : 'current',
    };
  });
}

// Mock data generators (structured to match Xero API responses for easy swap later)
function getMockPnlData() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString('en-NZ', { month: 'short', year: '2-digit' });
    const revenue = 12000 + Math.random() * 18000;
    const cogs = revenue * (0.25 + Math.random() * 0.1);
    const opex = revenue * (0.2 + Math.random() * 0.15);
    const expenses = cogs + opex;
    months.push({ label, revenue: Math.round(revenue), expenses: Math.round(expenses), cogs: Math.round(cogs), opex: Math.round(opex) });
  }
  return months;
}

function getMockPnlDetail() {
  return [
    { type: 'section', label: 'Revenue' },
    { type: 'row', label: 'Product Sales', amount: 21450 },
    { type: 'row', label: 'Wholesale', amount: 4320 },
    { type: 'row', label: 'Markets & Events', amount: 1890 },
    { type: 'total', label: 'Total Revenue', amount: 27660 },
    { type: 'section', label: 'Cost of Sales' },
    { type: 'row', label: 'Raw Materials', amount: -4120 },
    { type: 'row', label: 'Packaging', amount: -1850 },
    { type: 'row', label: 'Manufacturing Labor', amount: -2340 },
    { type: 'total', label: 'Gross Profit', amount: 19350 },
    { type: 'section', label: 'Operating Expenses' },
    { type: 'row', label: 'Advertising & Marketing', amount: -3200 },
    { type: 'row', label: 'Shipping & Freight', amount: -2450 },
    { type: 'row', label: 'Platform Fees (Stripe/Shopify)', amount: -980 },
    { type: 'row', label: 'Rent & Utilities', amount: -1200 },
    { type: 'row', label: 'Insurance', amount: -380 },
    { type: 'row', label: 'Software & Subscriptions', amount: -420 },
    { type: 'row', label: 'Accounting & Legal', amount: -650 },
    { type: 'total', label: 'Total Operating Expenses', amount: -9280 },
    { type: 'total', label: 'Net Profit', amount: 10070 },
  ];
}

function getMockBankData() {
  return [
    { name: 'Business Cheque Account', balance: 18420 },
    { name: 'Savings Account', balance: 5930 },
    { name: 'Tax Holding Account', balance: 3200 },
  ];
}

function getMockCashflowData() {
  const days = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
    const moneyIn = 400 + Math.random() * 1200;
    const moneyOut = 200 + Math.random() * 800;
    days.push({ label, moneyIn: Math.round(moneyIn), moneyOut: Math.round(moneyOut) });
  }
  return days;
}

function getMockBankTransactions() {
  const txns = [];
  const descs = [
    { desc: 'Stripe Payout', acct: 'Business Cheque', amt: 1245.60 },
    { desc: 'NZ Post Shipping', acct: 'Business Cheque', amt: -187.50 },
    { desc: 'Facebook Ads', acct: 'Business Cheque', amt: -320.00 },
    { desc: 'Countdown Wholesale Payment', acct: 'Business Cheque', amt: 2100.00 },
    { desc: 'Raw Material Supplier — BioGro Tallow', acct: 'Business Cheque', amt: -890.00 },
    { desc: 'Xero Subscription', acct: 'Business Cheque', amt: -75.00 },
    { desc: 'Transfer to Savings', acct: 'Business Cheque', amt: -500.00 },
    { desc: 'Transfer from Cheque', acct: 'Savings Account', amt: 500.00 },
    { desc: 'Stripe Payout', acct: 'Business Cheque', amt: 980.30 },
    { desc: 'Packaging Supplier — EcoPak', acct: 'Business Cheque', amt: -445.00 },
    { desc: 'Market Stall Income', acct: 'Business Cheque', amt: 620.00 },
    { desc: 'Insurance Premium', acct: 'Business Cheque', amt: -190.00 },
    { desc: 'Stripe Payout', acct: 'Business Cheque', amt: 1567.20 },
    { desc: 'Google Ads', acct: 'Business Cheque', amt: -210.00 },
    { desc: 'Label Printing — Avery', acct: 'Business Cheque', amt: -135.00 },
    { desc: 'Wholesale — Health 2000', acct: 'Business Cheque', amt: 1840.00 },
    { desc: 'Tax Transfer', acct: 'Tax Holding Account', amt: -1200.00 },
    { desc: 'Essential Oils Supplier', acct: 'Business Cheque', amt: -560.00 },
  ];
  const now = new Date();
  descs.forEach((t, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    txns.push({ date: d.toISOString().split('T')[0], description: t.desc, account: t.acct, amount: t.amt });
  });
  return txns;
}

function getMockInvoices() {
  const now = new Date();
  function dateDaysAgo(d) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    return dt.toISOString().split('T')[0];
  }
  return [
    { number: 'INV-0042', contact: 'Health 2000 NZ', dueDate: dateDaysAgo(-5), amount: 2400.00, status: 'current' },
    { number: 'INV-0041', contact: 'Commonsense Organics', dueDate: dateDaysAgo(-12), amount: 1850.00, status: 'current' },
    { number: 'INV-0039', contact: 'Huckleberry NZ', dueDate: dateDaysAgo(3), amount: 960.00, status: 'overdue' },
    { number: 'INV-0038', contact: 'Good For Store', dueDate: dateDaysAgo(8), amount: 1240.00, status: 'overdue' },
    { number: 'INV-0036', contact: 'Harvest Wholefoods', dueDate: dateDaysAgo(-20), amount: 780.00, status: 'current' },
    { number: 'INV-0035', contact: 'The Source Bulk Foods', dueDate: dateDaysAgo(15), amount: 520.00, status: 'overdue' },
    { number: 'INV-0034', contact: 'Bin Inn Wholefoods', dueDate: dateDaysAgo(-3), amount: 1650.00, status: 'current' },
    { number: 'INV-0033', contact: 'Moore Wilsons', dueDate: dateDaysAgo(22), amount: 490.00, status: 'overdue' },
  ];
}

function getMockBills() {
  const now = new Date();
  function dateDaysAgo(d) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    return dt.toISOString().split('T')[0];
  }
  return [
    { number: 'BILL-0187', contact: 'BioGro Tallow Supplies', dueDate: dateDaysAgo(-7), amount: 2800.00, status: 'current' },
    { number: 'BILL-0185', contact: 'EcoPak Packaging', dueDate: dateDaysAgo(5), amount: 1450.00, status: 'overdue' },
    { number: 'BILL-0183', contact: 'NZ Post Business', dueDate: dateDaysAgo(-14), amount: 680.00, status: 'current' },
    { number: 'BILL-0181', contact: 'Essential Oils NZ', dueDate: dateDaysAgo(2), amount: 920.00, status: 'overdue' },
    { number: 'BILL-0180', contact: 'Avery Labels NZ', dueDate: dateDaysAgo(-10), amount: 340.00, status: 'current' },
  ];
}

function getMockAgingData(items) {
  const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const now = new Date();
  items.forEach(inv => {
    const due = new Date(inv.dueDate);
    const daysOverdue = Math.floor((now - due) / (1000 * 60 * 60 * 24));
    if (daysOverdue <= 0) buckets.current += inv.amount;
    else if (daysOverdue <= 30) buckets['1-30'] += inv.amount;
    else if (daysOverdue <= 60) buckets['31-60'] += inv.amount;
    else if (daysOverdue <= 90) buckets['61-90'] += inv.amount;
    else buckets['90+'] += inv.amount;
  });
  return buckets;
}

// Chart rendering
const finChartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#9c9287', font: { family: 'DM Sans' } } } },
  scales: {
    y: { ticks: { color: '#9c9287' }, grid: { color: '#252220' } },
    x: { ticks: { color: '#9c9287' }, grid: { display: false } },
  }
};

async function renderFinanceStats() {
  let banks, invoices, bills, currentMonth;
  if (xeroConnected) {
    try {
      const [bankReport, invData, billData, pnlReport] = await Promise.all([
        xeroFetch('Reports/BankSummary'),
        xeroFetch('Invoices', { Statuses: 'AUTHORISED', where: 'Type=="ACCREC"' }),
        xeroFetch('Invoices', { Statuses: 'AUTHORISED', where: 'Type=="ACCPAY"' }),
        xeroFetch('Reports/ProfitAndLoss', { fromDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0], toDate: new Date().toISOString().split('T')[0] }),
      ]);
      banks = parseXeroBankSummary(bankReport) || [];
      invoices = parseXeroInvoices(invData, 'ACCREC') || [];
      bills = parseXeroInvoices(billData, 'ACCPAY') || [];
      // Parse current month P&L for stats
      const pnlDetail = parseXeroPnlDetail(pnlReport);
      if (pnlDetail) {
        const revTotal = pnlDetail.find(r => r.type === 'total' && r.label.toLowerCase().includes('revenue'));
        const netTotal = pnlDetail.find(r => r.type === 'total' && r.label.toLowerCase().includes('net') && r.label.toLowerCase().includes('profit'));
        const rev = revTotal ? Math.abs(revTotal.amount) : 0;
        const net = netTotal ? netTotal.amount : 0;
        currentMonth = { revenue: rev, expenses: rev - net };
      }
    } catch (e) { console.error('Xero stats fetch failed:', e.message); }
  }
  if (!currentMonth) currentMonth = { revenue: 0, expenses: 0 };
  if (!banks) banks = [];
  if (!invoices) invoices = [];
  if (!bills) bills = [];

  const cashPosition = banks.reduce((s, b) => s + b.balance, 0);
  const receivables = invoices.reduce((s, i) => s + i.amount, 0);
  const payables = bills.reduce((s, b) => s + b.amount, 0);
  const overdue = invoices.filter(i => i.status === 'overdue').length + bills.filter(b => b.status === 'overdue').length;
  const netProfit = currentMonth.revenue - currentMonth.expenses;

  const stats = [
    { label: 'Cash Position', value: fmt_money(cashPosition), sub: banks.length + ' accounts' },
    { label: 'Revenue (MTD)', value: fmt_money(currentMonth.revenue), sub: 'This month' },
    { label: 'Net Profit (MTD)', value: fmt_money(netProfit), sub: currentMonth.revenue > 0 ? ((netProfit / currentMonth.revenue) * 100).toFixed(1) + '% margin' : '—' },
    { label: 'Receivables', value: fmt_money(receivables), sub: invoices.length + ' invoices' },
    { label: 'Payables', value: fmt_money(payables), sub: bills.length + ' bills' },
    { label: 'Overdue', value: overdue, sub: overdue > 0 ? 'Needs attention' : 'All current' },
  ];

  document.getElementById('finance-stats').innerHTML = stats.map(s =>
    `<div class="fin-stat sensitive-stat${!statsVisible ? ' blurred' : ''}">
      <div class="fin-lbl">${s.label}</div>
      <div class="fin-val">${s.value}</div>
      <div class="fin-sub">${s.sub}</div>
    </div>`
  ).join('');
}

async function renderFinancePnl() {
  let data = null, detail = null;
  if (xeroConnected) {
    try {
      const now = new Date();
      const fromDate = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().split('T')[0];
      const toDate = now.toISOString().split('T')[0];
      const report = await xeroFetch('Reports/ProfitAndLoss', { fromDate, toDate, periods: '11', timeframe: 'MONTH' });
      data = parseXeroPnlMonthly(report);
      detail = parseXeroPnlDetail(report);
    } catch (e) { console.error('Xero P&L fetch failed:', e.message); }
  }
  if (!data) data = [];
  if (!detail) detail = [];

  // Revenue vs Expenses chart
  if (charts.xeroRevExp) charts.xeroRevExp.destroy();
  charts.xeroRevExp = new Chart(document.getElementById('xero-rev-exp-chart'), {
    type: 'bar',
    data: {
      labels: data.map(d => d.label),
      datasets: [
        { label: 'Revenue', data: data.map(d => d.revenue), backgroundColor: '#8CB47A', borderRadius: 4 },
        { label: 'Expenses', data: data.map(d => d.expenses), backgroundColor: '#e06050', borderRadius: 4 },
      ]
    },
    options: {
      ...finChartDefaults,
      scales: {
        ...finChartDefaults.scales,
        y: { ...finChartDefaults.scales.y, ticks: { ...finChartDefaults.scales.y.ticks, callback: v => '$' + (v / 1000).toFixed(0) + 'k' } },
        x: { ...finChartDefaults.scales.x, ticks: { ...finChartDefaults.scales.x.ticks, maxRotation: 45 } },
      }
    }
  });

  // Profit Margin chart
  if (charts.xeroMargin) charts.xeroMargin.destroy();
  const margins = data.map(d => ((d.revenue - d.expenses) / d.revenue * 100).toFixed(1));
  charts.xeroMargin = new Chart(document.getElementById('xero-margin-chart'), {
    type: 'line',
    data: {
      labels: data.map(d => d.label),
      datasets: [{
        label: 'Profit Margin %',
        data: margins,
        borderColor: '#8CB47A',
        backgroundColor: 'rgba(140,180,122,0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#8CB47A',
      }]
    },
    options: {
      ...finChartDefaults,
      scales: {
        ...finChartDefaults.scales,
        y: { ...finChartDefaults.scales.y, ticks: { ...finChartDefaults.scales.y.ticks, callback: v => v + '%' }, min: 0, max: 100 },
        x: { ...finChartDefaults.scales.x, ticks: { ...finChartDefaults.scales.x.ticks, maxRotation: 45 } },
      }
    }
  });

  // P&L detail table
  document.getElementById('pnl-detail-table').innerHTML = detail.map(row => {
    if (row.type === 'section') return `<tr class="fin-section-head"><td colspan="2">${row.label}</td></tr>`;
    if (row.type === 'total') return `<tr class="fin-total"><td>${row.label}</td><td style="text-align:right;color:${row.amount >= 0 ? 'var(--sage)' : 'var(--red)'}">${fmt_money(Math.abs(row.amount))}</td></tr>`;
    return `<tr class="fin-indent"><td>${row.label}</td><td style="text-align:right;color:${row.amount >= 0 ? 'var(--sage)' : 'var(--red)'}">${row.amount < 0 ? '-' : ''}${fmt_money(Math.abs(row.amount))}</td></tr>`;
  }).join('');
}

async function renderFinanceCashflow() {
  let banks = null, cfData = null, txns = null;
  if (xeroConnected) {
    try {
      const now = new Date();
      const fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 30);
      const [bankReport, txnData] = await Promise.all([
        xeroFetch('Reports/BankSummary'),
        xeroFetch('BankTransactions', { where: `Date >= DateTime(${fromDate.getFullYear()},${fromDate.getMonth()+1},${fromDate.getDate()})`, order: 'Date DESC' }),
      ]);
      banks = parseXeroBankSummary(bankReport);
      txns = parseXeroBankTransactions(txnData);
      // Aggregate daily cash flow from transactions
      if (txns && txns.length > 0) {
        const dayMap = {};
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const key = d.toISOString().split('T')[0];
          const label = d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
          dayMap[key] = { label, moneyIn: 0, moneyOut: 0 };
        }
        txns.forEach(t => {
          if (dayMap[t.date]) {
            if (t.amount >= 0) dayMap[t.date].moneyIn += t.amount;
            else dayMap[t.date].moneyOut += Math.abs(t.amount);
          }
        });
        cfData = Object.values(dayMap).map(d => ({ label: d.label, moneyIn: Math.round(d.moneyIn), moneyOut: Math.round(d.moneyOut) }));
      }
    } catch (e) { console.error('Xero cashflow fetch failed:', e.message); }
  }
  if (!banks) banks = [];
  // Bank balances chart
  if (charts.xeroBank) charts.xeroBank.destroy();
  charts.xeroBank = new Chart(document.getElementById('xero-bank-chart'), {
    type: 'bar',
    data: {
      labels: banks.map(b => b.name),
      datasets: [{
        label: 'Balance',
        data: banks.map(b => b.balance),
        backgroundColor: banks.map(b => b.balance >= 0 ? '#8CB47A' : '#e06050'),
        borderRadius: 6,
      }]
    },
    options: {
      ...finChartDefaults,
      indexAxis: 'y',
      plugins: { ...finChartDefaults.plugins, legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9c9287', callback: v => '$' + (v / 1000).toFixed(0) + 'k' }, grid: { color: '#252220' } },
        y: { ticks: { color: '#9c9287' }, grid: { display: false } },
      }
    }
  });

  // Cash flow chart
  if (!cfData) cfData = [];
  if (charts.xeroCashflow) charts.xeroCashflow.destroy();
  charts.xeroCashflow = new Chart(document.getElementById('xero-cashflow-chart'), {
    type: 'line',
    data: {
      labels: cfData.map(d => d.label),
      datasets: [
        { label: 'Money In', data: cfData.map(d => d.moneyIn), borderColor: '#8CB47A', backgroundColor: 'rgba(140,180,122,0.1)', fill: true, tension: 0.3, pointRadius: 0 },
        { label: 'Money Out', data: cfData.map(d => d.moneyOut), borderColor: '#D4A84B', backgroundColor: 'rgba(212,168,75,0.1)', fill: true, tension: 0.3, pointRadius: 0 },
      ]
    },
    options: {
      ...finChartDefaults,
      scales: {
        ...finChartDefaults.scales,
        y: { ...finChartDefaults.scales.y, ticks: { ...finChartDefaults.scales.y.ticks, callback: v => '$' + v } },
        x: { ...finChartDefaults.scales.x, ticks: { ...finChartDefaults.scales.x.ticks, maxTicksLimit: 10 } },
      }
    }
  });

  // Bank transactions table
  if (!txns) txns = [];
  document.getElementById('bank-txn-table').innerHTML = txns.map(t =>
    `<tr>
      <td>${t.date}</td>
      <td>${t.description}</td>
      <td>${t.account}</td>
      <td style="text-align:right;color:${t.amount >= 0 ? 'var(--sage)' : 'var(--red)'}">${t.amount < 0 ? '-' : ''}${fmt_money(Math.abs(t.amount))}</td>
    </tr>`
  ).join('');
}

function renderAgingChart(canvasId, chartKey, buckets, label) {
  if (charts[chartKey]) charts[chartKey].destroy();
  const labels = ['Current', '1-30 days', '31-60 days', '61-90 days', '90+ days'];
  const values = [buckets.current, buckets['1-30'], buckets['31-60'], buckets['61-90'], buckets['90+']];
  const colors = ['#8CB47A', '#D4A84B', '#DBBFA8', '#e06050', '#a03020'];
  charts[chartKey] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label, data: values, backgroundColor: colors, borderRadius: 6 }]
    },
    options: {
      ...finChartDefaults,
      indexAxis: 'y',
      plugins: { ...finChartDefaults.plugins, legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9c9287', callback: v => '$' + v }, grid: { color: '#252220' } },
        y: { ticks: { color: '#9c9287' }, grid: { display: false } },
      }
    }
  });
}

async function renderFinanceInvoices() {
  let invoices = null, bills = null;
  if (xeroConnected) {
    try {
      const [invData, billData] = await Promise.all([
        xeroFetch('Invoices', { Statuses: 'AUTHORISED', where: 'Type=="ACCREC"', order: 'DueDate' }),
        xeroFetch('Invoices', { Statuses: 'AUTHORISED', where: 'Type=="ACCPAY"', order: 'DueDate' }),
      ]);
      const parsedInv = parseXeroInvoices(invData, 'ACCREC');
      const parsedBills = parseXeroInvoices(billData, 'ACCPAY');
      if (parsedInv && parsedInv.length > 0) invoices = parsedInv;
      if (parsedBills && parsedBills.length > 0) bills = parsedBills;
    } catch (e) { console.error('Xero invoices fetch failed:', e.message); }
  }
  if (!invoices) invoices = [];
  if (!bills) bills = [];

  // AR aging chart
  renderAgingChart('xero-ar-chart', 'xeroAR', getMockAgingData(invoices), 'Receivables');

  // AP aging chart
  renderAgingChart('xero-ap-chart', 'xeroAP', getMockAgingData(bills), 'Payables');

  // Invoices table
  document.getElementById('invoices-table').innerHTML = invoices.map(inv =>
    `<tr>
      <td>${inv.number}</td>
      <td>${inv.contact}</td>
      <td>${inv.dueDate}</td>
      <td style="text-align:right">${fmt_money(inv.amount)}</td>
      <td><span class="status-badge" style="background:${inv.status === 'overdue' ? 'rgba(224,96,80,0.15)' : 'rgba(140,180,122,0.15)'};color:${inv.status === 'overdue' ? 'var(--red)' : 'var(--sage)'}">${inv.status === 'overdue' ? 'Overdue' : 'Current'}</span></td>
    </tr>`
  ).join('');

  // Bills table
  document.getElementById('bills-table').innerHTML = bills.map(bill =>
    `<tr>
      <td>${bill.number}</td>
      <td>${bill.contact}</td>
      <td>${bill.dueDate}</td>
      <td style="text-align:right">${fmt_money(bill.amount)}</td>
      <td><span class="status-badge" style="background:${bill.status === 'overdue' ? 'rgba(224,96,80,0.15)' : 'rgba(140,180,122,0.15)'};color:${bill.status === 'overdue' ? 'var(--red)' : 'var(--sage)'}">${bill.status === 'overdue' ? 'Overdue' : 'Current'}</span></td>
    </tr>`
  ).join('');
}

async function loadFinanceTab() {
  // Check Xero connection status
  try {
    const token = finToken();
    if (token) {
      const res = await fetch(`/.netlify/functions/xero-status?token=${token}`);
      const status = await res.json();
      xeroConnected = status.connected || false;
      if (status.orgName) {
        document.getElementById('xero-org-label').textContent = 'Connected to ' + status.orgName;
      }
    }
  } catch { xeroConnected = false; }

  // Show/hide connect banner and status bar
  document.getElementById('xero-connect-banner').style.display = xeroConnected ? 'none' : '';
  document.getElementById('xero-status-bar').style.display = xeroConnected ? 'flex' : 'none';

  await Promise.all([renderFinanceStats(), loadExpenses()]);
  const activePanel = document.querySelector('#fin-sub-tabs .wa-panel-tab.active');
  const panel = activePanel ? activePanel.dataset.finPanel : 'pnl';
  if (panel === 'pnl') await renderFinancePnl();
  else if (panel === 'cashflow') await renderFinanceCashflow();
  else if (panel === 'invoices') await renderFinanceInvoices();
  applyStatsVisibility();
}

// Finance sub-tab switching
document.querySelectorAll('#fin-sub-tabs .wa-panel-tab').forEach(tab => {
  tab.addEventListener('click', async function() {
    document.querySelectorAll('#fin-sub-tabs .wa-panel-tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    const panel = this.dataset.finPanel;
    document.getElementById('fin-panel-pnl').style.display = panel === 'pnl' ? '' : 'none';
    document.getElementById('fin-panel-cashflow').style.display = panel === 'cashflow' ? '' : 'none';
    document.getElementById('fin-panel-invoices').style.display = panel === 'invoices' ? '' : 'none';
    if (panel === 'pnl') await renderFinancePnl();
    if (panel === 'cashflow') await renderFinanceCashflow();
    if (panel === 'invoices') await renderFinanceInvoices();
    applyStatsVisibility();
  });
});

// ── Operational Expenses ──
let expensesData = [];
let currentMonthlyExpenses = 0;

function expenseMonthlyEquiv(amount, freq) {
  switch (freq) {
    case 'weekly': return amount * 52 / 12;
    case 'fortnightly': return amount * 26 / 12;
    case 'monthly': return amount;
    case 'quarterly': return amount / 3;
    case 'yearly': return amount / 12;
    case 'one-off': return 0;
    default: return amount;
  }
}

function expenseDailyEquiv(amount, freq) {
  switch (freq) {
    case 'weekly': return amount / 7;
    case 'fortnightly': return amount / 14;
    case 'monthly': return amount / 30;
    case 'quarterly': return amount / 90;
    case 'yearly': return amount / 365;
    case 'one-off': return 0;
    default: return amount / 30;
  }
}

async function loadExpenses() {
  try {
    const res = await db.from('expenses').select('*').order('category', { ascending: true });
    expensesData = Array.isArray(res) ? res : (res?.data || []);
  } catch { expensesData = []; }
  currentMonthlyExpenses = expensesData.reduce((s, e) => s + expenseMonthlyEquiv(Number(e.amount), e.frequency), 0);
  renderExpensesTable();
}

function renderExpensesTable() {
  const tbody = document.getElementById('expenses-table');
  const totalEl = document.getElementById('expenses-total');
  if (expensesData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No expenses added yet</td></tr>';
    totalEl.textContent = '';
    return;
  }
  totalEl.textContent = '$' + currentMonthlyExpenses.toFixed(2) + '/mo';
  tbody.innerHTML = expensesData.map(e => {
    const monthly = expenseMonthlyEquiv(Number(e.amount), e.frequency);
    return `<tr>
      <td>${esc(e.name)}</td>
      <td><span class="source-pill" style="background:rgba(156,146,135,0.15);color:var(--muted);">${esc(e.category)}</span></td>
      <td style="text-align:right;">$${Number(e.amount).toFixed(2)}</td>
      <td>${e.frequency}</td>
      <td style="text-align:right;color:var(--honey);">$${monthly.toFixed(2)}</td>
      <td><button onclick="deleteExpense(${e.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:0.75rem;">Delete</button></td>
    </tr>`;
  }).join('');
}

document.getElementById('expense-add-btn').addEventListener('click', () => {
  document.getElementById('expense-add-form').style.display = '';
  document.getElementById('expense-name').value = '';
  document.getElementById('expense-amount').value = '';
});

document.getElementById('expense-cancel-btn').addEventListener('click', () => {
  document.getElementById('expense-add-form').style.display = 'none';
});

document.getElementById('expense-save-btn').addEventListener('click', async () => {
  const name = document.getElementById('expense-name').value.trim();
  const category = document.getElementById('expense-category').value;
  const amount = parseFloat(document.getElementById('expense-amount').value);
  const frequency = document.getElementById('expense-frequency').value;
  if (!name || isNaN(amount) || amount <= 0) return;
  try {
    await db.from('expenses').insert({ name, category, amount, frequency });
    document.getElementById('expense-add-form').style.display = 'none';
    await loadExpenses();
  } catch (e) { console.error('Save expense error:', e); }
});

window.deleteExpense = async function(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    await db.from('expenses').delete().eq('id', id);
    await loadExpenses();
  } catch (e) { console.error('Delete expense error:', e); }
};

// ── Action Center Tab ──
let actionsInited = false;
let actionsLastLoaded = 0;
let actionAlerts = [];
let actionRules = [];
let actionConfig = [];
let actionAlertsPage = 1;

async function loadActionsTab() {
  // Cache for 2 minutes
  if (actionsInited && actionsLastLoaded && Date.now() - actionsLastLoaded < 120000) return;
  if (!actionsInited) {
    actionsInited = true;
    document.querySelectorAll('[data-action-panel]').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('[data-action-panel]').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const p = this.dataset.actionPanel;
        ['alerts','rules','config'].forEach(k => { document.getElementById('action-panel-'+k).style.display = k===p?'':'none'; });
      });
    });
    ['action-filter-priority','action-filter-category','action-filter-status'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => { actionAlertsPage=1; renderActionAlerts(); });
    });
    document.getElementById('action-refresh-summary').addEventListener('click', refreshActionSummary);
    document.getElementById('action-save-config').addEventListener('click', saveActionConfig);
  }

  document.getElementById('action-alerts-list').innerHTML = '<div class="loading">Loading alerts...</div>';

  const [alertsRes, rulesRes, configRes, summaryRes] = await Promise.all([
    db.from('action_alerts').select('*').order('created_at', { ascending: false }).limit(200).then(r=>r).catch(()=>({data:[]})),
    db.from('action_rules').select('*').order('category').then(r=>r).catch(()=>({data:[]})),
    db.from('action_rule_config').select('*').order('category').then(r=>r).catch(()=>({data:[]})),
    db.from('action_daily_summary').select('*').order('summary_date', { ascending: false }).limit(1).then(r=>r).catch(()=>({data:[]})),
  ]);

  actionAlerts = alertsRes.data || [];
  actionRules = rulesRes.data || [];
  actionConfig = configRes.data || [];

  renderActionStats();
  renderActionAlerts();
  renderActionRules();
  renderActionConfig();
  renderActionSummary(summaryRes.data?.[0]);
  renderProductIntelligence();
  actionsLastLoaded = Date.now();
}

function renderActionStats() {
  const active = actionAlerts.filter(a => a.status === 'new' || a.status === 'acknowledged');
  const p1 = active.filter(a => a.priority === 'P1').length;
  const p2 = active.filter(a => a.priority === 'P2').length;
  const p3 = active.filter(a => a.priority === 'P3').length;
  const today = new Date().toISOString().split('T')[0];
  const todayCount = actionAlerts.filter(a => (a.created_at||'').startsWith(today)).length;

  document.getElementById('action-stats-grid').innerHTML =
    '<div class="stat-card" style="border-left:3px solid var(--red);"><div class="label">P1 Urgent</div><div class="value" style="color:var(--red);">'+p1+'</div><div class="sub">immediate action</div></div>'
    +'<div class="stat-card" style="border-left:3px solid var(--honey);"><div class="label">P2 Action</div><div class="value" style="color:var(--honey);">'+p2+'</div><div class="sub">this week</div></div>'
    +'<div class="stat-card" style="border-left:3px solid var(--dim);"><div class="label">P3 Monitor</div><div class="value">'+p3+'</div><div class="sub">watch</div></div>'
    +'<div class="stat-card"><div class="label">New Today</div><div class="value">'+todayCount+'</div><div class="sub">triggered</div></div>';
}

function renderActionAlerts() {
  const pf = document.getElementById('action-filter-priority').value;
  const cf = document.getElementById('action-filter-category').value;
  const sf = document.getElementById('action-filter-status').value;

  let filtered = actionAlerts.filter(a => {
    if (pf && a.priority !== pf) return false;
    if (cf && a.category !== cf) return false;
    if (sf && a.status !== sf) return false;
    return true;
  });

  const start = (actionAlertsPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);
  const catLabels = { adops: 'Ad Ops', inventory: 'Inventory', customer: 'Customer', website: 'Website' };
  const priColors = { P1: 'var(--red)', P2: 'var(--honey)', P3: 'var(--dim)' };

  if (!page.length) {
    document.getElementById('action-alerts-list').innerHTML = '<div style="text-align:center;padding:2rem;color:var(--dim);">No alerts matching filters</div>';
    document.getElementById('action-alerts-pagination').innerHTML = '';
    return;
  }

  document.getElementById('action-alerts-list').innerHTML = page.map(a => {
    const time = new Date(a.created_at).toLocaleDateString('en-NZ', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const isActive = a.status === 'new' || a.status === 'acknowledged';
    const pc = priColors[a.priority] || 'var(--dim)';
    return '<div style="background:var(--card);border:1px solid var(--border);border-left:3px solid '+pc+';border-radius:10px;padding:1rem;margin-bottom:0.75rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.4rem;">'
      +'<span style="font-weight:600;font-size:0.9rem;">'+esc(a.title)+'</span>'
      +'<span style="font-size:0.65rem;font-weight:700;padding:0.1rem 0.4rem;border-radius:4px;background:'+pc+'22;color:'+pc+';">'+a.priority+'</span>'
      +'</div>'
      +(a.detail ? '<div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;line-height:1.5;">'+esc(a.detail)+'</div>' : '')
      +'<div style="font-size:0.7rem;color:var(--dim);display:flex;gap:1rem;align-items:center;">'
      +'<span>'+(catLabels[a.category]||a.category)+'</span><span>'+time+'</span><span style="text-transform:capitalize;">'+a.status+'</span>'
      +(isActive ? '<div style="display:flex;gap:0.4rem;margin-left:auto;">'
        +(a.status==='new' ? '<button onclick="updateActionAlert('+a.id+',\'acknowledged\')" style="background:none;border:1px solid var(--border);color:var(--muted);padding:0.2rem 0.5rem;border-radius:6px;font-size:0.7rem;cursor:pointer;">Ack</button>' : '')
        +'<button onclick="updateActionAlert('+a.id+',\'resolved\')" style="background:none;border:1px solid var(--sage);color:var(--sage);padding:0.2rem 0.5rem;border-radius:6px;font-size:0.7rem;cursor:pointer;">Resolve</button>'
        +'<button onclick="updateActionAlert('+a.id+',\'dismissed\')" style="background:none;border:1px solid var(--dim);color:var(--dim);padding:0.2rem 0.5rem;border-radius:6px;font-size:0.7rem;cursor:pointer;">Dismiss</button>'
        +'</div>' : '')
      +'</div></div>';
  }).join('');

  renderPagination('action-alerts-pagination', actionAlertsPage, filtered.length, p => { actionAlertsPage=p; renderActionAlerts(); });
}

async function updateActionAlert(id, status) {
  await db.from('action_alerts').update({ status, resolved_by: currentStaff?.display_name||'unknown', resolved_at: new Date().toISOString() }).eq('id', id);
  const a = actionAlerts.find(x => x.id === id);
  if (a) { a.status = status; a.resolved_by = currentStaff?.display_name; }
  renderActionAlerts();
  renderActionStats();
  checkActionAlerts();
}

function renderActionRules() {
  const alertsByRule = {};
  actionAlerts.filter(a => a.status==='new').forEach(a => { alertsByRule[a.rule_key] = (alertsByRule[a.rule_key]||0)+1; });

  if (!actionRules.length) {
    document.getElementById('action-rules-grid').innerHTML = '<div style="color:var(--dim);text-align:center;padding:1rem;">No rules configured. Run the SQL schema to seed rules.</div>';
    return;
  }

  document.getElementById('action-rules-grid').innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">'
    + actionRules.map(r => {
      const cnt = alertsByRule[r.rule_key]||0;
      const dotColor = !r.enabled ? 'var(--dim)' : cnt > 0 ? 'var(--red)' : 'var(--sage)';
      const label = !r.enabled ? 'Disabled' : cnt > 0 ? cnt+' alert(s)' : 'OK';
      return '<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:0.75rem;display:flex;justify-content:space-between;align-items:center;">'
        +'<div><div style="font-size:0.85rem;font-weight:600;">'+esc(r.name)+'</div><div style="font-size:0.7rem;color:var(--dim);">'+esc(r.category)+' &middot; '+r.priority+'</div></div>'
        +'<div style="display:flex;align-items:center;gap:0.5rem;"><span style="font-size:0.7rem;color:var(--dim);">'+label+'</span><span style="width:10px;height:10px;border-radius:50%;background:'+dotColor+';display:inline-block;"></span></div>'
        +'</div>';
    }).join('') + '</div>';
}

function renderActionConfig() {
  if (!actionConfig.length) {
    document.getElementById('action-config-grid').innerHTML = '<div style="color:var(--dim);">No config loaded. Run the SQL schema to seed thresholds.</div>';
    return;
  }
  const byCategory = {};
  actionConfig.forEach(c => { if (!byCategory[c.category]) byCategory[c.category]=[]; byCategory[c.category].push(c); });
  const catLabels = { adops:'Ad Ops', inventory:'Inventory' };
  let html = '';
  for (const [cat, items] of Object.entries(byCategory)) {
    html += '<div style="font-size:0.7rem;color:var(--honey);text-transform:uppercase;font-weight:600;letter-spacing:0.04em;margin:1rem 0 0.5rem;padding-bottom:0.3rem;border-bottom:1px solid var(--border);">'+esc(catLabels[cat]||cat)+'</div>';
    items.forEach(c => {
      html += '<div style="display:grid;grid-template-columns:1fr 120px 60px;gap:0.75rem;align-items:center;padding:0.5rem 0;border-bottom:1px solid rgba(232,226,218,0.1);">'
        +'<label style="font-size:0.85rem;">'+esc(c.label)+'</label>'
        +'<input type="number" step="any" data-config-key="'+c.config_key+'" value="'+c.value+'" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.4rem 0.5rem;border-radius:6px;font-size:0.85rem;font-family:\'DM Sans\',sans-serif;text-align:right;">'
        +'<span style="font-size:0.75rem;color:var(--dim);">'+esc(c.unit||'')+'</span></div>';
    });
  }
  document.getElementById('action-config-grid').innerHTML = html;
}

async function saveActionConfig() {
  const inputs = document.querySelectorAll('#action-config-grid input[data-config-key]');
  const updates = [];
  inputs.forEach(input => {
    const key = input.dataset.configKey;
    const val = parseFloat(input.value);
    if (!isNaN(val)) {
      const existing = actionConfig.find(c => c.config_key === key);
      if (existing && existing.value !== val) updates.push({ config_key: key, value: val });
    }
  });
  if (!updates.length) { document.getElementById('action-config-result').textContent='No changes.'; return; }
  for (const u of updates) {
    await db.from('action_rule_config').update({ value: u.value, updated_at: new Date().toISOString() }).eq('config_key', u.config_key);
    const c = actionConfig.find(c => c.config_key === u.config_key);
    if (c) c.value = u.value;
  }
  const r = document.getElementById('action-config-result');
  r.textContent = 'Updated '+updates.length+' threshold(s).';
  r.style.color = 'var(--sage)';
  setTimeout(() => { r.textContent=''; }, 3000);
}

function renderActionSummary(summary) {
  const body = document.getElementById('action-summary-body');
  const time = document.getElementById('action-summary-time');
  if (!summary) {
    body.innerHTML = '<div style="color:var(--dim);font-style:italic;">No briefing generated yet. Click Refresh to generate one.</div>';
    time.textContent = '';
    return;
  }
  body.innerHTML = summary.summary_text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  time.textContent = 'Generated ' + new Date(summary.generated_at).toLocaleDateString('en-NZ', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

async function refreshActionSummary() {
  const btn = document.getElementById('action-refresh-summary');
  btn.disabled = true; btn.textContent = 'Generating...';
  document.getElementById('action-summary-body').innerHTML = '<div class="loading">Generating AI briefing...</div>';
  try {
    const res = await fetch('/.netlify/functions/action-engine?token='+encodeURIComponent(currentStaff.token)+'&refresh=1&summary=1');
    const data = await res.json();
    if (data.summary) renderActionSummary({ summary_text: data.summary, generated_at: new Date().toISOString() });
    else document.getElementById('action-summary-body').innerHTML = '<div style="color:var(--dim);">Summary generated. '+data.alerts_created+' alerts created.</div>';
    // Reload alerts
    const ar = await db.from('action_alerts').select('*').order('created_at', { ascending: false }).limit(200);
    actionAlerts = ar.data || [];
    renderActionStats(); renderActionAlerts();
  } catch (e) {
    document.getElementById('action-summary-body').innerHTML = '<div style="color:var(--red);">Failed: '+e.message+'</div>';
  }
  btn.disabled = false; btn.textContent = 'Refresh';
}

function renderProductIntelligence() {
  if (!allOrders.length || !allLineItems.length) {
    document.getElementById('action-product-intel').innerHTML = '<div class="loading" style="grid-column:1/-1;">No order data loaded</div>';
    return;
  }
  const [from, to] = getDateRange();
  const orders = allOrders.filter(o => o.order_date >= from && o.order_date <= to);
  const liMap = {};
  allLineItems.forEach(li => { if (!liMap[li.order_id]) liMap[li.order_id]=[]; liMap[li.order_id].push(li); });

  // Group by email for repeat analysis
  const emailOrders = {};
  orders.forEach(o => { if (o.email) { if (!emailOrders[o.email]) emailOrders[o.email]=[]; emailOrders[o.email].push(o); } });

  // Product metrics
  const productData = {};
  orders.forEach(o => {
    const items = liMap[o.id] || [];
    const isFirst = emailOrders[o.email] && emailOrders[o.email].sort((a,b)=>a.order_date.localeCompare(b.order_date))[0]?.id === o.id;
    items.forEach(li => {
      const name = li.description || li.sku || 'Unknown';
      if (!productData[name]) productData[name] = { revenue: 0, units: 0, orders: 0, firstPurchase: 0, upsell: 0 };
      productData[name].revenue += (li.unit_price||0) * (li.quantity||1);
      productData[name].units += li.quantity||1;
      productData[name].orders++;
      if (isFirst && items.indexOf(li) === 0) productData[name].firstPurchase++;
      if (!isFirst || items.indexOf(li) > 0) productData[name].upsell++;
    });
  });

  const products = Object.entries(productData);
  const winners = products.sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,5);
  const magnets = products.sort((a,b)=>b[1].firstPurchase-a[1].firstPurchase).slice(0,5);
  const upsells = products.sort((a,b)=>b[1].upsell-a[1].upsell).slice(0,5);

  function renderCol(title, items, metric, label) {
    let h = '<div><h4 style="font-size:0.8rem;color:var(--sage);margin:0 0 0.5rem;">'+title+'</h4>';
    items.forEach(([name, d]) => {
      h += '<div style="padding:0.4rem 0;border-bottom:1px solid rgba(232,226,218,0.1);font-size:0.8rem;">'
        +'<div style="font-weight:600;">'+esc(name)+'</div>'
        +'<div style="color:var(--dim);font-size:0.7rem;">'+d[metric]+' '+label+' &middot; $'+d.revenue.toFixed(0)+' rev</div></div>';
    });
    return h+'</div>';
  }

  document.getElementById('action-product-intel').innerHTML =
    renderCol('Winners (Revenue)', winners, 'units', 'units')
    + renderCol('Best Magnets (Acquisition)', magnets, 'firstPurchase', 'first purchases')
    + renderCol('Best Upsells (Cross-sell)', upsells, 'upsell', 'upsell orders');
}

// Login banner for P1 alerts
async function checkActionAlerts() {
  try {
    const res = await db.from('action_alerts').select('id,priority,title').eq('status', 'new');
    const alerts = res.data || [];
    const p1 = alerts.filter(a => a.priority === 'P1').length;
    const badge = document.getElementById('action-nav-badge');
    if (p1 > 0) { badge.textContent = p1; badge.style.display = ''; } else { badge.style.display = 'none'; }

    if (p1 > 0 && !sessionStorage.getItem('pp_action_banner_dismissed')) {
      if (!document.getElementById('action-login-banner')) {
        const banner = document.createElement('div');
        banner.id = 'action-login-banner';
        banner.style.cssText = 'background:rgba(224,96,80,0.1);border:1px solid rgba(224,96,80,0.3);border-radius:10px;padding:0.75rem 1rem;margin-bottom:1rem;display:flex;align-items:center;gap:0.75rem;cursor:pointer;';
        banner.innerHTML = '<span style="font-size:1.2rem;">&#9888;</span><span style="font-size:0.85rem;flex:1;"><strong style="color:var(--red);">'+p1+' urgent alert'+(p1>1?'s':'')+' </strong>need'+(p1===1?'s':'')+' your attention</span><button onclick="event.stopPropagation();this.parentElement.remove();sessionStorage.setItem(\'pp_action_banner_dismissed\',\'1\');" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:1rem;">&times;</button>';
        banner.addEventListener('click', function() {
          document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
          const btn = document.querySelector('[data-tab="actions"]');
          if (btn) btn.classList.add('active');
          document.getElementById('tab-actions').classList.add('active');
          activeTab = 'actions';
          loadActionsTab();
          this.remove();
          sessionStorage.setItem('pp_action_banner_dismissed','1');
        });
        const dashboard = document.getElementById('dashboard');
        const first = dashboard.querySelector('.stats, .filter-bar, .orders-card');
        if (first) dashboard.insertBefore(banner, first);
      }
    }
  } catch (e) { /* silent */ }
}
