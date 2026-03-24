// ── Claude Chat Widget ──
(function() {
  const fab = document.getElementById('claude-fab');
  const panel = document.getElementById('claude-panel');
  const messagesEl = document.getElementById('claude-messages');
  const input = document.getElementById('claude-input');
  const sendBtn = document.getElementById('claude-send-btn');
  const clearBtn = document.getElementById('claude-clear-btn');

  let chatMessages = []; // API message history
  let isSending = false;
  let hasGreeted = false;

  // Toggle panel
  fab.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    fab.classList.toggle('open', isOpen);
    if (isOpen) {
      input.focus();
      if (!hasGreeted && messagesEl.children.length === 0) {
        hasGreeted = true;
        addMessage('assistant', '<strong style="color:#c4b5fd;">Whats up Cuh?</strong> 🔮<br><br>Ask me anything about your business — sales, marketing, inventory, costs, whatever you need.');
      }
    }
  });

  // Clear chat
  clearBtn.addEventListener('click', () => {
    chatMessages = [];
    messagesEl.innerHTML = '<div class="claude-msg assistant"><div class="claude-bubble">Chat cleared. Ask me anything about your dashboard data.</div></div>';
  });

  // Send on Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isSending) sendMessage();
  });
  sendBtn.addEventListener('click', () => { if (!isSending) sendMessage(); });

  // ── Context Gathering ──
  function gatherDashboardContext() {
    const lines = [];

    // Active tab
    const activeTabBtn = document.querySelector('.nav-item.active');
    if (activeTabBtn) lines.push(`Active tab: ${activeTabBtn.textContent.trim()}`);

    // Date range
    const rangeEl = document.getElementById('date-range');
    if (rangeEl) {
      const opt = rangeEl.options[rangeEl.selectedIndex];
      lines.push(`Date range: ${opt ? opt.textContent : rangeEl.value}`);
    }

    // Filters
    const filterIds = [
      { id: 'filter-utm', label: 'Source' },
      { id: 'filter-utm-medium', label: 'Medium' },
      { id: 'filter-utm-campaign', label: 'Campaign' },
      { id: 'filter-city', label: 'City' },
    ];
    filterIds.forEach(f => {
      const el = document.getElementById(f.id);
      if (el && el.value) lines.push(`Filter ${f.label}: ${el.value}`);
    });

    // All visible stat cards (overview, orders, shipping, marketing, customers, finance)
    const statCards = document.querySelectorAll('.stat-card, .fin-stat, .wa-stat');
    if (statCards.length) {
      lines.push('\nDashboard stats:');
      statCards.forEach(card => {
        const label = card.querySelector('.label, .fin-lbl, .wa-lbl');
        const value = card.querySelector('.value, .fin-val, .wa-val');
        const sub = card.querySelector('.sub, .fin-sub');
        if (label && value) {
          let text = `- ${label.textContent.trim()}: ${value.textContent.trim()}`;
          if (sub) text += ` (${sub.textContent.trim()})`;
          lines.push(text);
        }
      });
    }

    // Ad spend
    const adSpend = document.getElementById('adspend-value');
    if (adSpend && adSpend.textContent.trim() !== '—') {
      lines.push(`\nAd Spend Today: ${adSpend.textContent.trim()}`);
    }

    // ── Chart data from Chart.js instances ──
    try {
      if (typeof charts !== 'undefined') {
        for (const [name, chart] of Object.entries(charts)) {
          if (!chart || !chart.data) continue;
          const labels = chart.data.labels || [];
          const datasets = chart.data.datasets || [];
          if (labels.length === 0 && datasets.length === 0) continue;
          lines.push(`\nChart "${name}":`);
          datasets.forEach(ds => {
            const dataStr = (ds.data || []).slice(0, 30).map((v, i) => `${labels[i] || i}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
            lines.push(`  ${ds.label || 'data'}: ${dataStr}`);
          });
        }
      }
    } catch {}

    // ── Order breakdown data ──
    try {
      if (typeof filteredOrders !== 'undefined' && filteredOrders.length > 0) {
        const orders = filteredOrders;
        const totalRev = orders.reduce((s, o) => s + Number(o.total_value || 0), 0);
        const avgAOV = totalRev / orders.length;

        // Revenue by source
        const bySrc = {};
        orders.forEach(o => {
          const src = o.utm_source || 'Direct';
          bySrc[src] = (bySrc[src] || 0) + Number(o.total_value || 0);
        });
        lines.push(`\nRevenue by source: ${Object.entries(bySrc).sort((a,b) => b[1]-a[1]).slice(0,10).map(([k,v]) => `${k}: $${v.toFixed(2)}`).join(', ')}`);

        // Revenue by city
        const byCity = {};
        orders.forEach(o => {
          const city = o.city || 'Unknown';
          byCity[city] = (byCity[city] || 0) + Number(o.total_value || 0);
        });
        lines.push(`Revenue by city: ${Object.entries(byCity).sort((a,b) => b[1]-a[1]).slice(0,10).map(([k,v]) => `${k}: $${v.toFixed(2)}`).join(', ')}`);

        // Orders by hour (today)
        const byHour = Array(24).fill(0);
        const today = new Date().toISOString().slice(0, 10);
        orders.forEach(o => {
          if (o.created_at && o.order_date === today) {
            byHour[new Date(o.created_at).getHours()]++;
          }
        });
        const hourStr = byHour.map((c, h) => c > 0 ? `${h}:00=${c}` : '').filter(Boolean).join(', ');
        if (hourStr) lines.push(`Orders by hour today: ${hourStr}`);

        // Product breakdown
        if (typeof allLineItems !== 'undefined') {
          const orderIds = new Set(orders.map(o => o.id));
          const items = allLineItems.filter(li => orderIds.has(li.order_id));
          const byProduct = {};
          items.forEach(li => {
            const name = li.description || li.sku || 'Unknown';
            byProduct[name] = (byProduct[name] || 0) + (li.quantity || 1);
          });
          lines.push(`Top products: ${Object.entries(byProduct).sort((a,b) => b[1]-a[1]).slice(0,10).map(([k,v]) => `${k}: ${v} sold`).join(', ')}`);
        }

        // New vs returning
        const emailCounts = {};
        if (typeof allOrders !== 'undefined') {
          allOrders.forEach(o => { emailCounts[o.email] = (emailCounts[o.email] || 0) + 1; });
        }
        const newCust = orders.filter(o => emailCounts[o.email] === 1).length;
        const retCust = orders.length - newCust;
        lines.push(`New customers: ${newCust}, Returning: ${retCust}`);
      }
    } catch {}

    // ── Shipping stats ──
    try {
      if (typeof allShipments !== 'undefined' && allShipments.length > 0) {
        const statusCounts = {};
        allShipments.forEach(s => { statusCounts[s._shipping_status] = (statusCounts[s._shipping_status] || 0) + 1; });
        lines.push(`\nShipping: ${Object.entries(statusCounts).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
      }
    } catch {}

    // ── Marketing campaigns ──
    try {
      if (typeof mktAllCampaigns !== 'undefined' && mktAllCampaigns.length > 0) {
        lines.push(`\nMarketing campaigns: ${mktAllCampaigns.length} total`);
        mktAllCampaigns.slice(0, 10).forEach(c => {
          lines.push(`  ${c.name}: spend $${(c.spend || 0).toFixed(2)}, clicks ${c.clicks || 0}, conv ${c.conversions || 0}, ROAS ${c.roas || '-'}`);
        });
      }
    } catch {}

    // ── All visible tables (scrape any table on the active tab) ──
    try {
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab) {
        activeTab.querySelectorAll('table').forEach((table, idx) => {
          const caption = table.querySelector('h3, caption');
          const thead = table.querySelector('thead');
          const tbody = table.querySelector('tbody');
          if (!tbody || !tbody.querySelectorAll('tr').length) return;
          const headers = thead ? Array.from(thead.querySelectorAll('th')).map(th => th.textContent.trim()) : [];
          const rows = Array.from(tbody.querySelectorAll('tr')).slice(0, 15);
          if (rows.length === 0) return;
          const title = caption ? caption.textContent.trim() : `Table ${idx + 1}`;
          lines.push(`\n${title}:`);
          if (headers.length) lines.push(`  ${headers.join(' | ')}`);
          rows.forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
            if (cells.length) lines.push(`  ${cells.join(' | ')}`);
          });
        });
      }
    } catch {}

    return lines.join('\n');
  }

  // ── Read table data for get_table_data tool ──
  function readTableData(tableName) {
    const tableMap = {
      orders: '#orders-table',
      trending_products: '#trending-body',
      utm_campaigns: '#utm-body',
      bought_together: '#together-body',
      landing_revenue: '#landing-rev-container tbody',
      magnet_products: '#magnet-body',
      shipping: '#shipping-table-body',
      customers: '.customer-profile',
      website_pages: '#wa-pages-body',
      website_referrers: '#wa-referrers-body',
      website_browsers: '#wa-browsers-body',
      website_countries: '#wa-countries-body',
    };
    const selector = tableMap[tableName];
    if (!selector) return 'Table not found.';

    if (tableName === 'customers') {
      const profiles = document.querySelectorAll(selector);
      if (!profiles.length) return 'No customer data loaded.';
      const rows = [];
      profiles.forEach((p, i) => {
        if (i >= 20) return;
        const name = p.querySelector('.customer-name')?.textContent?.trim() || '';
        const email = p.querySelector('.customer-email')?.textContent?.trim() || '';
        const meta = p.querySelector('.customer-meta')?.textContent?.trim() || '';
        rows.push(`${name} | ${email} | ${meta}`);
      });
      return rows.join('\n') || 'No data.';
    }

    const tbody = document.querySelector(selector);
    if (!tbody) return 'Table not loaded yet.';
    const trs = tbody.querySelectorAll('tr');
    if (!trs.length) return 'No rows in table.';
    const rows = [];
    // Get headers from the parent table's thead
    const table = tbody.closest('table');
    if (table) {
      const ths = table.querySelectorAll('thead th');
      if (ths.length) rows.push(Array.from(ths).map(th => th.textContent.trim()).join(' | '));
    }
    trs.forEach((tr, i) => {
      if (i >= 30) return;
      const cells = tr.querySelectorAll('td');
      rows.push(Array.from(cells).map(td => td.textContent.trim()).join(' | '));
    });
    return rows.join('\n') || 'No data.';
  }

  // ── Action Executor ──
  function executeDashboardAction(toolName, toolInput) {
    switch (toolName) {
      case 'switch_tab': {
        const btn = document.querySelector(`.nav-item[data-tab="${toolInput.tab}"]`);
        if (btn) { btn.click(); return `Switched to ${btn.textContent.trim()} tab.`; }
        return `Tab "${toolInput.tab}" not found.`;
      }
      case 'set_date_range': {
        const rangeEl = document.getElementById('date-range');
        if (!rangeEl) return 'Date range control not found.';
        rangeEl.value = toolInput.range;
        rangeEl.dispatchEvent(new Event('change', { bubbles: true }));
        if (toolInput.range === 'custom' && toolInput.from && toolInput.to) {
          const fromEl = document.getElementById('date-from');
          const toEl = document.getElementById('date-to');
          if (fromEl) { fromEl.value = toolInput.from; fromEl.dispatchEvent(new Event('change', { bubbles: true })); }
          if (toEl) { toEl.value = toolInput.to; toEl.dispatchEvent(new Event('change', { bubbles: true })); }
          return `Set date range to ${toolInput.from} – ${toolInput.to}.`;
        }
        const opt = rangeEl.options[rangeEl.selectedIndex];
        return `Set date range to ${opt ? opt.textContent : toolInput.range}.`;
      }
      case 'set_filter': {
        const filterMap = { source: 'filter-utm', medium: 'filter-utm-medium', campaign: 'filter-utm-campaign', city: 'filter-city' };
        const el = document.getElementById(filterMap[toolInput.filter_type]);
        if (!el) return `Filter "${toolInput.filter_type}" not found.`;
        el.value = toolInput.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return toolInput.value ? `Set ${toolInput.filter_type} filter to "${toolInput.value}".` : `Cleared ${toolInput.filter_type} filter.`;
      }
      case 'clear_filters': {
        ['filter-utm', 'filter-utm-medium', 'filter-utm-campaign', 'filter-city'].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        return 'All filters cleared.';
      }
      case 'scroll_to_section': {
        const sectionMap = {
          stats: '.stats', 'revenue-chart': '#revenue-chart', 'hours-chart': '#hours-chart',
          'products-chart': '#products-chart', heatmap: '.heatmap-grid', map: '#order-map',
          utm: '#utm-body', trending: '#trending-body', 'orders-table': '#orders-table',
        };
        const el = document.querySelector(sectionMap[toolInput.section]);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return `Scrolled to ${toolInput.section}.`; }
        return `Section "${toolInput.section}" not found.`;
      }
      case 'get_table_data': {
        return readTableData(toolInput.table);
      }
      default:
        return `Unknown action: ${toolName}`;
    }
  }

  // ── Markdown-lite renderer ──
  function renderMarkdown(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n- /g, '</p><ul><li>').replace(/<\/li>(?=<ul>)/g, '')
      .replace(/^- /gm, '<li>')
      // Wrap in paragraphs
      .replace(/^(?!<)/, '<p>').replace(/(?<!>)$/, '</p>')
      // Fix dangling list items
      .replace(/<li>(.+?)(?=<li>|<\/p>|$)/g, '<li>$1</li>')
      .replace(/<ul>([\s\S]*?)(?=<\/p>|$)/g, '<ul>$1</ul>');
  }

  // ── UI helpers ──
  function addMessage(role, html) {
    const div = document.createElement('div');
    div.className = `claude-msg ${role}`;
    div.innerHTML = `<div class="claude-bubble">${html}</div>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function showThinking() {
    return addMessage('thinking', '<div class="claude-dots"><span></span><span></span><span></span></div>');
  }

  function removeThinking(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ── Send message ──
  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    isSending = true;
    sendBtn.disabled = true;

    addMessage('user', text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    chatMessages.push({ role: 'user', content: text });

    const thinkingEl = showThinking();

    try {
      await claudeLoop();
    } catch (err) {
      removeThinking(thinkingEl);
      addMessage('assistant', `<em style="color:var(--red);">Error: ${err.message}</em>`);
    }

    removeThinking(thinkingEl);
    isSending = false;
    sendBtn.disabled = false;
    input.focus();
  }

  // ── Claude conversation loop (handles tool use) ──
  async function claudeLoop() {
    const MAX_TURNS = 6;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const context = gatherDashboardContext();
      const res = await fetch('/.netlify/functions/claude-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: currentStaff ? currentStaff.token : '',
          messages: chatMessages,
          context: context,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      // Process response content blocks
      let textParts = [];
      let toolUses = [];

      data.content.forEach(block => {
        if (block.type === 'text') textParts.push(block.text);
        if (block.type === 'tool_use') toolUses.push(block);
      });

      // Show any text
      if (textParts.length) {
        const fullText = textParts.join('\n');
        // Remove existing thinking indicator before showing real response
        const thinkingEls = messagesEl.querySelectorAll('.claude-msg.thinking');
        thinkingEls.forEach(el => el.remove());
        addMessage('assistant', renderMarkdown(fullText));
      }

      // If no tool use, we're done
      if (data.stop_reason !== 'tool_use' || !toolUses.length) {
        // Add assistant message to history
        chatMessages.push({ role: 'assistant', content: data.content });
        return;
      }

      // Add assistant message with tool calls to history
      chatMessages.push({ role: 'assistant', content: data.content });

      // Execute each tool call and build tool results
      const toolResults = [];
      for (const tool of toolUses) {
        const result = executeDashboardAction(tool.name, tool.input);
        addMessage('action', `⚡ ${result}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: result,
        });
      }

      // Add tool results to message history
      chatMessages.push({ role: 'user', content: toolResults });

      // Brief delay for UI to update after actions
      await new Promise(r => setTimeout(r, 300));
    }
  }
})();

// ── Deploy Status Pills ──
(function() {
  const SITES = ['oso', 'primalpantry', 'reviana'];
  const LABELS = { oso: 'OSO', primalpantry: 'Primal', reviana: 'Reviana' };
  const container = document.getElementById('deploy-pills');
  if (!container) return;

  let deployData = {};

  SITES.forEach(site => {
    const pill = document.createElement('span');
    pill.className = 'deploy-pill';
    pill.id = 'dp-' + site;
    pill.title = LABELS[site];
    pill.innerHTML = '<span class="dp-dot"></span>' + LABELS[site];
    pill.addEventListener('click', () => showDeployPopup(site));
    container.appendChild(pill);
  });

  // Popup
  const popup = document.createElement('div');
  popup.id = 'deploy-popup';
  popup.style.cssText = 'display:none;position:fixed;top:60px;right:1.5rem;z-index:2000;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1rem;min-width:280px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
  document.body.appendChild(popup);

  document.addEventListener('click', (e) => {
    if (popup.style.display !== 'none' && !popup.contains(e.target) && !e.target.closest('.deploy-pill')) {
      popup.style.display = 'none';
    }
  });

  function stateClass(state) {
    if (state === 'ready') return 'dp-ready';
    if (['building','uploading','uploaded','preparing','prepared','processing'].includes(state)) return 'dp-building';
    if (state === 'enqueued' || state === 'new') return 'dp-enqueued';
    if (state === 'error') return 'dp-error';
    return '';
  }

  function stateLabel(state) {
    if (state === 'ready') return 'Live';
    if (state === 'building') return 'Building';
    if (state === 'enqueued') return 'Queued';
    if (state === 'error') return 'Failed';
    if (state === 'uploading' || state === 'uploaded') return 'Uploading';
    if (state === 'preparing' || state === 'prepared') return 'Preparing';
    return state || 'Unknown';
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function showDeployPopup(site) {
    const d = deployData[site];
    if (!d) { popup.style.display = 'none'; return; }
    const t = d.published_at || d.created_at;
    const ago = timeAgo(t);
    const dt = d.deploy_time ? d.deploy_time + 's' : '';
    const msg = d.title || '(no commit message)';
    const err = d.error_message ? '<div style="color:var(--red);margin-top:0.5rem;font-size:0.8rem;">' + d.error_message + '</div>' : '';
    popup.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">' +
        '<span style="font-weight:700;font-size:0.9rem;color:var(--text);">' + LABELS[site] + '</span>' +
        '<span class="deploy-pill ' + stateClass(d.state) + '" style="pointer-events:none;"><span class="dp-dot"></span>' + stateLabel(d.state) + '</span>' +
      '</div>' +
      '<div style="font-size:0.8rem;color:var(--text);margin-bottom:0.4rem;">' + msg + '</div>' +
      '<div style="font-size:0.7rem;color:var(--dim);">' + (ago ? ago : '') + (dt ? ' · ' + dt : '') + '</div>' +
      err;
    popup.style.display = 'block';
  }

  async function pollDeploys() {
    const staff = JSON.parse(sessionStorage.getItem('pp_staff') || 'null');
    if (!staff || !staff.token) return;
    try {
      const res = await fetch('/.netlify/functions/deploy-status?token=' + encodeURIComponent(staff.token));
      if (!res.ok) return;
      const data = await res.json();
      deployData = data;
      SITES.forEach(site => {
        const pill = document.getElementById('dp-' + site);
        if (!pill || !data[site]) return;
        const d = data[site];
        pill.className = 'deploy-pill ' + stateClass(d.state);
        const t = d.published_at || d.created_at;
        pill.title = LABELS[site] + ': ' + stateLabel(d.state) + (timeAgo(t) ? ' · ' + timeAgo(t) : '');
      });
    } catch (e) { /* silent */ }
  }

  pollDeploys();
  setInterval(pollDeploys, 15000);
})();
