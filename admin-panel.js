/**
 * ==========================================================================
 * SALON HAIR BRIDE — ADMIN EXTENSION PANELS
 * Adds to the existing Admin Dispatch Modal:
 *   1. Stylist Directory (add / edit / deactivate, shifts, block-outs)
 *   2. Dynamic Service Menu & Pricing CRUD
 *   3. Revenue & Business Analytics Dashboard (CSS charts, no libraries)
 *   4. Client Feedback & Rating Directory (+ record-on-behalf form)
 * Plus the public "Rate Your Visit" feedback modal (footer link / #rate hash).
 *
 * Auth: uses the backend JWT stored by script.js in
 *       sessionStorage['salon_admin_token'] after admin login.
 * ==========================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:')
    ? 'http://localhost:5000/api'
    : '/api';

  const TIME_SLOTS = [
    '09:00 AM - 09:45 AM', '09:45 AM - 10:30 AM', '10:30 AM - 11:15 AM',
    '11:15 AM - 12:00 PM', '12:45 PM - 01:30 PM', '01:30 PM - 02:15 PM',
    '02:15 PM - 03:00 PM', '03:00 PM - 03:45 PM', '03:45 PM - 04:30 PM',
    '04:30 PM - 05:15 PM', '05:15 PM - 06:00 PM', '06:00 PM - 06:45 PM',
    '06:45 PM - 07:30 PM', '07:15 PM - 08:00 PM'
  ];

  const SPEC_OPTIONS = ['Hair', 'Makeup', 'Nails', 'Bridal Styling', 'Color & Highlights', 'Therapy & Spa', 'Skin & Aesthetics'];
  const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // ---------------------------------------------------------------- helpers
  function getToken() {
    try {
      return sessionStorage.getItem('salon_admin_token') || localStorage.getItem('salon_admin_token') || localStorage.getItem('salon_auth_token');
    } catch (e) { return null; }
  }

  async function api(path, options = {}) {
    const token = getToken();
    const resp = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    let data = null;
    try { data = await resp.json(); } catch (e) {}
    if (!resp.ok || !data || data.success === false) {
      const err = new Error((data && data.message) || `Request failed (${resp.status})`);
      err.status = resp.status;
      // Strict auth: a rejected/missing admin token purges the session and
      // redirects to the login screen (handled in script.js).
      if (resp.status === 401 || resp.status === 403) {
        window.dispatchEvent(new CustomEvent('salon:admin_session_invalid'));
      }
      throw err;
    }
    return data;
  }

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtMoney(n) {
    const num = Number(n) || 0;
    return `Rs. ${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function starsHtml(rating) {
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    let out = '<span class="stars-display" aria-label="' + r + ' out of 5 stars">';
    for (let i = 1; i <= 5; i++) {
      out += `<span class="star ${i <= Math.round(r) ? 'star-filled' : ''}">★</span>`;
    }
    return out + '</span>';
  }

  function offlineNotice() {
    return `
      <div class="admin-panel-offline">
        <strong>Backend unavailable or admin session not authenticated.</strong>
        <p>Make sure the Node/MySQL server is running, then lock &amp; re-open the Admin panel
        (login again so a fresh API token is issued).</p>
        <button type="button" class="btn-admin-action ap-retry-btn">Retry</button>
      </div>`;
  }

  function splitList(value) {
    return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  function chipRow(options, selectedValues, inputName) {
    const sel = new Set(selectedValues.map(s => s.toLowerCase()));
    return `<div class="ap-chip-group" data-input="${inputName}">` + options.map(opt => `
      <button type="button" class="ap-chip ${sel.has(opt.toLowerCase()) ? 'active' : ''}" data-value="${escapeHtml(opt)}">
        ${escapeHtml(opt)}
      </button>`).join('') + `</div>`;
  }

  function bindChipGroups(root) {
    root.querySelectorAll('.ap-chip-group').forEach(group => {
      group.addEventListener('click', (e) => {
        const chip = e.target.closest('.ap-chip');
        if (chip) chip.classList.toggle('active');
      });
    });
  }

  function readChipGroup(root, inputName) {
    const group = root.querySelector(`.ap-chip-group[data-input="${inputName}"]`);
    if (!group) return [];
    return Array.from(group.querySelectorAll('.ap-chip.active')).map(c => c.getAttribute('data-value'));
  }

  // ------------------------------------------------------- section switching
  const sectionNav = document.getElementById('adminSectionNav');
  const sectionMap = {
    appointments: document.getElementById('adminSectionAppointments'),
    stylists: document.getElementById('adminSectionStylists'),
    services: document.getElementById('adminSectionServices'),
    analytics: document.getElementById('adminSectionAnalytics'),
    feedback: document.getElementById('adminSectionFeedback'),
    'waiting-list': document.getElementById('adminSectionWaitingList'),
    clients: document.getElementById('adminSectionClients')
  };
  const loaders = {
    stylists: () => renderStylistsPanel(),
    services: () => renderServicesPanel(),
    analytics: () => renderAnalyticsPanel(),
    feedback: () => renderFeedbackPanel(),
    'waiting-list': () => renderWaitingListPanel(),
    waitingList: () => renderWaitingListPanel(),
    clients: () => renderClientsPanel()
  };
  let activeSection = 'appointments';

  function switchSection(name) {
    const targetKey = (name === 'waitingList') ? 'waiting-list' : name;
    const targetEl = sectionMap[targetKey];
    if (!targetEl) {
      console.warn(`[Admin Dashboard] Section "${targetKey}" not found in sectionMap.`);
      return;
    }
    activeSection = targetKey;

    // Toggle active and hidden states strictly on unique elements
    const uniqueEls = new Set(Object.values(sectionMap).filter(Boolean));
    uniqueEls.forEach(el => {
      const isActive = (el === targetEl);
      el.classList.toggle('active', isActive);
      if (isActive) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
    });

    if (sectionNav) {
      sectionNav.querySelectorAll('.admin-section-btn').forEach(btn => {
        const btnSec = btn.getAttribute('data-section');
        const isActive = (btnSec === targetKey || (targetKey === 'waiting-list' && btnSec === 'waitingList'));
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    console.log(`[Admin Dashboard] Switched to tab: "${targetKey}"`);

    if (loaders[targetKey]) {
      loaders[targetKey]();
    }
  }

  // Delegated click listener on sectionNav container
  if (sectionNav) {
    sectionNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.admin-section-btn');
      if (btn) {
        const sec = btn.getAttribute('data-section');
        console.log(`[Admin Dashboard] Section nav button clicked: "${sec}"`);
        if (sec) switchSection(sec);
      }
    });
  }

  // Explicit direct click listener for "Waiting List" tab
  const directWlButtons = document.querySelectorAll('.admin-section-btn[data-section="waiting-list"], #adminTabWaitingList');
  directWlButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      console.log('[Admin Dashboard] Waiting List tab button clicked directly.');
      switchSection('waiting-list');
    });
  });

  // Explicit direct click listener for "Clients" tab
  const directClientsButtons = document.querySelectorAll('.admin-section-btn[data-section="clients"], #adminTabClients');
  directClientsButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      console.log('[Admin Dashboard] Clients tab button clicked directly.');
      switchSection('clients');
    });
  });

  // Reload the visible panel once a fresh admin token arrives (after login)
  window.addEventListener('salon:admin_token_ready', () => {
    if (activeSection !== 'appointments' && loaders[activeSection]) loaders[activeSection]();
  });

  // Reload waiting list immediately when an appointment is moved or updated
  window.addEventListener('salon:waiting_list_changed', () => {
    if (activeSection === 'waiting-list' || activeSection === 'waitingList') {
      renderWaitingListPanel();
    }
  });

  function panelRoot(id) { return document.getElementById(id); }

  function panelError(root, err) {
    if (!root) return;
    if (err && (err.status === 401 || err.status === 403)) {
      root.innerHTML = `<div class="admin-panel-offline"><strong>Admin session invalid.</strong><p>Redirecting to the login screen — please enter your credentials again.</p></div>`;
      return;
    }
    if (err && err.message === 'Failed to fetch') {
      root.innerHTML = offlineNotice();
    } else {
      root.innerHTML = `<div class="admin-panel-offline"><strong>Could not load data.</strong><p>${escapeHtml(err && err.message || err)}</p></div>`;
    }
    const retry = root.querySelector('.ap-retry-btn');
    if (retry) retry.addEventListener('click', () => loaders[activeSection] && loaders[activeSection]());
  }

  // ============================================================
  // 1. STYLIST DIRECTORY PANEL
  // ============================================================
  let stylistsCache = [];
  let editingStylistId = null;   // null = closed, 'new' = add form, number = edit
  let blocksForStylistId = null; // stylist whose block-out list is expanded

  async function renderStylistsPanel() {
    const root = panelRoot('stylistsPanel');
    if (!root) return;
    root.innerHTML = '<p class="admin-panel-loading">Loading stylist directory…</p>';
    try {
      const data = await api('/stylists/admin');
      stylistsCache = data.stylists || [];
      drawStylists(root);
    } catch (err) {
      panelError(root, err);
    }
  }

  function stylistFormHtml(s) {
    const isNew = !s || !s.id;
    const specs = splitList(s ? (s.specializations || s.specialization) : '');
    const days = splitList(s ? s.shiftDays : '');
    return `
      <form class="ap-form ap-stylist-form" data-form="stylist">
        <h4 class="ap-form-title">${isNew ? 'Add New Stylist' : `Edit Stylist — ${escapeHtml(s.name)}`}</h4>
        <div class="ap-form-grid">
          <div class="form-group">
            <label class="form-label">Full Name <span class="required">*</span></label>
            <input type="text" class="form-input" name="name" value="${escapeHtml(s ? s.name : '')}" placeholder="e.g. Nadeesha Fernando" required>
          </div>
          <div class="form-group">
            <label class="form-label">Photo URL</label>
            <input type="url" class="form-input" name="photoUrl" value="${escapeHtml(s ? (s.photoUrl || '') : '')}" placeholder="https://…/photo.jpg">
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="tel" class="form-input" name="phone" value="${escapeHtml(s ? (s.phone || '') : '')}" placeholder="07X XXX XXXX">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" name="email" value="${escapeHtml(s ? (s.email || '') : '')}" placeholder="stylist@salonhairbride.lk">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Specializations</label>
          ${chipRow(SPEC_OPTIONS, specs, 'specializations')}
        </div>
        <div class="form-group">
          <label class="form-label">Working Shift — Days</label>
          ${chipRow(DAY_OPTIONS, days, 'shiftDays')}
        </div>
        <div class="ap-form-grid">
          <div class="form-group">
            <label class="form-label">Shift Start</label>
            <input type="time" class="form-input" name="shiftStart" value="${escapeHtml(s ? (s.shiftStart || '') : '09:00')}">
          </div>
          <div class="form-group">
            <label class="form-label">Shift End</label>
            <input type="time" class="form-input" name="shiftEnd" value="${escapeHtml(s ? (s.shiftEnd || '') : '18:00')}">
          </div>
        </div>
        <div class="ap-form-actions">
          <button type="submit" class="btn btn-primary">${isNew ? 'Add Stylist' : 'Save Changes'}</button>
          <button type="button" class="btn btn-secondary ap-cancel-btn">Cancel</button>
        </div>
      </form>`;
  }

  function stylistCardHtml(s) {
    const specs = splitList(s.specializations && s.specializations.length ? s.specializations : s.specialization);
    const days = splitList(s.shiftDays);
    const shift = (days.length || s.shiftStart)
      ? `${days.length ? days.join(' · ') : 'Daily'}${s.shiftStart && s.shiftEnd ? ` — ${s.shiftStart} to ${s.shiftEnd}` : ''}`
      : 'Shift not set';
    const initials = String(s.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const photo = s.photoUrl
      ? `<img class="ap-stylist-photo" src="${escapeHtml(s.photoUrl)}" alt="${escapeHtml(s.name)}" loading="lazy" onerror="this.outerHTML='<span class=&quot;ap-stylist-photo ap-photo-fallback&quot;>${initials}</span>'">`
      : `<span class="ap-stylist-photo ap-photo-fallback">${escapeHtml(initials)}</span>`;

    return `
      <div class="ap-stylist-card ${Number(s.isActive) === 1 ? '' : 'inactive'}" data-stylist="${s.id}">
        <div class="ap-stylist-head">
          ${photo}
          <div class="ap-stylist-id">
            <h4 class="ap-stylist-name">${escapeHtml(s.name)}
              <span class="ap-badge ${Number(s.isActive) === 1 ? 'ap-badge-active' : 'ap-badge-inactive'}">${Number(s.isActive) === 1 ? 'Active' : 'Deactivated'}</span>
            </h4>
            <p class="ap-stylist-contact">
              ${s.phone ? `<a href="tel:${escapeHtml(s.phone)}">${escapeHtml(s.phone)}</a>` : '<span class="ap-muted">No phone</span>'}
              ${s.email ? ` · <a href="mailto:${escapeHtml(s.email)}">${escapeHtml(s.email)}</a>` : ''}
            </p>
          </div>
        </div>
        <div class="ap-stylist-specs">
          ${specs.length ? specs.map(sp => `<span class="ap-spec-chip">${escapeHtml(sp)}</span>`).join('') : '<span class="ap-muted">No specializations set</span>'}
        </div>
        <p class="ap-stylist-shift"><strong>Shift:</strong> ${escapeHtml(shift)}</p>
        <div class="ap-stylist-stats">
          <span title="Upcoming appointments linked to this stylist">📅 ${Number(s.upcomingAppointments) || 0} upcoming</span>
          <span title="Completed appointments">✅ ${Number(s.completedAppointments) || 0} completed</span>
          <span title="Active block-out times">⛔ ${Number(s.activeBlocks) || 0} blocks</span>
        </div>
        <div class="ap-stylist-actions">
          <button type="button" class="btn-admin-action ap-edit-stylist">Edit</button>
          <button type="button" class="btn-admin-action ap-toggle-stylist">${Number(s.isActive) === 1 ? 'Deactivate' : 'Reactivate'}</button>
          <button type="button" class="btn-admin-action ap-manage-blocks">${blocksForStylistId === s.id ? 'Hide Blocks' : 'Block-Outs'}</button>
        </div>
        ${blocksForStylistId === s.id ? `<div class="ap-blocks-area" data-blocks-for="${s.id}"><p class="admin-panel-loading">Loading block-outs…</p></div>` : ''}
      </div>`;
  }

  function drawStylists(root) {
    const formHtml = (editingStylistId !== null)
      ? stylistFormHtml(editingStylistId === 'new' ? null : stylistsCache.find(s => s.id === editingStylistId))
      : '';
    root.innerHTML = `
      <div class="ap-panel-header">
        <div>
          <h3 class="ap-panel-title">Stylist Directory</h3>
          <p class="ap-panel-subtitle">Manage profiles, specializations, working shifts and block-out times. Stylist IDs stay linked to appointments and <code>stylist_blocks</code>.</p>
        </div>
        <button type="button" class="btn btn-primary" id="apAddStylistBtn">+ Add Stylist</button>
      </div>
      <div id="apStylistFormSlot">${editingStylistId !== null ? formHtml : ''}</div>
      <div class="ap-stylist-grid">
        ${stylistsCache.length ? stylistsCache.map(stylistCardHtml).join('') : '<p class="admin-panel-loading">No stylists yet — add your first stylist.</p>'}
      </div>`;

    bindChipGroups(root);

    const addBtn = root.querySelector('#apAddStylistBtn');
    if (addBtn) addBtn.addEventListener('click', () => { editingStylistId = 'new'; drawStylists(root); });

    const cancelBtn = root.querySelector('.ap-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { editingStylistId = null; drawStylists(root); });

    const form = root.querySelector('form[data-form="stylist"]');
    if (form) form.addEventListener('submit', submitStylistForm);

    root.querySelectorAll('.ap-edit-stylist').forEach(btn => btn.addEventListener('click', () => {
      editingStylistId = Number(btn.closest('.ap-stylist-card').getAttribute('data-stylist'));
      drawStylists(root);
    }));

    root.querySelectorAll('.ap-toggle-stylist').forEach(btn => btn.addEventListener('click', async () => {
      const id = Number(btn.closest('.ap-stylist-card').getAttribute('data-stylist'));
      const s = stylistsCache.find(x => x.id === id);
      if (!s) return;
      const nextActive = Number(s.isActive) === 1 ? 0 : 1;
      if (!nextActive && !window.confirm(`Deactivate ${s.name}? They will no longer accept new appointments (existing history is preserved).`)) return;
      btn.disabled = true;
      try {
        await api(`/stylists/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: nextActive }) });
        await renderStylistsPanel();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    }));

    root.querySelectorAll('.ap-manage-blocks').forEach(btn => btn.addEventListener('click', () => {
      const id = Number(btn.closest('.ap-stylist-card').getAttribute('data-stylist'));
      blocksForStylistId = blocksForStylistId === id ? null : id;
      drawStylists(root);
      if (blocksForStylistId === id) loadBlocksFor(id);
    }));

    if (blocksForStylistId !== null) loadBlocksFor(blocksForStylistId);
  }

  async function submitStylistForm(e) {
    e.preventDefault();
    const form = e.target;
    const root = panelRoot('stylistsPanel');
    const fd = new FormData(form);
    const payload = {
      name: fd.get('name'),
      photoUrl: fd.get('photoUrl'),
      phone: fd.get('phone'),
      email: fd.get('email'),
      specializations: readChipGroup(form, 'specializations'),
      shiftDays: readChipGroup(form, 'shiftDays'),
      shiftStart: fd.get('shiftStart'),
      shiftEnd: fd.get('shiftEnd')
    };
    if (!payload.name || !payload.name.trim()) { alert('Stylist name is required.'); return; }
    try {
      if (editingStylistId === 'new') {
        await api('/stylists', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await api(`/stylists/${editingStylistId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      }
      editingStylistId = null;
      await renderStylistsPanel();
    } catch (err) {
      alert(err.message);
      if (root) bindChipGroups(root);
    }
  }

  async function loadBlocksFor(stylistId) {
    const area = document.querySelector(`.ap-blocks-area[data-blocks-for="${stylistId}"]`);
    if (!area) return;
    try {
      const data = await api(`/stylists/blocks?stylistId=${stylistId}`);
      const blocks = data.blocks || [];
      area.innerHTML = `
        <h5 class="ap-blocks-title">Block-Out Times (breaks / training / unavailable)</h5>
        <form class="ap-block-form" data-block-form="${stylistId}">
          <input type="date" class="form-input" name="date" required min="${new Date().toISOString().split('T')[0]}">
          <select class="form-input" name="timeSlot" required>
            <option value="">Select time slot…</option>
            ${TIME_SLOTS.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
          <input type="text" class="form-input" name="reason" placeholder="Reason (optional)" maxlength="255">
          <button type="submit" class="btn btn-primary btn-sm">Add Block</button>
        </form>
        ${blocks.length ? `
          <ul class="ap-block-list">
            ${blocks.map(b => `
              <li class="ap-block-item">
                <span><strong>${escapeHtml(b.blockDate)}</strong> · ${escapeHtml(b.timeSlot)}${b.reason ? ` — ${escapeHtml(b.reason)}` : ''}</span>
                <button type="button" class="btn-admin-icon ap-remove-block" data-block-id="${b.id}" title="Remove block-out" aria-label="Remove block-out">&times;</button>
              </li>`).join('')}
          </ul>` : '<p class="ap-muted">No block-out times recorded.</p>'}`;

      const form = area.querySelector('form[data-block-form]');
      if (form) form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        try {
          await api('/stylists/blocks', {
            method: 'POST',
            body: JSON.stringify({ stylistId, date: fd.get('date'), timeSlot: fd.get('timeSlot'), reason: fd.get('reason') })
          });
          loadBlocksFor(stylistId);
          refreshStylistCounts();
        } catch (err2) { alert(err2.message); }
      });

      area.querySelectorAll('.ap-remove-block').forEach(btn => btn.addEventListener('click', async () => {
        if (!window.confirm('Remove this block-out time?')) return;
        try {
          await api(`/stylists/blocks/${btn.getAttribute('data-block-id')}`, { method: 'DELETE' });
          loadBlocksFor(stylistId);
          refreshStylistCounts();
        } catch (err2) { alert(err2.message); }
      }));
    } catch (err) {
      area.innerHTML = `<p class="ap-muted">Failed to load block-outs: ${escapeHtml(err.message)}</p>`;
    }
  }

  async function refreshStylistCounts() {
    try {
      const data = await api('/stylists/admin');
      stylistsCache = data.stylists || [];
      const cards = document.querySelectorAll('.ap-stylist-card');
      cards.forEach(card => {
        const id = Number(card.getAttribute('data-stylist'));
        const s = stylistsCache.find(x => x.id === id);
        const stats = card.querySelector('.ap-stylist-stats');
        if (s && stats) {
          stats.innerHTML = `
            <span title="Upcoming appointments linked to this stylist">📅 ${Number(s.upcomingAppointments) || 0} upcoming</span>
            <span title="Completed appointments">✅ ${Number(s.completedAppointments) || 0} completed</span>
            <span title="Active block-out times">⛔ ${Number(s.activeBlocks) || 0} blocks</span>`;
        }
      });
    } catch (e) {}
  }

  // ============================================================
  // 2. SERVICE MENU & PRICING PANEL
  // ============================================================
  let servicesCache = [];
  let editingServiceId = null; // null | 'new' | number

  async function renderServicesPanel() {
    const root = panelRoot('servicesPanel');
    if (!root) return;
    root.innerHTML = '<p class="admin-panel-loading">Loading service menu…</p>';
    try {
      const data = await api('/services/admin');
      servicesCache = data.services || [];
      drawServices(root);
    } catch (err) {
      panelError(root, err);
    }
  }

  function serviceFormHtml(s) {
    const isNew = !s || !s.id;
    return `
      <form class="ap-form ap-service-form" data-form="service">
        <h4 class="ap-form-title">${isNew ? 'Add New Service' : `Edit Service — ${escapeHtml(s.service_name)}`}</h4>
        <div class="ap-form-grid">
          <div class="form-group">
            <label class="form-label">Service Title <span class="required">*</span></label>
            <input type="text" class="form-input" name="service_name" value="${escapeHtml(s ? s.service_name : '')}" placeholder="e.g. Bridal Styling" required maxlength="150">
          </div>
          <div class="form-group">
            <label class="form-label">Category</label>
            <input type="text" class="form-input" name="category" value="${escapeHtml(s ? (s.category || '') : '')}" placeholder="e.g. Bridal & Occasions" list="apCategoryList" maxlength="100">
            <datalist id="apCategoryList">
              ${Array.from(new Set(servicesCache.map(x => x.category).filter(Boolean))).map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}
            </datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Price (Rs.) <span class="required">*</span></label>
            <input type="number" class="form-input" name="price" value="${s ? Number(s.price) : ''}" min="0" step="0.01" placeholder="e.g. 15000" required>
          </div>
          <div class="form-group">
            <label class="form-label">Duration (minutes)</label>
            <input type="number" class="form-input" name="duration_minutes" value="${s ? Number(s.duration_minutes) : 45}" min="1" max="600" step="1">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input ap-textarea" name="description" rows="3" placeholder="Short description shown to the salon team…">${escapeHtml(s ? (s.description || '') : '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-input" name="status">
            <option value="active" ${!s || s.status === 'active' ? 'selected' : ''}>Active (bookable)</option>
            <option value="inactive" ${s && s.status === 'inactive' ? 'selected' : ''}>Inactive (hidden from menu)</option>
          </select>
        </div>
        <div class="ap-form-actions">
          <button type="submit" class="btn btn-primary">${isNew ? 'Create Service' : 'Save Changes'}</button>
          <button type="button" class="btn btn-secondary ap-cancel-btn">Cancel</button>
        </div>
      </form>`;
  }

  function drawServices(root) {
    root.innerHTML = `
      <div class="ap-panel-header">
        <div>
          <h3 class="ap-panel-title">Service Menu & Pricing</h3>
          <p class="ap-panel-subtitle">Create, edit, deactivate or delete salon services. Completed-visit revenue is valued from these prices.</p>
        </div>
        <button type="button" class="btn btn-primary" id="apAddServiceBtn">+ Add Service</button>
      </div>
      <div id="apServiceFormSlot">${editingServiceId !== null ? serviceFormHtml(editingServiceId === 'new' ? null : servicesCache.find(s => s.id === editingServiceId)) : ''}</div>
      <div class="ap-table-wrap">
        <table class="ap-table">
          <thead>
            <tr><th>Service</th><th>Category</th><th>Duration</th><th>Price</th><th>Status</th><th class="ap-th-actions">Actions</th></tr>
          </thead>
          <tbody>
            ${servicesCache.length ? servicesCache.map(s => `
              <tr class="${s.status === 'inactive' ? 'ap-row-inactive' : ''}" data-service="${s.id}">
                <td>
                  <strong>${escapeHtml(s.service_name)}</strong>
                  ${s.description ? `<p class="ap-cell-desc">${escapeHtml(s.description)}</p>` : ''}
                </td>
                <td>${escapeHtml(s.category || '—')}</td>
                <td>${Number(s.duration_minutes) || 0} min</td>
                <td class="ap-cell-price">${fmtMoney(s.price)}</td>
                <td><span class="ap-badge ${s.status === 'active' ? 'ap-badge-active' : 'ap-badge-inactive'}">${escapeHtml(s.status)}</span></td>
                <td class="ap-td-actions">
                  <button type="button" class="btn-admin-action ap-edit-service">Edit</button>
                  <button type="button" class="btn-admin-action btn-danger-ghost ap-delete-service">Delete</button>
                </td>
              </tr>`).join('') : '<tr><td colspan="6" class="ap-muted">No services found.</td></tr>'}
          </tbody>
        </table>
      </div>`;

    const addBtn = root.querySelector('#apAddServiceBtn');
    if (addBtn) addBtn.addEventListener('click', () => { editingServiceId = 'new'; drawServices(root); });

    const cancelBtn = root.querySelector('.ap-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { editingServiceId = null; drawServices(root); });

    const form = root.querySelector('form[data-form="service"]');
    if (form) form.addEventListener('submit', submitServiceForm);

    root.querySelectorAll('.ap-edit-service').forEach(btn => btn.addEventListener('click', () => {
      editingServiceId = Number(btn.closest('tr').getAttribute('data-service'));
      drawServices(root);
    }));

    root.querySelectorAll('.ap-delete-service').forEach(btn => btn.addEventListener('click', async () => {
      const id = Number(btn.closest('tr').getAttribute('data-service'));
      const s = servicesCache.find(x => x.id === id);
      if (!window.confirm(`Delete "${s ? s.service_name : 'this service'}"? Past appointments keep their recorded service name.`)) return;
      try {
        await api(`/services/${id}`, { method: 'DELETE' });
        await renderServicesPanel();
      } catch (err) { alert(err.message); }
    }));
  }

  async function submitServiceForm(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const payload = {
      service_name: fd.get('service_name'),
      category: fd.get('category'),
      price: fd.get('price'),
      duration_minutes: fd.get('duration_minutes'),
      description: fd.get('description'),
      status: fd.get('status')
    };
    try {
      if (editingServiceId === 'new') {
        await api('/services', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await api(`/services/${editingServiceId}`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      editingServiceId = null;
      await renderServicesPanel();
    } catch (err) {
      alert(err.message);
    }
  }

  // ============================================================
  // 3. REVENUE & BUSINESS ANALYTICS PANEL
  // ============================================================
  async function renderAnalyticsPanel() {
    const root = panelRoot('analyticsPanel');
    if (!root) return;
    root.innerHTML = '<p class="admin-panel-loading">Loading analytics…</p>';
    try {
      const data = await api('/analytics/summary');
      drawAnalytics(root, data.analytics);
    } catch (err) {
      panelError(root, err);
    }
  }

  function drawAnalytics(root, a) {
    const rev = a.revenue || {};
    const counts = a.appointments || {};
    const rating = a.rating || {};
    const trend = a.trend || [];

    // Build a full 14-day series (fill missing days with zero)
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      days.push(d.toISOString().split('T')[0]);
    }
    const trendMap = new Map(trend.map(t => [t.day, t]));
    const trendVals = days.map(day => {
      const t = trendMap.get(day);
      return { day, revenue: t ? Number(t.revenue) : 0, visits: t ? Number(t.visits) : 0 };
    });
    const maxRev = Math.max(1, ...trendVals.map(t => t.revenue));

    const topServices = a.topServices || [];
    const maxTop = Math.max(1, ...topServices.map(t => Number(t.revenue)));

    const workload = a.stylistWorkload || [];
    const maxCompleted = Math.max(1, ...workload.map(w => Number(w.completed)));

    root.innerHTML = `
      <div class="ap-panel-header">
        <div>
          <h3 class="ap-panel-title">Revenue & Business Analytics</h3>
          <p class="ap-panel-subtitle">Revenue is calculated from completed visits valued at current service-menu prices.</p>
        </div>
        <button type="button" class="btn-admin-action" id="apAnalyticsRefresh">↻ Refresh</button>
      </div>

      <div class="ap-kpi-grid">
        <div class="ap-kpi-card">
          <span class="ap-kpi-label">Today's Revenue</span>
          <span class="ap-kpi-value">${fmtMoney(rev.today)}</span>
          <span class="ap-kpi-sub">${Number(rev.todayVisits) || 0} completed visit(s)</span>
        </div>
        <div class="ap-kpi-card">
          <span class="ap-kpi-label">This Week</span>
          <span class="ap-kpi-value">${fmtMoney(rev.week)}</span>
          <span class="ap-kpi-sub">${Number(rev.weekVisits) || 0} completed visit(s)</span>
        </div>
        <div class="ap-kpi-card">
          <span class="ap-kpi-label">This Month</span>
          <span class="ap-kpi-value">${fmtMoney(rev.month)}</span>
          <span class="ap-kpi-sub">${Number(rev.monthVisits) || 0} completed visit(s)</span>
        </div>
        <div class="ap-kpi-card">
          <span class="ap-kpi-label">Completed Appointments</span>
          <span class="ap-kpi-value">${Number(counts.completedTotal) || 0}</span>
          <span class="ap-kpi-sub">${Number(counts.upcomingTotal) || 0} upcoming · ${Number(counts.cancelledTotal) || 0} cancelled</span>
        </div>
        <div class="ap-kpi-card">
          <span class="ap-kpi-label">Average Client Rating</span>
          <span class="ap-kpi-value">${starsHtml(rating.avgRating)} ${Number(rating.avgRating || 0).toFixed(2)}</span>
          <span class="ap-kpi-sub">${Number(rating.totalReviews) || 0} review(s)</span>
        </div>
      </div>

      <div class="ap-chart-card">
        <h4 class="ap-chart-title">Daily Revenue — Last 14 Days</h4>
        <div class="ap-bar-chart" role="img" aria-label="Daily revenue bar chart for the last 14 days">
          ${trendVals.map(t => `
            <div class="ap-bar-col" title="${escapeHtml(t.day)}: ${fmtMoney(t.revenue)} (${t.visits} visit${t.visits === 1 ? '' : 's'})">
              <div class="ap-bar" style="height: ${Math.round((t.revenue / maxRev) * 100)}%;"></div>
              <span class="ap-bar-label">${escapeHtml(t.day.slice(5))}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="ap-two-col">
        <div class="ap-chart-card">
          <h4 class="ap-chart-title">Top-Performing Services</h4>
          ${topServices.length ? topServices.map((t, i) => `
            <div class="ap-hbar-row">
              <span class="ap-hbar-rank">${i + 1}</span>
              <div class="ap-hbar-body">
                <div class="ap-hbar-head">
                  <strong>${escapeHtml(t.service)}</strong>
                  <span>${fmtMoney(t.revenue)} · ${Number(t.completedCount)} done</span>
                </div>
                <div class="ap-hbar-track"><div class="ap-hbar-fill" style="width: ${Math.round((Number(t.revenue) / maxTop) * 100)}%;"></div></div>
              </div>
            </div>`).join('') : '<p class="ap-muted">No completed visits yet — revenue stats appear once appointments are marked Completed.</p>'}
        </div>

        <div class="ap-chart-card">
          <h4 class="ap-chart-title">Stylist Workload</h4>
          <div class="ap-table-wrap">
            <table class="ap-table ap-table-compact">
              <thead><tr><th>Stylist</th><th>Upcoming</th><th>Completed</th><th>Revenue</th><th>Rating</th></tr></thead>
              <tbody>
                ${workload.length ? workload.map(w => `
                  <tr class="${w.isActive ? '' : 'ap-row-inactive'}">
                    <td>${escapeHtml(w.name)}${w.isActive ? '' : ' <span class="ap-badge ap-badge-inactive">off</span>'}</td>
                    <td>${Number(w.upcoming) || 0}</td>
                    <td>
                      <div class="ap-workload-cell">
                        <span>${Number(w.completed) || 0}</span>
                        <span class="ap-hbar-track ap-workload-track"><span class="ap-hbar-fill" style="width: ${Math.round((Number(w.completed) / maxCompleted) * 100)}%;"></span></span>
                      </div>
                    </td>
                    <td>${fmtMoney(w.revenue)}</td>
                    <td>${w.avgRating > 0 ? `${Number(w.avgRating).toFixed(1)} ★` : '<span class="ap-muted">—</span>'}</td>
                  </tr>`).join('') : '<tr><td colspan="5" class="ap-muted">No stylists on roster.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;

    const refresh = root.querySelector('#apAnalyticsRefresh');
    if (refresh) refresh.addEventListener('click', () => renderAnalyticsPanel());
  }

  // ============================================================
  // 4. CLIENT FEEDBACK & RATING PANEL
  // ============================================================
  async function renderFeedbackPanel() {
    const root = panelRoot('feedbackPanel');
    if (!root) return;
    root.innerHTML = '<p class="admin-panel-loading">Loading feedback…</p>';
    try {
      const data = await api('/feedback');
      drawFeedback(root, data);
    } catch (err) {
      panelError(root, err);
    }
  }

  function drawFeedback(root, data) {
    const list = data.feedback || [];
    const summary = data.summary || {};
    const dist = summary.distribution || [];
    const maxDist = Math.max(1, ...dist.map(d => Number(d.count)));

    root.innerHTML = `
      <div class="ap-panel-header">
        <div>
          <h3 class="ap-panel-title">Client Feedback & Ratings</h3>
          <p class="ap-panel-subtitle">Reviews are linked to CRM client profiles and the serving stylist. Marking an appointment Completed automatically sends a review request.</p>
        </div>
        <button type="button" class="btn-admin-action" id="apFeedbackRefresh">↻ Refresh</button>
      </div>

      <div class="ap-kpi-grid ap-kpi-grid-small">
        <div class="ap-kpi-card">
          <span class="ap-kpi-label">Average Rating</span>
          <span class="ap-kpi-value">${starsHtml(summary.avgRating)} ${Number(summary.avgRating || 0).toFixed(2)}</span>
        </div>
        <div class="ap-kpi-card">
          <span class="ap-kpi-label">Total Reviews</span>
          <span class="ap-kpi-value">${Number(summary.totalReviews) || 0}</span>
        </div>
        <div class="ap-kpi-card ap-kpi-wide">
          <span class="ap-kpi-label">Distribution</span>
          <div class="ap-dist-rows">
            ${dist.map(d => `
              <div class="ap-dist-row">
                <span class="ap-dist-star">${d.star}★</span>
                <span class="ap-hbar-track"><span class="ap-hbar-fill" style="width: ${Math.round((Number(d.count) / maxDist) * 100)}%;"></span></span>
                <span class="ap-dist-count">${Number(d.count) || 0}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <form class="ap-form" data-form="admin-feedback">
        <h4 class="ap-form-title">Record Feedback on Behalf of a Client</h4>
        <div class="ap-form-grid">
          <div class="form-group">
            <label class="form-label">Booking Code <span class="required">*</span></label>
            <input type="text" class="form-input" name="bookingCode" placeholder="e.g. APT-98241" required>
          </div>
          <div class="form-group">
            <label class="form-label">Star Rating <span class="required">*</span></label>
            <div class="star-rating-input ap-star-input" data-star-target="admin">
              ${[1, 2, 3, 4, 5].map(i => `<button type="button" class="star-btn" data-value="${i}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`).join('')}
            </div>
            <input type="hidden" name="rating" id="apAdminFbRating" value="">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input ap-textarea" name="notes" rows="2" placeholder="Feedback captured by phone / in person…"></textarea>
        </div>
        <div class="ap-form-actions">
          <button type="submit" class="btn btn-primary">Save Feedback</button>
        </div>
      </form>

      <div class="ap-feedback-list">
        ${list.length ? list.map(f => `
          <div class="ap-feedback-card" data-feedback="${f.id}">
            <div class="ap-feedback-head">
              ${starsHtml(f.rating)}
              <strong>${escapeHtml(f.clientName || 'Client')}</strong>
              <span class="ap-badge ${f.source === 'admin' ? 'ap-badge-inactive' : 'ap-badge-active'}">${escapeHtml(f.source)}</span>
              <span class="ap-feedback-date">${escapeHtml(String(f.createdAt || '').slice(0, 16).replace('T', ' '))}</span>
            </div>
            <p class="ap-feedback-meta">
              ${escapeHtml(f.bookingCode || '')} · ${escapeHtml(f.serviceName || 'Service')}${f.stylistName ? ` · Stylist: ${escapeHtml(f.stylistName)}` : ''}${f.clientId ? ` · CRM Client #${f.clientId}` : ''}
            </p>
            ${f.notes ? `<p class="ap-feedback-notes">“${escapeHtml(f.notes)}”</p>` : ''}
            <div class="ap-stylist-actions">
              <button type="button" class="btn-admin-action btn-danger-ghost ap-delete-feedback">Delete</button>
            </div>
          </div>`).join('') : '<p class="ap-muted">No reviews yet. Reviews appear here when clients submit the “Rate Your Visit” form or staff record feedback above.</p>'}
      </div>`;

    const refresh = root.querySelector('#apFeedbackRefresh');
    if (refresh) refresh.addEventListener('click', () => renderFeedbackPanel());

    bindStarInput(root.querySelector('.ap-star-input'), (val) => {
      const hidden = root.querySelector('#apAdminFbRating');
      if (hidden) hidden.value = val;
    });

    const form = root.querySelector('form[data-form="admin-feedback"]');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = { bookingCode: fd.get('bookingCode'), rating: fd.get('rating'), notes: fd.get('notes') };
      if (!payload.bookingCode || !payload.rating) { alert('Booking code and star rating are required.'); return; }
      try {
        await api('/feedback/admin', { method: 'POST', body: JSON.stringify(payload) });
        await renderFeedbackPanel();
      } catch (err) { alert(err.message); }
    });

    root.querySelectorAll('.ap-delete-feedback').forEach(btn => btn.addEventListener('click', async () => {
      if (!window.confirm('Delete this feedback entry?')) return;
      const id = btn.closest('.ap-feedback-card').getAttribute('data-feedback');
      try {
        await api(`/feedback/${id}`, { method: 'DELETE' });
        await renderFeedbackPanel();
      } catch (err) { alert(err.message); }
    }));
  }

  function bindStarInput(container, onChange) {
    if (!container) return;
    const btns = container.querySelectorAll('.star-btn');
    let current = 0;
    function paint(upto) {
      btns.forEach(b => {
        const on = Number(b.getAttribute('data-value')) <= upto;
        b.classList.toggle('star-filled', on);
        b.setAttribute('aria-checked', Number(b.getAttribute('data-value')) === upto ? 'true' : 'false');
      });
    }
    btns.forEach(b => {
      b.addEventListener('mouseenter', () => paint(Number(b.getAttribute('data-value'))));
      b.addEventListener('click', () => {
        current = Number(b.getAttribute('data-value'));
        paint(current);
        if (onChange) onChange(current);
      });
    });
    container.addEventListener('mouseleave', () => paint(current));
  }

  // ============================================================
  // 4b. SMART WAITING LIST MANAGEMENT PANEL (ADMIN ONLY)
  // ============================================================
  let wlState = {
    status: 'all',
    date: '',
    stylistId: '',
    search: '',
    showAddForm: false,
    viewMode: 'cards' // 'cards' or 'table'
  };

  async function renderWaitingListPanel() {
    const root = document.getElementById('waitingListPanel');
    if (!root) {
      console.warn('[Admin Dashboard] #waitingListPanel container not found in DOM.');
      return;
    }

    console.log('[Admin Dashboard] Waiting List tab activated — fetching data from /api/waiting-list...');
    root.innerHTML = '<p class="admin-panel-loading">Loading waiting list…</p>';

    let entries = [];
    let summary = { pending: 0, waiting_list: 0, notified: 0, booked: 0, cancelled: 0, total: 0 };
    let stylists = [];

    try {
      const qParams = new URLSearchParams();
      if (wlState.status && wlState.status !== 'all') qParams.set('status', wlState.status);
      if (wlState.date) qParams.set('date', wlState.date);
      if (wlState.stylistId) qParams.set('stylistId', wlState.stylistId);

      const endpoint = `/waiting-list${qParams.toString() ? `?${qParams.toString()}` : ''}`;
      console.log(`[Admin Dashboard] Fetching waiting list entries from: ${endpoint}`);

      const [wlData, stylData] = await Promise.all([
        api(endpoint),
        api('/stylists').catch(() => ({ stylists: [] }))
      ]);

      console.log('[Admin Dashboard] Waiting List data successfully received from /api/waiting-list:', wlData);

      entries = wlData.entries || wlData.data || wlData.waitingList || [];
      summary = wlData.summary || {
        pending: entries.filter(e => e.status === 'pending' || e.status === 'waiting_list').length,
        waiting_list: entries.filter(e => e.status === 'waiting_list').length,
        notified: entries.filter(e => e.status === 'notified').length,
        booked: entries.filter(e => e.status === 'booked').length,
        cancelled: entries.filter(e => e.status === 'cancelled').length,
        total: entries.length
      };
      stylists = (stylData && (stylData.stylists || stylData.data)) || [];
    } catch (err) {
      console.error('[Admin Dashboard] Error fetching /api/waiting-list:', err);

      // Fallback: check localStorage for any appointments marked waiting_list
      try {
        const rawLocal = localStorage.getItem('salon_appointments');
        const localApts = rawLocal ? JSON.parse(rawLocal) : [];
        const localWl = localApts.filter(a => a.status === 'waiting_list' || a.movedToWaitingList);
        if (localWl.length > 0) {
          console.log('[Admin Dashboard] Loaded fallback waiting list entries from local storage:', localWl);
          entries = localWl;
          summary = {
            pending: localWl.length,
            waiting_list: localWl.length,
            notified: 0,
            booked: 0,
            cancelled: 0,
            total: localWl.length
          };
        }
      } catch (_) {}

      if (entries.length === 0) {
        root.innerHTML = `<div class="ap-alert ap-alert-error" style="padding: 1rem; background: #FDECEA; color: #C53030; border-radius: 6px;">
          <strong>Failed to load Waiting List:</strong> ${escapeHtml(err.message)}
          <div style="margin-top:8px;">
            <button type="button" class="btn-admin-action" id="apWlRetryBtn">Retry</button>
          </div>
        </div>`;
        const retry = root.querySelector('#apWlRetryBtn');
        if (retry) retry.addEventListener('click', renderWaitingListPanel);
        return;
      }
    }

    // Filter by client-side search query
    let filtered = entries;
    if (wlState.search) {
      const s = wlState.search.toLowerCase();
      filtered = filtered.filter(e =>
        (e.clientName || e.client_name || e.name || '').toLowerCase().includes(s) ||
        (e.clientPhone || e.client_phone || e.phone || '').includes(s) ||
        (e.serviceName || e.service_name || e.service || '').toLowerCase().includes(s) ||
        (e.stylistName || '').toLowerCase().includes(s)
      );
    }

    console.log(`[Admin Dashboard] Rendering Waiting List UI (${filtered.length} entries to display in ${wlState.viewMode || 'cards'} view).`);

    root.innerHTML = `
      <div class="ap-panel-header">
        <div>
          <h3 class="ap-panel-title">Smart Waiting List &amp; Priority Release Queue</h3>
          <p class="ap-panel-subtitle">Manage queued clients for booked slots. When an appointment is cancelled, the system automatically tags and notifies the top matching waiting client.</p>
        </div>
        <div class="ap-panel-actions">
          <button type="button" class="btn-admin-action" id="apWlToggleAddBtn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>${wlState.showAddForm ? 'Hide Form' : 'Add to Queue'}</span>
          </button>
          <button type="button" class="btn-admin-action" id="apWlRefreshBtn" title="Refresh Waiting List">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- Quick Add Inline Form (Collapsible) -->
      <div id="apWlAddFormContainer" style="display: ${wlState.showAddForm ? 'block' : 'none'}; margin-bottom: 1.25rem;">
        <form class="ap-card" id="apWlAddForm" style="padding: 1.25rem; background: #FAF9F6; border: 1px solid var(--color-primary, #C5A880); border-radius: 8px;">
          <h4 style="margin: 0 0 12px; font-size: 0.95rem; font-weight: 700; color: #1F2937;">Add Client Directly to Waiting List</h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px;">
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Client Name *</label>
              <input type="text" name="clientName" class="form-input" style="padding: 8px 10px; font-size: 0.85rem;" placeholder="e.g. Ruwanthi Perera" required>
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Client Phone *</label>
              <input type="tel" name="clientPhone" class="form-input" style="padding: 8px 10px; font-size: 0.85rem;" placeholder="e.g. 0771234567" required>
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Client Email</label>
              <input type="email" name="clientEmail" class="form-input" style="padding: 8px 10px; font-size: 0.85rem;" placeholder="optional@example.com">
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Preferred Date *</label>
              <input type="date" name="preferredDate" class="form-input" style="padding: 8px 10px; font-size: 0.85rem;" required>
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Preferred Time Slot *</label>
              <input type="text" name="preferredTimeSlot" class="form-input" style="padding: 8px 10px; font-size: 0.85rem;" placeholder="e.g. 10:30 AM - 11:15 AM" required>
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Stylist Preference</label>
              <select name="stylistId" class="form-input form-select" style="padding: 8px 10px; font-size: 0.85rem;">
                <option value="">Any Stylist</option>
                ${stylists.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Service Name</label>
              <input type="text" name="serviceName" class="form-input" style="padding: 8px 10px; font-size: 0.85rem;" placeholder="e.g. Hair Cut / Bridal">
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Special Notes</label>
              <input type="text" name="notes" class="form-input" style="padding: 8px 10px; font-size: 0.85rem;" placeholder="e.g. Flexible after 2 PM">
            </div>
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button type="button" class="btn-admin-action" id="apWlCancelAddBtn">Cancel</button>
            <button type="submit" class="btn-admin-action" style="background: var(--color-primary, #8B6F47); color: #FFF;">Save to Waiting List</button>
          </div>
        </form>
      </div>

      <!-- KPI Metrics Ribbon -->
      <div class="ap-kpi-grid" style="margin-bottom: 1.25rem;">
        <div class="ap-kpi-card">
          <span class="ap-kpi-label">Total In Queue</span>
          <span class="ap-kpi-value">${summary.total || 0}</span>
        </div>
        <div class="ap-kpi-card" style="border-left: 3px solid #D97706;">
          <span class="ap-kpi-label">Pending / Waiting</span>
          <span class="ap-kpi-value" style="color: #D97706;">${summary.pending || 0}</span>
        </div>
        <div class="ap-kpi-card" style="border-left: 3px solid #2563EB;">
          <span class="ap-kpi-label">Slot Notified</span>
          <span class="ap-kpi-value" style="color: #2563EB;">${summary.notified || 0}</span>
        </div>
        <div class="ap-kpi-card" style="border-left: 3px solid #16A34A;">
          <span class="ap-kpi-label">Assigned / Booked</span>
          <span class="ap-kpi-value" style="color: #16A34A;">${summary.booked || 0}</span>
        </div>
        <div class="ap-kpi-card" style="border-left: 3px solid #9CA3AF;">
          <span class="ap-kpi-label">Cancelled / Expired</span>
          <span class="ap-kpi-value" style="color: #6B7280;">${summary.cancelled || 0}</span>
        </div>
      </div>

      <!-- Filter Toolbar with View Mode Toggle -->
      <div class="ap-wl-toolbar">
        <div class="admin-tabs" role="tablist">
          <button type="button" class="admin-tab ${wlState.status === 'all' ? 'active' : ''}" data-wl-status="all">All (${summary.total || 0})</button>
          <button type="button" class="admin-tab ${wlState.status === 'pending' || wlState.status === 'waiting_list' ? 'active' : ''}" data-wl-status="pending">Pending (${summary.pending || 0})</button>
          <button type="button" class="admin-tab ${wlState.status === 'notified' ? 'active' : ''}" data-wl-status="notified">Notified (${summary.notified || 0})</button>
          <button type="button" class="admin-tab ${wlState.status === 'booked' ? 'active' : ''}" data-wl-status="booked">Booked (${summary.booked || 0})</button>
          <button type="button" class="admin-tab ${wlState.status === 'cancelled' ? 'active' : ''}" data-wl-status="cancelled">Cancelled (${summary.cancelled || 0})</button>
        </div>

        <div class="ap-wl-filters">
          <input type="date" id="apWlFilterDate" class="form-input" style="padding: 5px 10px; font-size: 0.8rem; width: 140px;" value="${wlState.date}" title="Filter by date">
          <select id="apWlFilterStylist" class="form-input form-select" style="padding: 5px 10px; font-size: 0.8rem; width: 160px;" title="Filter by stylist">
            <option value="">All Stylists</option>
            ${stylists.map(s => `<option value="${s.id}" ${String(wlState.stylistId) === String(s.id) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
          ${(wlState.status !== 'all' || wlState.date || wlState.stylistId || wlState.search) ? `
            <button type="button" class="btn-admin-action" id="apWlClearFilters" style="padding: 5px 8px; font-size: 0.75rem;" title="Reset all filters">✕ Clear</button>
          ` : ''}
        </div>

        <div class="ap-wl-search">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="apWlSearchInput" placeholder="Search client, phone, service..." value="${escapeHtml(wlState.search)}">
        </div>

        <!-- View Mode Toggle (Cards vs Table) -->
        <div style="display: flex; gap: 4px; align-items: center;">
          <button type="button" class="btn-admin-action ${wlState.viewMode === 'cards' ? 'active' : ''}" id="apWlViewCardsBtn" style="padding: 5px 9px; font-size: 0.75rem; font-weight: 600;" title="Card View">
            Cards
          </button>
          <button type="button" class="btn-admin-action ${wlState.viewMode === 'table' ? 'active' : ''}" id="apWlViewTableBtn" style="padding: 5px 9px; font-size: 0.75rem; font-weight: 600;" title="Table View">
            Table
          </button>
        </div>
      </div>

      <!-- Main Waiting List Content (Dynamic Table or Cards) -->
      ${filtered.length === 0 ? `
        <div style="text-align: center; padding: 2.5rem 1rem; background: #FFF; border: 1px dashed var(--color-border, #E5E7EB); border-radius: 8px;">
          <p style="font-size: 1rem; font-weight: 600; color: #4B5563; margin-bottom: 4px;">No waiting list clients found</p>
          <p style="font-size: 0.8125rem; color: #9CA3AF; margin: 0;">
            ${(wlState.status !== 'all' || wlState.date || wlState.stylistId || wlState.search) ? 'Try clearing your filters or search term.' : 'When clients request a fully booked slot or appointments are moved to the waiting list, they will appear here.'}
          </p>
        </div>
      ` : wlState.viewMode === 'table' ? `
        <!-- Table View -->
        <div class="ap-table-wrap">
          <table class="ap-table">
            <thead>
              <tr>
                <th style="width: 45px;">Queue</th>
                <th>Client Name</th>
                <th>Service</th>
                <th>Date</th>
                <th>Time Slot</th>
                <th>Phone</th>
                <th>Stylist</th>
                <th>Status</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(item => {
                const name = item.clientName || item.client_name || item.name || 'Anonymous Client';
                const phone = item.clientPhone || item.client_phone || item.phone || 'N/A';
                const email = item.clientEmail || item.client_email || item.email || '';
                const date = item.preferredDate || item.preferred_date || item.appointment_date || item.date || 'N/A';
                const slot = item.preferredTimeSlot || item.preferred_time_slot || item.time_slot || item.time || 'Any Time';
                const stylistName = item.stylistName || item.stylist_name || 'Any Stylist';
                const serviceName = item.serviceName || item.service_name || item.service || 'General Service';
                const status = item.status || 'pending';
                const pos = item.queuePosition || 1;
                const notes = item.notes || '';

                return `
                  <tr data-wlid="${item.id}" class="status-${escapeHtml(status)}">
                    <td><span class="ap-wl-queue-badge">#${pos}</span></td>
                    <td>
                      <span class="ap-wl-client-name">${escapeHtml(name)}</span>
                      ${email ? `<br><small style="color: #6B7280;">${escapeHtml(email)}</small>` : ''}
                      ${notes ? `<br><small style="color: #8B6F47; font-style: italic;">“${escapeHtml(notes)}”</small>` : ''}
                    </td>
                    <td><span style="font-weight: 600; color: #1F2937;">${escapeHtml(serviceName)}</span></td>
                    <td><span style="font-weight: 600;">${escapeHtml(date)}</span></td>
                    <td><span style="font-weight: 600; color: #1F2937;">${escapeHtml(slot)}</span></td>
                    <td><a href="tel:${escapeHtml(phone)}" style="color: inherit; text-decoration: underline;">${escapeHtml(phone)}</a></td>
                    <td>${escapeHtml(stylistName)}</td>
                    <td><span class="ap-badge ap-badge-${escapeHtml(status)}">${escapeHtml(status.toUpperCase())}</span></td>
                    <td style="text-align: right;">
                      <div style="display: flex; gap: 4px; justify-content: flex-end; align-items: center;">
                        <button type="button" class="btn-wl-notify ap-wl-action-notify" style="padding: 4px 8px; font-size: 0.72rem;" title="Notify Client">Notify</button>
                        ${status !== 'booked' ? `
                          <button type="button" class="btn-wl-assign ap-wl-action-assign" style="padding: 4px 8px; font-size: 0.72rem;" title="Assign Slot & Book">Book</button>
                        ` : ''}
                        <select class="form-input form-select ap-wl-status-select" style="padding: 3px 5px; font-size: 0.72rem; width: 95px;">
                          <option value="pending" ${status === 'pending' || status === 'waiting_list' ? 'selected' : ''}>Pending</option>
                          <option value="notified" ${status === 'notified' ? 'selected' : ''}>Notified</option>
                          <option value="booked" ${status === 'booked' ? 'selected' : ''}>Booked</option>
                          <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                        <button type="button" class="btn-admin-action btn-danger-ghost ap-wl-action-delete" style="padding: 4px 7px; font-size: 0.72rem;" title="Remove">✕</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <!-- Cards View -->
        <div class="ap-wl-list">
          ${filtered.map(item => {
            const name = item.clientName || item.client_name || item.name || 'Anonymous Client';
            const phone = item.clientPhone || item.client_phone || item.phone || 'N/A';
            const email = item.clientEmail || item.client_email || item.email || '';
            const date = item.preferredDate || item.preferred_date || item.appointment_date || item.date || 'N/A';
            const slot = item.preferredTimeSlot || item.preferred_time_slot || item.time_slot || item.time || 'Any Time';
            const stylistName = item.stylistName || item.stylist_name || 'Any Stylist';
            const serviceName = item.serviceName || item.service_name || item.service || 'General Service';
            const status = item.status || 'pending';
            const pos = item.queuePosition || 1;
            const createdAt = item.createdAt || item.created_at || '';
            const notifiedAt = item.notifiedAt || item.notified_at || '';
            const notes = item.notes || '';

            return `
              <div class="ap-wl-card status-${escapeHtml(status)}" data-wlid="${item.id}">
                <div class="ap-wl-head">
                  <span class="ap-wl-queue-badge">#${pos} in line</span>
                  <span class="ap-wl-client-name">${escapeHtml(name)}</span>
                  <span class="ap-badge ap-badge-${escapeHtml(status)}">${escapeHtml(status.toUpperCase())}</span>
                  <span style="font-size: 0.75rem; color: #6B7280; margin-left: auto;">
                    Requested: ${escapeHtml(String(createdAt).slice(0, 16).replace('T', ' '))}
                  </span>
                </div>

                <div class="ap-wl-meta">
                  <div class="ap-wl-meta-item">
                    <strong>📞 Phone:</strong>
                    <a href="tel:${escapeHtml(phone)}" style="color:inherit; text-decoration:underline;">${escapeHtml(phone)}</a>
                  </div>
                  ${email ? `
                    <div class="ap-wl-meta-item">
                      <strong>✉️ Email:</strong>
                      <a href="mailto:${escapeHtml(email)}" style="color:inherit; text-decoration:underline;">${escapeHtml(email)}</a>
                    </div>
                  ` : ''}
                  <div class="ap-wl-meta-item">
                    <strong>📅 Date:</strong> <span style="font-weight:600; color:#1F2937;">${escapeHtml(date)}</span>
                  </div>
                  <div class="ap-wl-meta-item">
                    <strong>⏰ Slot:</strong> <span style="font-weight:600; color:#1F2937;">${escapeHtml(slot)}</span>
                  </div>
                  <div class="ap-wl-meta-item">
                    <strong>✂️ Stylist:</strong> ${escapeHtml(stylistName)}
                  </div>
                  <div class="ap-wl-meta-item">
                    <strong>💆 Service:</strong> <span style="font-weight:600; color:#1F2937;">${escapeHtml(serviceName)}</span>
                  </div>
                  ${notifiedAt ? `
                    <div class="ap-wl-meta-item" style="color: #2563EB;">
                      <strong>📣 Notified:</strong> ${escapeHtml(String(notifiedAt).slice(0, 16).replace('T', ' '))}
                    </div>
                  ` : ''}
                </div>

                ${notes ? `
                  <div class="ap-wl-notes">
                    <strong>Notes:</strong> “${escapeHtml(notes)}”
                  </div>
                ` : ''}

                <div class="ap-wl-actions">
                  <!-- Action 1: Notify Client -->
                  <button type="button" class="btn-wl-notify ap-wl-action-notify" title="Send slot-available notification alert to client">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    <span>Notify Slot Available</span>
                  </button>

                  <!-- Action 2: Assign Slot & Create Real Appointment -->
                  ${status !== 'booked' ? `
                    <button type="button" class="btn-wl-assign ap-wl-action-assign" title="Assign slot to client and convert to booked appointment">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>Assign Slot &amp; Book</span>
                    </button>
                  ` : `
                    <span style="font-size:0.75rem; color:#16A34A; font-weight:600;">✓ Appointment Booked</span>
                  `}

                  <!-- Action 3: Status Quick Change -->
                  <div style="display:inline-flex; align-items:center; gap:4px; margin-left:auto;">
                    <span style="font-size:0.75rem; color:#6B7280;">Status:</span>
                    <select class="form-input form-select ap-wl-status-select" style="padding: 3px 8px; font-size: 0.75rem; width: 110px;">
                      <option value="pending" ${status === 'pending' || status === 'waiting_list' ? 'selected' : ''}>Pending</option>
                      <option value="notified" ${status === 'notified' ? 'selected' : ''}>Notified</option>
                      <option value="booked" ${status === 'booked' ? 'selected' : ''}>Booked</option>
                      <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                  </div>

                  <!-- Action 4: Delete Entry -->
                  <button type="button" class="btn-admin-action btn-danger-ghost ap-wl-action-delete" style="padding: 4px 8px; font-size: 0.75rem;" title="Remove from waiting list">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    `;

    console.log(`[Admin Dashboard] Waiting List successfully rendered (${filtered.length} entries dynamically populated).`);

    // -------------------------------------------------------- Event Listeners
    // Refresh
    const refreshBtn = root.querySelector('#apWlRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => renderWaitingListPanel());

    // Toggle Add Form
    const toggleAddBtn = root.querySelector('#apWlToggleAddBtn');
    if (toggleAddBtn) {
      toggleAddBtn.addEventListener('click', () => {
        wlState.showAddForm = !wlState.showAddForm;
        const c = root.querySelector('#apWlAddFormContainer');
        if (c) c.style.display = wlState.showAddForm ? 'block' : 'none';
        toggleAddBtn.querySelector('span').textContent = wlState.showAddForm ? 'Hide Form' : 'Add to Queue';
      });
    }

    const cancelAddBtn = root.querySelector('#apWlCancelAddBtn');
    if (cancelAddBtn) {
      cancelAddBtn.addEventListener('click', () => {
        wlState.showAddForm = false;
        const c = root.querySelector('#apWlAddFormContainer');
        if (c) c.style.display = 'none';
        if (toggleAddBtn) toggleAddBtn.querySelector('span').textContent = 'Add to Queue';
      });
    }

    // View Mode Toggle Listeners
    const cardsBtn = root.querySelector('#apWlViewCardsBtn');
    const tableBtn = root.querySelector('#apWlViewTableBtn');
    if (cardsBtn) {
      cardsBtn.addEventListener('click', () => {
        if (wlState.viewMode !== 'cards') {
          wlState.viewMode = 'cards';
          renderWaitingListPanel();
        }
      });
    }
    if (tableBtn) {
      tableBtn.addEventListener('click', () => {
        if (wlState.viewMode !== 'table') {
          wlState.viewMode = 'table';
          renderWaitingListPanel();
        }
      });
    }

    // Add Form Submit
    const addForm = root.querySelector('#apWlAddForm');
    if (addForm) {
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(addForm);
        const payload = {
          clientName: fd.get('clientName'),
          clientPhone: fd.get('clientPhone'),
          clientEmail: fd.get('clientEmail'),
          preferredDate: fd.get('preferredDate'),
          preferredTimeSlot: fd.get('preferredTimeSlot'),
          stylistId: fd.get('stylistId') ? Number(fd.get('stylistId')) : null,
          serviceName: fd.get('serviceName'),
          notes: fd.get('notes')
        };
        try {
          const res = await api('/waiting-list', { method: 'POST', body: JSON.stringify(payload) });
          alert(res.message || 'Client added to waiting list successfully!');
          wlState.showAddForm = false;
          await renderWaitingListPanel();
        } catch (err) {
          alert('Failed to add client: ' + err.message);
        }
      });
    }

    // Status Filter Tabs
    root.querySelectorAll('[data-wl-status]').forEach(tab => {
      tab.addEventListener('click', () => {
        wlState.status = tab.getAttribute('data-wl-status');
        renderWaitingListPanel();
      });
    });

    // Date Filter
    const dateInput = root.querySelector('#apWlFilterDate');
    if (dateInput) {
      dateInput.addEventListener('change', () => {
        wlState.date = dateInput.value;
        renderWaitingListPanel();
      });
    }

    // Stylist Filter
    const stylistSelect = root.querySelector('#apWlFilterStylist');
    if (stylistSelect) {
      stylistSelect.addEventListener('change', () => {
        wlState.stylistId = stylistSelect.value;
        renderWaitingListPanel();
      });
    }

    // Clear Filters
    const clearBtn = root.querySelector('#apWlClearFilters');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        wlState.status = 'all';
        wlState.date = '';
        wlState.stylistId = '';
        wlState.search = '';
        renderWaitingListPanel();
      });
    }

    // Search Input (Real-time debounce)
    const searchInput = root.querySelector('#apWlSearchInput');
    if (searchInput) {
      let timeout = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          wlState.search = searchInput.value.trim();
          renderWaitingListPanel();
        }, 250);
      });
    }

    // Card/Row Action 1: Notify
    root.querySelectorAll('.ap-wl-action-notify').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemEl = btn.closest('[data-wlid]');
        if (!itemEl) return;
        const id = itemEl.getAttribute('data-wlid');
        btn.disabled = true;
        try {
          const res = await api(`/waiting-list/${id}/notify`, { method: 'POST' });
          alert(res.message || 'Slot-available alert sent to client!');
          await renderWaitingListPanel();
        } catch (err) {
          alert('Notification failed: ' + err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Card/Row Action 2: Assign Slot & Book
    root.querySelectorAll('.ap-wl-action-assign').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemEl = btn.closest('[data-wlid]');
        if (!itemEl) return;
        const id = itemEl.getAttribute('data-wlid');
        if (!confirm('Assign this slot to the waiting client and create a confirmed salon appointment?')) return;
        btn.disabled = true;
        try {
          const res = await api(`/waiting-list/${id}/assign`, { method: 'POST' });
          alert(res.message || 'Slot successfully assigned and booked!');
          window.dispatchEvent(new CustomEvent('salon:appointments_changed'));
          await renderWaitingListPanel();
        } catch (err) {
          alert('Slot assignment failed: ' + err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Card/Row Action 3: Status Select Change
    root.querySelectorAll('.ap-wl-status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const itemEl = sel.closest('[data-wlid]');
        if (!itemEl) return;
        const id = itemEl.getAttribute('data-wlid');
        const newStatus = sel.value;
        try {
          await api(`/waiting-list/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
          });
          await renderWaitingListPanel();
        } catch (err) {
          alert('Failed to update status: ' + err.message);
          await renderWaitingListPanel();
        }
      });
    });

    // Card/Row Action 4: Delete Entry
    root.querySelectorAll('.ap-wl-action-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemEl = btn.closest('[data-wlid]');
        if (!itemEl) return;
        const id = itemEl.getAttribute('data-wlid');
        if (!confirm('Remove this client from the waiting list?')) return;
        try {
          await api(`/waiting-list/${id}`, { method: 'DELETE' });
          await renderWaitingListPanel();
        } catch (err) {
          alert('Failed to remove entry: ' + err.message);
        }
      });
    });
  }

  // ============================================================
  // 4B. CLIENTS MANAGEMENT & SERVICE HISTORY CRM
  // ============================================================
  let clientsCache = [];
  let clientSearchQuery = '';

  async function renderClientsPanel() {
    const root = panelRoot('clientsPanel');
    if (!root) return;
    root.innerHTML = '<p class="admin-panel-loading">Loading registered clients directory…</p>';
    try {
      const queryParam = clientSearchQuery ? `?search=${encodeURIComponent(clientSearchQuery)}` : '';
      const data = await api(`/clients${queryParam}`);
      clientsCache = data.clients || [];
      drawClients(root);
    } catch (err) {
      panelError(root, err);
    }
  }

  function drawClients(root) {
    const totalClients = clientsCache.length;
    const totalVisitsCount = clientsCache.reduce((acc, c) => acc + (Number(c.totalVisits) || 0), 0);

    let html = `
      <div class="ap-clients-header" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 20px; padding: 14px 18px; background: #ffffff; border: 1px solid #e2d9c8; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
        <div class="ap-clients-intro">
          <h3 style="margin: 0 0 4px; font-size: 1.1rem; color: #1e293b; font-family: var(--font-serif, 'Playfair Display', serif); font-weight: 700;">
            Client Management Directory
          </h3>
          <p style="margin: 0; font-size: 0.85rem; color: #475569;">
            ${totalClients} registered customer${totalClients === 1 ? '' : 's'} &bull; ${totalVisitsCount} aggregate salon visit${totalVisitsCount === 1 ? '' : 's'} recorded
          </p>
        </div>
        <div class="ap-clients-search-box" style="display: flex; align-items: center; gap: 8px;">
          <input type="text" id="apClientsSearchInput" class="form-input" placeholder="Search by name, phone, or email..." value="${escapeHtml(clientSearchQuery)}" style="padding: 7px 12px; font-size: 0.88rem; width: 260px; border-radius: 6px;">
          <button type="button" class="btn-admin-action" id="apClientsSearchBtn" style="padding: 7px 14px; font-size: 0.85rem; white-space: nowrap;">Search</button>
          ${clientSearchQuery ? '<button type="button" class="btn-admin-action" id="apClientsResetBtn" style="padding: 7px 10px; font-size: 0.85rem;">Clear</button>' : ''}
        </div>
      </div>
    `;

    if (clientsCache.length === 0) {
      html += `
        <div class="admin-panel-empty" style="text-align: center; padding: 40px 20px; background: #fafaf8; border-radius: 8px; border: 1px dashed #c8bfb0;">
          <p style="font-size: 1rem; color: #374151; margin-bottom: 6px; font-weight: 500;">No clients found${clientSearchQuery ? ` matching "<em>${escapeHtml(clientSearchQuery)}</em>"` : ''}.</p>
          <span style="font-size: 0.85rem; color: #6b7280;">Registered customers and appointment bookers will automatically appear in this directory.</span>
        </div>
      `;
      root.innerHTML = html;
      bindClientsEvents(root);
      return;
    }

    html += `
      <div class="ap-table-wrap">
        <table class="ap-table" style="min-width: 700px;">
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Phone Number</th>
              <th>Email Address</th>
              <th style="text-align: center;">Total Visits</th>
              <th>Last Visit</th>
              <th style="text-align: right;">Service History</th>
            </tr>
          </thead>
          <tbody>
    `;

    clientsCache.forEach(client => {
      const visits = Number(client.totalVisits) || 0;
      const lastVisit = client.lastVisitDate
        ? `<span style="color:#374151; font-weight:500;">${escapeHtml(client.lastVisitDate)}</span>`
        : '<span style="color:#9ca3af;">—</span>';
      const phone = client.phone
        ? `<span style="color:#1e293b; font-weight:500;">${escapeHtml(client.phone)}</span>`
        : '<span style="color:#9ca3af; font-style:italic;">Not provided</span>';
      const email = client.email
        ? `<span style="color:#334155;">${escapeHtml(client.email)}</span>`
        : '<span style="color:#9ca3af; font-style:italic;">Not provided</span>';

      // Visits badge: green for frequent visitors, amber for occasional
      const badgeStyle = visits > 2
        ? 'background:#dcfce7; color:#166534; border:1px solid #bbf7d0;'
        : 'background:#fef9c3; color:#854d0e; border:1px solid #fde68a;';

      html += `
        <tr class="ap-client-row" data-client-id="${client.id}" style="cursor:pointer;">
          <td style="font-weight:600; color:#1e293b;">
            <div style="display:flex; align-items:center; gap:9px;">
              <span style="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:50%; background:#f0e9df; color:#a88555; font-size:0.8rem; font-weight:700; flex-shrink:0; border:1px solid #e2d9c8;">
                ${escapeHtml((client.name || 'C').charAt(0).toUpperCase())}
              </span>
              <span style="color:#0f172a;">${escapeHtml(client.name || 'Valued Client')}</span>
            </div>
          </td>
          <td>${phone}</td>
          <td style="font-size:0.875rem;">${email}</td>
          <td style="text-align:center;">
            <span style="display:inline-block; padding:3px 10px; border-radius:12px; font-size:0.78rem; font-weight:700; ${badgeStyle}">
              ${visits} visit${visits === 1 ? '' : 's'}
            </span>
          </td>
          <td>${lastVisit}</td>
          <td style="text-align:right;">
            <button type="button" class="btn-admin-action ap-view-history-btn" data-client-id="${client.id}" style="padding:5px 14px; font-size:0.82rem; background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8; border-radius:6px; cursor:pointer; font-weight:600; white-space:nowrap;">
              View History
            </button>
          </td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    root.innerHTML = html;
    bindClientsEvents(root);
  }

  function bindClientsEvents(root) {
    const searchInput = root.querySelector('#apClientsSearchInput');
    const searchBtn = root.querySelector('#apClientsSearchBtn');
    const resetBtn = root.querySelector('#apClientsResetBtn');

    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', () => {
        clientSearchQuery = searchInput.value.trim();
        renderClientsPanel();
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clientSearchQuery = searchInput.value.trim();
          renderClientsPanel();
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        clientSearchQuery = '';
        renderClientsPanel();
      });
    }

    // Row click & "View History" button click
    root.querySelectorAll('.ap-view-history-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = btn.getAttribute('data-client-id');
        if (cid) openClientHistoryModal(cid);
      });
    });

    root.querySelectorAll('.ap-client-row').forEach(row => {
      row.addEventListener('click', () => {
        const cid = row.getAttribute('data-client-id');
        if (cid) openClientHistoryModal(cid);
      });
    });
  }

  // ============================================================
  // CLIENT SERVICE HISTORY MODAL (DRAWER / POPUP)
  // ============================================================
  const clientHistoryModalOverlay = document.getElementById('clientHistoryModalOverlay');
  const clientHistoryModalClose = document.getElementById('clientHistoryModalClose');
  const clientHistoryModalBody = document.getElementById('clientHistoryModalBody');
  const clientHistoryModalTitle = document.getElementById('clientHistoryModalTitle');
  const clientHistoryModalSubtitle = document.getElementById('clientHistoryModalSubtitle');

  function closeClientHistoryModal() {
    if (!clientHistoryModalOverlay) return;
    clientHistoryModalOverlay.classList.remove('show');
    clientHistoryModalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (clientHistoryModalClose) {
    clientHistoryModalClose.addEventListener('click', closeClientHistoryModal);
  }

  if (clientHistoryModalOverlay) {
    clientHistoryModalOverlay.addEventListener('click', (e) => {
      if (e.target === clientHistoryModalOverlay) closeClientHistoryModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && clientHistoryModalOverlay && clientHistoryModalOverlay.classList.contains('show')) {
      closeClientHistoryModal();
    }
  });

  async function openClientHistoryModal(clientId) {
    if (!clientHistoryModalOverlay || !clientHistoryModalBody) return;

    // Show modal in loading state
    clientHistoryModalOverlay.classList.add('show');
    clientHistoryModalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    if (clientHistoryModalTitle) clientHistoryModalTitle.textContent = 'Client Service History';
    if (clientHistoryModalSubtitle) clientHistoryModalSubtitle.textContent = 'Fetching appointment and service records…';
    clientHistoryModalBody.innerHTML = '<p class="admin-panel-loading" style="padding: 24px; text-align: center; color: #475569;">Loading service history…</p>';

    try {
      const data = await api(`/clients/${clientId}`);
      const client = data.client || {};
      const history = data.history || data.visits || [];

      if (clientHistoryModalTitle) {
        clientHistoryModalTitle.textContent = `${client.name || 'Client'} — Service History`;
      }
      if (clientHistoryModalSubtitle) {
        clientHistoryModalSubtitle.innerHTML = `Phone: <strong>${escapeHtml(client.phone || 'N/A')}</strong> &bull; Email: <strong>${escapeHtml(client.email || 'N/A')}</strong> &bull; Total Recorded Visits: <strong>${history.length}</strong>`;
      }

      let modalHtml = `
        <!-- Client Quick Profile Bar -->
        <div class="ap-client-profile-card" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; padding: 16px; background: #f8f5f0; border: 1px solid #e2d9c8; border-radius: 10px;">
          <div>
            <span style="font-size: 0.7rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.06em; font-weight: 600;">Client Full Name</span>
            <div style="font-size: 1rem; font-weight: 700; color: #0f172a; margin-top: 3px;">${escapeHtml(client.name || 'Valued Customer')}</div>
          </div>
          <div>
            <span style="font-size: 0.7rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.06em; font-weight: 600;">Contact Info</span>
            <div style="font-size: 0.875rem; color: #1e293b; margin-top: 3px; font-weight: 500;">
              ${escapeHtml(client.phone || 'No phone')}
              <span style="color:#94a3b8; margin: 0 4px;">|</span>
              ${escapeHtml(client.email || 'No email')}
            </div>
          </div>
          <div>
            <span style="font-size: 0.7rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.06em; font-weight: 600;">Lifetime Visits</span>
            <div style="font-size: 1.1rem; font-weight: 700; color: #a88555; margin-top: 3px;">${history.length} visit${history.length === 1 ? '' : 's'}</div>
          </div>
        </div>

        <!-- Notes, Allergies & Formulas (if any) -->
        <div class="ap-client-notes-card" style="margin-bottom: 22px; padding: 14px 16px; background: #fffbeb; border-left: 3px solid #c5a880; border-radius: 0 8px 8px 0; border-top: 1px solid #fde68a; border-right: 1px solid #fde68a; border-bottom: 1px solid #fde68a;">
          <strong style="font-size: 0.8rem; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 8px;">Client Medical Notes &amp; Allergies</strong>
          <div style="font-size: 0.875rem; line-height: 1.6; color: #374151;">
            ${client.allergies
              ? `<p style="margin: 0 0 6px;"><strong style="color:#b91c1c;">Known Allergies:</strong> ${escapeHtml(client.allergies)}</p>`
              : '<p style="margin: 0 0 6px; color:#6b7280; font-style:italic;">No known chemical/product allergies recorded.</p>'}
            ${client.colorFormulaNotes ? `<p style="margin: 0 0 6px;"><strong style="color:#0369a1;">Hair Color Formula:</strong> ${escapeHtml(client.colorFormulaNotes)}</p>` : ''}
            ${client.generalNotes ? `<p style="margin: 0;"><strong style="color:#374151;">General Preferences:</strong> ${escapeHtml(client.generalNotes)}</p>` : ''}
          </div>
        </div>
      `;

      // Appointments / Service History Listing
      modalHtml += `
        <h4 style="margin: 0 0 12px; font-size: 1rem; font-weight: 700; color: #1e293b; display: flex; align-items: center; justify-content: space-between;">
          <span>Past Appointments &amp; Services Taken</span>
          <span style="font-size: 0.8rem; font-weight: 500; color: #64748b;">${history.length} record${history.length === 1 ? '' : 's'} found</span>
        </h4>
      `;

      if (history.length === 0) {
        modalHtml += `
          <div style="text-align: center; padding: 32px 16px; background: #fafaf8; border-radius: 8px; border: 1px dashed #c8bfb0;">
            <p style="color: #374151; margin: 0 0 4px; font-size: 0.95rem; font-weight: 500;">No past appointments or services found for this customer.</p>
            <span style="font-size: 0.82rem; color: #6b7280;">New bookings confirmed through the salon booking flow will link here automatically.</span>
          </div>
        `;
      } else {
        modalHtml += `
          <div class="ap-table-wrap">
            <table class="ap-table" style="min-width: 680px;">
              <thead>
                <tr>
                  <th>Booking Code</th>
                  <th>Date &amp; Time Slot</th>
                  <th>Service Taken</th>
                  <th>Stylist</th>
                  <th style="text-align:center;">Status</th>
                  <th>Invoice</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
        `;

        history.forEach((item, index) => {
          const dateStr = item.date || item.appointmentDate || '—';
          const slotStr = item.timeSlot || '—';
          const svcName = item.service || item.serviceName || 'General Styling';
          const svcPrice = item.servicePrice ? fmtMoney(item.servicePrice) : '';
          const stylist = item.stylistName || 'Any Stylist';
          const status = (item.status || 'pending').toLowerCase();
          const visitStatus = (item.visitStatus || '').toLowerCase();
          const notes = item.customerNotes || item.adminNote || '—';
          const displayStatus = visitStatus === 'completed' ? 'Completed' : status;

          // Status badges — all dark text on pale colour backgrounds for light modal
          let badgeStyle = 'background:#fef9c3; color:#854d0e; border:1px solid #fde68a;'; // pending
          if (visitStatus === 'completed') {
            badgeStyle = 'background:#dcfce7; color:#166534; border:1px solid #bbf7d0;';
          } else if (status === 'confirmed') {
            badgeStyle = 'background:#d1fae5; color:#065f46; border:1px solid #a7f3d0;';
          } else if (status === 'cancelled') {
            badgeStyle = 'background:#fee2e2; color:#991b1b; border:1px solid #fca5a5;';
          } else if (status === 'review') {
            badgeStyle = 'background:#dbeafe; color:#1e40af; border:1px solid #93c5fd;';
          } else if (status === 'waiting_list') {
            badgeStyle = 'background:#ede9fe; color:#5b21b6; border:1px solid #c4b5fd;';
          }

          modalHtml += `
            <tr>
              <td style="font-weight: 700; color: #1d4ed8; white-space: nowrap; font-size: 0.82rem;">
                ${escapeHtml(item.bookingCode || `#${item.id}`)}
              </td>
              <td style="white-space: nowrap;">
                <div style="font-weight: 600; color: #0f172a;">${escapeHtml(dateStr)}</div>
                <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">${escapeHtml(slotStr)}</div>
              </td>
              <td>
                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(svcName)}</div>
                ${svcPrice ? `<div style="font-size: 0.78rem; color: #a88555; font-weight: 600; margin-top: 2px;">${escapeHtml(svcPrice)}</div>` : ''}
              </td>
              <td style="color: #374151; white-space: nowrap; font-weight: 500;">${escapeHtml(stylist)}</td>
              <td style="text-align: center; white-space: nowrap;">
                <span style="display: inline-block; padding: 3px 9px; border-radius: 10px; font-size: 0.73rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; ${badgeStyle}">
                  ${escapeHtml(displayStatus)}
                </span>
              </td>
              <td style="white-space: nowrap;">
                <button type="button" class="btn-view-invoice ap-btn-view-invoice" data-idx="${index}" title="View and Print Invoice">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                  </svg>
                  View Invoice
                </button>
              </td>
              <td style="color: #475569; font-size: 0.82rem; max-width: 200px; line-height: 1.4;">
                ${escapeHtml(notes)}
              </td>
            </tr>
          `;
        });

        modalHtml += `
              </tbody>
            </table>
          </div>
        `;
      }

      clientHistoryModalBody.innerHTML = modalHtml;

      // Attach click listeners for View Invoice buttons in Service History
      clientHistoryModalBody.querySelectorAll('.btn-view-invoice').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          const item = history[idx] || {};
          const svcName = item.service || item.serviceName || 'General Styling';
          const priceMap = {
            'Bridal Styling': 15000,
            'Hair Coloring': 6500,
            'Hair Cut': 2500,
            'Hair Treatment': 4800,
            'Hair Styling': 3500,
            'Facial & Beauty Care': 4200
          };
          const priceVal = item.servicePrice || item.price || priceMap[svcName] || 3500;
          const invoiceData = {
            salon: {
              name: 'Salon Hair Bird',
              address: '123 Colombo Street, Colombo 07, Sri Lanka',
              phone: '077 123 4567',
              email: 'info@salonhairbird.com'
            },
            invoiceId: item.bookingCode ? (String(item.bookingCode).startsWith('INV-') ? item.bookingCode : `INV-${String(item.bookingCode).replace(/^#/, '')}`) : `INV-${item.id || Date.now()}`,
            clientName: client.name || item.clientName || 'Valued Customer',
            clientPhone: client.phone || item.clientPhone || '—',
            clientEmail: client.email || item.clientEmail || '—',
            serviceName: svcName,
            price: priceVal,
            date: item.date || item.appointmentDate || '—',
            timeSlot: item.timeSlot || '—',
            stylistName: item.stylistName || 'Salon Specialist',
            status: item.visitStatus === 'completed' ? 'COMPLETED' : ((item.status || 'CONFIRMED').toUpperCase()),
            notes: item.customerNotes || item.adminNote || ''
          };

          if (typeof window.openInvoiceModal === 'function') {
            window.openInvoiceModal(invoiceData);
          }
        });
      });
    } catch (err) {
      clientHistoryModalBody.innerHTML = `
        <div class="admin-panel-offline" style="padding: 24px; text-align: center;">
          <strong style="color: #b91c1c;">Could not load service history.</strong>
          <p style="margin: 6px 0 0; color: #475569;">${escapeHtml(err.message || err)}</p>
        </div>
      `;
    }
  }

  // ============================================================
  // 5. PUBLIC "RATE YOUR VISIT" FEEDBACK MODAL
  // ============================================================
  const feedbackModalOverlay = document.getElementById('feedbackModalOverlay');
  const feedbackModalClose = document.getElementById('feedbackModalClose');
  const publicFeedbackForm = document.getElementById('publicFeedbackForm');
  const feedbackFormAlert = document.getElementById('feedbackFormAlert');
  const fbBookingCode = document.getElementById('fbBookingCode');
  const fbRatingValue = document.getElementById('fbRatingValue');
  const fbNotes = document.getElementById('fbNotes');

  const fbPrefillBadge = document.getElementById('fbPrefillBadge');

  function openFeedbackModal(prefillCode) {
    if (!feedbackModalOverlay) return;
    if (prefillCode && fbBookingCode) {
      const cleanCode = String(prefillCode).trim();
      fbBookingCode.value = cleanCode;
      if (fbPrefillBadge) {
        fbPrefillBadge.innerHTML = `⭐ <strong>Verified Booking:</strong> Reviewing appointment <strong>#${escapeHtml(cleanCode)}</strong>. Please select your 1–5 star rating below!`;
        fbPrefillBadge.style.display = 'block';
      }
    } else if (fbPrefillBadge) {
      fbPrefillBadge.style.display = 'none';
      fbPrefillBadge.textContent = '';
    }
    feedbackModalOverlay.classList.add('show');
    feedbackModalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Auto-focus on rating stars or booking code
    setTimeout(() => {
      if (prefillCode) {
        const star5 = document.querySelector('#starRatingInput .star-btn[data-value="5"]');
        if (star5) star5.focus();
      } else if (fbBookingCode) {
        fbBookingCode.focus();
      }
    }, 120);
  }

  function closeFeedbackModal() {
    if (!feedbackModalOverlay) return;
    feedbackModalOverlay.classList.remove('show');
    feedbackModalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // Globally expose modal controllers for client portal / deep linking
  window.openFeedbackModal = openFeedbackModal;
  window.closeFeedbackModal = closeFeedbackModal;

  const footerRateLink = document.getElementById('footerRateVisitLink');
  if (footerRateLink) {
    footerRateLink.addEventListener('click', (e) => { e.preventDefault(); openFeedbackModal(); });
  }
  if (feedbackModalClose) feedbackModalClose.addEventListener('click', closeFeedbackModal);
  if (feedbackModalOverlay) {
    feedbackModalOverlay.addEventListener('click', (e) => {
      if (e.target === feedbackModalOverlay) closeFeedbackModal();
    });
  }

  // Automatic URL Capture: handles
  // - index.html#review-section?code=APT-58320
  // - index.html?code=APT-58320
  // - index.html#review-section
  // - index.html#rate=APT-58320
  // - index.html#feedback?code=APT-58320
  function captureReviewFromUrl() {
    let bookingCode = '';
    let shouldOpen = false;

    // 1. Check Query String in URL (?code=APT-58320 or ?bookingCode=...)
    if (window.location.search) {
      const sp = new URLSearchParams(window.location.search);
      const qCode = sp.get('code') || sp.get('bookingCode') || sp.get('booking_code') || sp.get('id');
      if (qCode) {
        bookingCode = qCode.trim();
        shouldOpen = true;
      }
    }

    // 2. Check Hash String (#review-section?code=APT-58320 or #rate=... etc.)
    const hash = window.location.hash || '';
    if (hash) {
      // Embedded query inside hash: #review-section?code=APT-58320 or #review?code=...
      if (hash.includes('?')) {
        const hashQuery = hash.split('?')[1];
        const hp = new URLSearchParams(hashQuery);
        const hCode = hp.get('code') || hp.get('bookingCode') || hp.get('id');
        if (hCode) {
          bookingCode = hCode.trim();
          shouldOpen = true;
        }
      }

      // Key-value pair in hash: #rate=APT-58320, #review=APT-58320, #code=APT-58320
      if (!bookingCode) {
        const kvMatch = hash.match(/#(?:rate|code|booking|review|feedback)=([^&?]+)/i);
        if (kvMatch) {
          bookingCode = decodeURIComponent(kvMatch[1]).trim();
          shouldOpen = true;
        }
      }

      // Check section trigger hashes: #review-section, #review, #feedback, #rate
      const cleanHash = hash.split('?')[0].toLowerCase();
      if (['#review-section', '#review', '#feedback', '#rate', '#testimonials-review'].includes(cleanHash)) {
        shouldOpen = true;
      }
    }

    if (shouldOpen) {
      openFeedbackModal(bookingCode);
    }
  }
  window.addEventListener('hashchange', captureReviewFromUrl);
  captureReviewFromUrl();

  if (publicFeedbackForm) {
    bindStarInput(document.getElementById('starRatingInput'), (val) => {
      if (fbRatingValue) fbRatingValue.value = val;
    });

    publicFeedbackForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = fbBookingCode ? fbBookingCode.value.trim() : '';
      const rating = fbRatingValue ? Number(fbRatingValue.value) : 0;
      const notes = fbNotes ? fbNotes.value.trim() : '';

      function showFbAlert(msg, ok) {
        if (!feedbackFormAlert) return;
        feedbackFormAlert.textContent = msg;
        feedbackFormAlert.className = `feedback-form-alert ${ok ? 'alert-success' : 'alert-error'}`;
        feedbackFormAlert.style.display = 'block';
      }

      if (!code) { showFbAlert('Please enter your booking code (e.g. APT-98241).', false); return; }
      if (!rating) { showFbAlert('Please select your star rating (1–5).', false); return; }

      const submitBtn = document.getElementById('fbSubmitBtn');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const data = await api('/feedback', {
          method: 'POST',
          body: JSON.stringify({ bookingCode: code, rating, notes })
        });
        showFbAlert(data.message || 'Thank you! Your review has been recorded.', true);
        publicFeedbackForm.reset();
        if (fbRatingValue) fbRatingValue.value = '';
        document.querySelectorAll('#starRatingInput .star-btn').forEach(b => b.classList.remove('star-filled'));
        setTimeout(closeFeedbackModal, 2500);
      } catch (err) {
        showFbAlert(err.message || 'Could not submit your review. Please try again.', false);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
});
