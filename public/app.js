const API = '/api';
let authToken = localStorage.getItem('flasmc_token');
let socket = null;

// ─── Translation / i18n ─────────────────────
const LANG = localStorage.getItem('flasmc_lang') || 'en';
let translations = {};

async function loadTranslations(lang) {
  try {
    const resp = await fetch(`/lang/${lang}.json`);
    if (resp.ok) translations = await resp.json();
  } catch {}
  applyTranslations();
}

function t(key, ...args) {
  let val = translations[key] || key;
  if (args.length) args.forEach((a, i) => { val = val.replace(`{${i}}`, a); });
  return val;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = t(key);
    } else {
      el.textContent = t(key);
    }
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-value]').forEach(el => {
    el.value = t(el.dataset.i18nValue);
  });
}

function switchLanguage(lang) {
  localStorage.setItem('flasmc_lang', lang);
  loadTranslations(lang);
}

loadTranslations(LANG);

document.getElementById('lang-select').value = LANG;
document.getElementById('lang-select-top').value = LANG;
document.getElementById('lang-select').addEventListener('change', (e) => switchLanguage(e.target.value));
document.getElementById('lang-select-top').addEventListener('change', (e) => { switchLanguage(e.target.value); document.getElementById('lang-select').value = e.target.value; });
let currentServers = [];
let currentServerId = null;
let serverRunning = false;
let cmdHistory = [];
let cmdHistoryIndex = -1;
let currentPlugins = [];
let pluginFilter = '';

// ─── Auth ────────────────────────────────────────
async function checkAuth() {
  const resp = await fetch(API + '/auth/status', {
    headers: authToken ? { 'x-auth-token': authToken } : {}
  });
  const data = await resp.json();
  if (data.authenticated) {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('top-bar-right').style.display = 'flex';
    if (!socket) initSocket();
    else if (socket.disconnected) socket.connect();
    loadServers();
    return true;
  } else {
    document.getElementById('auth-gate').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('top-bar-right').style.display = 'none';
    if (socket) { socket.disconnect(); socket = null; }
    document.getElementById('auth-form-login').style.display = '';
    document.getElementById('auth-form-setup').style.display = 'none';
    document.getElementById('auth-setup-link').style.display = data.needsSetup ? 'none' : '';
    if (data.needsSetup) {
      window.location.href = '/setup.html';
      return false;
    }
    return false;
  }
}

function initSocket() {
  socket = io({
    query: { token: authToken },
    extraHeaders: authToken ? { 'x-auth-token': authToken } : {}
  });
  setupSocketHandlers();
}

function apiWithAuth(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (authToken) opts.headers['x-auth-token'] = authToken;
  if (body) opts.body = JSON.stringify(body);
  return fetch(API + path, opts).then(r => r.json()).catch(() => ({ error: 'Network error' }));
}

// api() is defined later in this file and includes auth

document.getElementById('auth-login-btn').addEventListener('click', async () => {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!username || !password) { showAuthError('Enter username and password'); return; }
  const result = await apiWithAuth('POST', '/auth/login', { username, password });
  if (result.success) {
    authToken = result.token;
    localStorage.setItem('flasmc_token', authToken);
    checkAuth();
  } else {
    showAuthError(result.error || 'Login failed');
  }
});

document.getElementById('auth-setup-btn').addEventListener('click', async () => {
  const username = document.getElementById('setup-username').value.trim();
  const password = document.getElementById('setup-password').value;
  const confirm = document.getElementById('setup-password-confirm').value;
  document.getElementById('setup-error').style.display = 'none';
  if (!username) { showSetupError('Enter a username'); return; }
  if (password.length < 4) { showSetupError('Password must be at least 4 characters'); return; }
  if (password !== confirm) { showSetupError('Passwords do not match'); return; }
  const result = await apiWithAuth('POST', '/auth/setup', { username, password });
  if (result.success) {
    authToken = result.token;
    localStorage.setItem('flasmc_token', authToken);
    checkAuth();
  } else {
    showSetupError(result.error || 'Setup failed');
  }
});

document.getElementById('auth-show-setup').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('auth-form-login').style.display = 'none';
  document.getElementById('auth-form-setup').style.display = '';
});

document.getElementById('auth-show-login').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('auth-form-setup').style.display = 'none';
  document.getElementById('auth-form-login').style.display = '';
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await apiWithAuth('POST', '/auth/logout');
  localStorage.removeItem('flasmc_token');
  authToken = null;
  if (socket) { socket.disconnect(); socket = null; }
  document.getElementById('app').classList.add('hidden');
  checkAuth();
});

document.getElementById('auth-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('auth-login-btn').click();
});

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = '';
}

function showSetupError(msg) {
  const el = document.getElementById('setup-error');
  el.textContent = msg; el.style.display = '';
}

// ─── Toast ───────────────────────────────────────
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = msg;
  container.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(0)'; });
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateX(100%)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ─── Button loading state ───────────────────
async function btnLoading(btn, action) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  try { await action(); } finally { btn.disabled = false; btn.innerHTML = orig; }
}

function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

async function api(method, path, body) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (authToken) opts.headers['x-auth-token'] = authToken;
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(API + path, opts);
    if (resp.status === 401) {
      localStorage.removeItem('flasmc_token');
      authToken = null;
      checkAuth();
      return { error: 'Session expired' };
    }
    return await resp.json();
  } catch { return { error: 'Network error' }; }
}

// ─── Tab Switching ───────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ─── Server List ─────────────────────────────────
async function loadServers() {
  const data = await api('GET', '/servers');
  if (data.error) { toast(data.error, 'error'); return; }
  currentServers = data;
  renderServerList(data);
}

function renderServerList(servers) {
  const grid = document.getElementById('slist-grid');
  const empty = document.getElementById('slist-empty');
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  if (servers.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  for (const s of servers) {
    const card = document.createElement('div');
    card.className = 'server-card stopped';
    card.dataset.id = s.id;
    const typeIcons = { paper: 'fa-cube', vanilla: 'fa-cube', spigot: 'fa-cubes', bedrock: 'fa-cube' };
    card.innerHTML = `
      <div class="card-thumb-container">
        <img class="card-thumb" src="/api/servers/${s.id}/thumbnail?t=${Date.now()}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="card-thumb-fallback" style="display:none;"><i class="fas ${typeIcons[s.type] || 'fa-cube'}"></i></div>
      </div>
      <div class="card-top">
        <span class="card-name">${s.id}</span>
        <span class="card-status stopped">Stopped</span>
      </div>
      <div class="card-info">
        <span><i class="fas fa-tag"></i>${s.type || 'paper'}</span>
        <span><i class="fas fa-code-branch"></i>${s.version || 'latest'}</span>
      </div>
      <button class="card-delete-btn" title="Delete"><i class="fas fa-times"></i></button>
    `;
    card.querySelector('.card-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this server?')) return;
      await api('DELETE', '/servers/' + s.id);
      toast('Server deleted', 'success');
      if (currentServerId === s.id) showListView();
      loadServers();
    });
    card.addEventListener('click', () => openServer(s.id));
    grid.appendChild(card);
  }
  // Check running servers to update card status
  fetch(API + '/servers/running').then(r => r.json()).then(running => {
    for (const card of grid.children) {
      if (running[card.dataset.id]) {
        card.className = 'server-card running';
        const sd = card.querySelector('.card-status');
        if (sd) { sd.className = 'card-status running'; sd.textContent = 'Running'; }
      }
    }
  }).catch(() => {});
}

document.getElementById('slist-create-btn').addEventListener('click', openCreateModal);
document.getElementById('slist-empty-btn').addEventListener('click', openCreateModal);
document.getElementById('btn-back-list').addEventListener('click', showListView);

function showListView() {
  document.getElementById('server-list-view').classList.remove('hidden');
  document.getElementById('server-detail-view').classList.add('hidden');
  currentServerId = null;
}

// ─── Create Server ──────────────────────────────
async function openCreateModal() {
  document.getElementById('create-modal').classList.remove('hidden');
  document.getElementById('new-server-name').value = '';
  document.getElementById('create-status').classList.add('hidden');
  const java = await api('GET', '/java/detect');
  const statusEl = document.getElementById('create-status');
  if (java.found && !java.compatible) {
    statusEl.className = 'error'; statusEl.textContent = '⚠ Java ' + java.version + ' detected. Needs Java 21+.';
    statusEl.classList.remove('hidden');
  }
  await loadVersionsForType(document.getElementById('new-server-type').value);
}

function closeCreateModal() { document.getElementById('create-modal').classList.add('hidden'); }
document.querySelector('#create-modal .modal-close-btn').addEventListener('click', closeCreateModal);
document.getElementById('btn-modal-cancel').addEventListener('click', closeCreateModal);
document.getElementById('new-server-type').addEventListener('change', async () => {
  await loadVersionsForType(document.getElementById('new-server-type').value);
});

async function loadVersionsForType(type) {
  const select = document.getElementById('new-server-version');
  select.innerHTML = '<option>Loading...</option>';
  const data = await api('GET', '/versions/' + type);
  while (select.firstChild) select.removeChild(select.firstChild);
  if (data.versions) {
    for (const v of data.versions) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(v);
      opt.textContent = v.name;
      if (v.compatible === false) { opt.disabled = true; opt.style.color = 'var(--text-muted)'; }
      select.appendChild(opt);
    }
  }
}

document.getElementById('btn-modal-create').addEventListener('click', async () => {
  const id = document.getElementById('new-server-name').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!id) { toast('Enter a valid server name', 'error'); return; }
  const type = document.getElementById('new-server-type').value;
  let version = null;
  try { version = JSON.parse(document.getElementById('new-server-version').value); } catch { version = { version: 'latest' }; }
  const anticheat = document.getElementById('new-server-anticheat').checked;
  const geyser = document.getElementById('new-server-geyser').checked;
  const xray = document.getElementById('new-server-xray').checked;
  const statusEl = document.getElementById('create-status');
  statusEl.className = ''; statusEl.textContent = 'Creating server...'; statusEl.classList.remove('hidden');
  showLoading();
  const result = await api('POST', '/servers', { id, type, version, anticheat, geyser, xray });
  hideLoading();
  if (result.error) { statusEl.className = 'error'; statusEl.textContent = result.error; return; }
  toast('Server created!', 'success');
  closeCreateModal();
  loadServers();
  openServer(id);
});

// ─── Open Server ────────────────────────────────
function openServer(id) {
  currentServerId = id;
  document.getElementById('server-list-view').classList.add('hidden');
  document.getElementById('server-detail-view').classList.remove('hidden');
  document.getElementById('detail-name').textContent = id;
  const srv = currentServers.find(s => s.id === id);
  if (srv) {
    document.getElementById('info-type').textContent = srv.type || 'paper';
    document.getElementById('info-version').textContent = srv.version || 'latest';
    document.getElementById('info-serverid').textContent = id;
  }
  document.getElementById('console-output').innerHTML = '';
  document.getElementById('console-input').value = '';
  updateStatusUI('stopped');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="console"]').classList.add('active');
  document.getElementById('tab-console').classList.add('active');
  socket.emit('server:subscribe', id);
  // Also check via API if server is already running (for page refresh cases)
  fetch(API + '/servers/running').then(r => r.json()).then(data => {
    if (data[id]) {
      updateStatusUI('running');
      addConsoleLine('[Server was already running — reconnected]', 'done');
    }
  }).catch(() => {});
  loadPluginsList();
  loadMediaList();
  loadWorldsList();
  loadDiscordStatus();
  loadAIBotStatus();
  loadAntiCheatStatus();
  loadGeyserStatus();
  loadXrayStatus();
  loadCrashRestartSettings();
  loadMotd();
  loadSettings();
  loadBannedListDisplay();
  loadThumbnail();
}

function loadThumbnail() {
  const id = currentServerId;
  if (!id) return;
  const img = document.getElementById('info-thumb-img');
  const placeholder = document.getElementById('info-thumb-placeholder');
  document.getElementById('detail-name-thumb').textContent = id;
  img.style.display = 'none';
  placeholder.style.display = 'flex';
  // Try loading thumbnail
  const testImg = new Image();
  testImg.onload = () => { img.src = '/api/servers/' + id + '/thumbnail?t=' + Date.now(); img.style.display = ''; placeholder.style.display = 'none'; };
  testImg.onerror = () => {};
  testImg.src = '/api/servers/' + id + '/thumbnail?t=' + Date.now();
}

document.getElementById('info-thumb-upload').addEventListener('click', () => {
  document.getElementById('info-thumb-input').click();
});
// Also make the thumbnail area clickable
document.getElementById('info-thumb').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
    document.getElementById('info-thumb-input').click();
  }
});

document.getElementById('info-thumb-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const base64 = ev.target.result;
    try {
      const resp = await fetch('/api/servers/' + currentServerId + '/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { 'x-auth-token': authToken } : {}) },
        body: JSON.stringify({ image: base64 })
      });
      const data = await resp.json();
      if (data.success) { toast('Thumbnail updated', 'success'); loadThumbnail(); loadServers(); }
      else toast(data.error, 'error');
    } catch { toast('Upload failed', 'error'); }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

document.getElementById('info-thumb-remove').addEventListener('click', async () => {
  if (!currentServerId) return;
  await api('DELETE', '/servers/' + currentServerId + '/thumbnail');
  toast('Thumbnail removed', 'info');
  loadThumbnail();
  loadServers();
});

// ─── Status UI ──────────────────────────────────
function updateStatusUI(status) {
  serverRunning = status === 'running';
  document.getElementById('detail-btn-start').disabled = status === 'running' || status === 'starting';
  document.getElementById('detail-btn-stop').disabled = status !== 'running';
  document.getElementById('detail-btn-restart').disabled = status !== 'running';
  document.getElementById('console-input').disabled = status !== 'running';
  document.getElementById('btn-console-send').disabled = status !== 'running';
  const dot = document.getElementById('detail-status-dot');
  const text = document.getElementById('detail-status-text');
  dot.className = 'status-dot ' + status;
  text.className = 'status-text ' + status;
  const labels = { running: 'Running', stopped: 'Stopped', starting: 'Starting...', crashed: 'Crashed' };
  text.textContent = labels[status] || status;
  const cards = document.querySelectorAll('.server-card');
  for (const card of cards) {
    if (card.dataset.id === currentServerId) {
      card.className = 'server-card ' + status;
      const statusDot = card.querySelector('.card-status');
      if (statusDot) { statusDot.className = 'card-status ' + status; statusDot.textContent = labels[status] || status; }
    }
  }
}

document.getElementById('detail-btn-start').addEventListener('click', () => {
  if (!currentServerId) return;
  updateStatusUI('starting');
  socket.emit('server:start', {
    id: currentServerId,
    minRam: document.getElementById('info-ram-min').value,
    maxRam: document.getElementById('info-ram-max').value
  });
});

document.getElementById('detail-btn-stop').addEventListener('click', () => {
  if (!currentServerId) return;
  socket.emit('server:stop', currentServerId);
  addConsoleLine('Stopping server...', 'warn');
});

document.getElementById('detail-btn-restart').addEventListener('click', () => {
  if (!currentServerId) return;
  socket.emit('server:command', { id: currentServerId, cmd: 'stop' });
  addConsoleLine('Restarting...', 'warn');
  updateStatusUI('starting');
  setTimeout(() => {
    socket.emit('server:start', {
      id: currentServerId,
      minRam: document.getElementById('info-ram-min').value,
      maxRam: document.getElementById('info-ram-max').value
    });
  }, 3000);
});

// ─── Console ────────────────────────────────────
document.getElementById('btn-console-send').addEventListener('click', sendConsoleCommand);
document.getElementById('console-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendConsoleCommand(); }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cmdHistory.length === 0) return;
    cmdHistoryIndex = Math.max(0, cmdHistoryIndex - 1);
    document.getElementById('console-input').value = cmdHistory[cmdHistoryIndex] || '';
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdHistoryIndex = Math.min(cmdHistory.length, cmdHistoryIndex + 1);
    document.getElementById('console-input').value = cmdHistoryIndex >= cmdHistory.length ? '' : (cmdHistory[cmdHistoryIndex] || '');
  }
});

document.getElementById('btn-console-clear').addEventListener('click', () => {
  document.getElementById('console-output').innerHTML = '';
});

function sendConsoleCommand() {
  const input = document.getElementById('console-input');
  const cmd = input.value.trim();
  if (!cmd || !currentServerId) return;
  socket.emit('server:command', { id: currentServerId, cmd });
  addConsoleLine('/' + cmd, 'warn');
  cmdHistory.push(cmd);
  cmdHistoryIndex = cmdHistory.length;
  input.value = '';
}

function addConsoleLine(text, type) {
  const output = document.getElementById('console-output');
  const el = document.createElement('div');
  el.className = 'console-line';
  if (type) el.classList.add(type);
  el.textContent = text;
  output.appendChild(el);
  output.scrollTop = output.scrollHeight;
}

// ─── Socket.IO ──────────────────────────────────
function setupSocketHandlers() {
  socket.on('server:console', (data) => {
    const lines = data.split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      let type = '';
      if (l.includes('ERROR') || l.includes('Error')) type = 'error';
      else if (l.includes('Done') && l.includes('!')) type = 'done';
      else if (l.includes('WARN')) type = 'warn';
      addConsoleLine(l, type);
    }
  });

  socket.on('server:status', (status) => {
    updateStatusUI(status);
    if (status === 'running') toast('Server started!', 'success');
    else if (status === 'stopped') toast('Server stopped', 'info');
    else if (status === 'crashed') toast('Server crashed!', 'error');
  });

  socket.on('server:error', (msg) => { toast(msg, 'error'); updateStatusUI('stopped'); });

  socket.on('server:stats', (stats) => {
    if (stats.tps !== undefined) {
      const tps = stats.tps;
      const el = document.getElementById('info-tps');
      el.textContent = tps.toFixed(1);
      el.style.color = tps > 18 ? 'var(--green)' : tps > 10 ? 'var(--yellow)' : 'var(--red)';
      document.getElementById('bottombar-stats').textContent = 'TPS: ' + tps.toFixed(1);
    }
    if (stats.players !== undefined) {
      document.getElementById('info-players').textContent = stats.players + '/' + (stats.maxPlayers || '?');
    }
    if (stats.usedMem !== undefined) {
      document.getElementById('info-memory').textContent = parseInt(stats.usedMem) + ' / ' + parseInt(stats.totalMem) + ' MB';
    }
    if (stats.startTime !== undefined) {
      addConsoleLine('Server started in ' + stats.startTime + 's!', 'done');
    }
  });

  socket.on('connect', () => {
    if (currentServerId) {
      socket.emit('server:subscribe', currentServerId);
    }
  });

  socket.on('disconnect', () => {
    addConsoleLine('[Connection lost — reconnecting...]', 'warn');
  });
}

// ─── Settings ───────────────────────────────────
async function loadSettings() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/properties');
  if (data.error) return;
  const container = document.getElementById('settings-props');
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const [key, val] of Object.entries(data)) {
    const entry = document.createElement('div');
    entry.className = 'prop-entry';
    const label = document.createElement('label');
    label.textContent = key;
    const input = document.createElement('input');
    input.dataset.propKey = key;
    input.value = val;
    input.spellcheck = false;
    entry.appendChild(label);
    entry.appendChild(input);
    container.appendChild(entry);
  }
}

document.getElementById('settings-save-btn').addEventListener('click', async () => {
  if (!currentServerId) return;
  const props = {};
  const inputs = document.querySelectorAll('#settings-props .prop-entry input');
  for (const input of inputs) props[input.dataset.propKey] = input.value;
  await api('PUT', '/servers/' + currentServerId + '/properties', props);
  toast('Settings saved!', 'success');
});

document.getElementById('settings-reload-btn').addEventListener('click', () => {
  loadSettings();
  toast('Settings reloaded', 'info');
});

// ─── Plugins Tab ────────────────────────────────
async function loadPluginsList() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/plugins');
  if (data.error) return;
  currentPlugins = data.plugins || [];
  renderPluginsGrid();
}

function renderPluginsGrid() {
  const grid = document.getElementById('plugins-grid');
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  const filtered = currentPlugins.filter(p => p.displayName.toLowerCase().includes(pluginFilter.toLowerCase()));
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i>No plugins found</div>';
    return;
  }
  for (const p of filtered) {
    const card = document.createElement('div');
    card.className = 'plugin-card';
    card.innerHTML = `
      <div class="plugin-icon"><i class="fas ${p.enabled ? 'fa-plug' : 'fa-ban'}" style="color:${p.enabled ? 'var(--green)' : 'var(--red)'}"></i></div>
      <div class="plugin-info">
        <div class="plugin-name">${p.displayName}</div>
        <div class="plugin-meta">${p.sizeFormatted} · ${p.enabled ? '<span style="color:var(--green)">Enabled</span>' : '<span style="color:var(--red)">Disabled</span>'}</div>
      </div>
      <div class="plugin-actions">
        <button class="plugin-toggle ${p.enabled ? 'plugin-toggle-disable' : 'plugin-toggle-enable'}" title="${p.enabled ? 'Disable' : 'Enable'}"><i class="fas ${p.enabled ? 'fa-pause' : 'fa-play'}"></i></button>
        <button class="plugin-delete" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    `;
    card.querySelector('.plugin-toggle').addEventListener('click', async () => {
      await api('POST', '/servers/' + currentServerId + '/plugins/' + p.fileName + '/toggle');
      await loadPluginsList();
    });
    card.querySelector('.plugin-delete').addEventListener('click', async () => {
      if (!confirm('Delete "' + p.displayName + '"?')) return;
      await api('DELETE', '/servers/' + currentServerId + '/plugins/' + p.fileName);
      toast('Plugin deleted', 'info');
      await loadPluginsList();
    });
    grid.appendChild(card);
  }
}

document.getElementById('plugins-upload-btn').addEventListener('click', () => document.getElementById('plugins-file-input').click());
document.getElementById('plugins-file-input').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files.length || !currentServerId) return;
  showLoading();
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  try {
    const headers = {};
    if (authToken) headers['x-auth-token'] = authToken;
    const resp = await fetch(API + '/servers/' + currentServerId + '/plugins/upload', { method: 'POST', body: fd, headers });
    const json = await resp.json();
    if (json.success) toast(json.count + ' plugin(s) uploaded', 'success');
  } catch { toast('Upload failed', 'error'); }
  hideLoading();
  e.target.value = '';
  await loadPluginsList();
});

document.getElementById('plugins-search').addEventListener('input', (e) => {
  pluginFilter = e.target.value;
  renderPluginsGrid();
});

document.getElementById('plugins-enable-all').addEventListener('click', async () => {
  if (!currentServerId) return;
  for (const p of currentPlugins) { if (!p.enabled) await api('POST', '/servers/' + currentServerId + '/plugins/' + p.fileName + '/toggle'); }
  toast('All enabled', 'success');
  await loadPluginsList();
});

document.getElementById('plugins-disable-all').addEventListener('click', async () => {
  if (!currentServerId) return;
  for (const p of currentPlugins) { if (p.enabled) await api('POST', '/servers/' + currentServerId + '/plugins/' + p.fileName + '/toggle'); }
  toast('All disabled', 'info');
  await loadPluginsList();
});

// ─── Worlds Tab ─────────────────────────────────
async function loadWorldsList() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/worlds');
  if (data.error) return;
  const grid = document.getElementById('worlds-grid');
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  const worlds = data.worlds || [];
  if (worlds.length === 0) {
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-globe"></i>No worlds found<br><span style="font-size:12px;">Start the server to generate worlds</span></div>';
    return;
  }
  for (const w of worlds) {
    const card = document.createElement('div');
    card.className = 'world-card';
    const valid = w.hasLevelDat;
    card.innerHTML = `
      <div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:var(--bg-card);border-radius:var(--radius-sm);flex-shrink:0;">
        <i class="fas fa-globe" style="font-size:16px;color:${valid ? 'var(--green)' : 'var(--text-muted)'}"></i>
      </div>
      <div class="world-info">
        <div class="world-name">${w.name}</div>
        <div class="world-meta">${w.sizeFormatted} ${valid ? '· Valid' : '· No level.dat'}</div>
      </div>
      <div class="world-actions">
        <button class="world-download" title="Download"><i class="fas fa-download"></i></button>
        <button class="world-delete" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    `;
    card.querySelector('.world-download').addEventListener('click', async () => {
      showLoading();
      try {
        const resp = await fetch(API + '/servers/' + currentServerId + '/worlds/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: w.name }) });
        if (!resp.ok) { toast('Download failed', 'error'); return; }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = w.name + '.zip'; a.click();
        URL.revokeObjectURL(url);
        toast('World downloaded', 'success');
      } catch { toast('Download failed', 'error'); }
      hideLoading();
    });
    card.querySelector('.world-delete').addEventListener('click', async () => {
      if (!confirm('Delete world "' + w.name + '"?')) return;
      const r = await api('DELETE', '/servers/' + currentServerId + '/worlds/' + w.name);
      if (r.error && r.error.includes('level.dat')) { if (!confirm('No level.dat. Force delete?')) return; await api('DELETE', '/servers/' + currentServerId + '/worlds/' + w.name + '?force=true'); }
      toast('World deleted', 'info');
      await loadWorldsList();
    });
    grid.appendChild(card);
  }
}

document.getElementById('worlds-upload-btn').addEventListener('click', () => document.getElementById('worlds-file-input').click());
document.getElementById('worlds-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !currentServerId) return;
  showLoading();
  const fd = new FormData();
  fd.append('world', file); fd.append('name', file.name.replace('.zip', ''));
  try {
    const hdrs = {};
    if (authToken) hdrs['x-auth-token'] = authToken;
    const resp = await fetch(API + '/servers/' + currentServerId + '/worlds/upload', { method: 'POST', body: fd, headers: hdrs });
    const json = await resp.json();
    if (json.success) toast('World "' + json.name + '" uploaded', 'success');
    else toast(json.error, 'error');
  } catch { toast('Upload failed', 'error'); }
  hideLoading();
  e.target.value = '';
  await loadWorldsList();
});

// ─── Media Tab ──────────────────────────────────
async function loadMediaList() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/media');
  if (data.error) return;
  const grid = document.getElementById('media-grid');
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  const files = data.files || [];
  if (files.length === 0) {
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-images"></i>No media uploaded</div>';
    return;
  }
  for (const f of files) {
    const item = document.createElement('div');
    item.className = 'media-grid-item';
    const isImage = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg'].includes(f.ext);
    const isVideo = ['.mp4','.webm'].includes(f.ext);
    item.innerHTML = `
      ${isImage ? '<img src="'+f.url+'" loading="lazy">' : '<div class="media-icon-overlay"><i class="fas '+(isVideo?'fa-video':'fa-music')+'" style="font-size:32px;color:'+(isVideo?'var(--accent)':'var(--green)')+'"></i></div>'}
      <button class="media-delete-btn" data-file="${f.name}"><i class="fas fa-times"></i></button>
    `;
    if (isImage) item.querySelector('img').addEventListener('click', () => openMediaPreview(f));
    else item.querySelector('.media-icon-overlay').addEventListener('click', () => openMediaPreview(f));
    item.querySelector('.media-delete-btn').addEventListener('click', async () => {
      if (!confirm('Delete "' + f.name + '"?')) return;
      await api('DELETE', '/servers/' + currentServerId + '/media/' + f.name);
      toast('File deleted', 'info');
      await loadMediaList();
    });
    grid.appendChild(item);
  }
}

document.getElementById('media-upload-btn').addEventListener('click', () => document.getElementById('media-file-input').click());
document.getElementById('media-file-input').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files.length || !currentServerId) return;
  showLoading();
  let ok = 0;
  for (const file of files) {
    const fd = new FormData(); fd.append('file', file);
    try {
      const hdrs = {};
      if (authToken) hdrs['x-auth-token'] = authToken;
      const resp = await fetch(API + '/servers/' + currentServerId + '/media/upload', { method: 'POST', body: fd, headers: hdrs });
      const json = await resp.json();
      if (json.success) ok++;
    } catch {}
  }
  hideLoading();
  if (ok) toast(ok + ' file(s) uploaded', 'success');
  e.target.value = '';
  await loadMediaList();
});

function openMediaPreview(f) {
  const modal = document.getElementById('media-preview-modal');
  document.getElementById('media-preview-name').textContent = f.name;
  const img = document.getElementById('media-preview-img');
  const vid = document.getElementById('media-preview-video');
  img.style.display = 'none'; vid.style.display = 'none';
  if (['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg'].includes(f.ext)) { img.src = f.url; img.style.display = 'block'; }
  else if (['.mp4','.webm'].includes(f.ext)) { vid.src = f.url; vid.style.display = 'block'; }
  modal.classList.remove('hidden');
}

document.getElementById('media-preview-close-btn').addEventListener('click', () => {
  document.getElementById('media-preview-modal').classList.add('hidden');
  document.getElementById('media-preview-img').src = '';
  document.getElementById('media-preview-video').src = '';
});

// ─── Files Tab ─────────────────────────────────
let fileTreeData = [];
let fileCurrentPath = '';
let fileEditingPath = null;

async function loadFileTree() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/files');
  if (data.error) { document.getElementById('files-tree').innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px;">Error loading files</div>'; return; }
  fileTreeData = Array.isArray(data) ? data : [];
  renderFileTree();
  if (!fileCurrentPath) { fileCurrentPath = ''; loadFileList(); }
}

function renderFileTree() {
  const container = document.getElementById('files-tree');
  container.innerHTML = buildTreeHTML(fileTreeData, '');
  container.querySelectorAll('.tree-toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = el.closest('.file-tree-item');
      const ul = target.nextElementSibling;
      if (ul) {
        ul.style.display = ul.style.display === 'none' ? '' : 'none';
        el.classList.toggle('fa-chevron-down');
        el.classList.toggle('fa-chevron-right');
      }
    });
  });
  container.querySelectorAll('.file-tree-item').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path;
      fileCurrentPath = path;
      loadFileList();
      container.querySelectorAll('.file-tree-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
    });
  });
}

function buildTreeHTML(items, parentPath) {
  let html = '';
  if (parentPath === '') html += '<div class="file-tree-item" data-path="" style="font-weight:600;"><i class="fas fa-server"></i> /</div>';
  for (const item of items) {
    const fullPath = parentPath ? parentPath + '/' + item.name : item.name;
    const icon = item.type === 'directory' ? 'fa-folder' : getFileIcon(item.name);
    const hasChildren = item.type === 'directory' && item.children && item.children.length > 0;
    html += '<div class="file-tree-item" data-path="' + fullPath + '">';
    if (item.type === 'directory') {
      html += '<span class="tree-toggle fas fa-chevron-down" style="' + (hasChildren ? '' : 'visibility:hidden') + '"></span>';
    } else {
      html += '<span style="width:16px;"></span>';
    }
    html += '<i class="fas ' + icon + '"></i> ' + item.name + '</div>';
    if (item.type === 'directory' && item.children) {
      html += '<div class="file-tree-children">' + buildTreeHTML(item.children, fullPath) + '</div>';
    }
  }
  return html;
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    'js': 'fa-file-code', 'json': 'fa-file-code', 'xml': 'fa-file-code', 'yml': 'fa-file-code', 'yaml': 'fa-file-code',
    'toml': 'fa-file-code', 'properties': 'fa-file-code', 'txt': 'fa-file-lines', 'md': 'fa-file-lines',
    'jar': 'fa-file-archive', 'zip': 'fa-file-zipper', 'png': 'fa-file-image', 'jpg': 'fa-file-image',
    'jpeg': 'fa-file-image', 'gif': 'fa-file-image', 'svg': 'fa-file-image', 'ico': 'fa-file-image',
    'mp3': 'fa-file-audio', 'ogg': 'fa-file-audio', 'wav': 'fa-file-audio',
    'mp4': 'fa-file-video', 'webm': 'fa-file-video',
    'log': 'fa-file-lines', 'dat': 'fa-database', 'sh': 'fa-terminal', 'bat': 'fa-terminal',
    'yml': 'fa-file-code',
  };
  return map[ext] || 'fa-file';
}

async function loadFileList() {
  if (!currentServerId) return;
  document.getElementById('files-path').textContent = '/' + fileCurrentPath;
  const allData = await api('GET', '/servers/' + currentServerId + '/files');
  if (allData.error) return;
  const files = findInTree(allData, fileCurrentPath);
  renderFileList(files || []);
}

function findInTree(items, path) {
  if (!path) return items;
  const parts = path.split('/');
  let current = items;
  for (const part of parts) {
    if (!current) return null;
    const found = current.find(i => i.name === part);
    if (!found) return null;
    current = found.children;
  }
  return current;
}

function renderFileList(items) {
  const container = document.getElementById('files-list');
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i>Empty directory</div>';
    return;
  }
  // Up button
  if (fileCurrentPath) {
    const up = document.createElement('div');
    up.className = 'file-list-item';
    up.innerHTML = '<i class="fas fa-arrow-up"></i> ..';
    up.addEventListener('click', () => {
      fileCurrentPath = fileCurrentPath.split('/').slice(0, -1).join('/');
      loadFileList();
      renderFileTreeActive();
    });
    container.appendChild(up);
  }
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'file-list-item';
    const icon = item.type === 'directory' ? 'fa-folder' : getFileIcon(item.name);
    const sizeStr = item.size !== undefined && item.size !== null ? formatFileSize(item.size) : '';
    el.innerHTML = '<i class="fas ' + icon + '"></i> ' + item.name +
      '<span class="file-size">' + sizeStr + '</span>' +
      '<span class="file-actions">' +
        '<button class="file-rename-btn" title="Rename"><i class="fas fa-pen"></i></button>' +
        '<button class="file-delete-btn danger" title="Delete"><i class="fas fa-trash"></i></button>' +
      '</span>';
    if (item.type === 'directory') {
      el.addEventListener('dblclick', () => {
        fileCurrentPath = fileCurrentPath ? fileCurrentPath + '/' + item.name : item.name;
        loadFileList();
        renderFileTreeActive();
      });
    } else {
      el.addEventListener('dblclick', () => openFileEditor(fileCurrentPath ? fileCurrentPath + '/' + item.name : item.name));
    }
    el.querySelector('.file-rename-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const oldPath = fileCurrentPath ? fileCurrentPath + '/' + item.name : item.name;
      const newName = prompt('Rename to:', item.name);
      if (newName && newName !== item.name) {
        const newPath = fileCurrentPath ? fileCurrentPath + '/' + newName : newName;
        api('POST', '/servers/' + currentServerId + '/files/rename', { oldPath, newPath }).then(r => {
          if (r.success) { loadFileTree(); loadFileList(); } else toast(r.error, 'error');
        });
      }
    });
    el.querySelector('.file-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const delPath = fileCurrentPath ? fileCurrentPath + '/' + item.name : item.name;
      if (!confirm('Delete "' + item.name + '"?' + (item.type === 'directory' ? ' (entire directory)' : ''))) return;
      api('DELETE', '/servers/' + currentServerId + '/files?path=' + encodeURIComponent(delPath)).then(r => {
        if (r.success) { loadFileTree(); loadFileList(); } else toast(r.error, 'error');
      });
    });
    container.appendChild(el);
  }
}

function renderFileTreeActive() {
  document.querySelectorAll('.file-tree-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path === fileCurrentPath);
  });
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

async function openFileEditor(filePath) {
  fileEditingPath = filePath;
  const data = await api('GET', '/servers/' + currentServerId + '/files/read?path=' + encodeURIComponent(filePath));
  document.getElementById('files-list').style.display = 'none';
  const editor = document.getElementById('files-editor');
  editor.style.display = 'flex';
  document.getElementById('files-editor-path').textContent = '/' + filePath;
  if (data.binary) {
    document.getElementById('files-editor-text').value = '[Binary file — ' + formatFileSize(data.size) + ' — cannot be edited]';
    document.getElementById('files-editor-text').disabled = true;
    document.getElementById('files-editor-save').style.display = 'none';
  } else {
    document.getElementById('files-editor-text').value = data.content || '';
    document.getElementById('files-editor-text').disabled = false;
    document.getElementById('files-editor-save').style.display = '';
  }
}

document.getElementById('files-editor-close').addEventListener('click', () => {
  document.getElementById('files-editor').style.display = 'none';
  document.getElementById('files-list').style.display = '';
  fileEditingPath = null;
});

document.getElementById('files-editor-save').addEventListener('click', async () => {
  if (!fileEditingPath) return;
  const content = document.getElementById('files-editor-text').value;
  const result = await api('POST', '/servers/' + currentServerId + '/files/write', { path: fileEditingPath, content });
  if (result.success) { toast('File saved', 'success'); } else toast(result.error, 'error');
});

// File actions
document.getElementById('files-upload-btn').addEventListener('click', () => document.getElementById('files-file-input').click());
document.getElementById('files-file-input').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files.length) return;
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('dir', fileCurrentPath || '');
    try {
      const resp = await fetch('/api/servers/' + currentServerId + '/files/upload', {
        method: 'POST',
        headers: authToken ? { 'x-auth-token': authToken } : {},
        body: formData
      });
      const result = await resp.json();
      if (result.success) toast('Uploaded ' + file.name, 'success');
      else toast(result.error, 'error');
    } catch { toast('Upload failed', 'error'); }
  }
  e.target.value = '';
  loadFileTree(); loadFileList();
});

document.getElementById('files-new-dir').addEventListener('click', async () => {
  const name = prompt('Folder name:');
  if (!name) return;
  const dirPath = fileCurrentPath ? fileCurrentPath + '/' + name : name;
  const result = await api('POST', '/servers/' + currentServerId + '/files/mkdir', { path: dirPath });
  if (result.success) { loadFileTree(); loadFileList(); } else toast(result.error, 'error');
});

document.getElementById('files-new-file').addEventListener('click', async () => {
  const name = prompt('File name:');
  if (!name) return;
  const filePath = fileCurrentPath ? fileCurrentPath + '/' + name : name;
  const result = await api('POST', '/servers/' + currentServerId + '/files/write', { path: filePath, content: '' });
  if (result.success) { loadFileTree(); loadFileList(); openFileEditor(filePath); }
  else toast(result.error, 'error');
});

document.getElementById('files-refresh').addEventListener('click', () => { loadFileTree(); loadFileList(); });

// Tab switch hook for files
const origTabSwitch = document.querySelector('.tab-btn[data-tab="files"]');
if (origTabSwitch) {
  origTabSwitch.addEventListener('click', () => {
    if (currentServerId) { loadFileTree(); }
  });
}

// ─── Backup Tab ─────────────────────────────────
async function loadBackups() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/backups');
  const list = Array.isArray(data) ? data : [];
  const container = document.getElementById('backup-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-archive"></i>No backups yet</div>';
    return;
  }
  for (const b of list) {
    const el = document.createElement('div');
    el.className = 'backup-item';
    const date = new Date(b.modified).toLocaleString();
    const size = b.size > 1024 * 1024 ? (b.size / 1024 / 1024).toFixed(1) + ' MB' : (b.size / 1024).toFixed(0) + ' KB';
    el.innerHTML = '<i class="fas fa-archive" style="color:var(--accent)"></i><span style="flex:1;">' + b.name + '</span><span style="color:var(--text-muted);font-size:11px;">' + size + ' — ' + date + '</span><button class="btn-ghost danger" style="font-size:11px;padding:2px 8px;"><i class="fas fa-trash"></i></button>';
    el.querySelector('button').addEventListener('click', async () => {
      if (!confirm('Delete backup ' + b.name + '?')) return;
      await api('DELETE', '/servers/' + currentServerId + '/backups/' + encodeURIComponent(b.name));
      toast('Deleted', 'info');
      loadBackups();
    });
    container.appendChild(el);
  }
}

document.getElementById('backup-create-btn').addEventListener('click', async () => {
  if (!currentServerId) return;
  showLoading();
  const result = await api('POST', '/servers/' + currentServerId + '/backups');
  hideLoading();
  if (result.success) { toast('Backup created: ' + result.name, 'success'); addConsoleLine('Backup created: ' + result.name, 'done'); loadBackups(); }
  else toast(result.error, 'error');
});

document.getElementById('backup-refresh').addEventListener('click', loadBackups);

// Backup retention
async function loadBackupRetention() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/crash-restart');
  // Use crash-restart to store retention (or add separate API, but we already have a generic config)
  document.getElementById('backup-retention').value = 0;
  // We'll use a separate approach - read from server-config directly
  try {
    const resp = await fetch('/api/servers/' + currentServerId + '/backups/retention', {
      headers: authToken ? { 'x-auth-token': authToken } : {}
    });
    // Not implemented as separate GET, just use the config
  } catch {}
}

document.getElementById('backup-retention-save').addEventListener('click', async () => {
  if (!currentServerId) return;
  const retention = parseInt(document.getElementById('backup-retention').value) || 0;
  const result = await api('POST', '/servers/' + currentServerId + '/backups/retention', { retention });
  if (result.success) toast('Retention saved', 'success');
});

document.querySelector('.tab-btn[data-tab="backup"]').addEventListener('click', () => {
  if (currentServerId) loadBackups();
});

// ─── MOTD Tab ────────────────────────────────────
let savedMotd = '';

async function loadMotd() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/motd');
  if (data.error) return;
  savedMotd = data.motd || '';
  document.getElementById('motd-textarea').value = savedMotd;
  updateMotdPreview();
}

function updateMotdPreview() {
  const text = document.getElementById('motd-textarea').value;
  document.getElementById('motd-char-count').textContent = text.length + ' chars';
  // Parse § color codes for preview
  const lines = text.split('\n');
  const line1El = document.getElementById('motd-line1');
  const line2El = document.getElementById('motd-line2');
  if (lines.length >= 2) {
    line1El.textContent = lines[0] || ' ';
    line2El.textContent = lines[1] || ' ';
  } else if (lines.length === 1) {
    line1El.textContent = lines[0] || ' ';
    line2El.textContent = ' ';
  } else {
    line1El.textContent = 'düzenlemiş olduğu etkinliğe';
    line2El.textContent = 'hoşgeldin!';
  }
}

function insertMotdCode(code) {
  const ta = document.getElementById('motd-textarea');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = ta.value;
  const before = text.substring(0, start);
  const after = text.substring(end);
  ta.value = before + '§' + code + after;
  ta.selectionStart = ta.selectionEnd = start + 2;
  ta.focus();
  updateMotdPreview();
}

document.getElementById('motd-textarea').addEventListener('input', updateMotdPreview);

document.querySelectorAll('.motd-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const code = btn.dataset.code;
    insertMotdCode(code);
  });
});

document.querySelectorAll('.motd-tool-btn[data-insert]').forEach(btn => {
  btn.addEventListener('click', () => {
    const ta = document.getElementById('motd-textarea');
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = ta.value;
    const before = text.substring(0, start);
    const after = text.substring(end);
    ta.value = before + btn.dataset.insert + after;
    ta.selectionStart = ta.selectionEnd = start + btn.dataset.insert.length;
    ta.focus();
    updateMotdPreview();
  });
});

document.getElementById('motd-save-btn').addEventListener('click', async () => {
  if (!currentServerId) return;
  const motd = document.getElementById('motd-textarea').value;
  const result = await api('PUT', '/servers/' + currentServerId + '/motd', { motd });
  if (result.success) {
    savedMotd = motd;
    toast('MOTD saved! Restart server to apply.', 'success');
  } else toast(result.error, 'error');
});

document.getElementById('motd-refresh').addEventListener('click', () => {
  document.getElementById('motd-textarea').value = savedMotd;
  updateMotdPreview();
  toast('Reset to saved MOTD', 'info');
});

document.getElementById('motd-align-left').addEventListener('click', () => {
  const ta = document.getElementById('motd-textarea');
  const text = ta.value;
  if (!text.includes('\n')) return;
  const lines = text.split('\n');
  if (lines.length >= 2) {
    lines[0] = lines[0].replace(/^§l/, '');
    lines[1] = lines[1].replace(/^§l/, '');
    ta.value = lines.join('\n');
    updateMotdPreview();
  }
});

document.getElementById('motd-align-center').addEventListener('click', () => {
  const ta = document.getElementById('motd-textarea');
  const text = ta.value;
  if (!text.includes('\n')) return;
  const lines = text.split('\n');
  if (lines.length >= 2) {
    if (!lines[0].startsWith('§l')) lines[0] = '§l' + lines[0];
    if (!lines[1].startsWith('§l')) lines[1] = '§l' + lines[1];
    ta.value = lines.join('\n');
    updateMotdPreview();
  }
});

document.querySelector('.tab-btn[data-tab="motd"]').addEventListener('click', () => {
  if (currentServerId) loadMotd();
});

// ─── Discord Tab ────────────────────────────────
async function loadDiscordStatus() {
  const data = await api('GET', '/discord/status');
  const bar = document.getElementById('discord-status-bar');
  if (data.connected) {
    bar.className = 'success'; bar.textContent = '🟢 Connected as ' + (data.botUser || 'Bot');
    document.getElementById('discord-disconnect-btn').classList.remove('hidden');
    document.getElementById('discord-connect-btn').textContent = 'Reconnect';
    document.getElementById('discord-token').placeholder = 'Token saved (click Reconnect to use)';
  } else {
    bar.className = 'error'; bar.textContent = '🔴 Not connected';
    document.getElementById('discord-disconnect-btn').classList.add('hidden');
    document.getElementById('discord-connect-btn').textContent = 'Connect';
    document.getElementById('discord-token').placeholder = data.hasToken ? 'Token saved — just click Connect' : 'Enter your Discord bot token...';
  }
  // Don't overwrite token input — it's masked; user either already entered it or server has it saved
  document.getElementById('discord-channel').value = data.consoleChannelId || '';
  document.getElementById('discord-prefix').value = data.prefix || '!';
  document.getElementById('discord-prefix-display').textContent = data.prefix || '!';
}

document.getElementById('discord-connect-btn').addEventListener('click', async () => {
  const token = document.getElementById('discord-token').value;
  showLoading();
  const body = {};
  if (token) body.token = token;
  const result = await api('POST', '/discord/start', body);
  hideLoading();
  if (result.connected) { toast('Discord bot connected!', 'success'); } else { toast('Connection failed', 'error'); }
  loadDiscordStatus();
});

document.getElementById('discord-disconnect-btn').addEventListener('click', async () => {
  await api('POST', '/discord/stop');
  toast('Disconnected', 'info');
  loadDiscordStatus();
});

document.getElementById('discord-save-btn').addEventListener('click', async () => {
  const token = document.getElementById('discord-token').value;
  const channel = document.getElementById('discord-channel').value;
  const prefix = document.getElementById('discord-prefix').value;
  await api('POST', '/discord/config', { token, consoleChannelId: channel, prefix });
  toast('Settings saved', 'success');
  loadDiscordStatus();
});

// ─── AI Bot ─────────────────────────────────────
async function loadAIBotStatus() {
  if (!currentServerId) return;
  const data = await api('GET', '/ai-bot/' + currentServerId);
  if (data.error) return;
  const bar = document.getElementById('aibot-status-bar');
  const usingGroq = data.groqApiKey && data.groqApiKey.startsWith('gsk_');
  if (data.enabled) {
    const mode = usingGroq ? '🧠 Groq AI' : '⚡ Keyword';
    const statusIcon = data.connected ? '🟢' : '🟡';
    const statusText = data.connected ? 'online' : 'connecting...';
    bar.className = data.connected ? 'success' : 'warn';
    bar.textContent = `${statusIcon} AI Bot ${statusText} (${mode}) — ${data.botName || 'Bot'}@${data.host}:${data.port}`;
  } else {
    bar.className = 'error'; bar.textContent = '🔴 AI Bot is disabled';
  }
  document.getElementById('aibot-enabled').checked = data.enabled || false;
  document.getElementById('aibot-name').value = data.botName || 'Bot';
  document.getElementById('aibot-language').value = data.language || 'en';
  document.getElementById('aibot-host').value = data.host || 'localhost';
  document.getElementById('aibot-port').value = data.port || '25565';
  document.getElementById('aibot-version').value = data.version || '';
  document.getElementById('aibot-groq-key').value = data.groqApiKey || '';
  document.getElementById('aibot-groq-model').value = data.groqModel || 'llama-3.3-70b-versatile';
  updateAIBotPreview();
}

function updateAIBotPreview() {
  const name = document.getElementById('aibot-name').value || 'Bot';
  const lang = document.getElementById('aibot-language').value;
  const greeting = lang === 'tr' ? 'Merhaba!' : 'Hello!';
  document.getElementById('aibot-preview-text').innerHTML =
    '&lt;Player&gt; ' + (lang === 'tr' ? 'Merhaba!' : 'Hello!') + '<br>' +
    '&lt;' + name + '&gt; ' + greeting;
}

document.getElementById('aibot-enabled').addEventListener('change', () => {
  updateAIBotPreview();
  document.getElementById('aibot-save-btn').click();
});
document.getElementById('aibot-name').addEventListener('input', updateAIBotPreview);

document.getElementById('aibot-save-btn').addEventListener('click', async () => {
  if (!currentServerId) return;
  const btn = document.getElementById('aibot-save-btn');
  btn.disabled = true;
  const enabled = document.getElementById('aibot-enabled').checked;
  const botName = document.getElementById('aibot-name').value || 'Bot';
  const language = document.getElementById('aibot-language').value;
  const host = document.getElementById('aibot-host').value || 'localhost';
  const port = document.getElementById('aibot-port').value || '25565';
  const version = document.getElementById('aibot-version').value;
  const groqApiKey = document.getElementById('aibot-groq-key').value;
  const groqModel = document.getElementById('aibot-groq-model').value;
  const result = await api('POST', '/ai-bot/' + currentServerId, { enabled, botName, language, host, port, version, groqApiKey, groqModel });
  btn.disabled = false;
  if (result.error) { toast('Failed: ' + result.error, 'error'); return; }
  toast('AI Bot settings saved!', 'success');
  loadAIBotStatus();
});

document.getElementById('aibot-refresh-btn').addEventListener('click', loadAIBotStatus);

// ─── Anti-Cheat Modal ───────────────────────────
async function loadAntiCheatStatus() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/anticheat');
  if (data.error) return;
  const el = document.getElementById('info-anticheat');
  if (data.anticheat && data.installed.length > 0) el.innerHTML = '<span class="badge-on">' + data.installed[0].name + '</span>';
  else if (data.anticheat) el.innerHTML = '<span class="badge-warn">Not Installed</span>';
  else el.innerHTML = '<span class="badge-off">Off</span>';
  // Update modal data
  document.getElementById('geyser-modal').dataset.anticheatData = JSON.stringify(data);
}

document.getElementById('bottombar-anticheat').addEventListener('click', async () => {
  const modal = document.getElementById('anticheat-modal');
  modal.classList.remove('hidden');
  const data = await api('GET', '/servers/' + currentServerId + '/anticheat');
  const statusEl = document.getElementById('ac-modal-status');
  const infoEl = document.getElementById('ac-modal-info');
  const installBtn = document.getElementById('ac-modal-install');
  const removeBtn = document.getElementById('ac-modal-remove');
  if (data.installed && data.installed.length > 0) {
    statusEl.innerHTML = '<span class="badge-on">' + data.installed[0].name + ' Installed</span>';
    infoEl.textContent = 'GrimAC is protecting your server.';
    installBtn.classList.add('hidden');
    removeBtn.classList.remove('hidden');
  } else if (data.anticheat) {
    statusEl.innerHTML = '<span class="badge-warn">Not Installed</span>';
    infoEl.textContent = 'Marked as enabled but not installed. Click Install to download GrimAC.';
    installBtn.classList.remove('hidden');
    removeBtn.classList.add('hidden');
  } else {
    statusEl.innerHTML = '<span class="badge-off">Disabled</span>';
    infoEl.textContent = 'Anti-cheat is not enabled for this server.';
    installBtn.classList.add('hidden');
    removeBtn.classList.add('hidden');
  }
});

document.getElementById('ac-modal-install').addEventListener('click', async () => {
  if (!currentServerId) return;
  showLoading();
  const btn = document.getElementById('ac-modal-install');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Installing...';
  const result = await api('POST', '/servers/' + currentServerId + '/anticheat/install');
  hideLoading();
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Install GrimAC';
  toast(result.message || 'Installed!', 'success');
  loadAntiCheatStatus();
  document.getElementById('anticheat-modal').classList.add('hidden');
});

document.getElementById('ac-modal-remove').addEventListener('click', async () => {
  if (!currentServerId) return;
  if (!confirm('Remove anti-cheat?')) return;
  await api('DELETE', '/servers/' + currentServerId + '/anticheat');
  toast('Removed', 'info');
  loadAntiCheatStatus();
  document.getElementById('anticheat-modal').classList.add('hidden');
});

document.querySelector('#anticheat-modal .modal-close-btn').addEventListener('click', () => {
  document.getElementById('anticheat-modal').classList.add('hidden');
});

// ─── Geyser Modal ───────────────────────────────
async function loadGeyserStatus() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/geyser');
  if (data.error) return;
  const el = document.getElementById('info-geyser');
  if (data.geyser && data.installed.length >= 2) el.innerHTML = '<span class="badge-on">Active</span>';
  else if (data.geyser) el.innerHTML = '<span class="badge-warn">Partial</span>';
  else el.innerHTML = '<span class="badge-off">Off</span>';
  if (data.geyser) document.getElementById('info-bedrock-port').textContent = (data.bedrockPort || 19132) + ' (UDP)';
}

document.getElementById('bottombar-geyser').addEventListener('click', async () => {
  const modal = document.getElementById('geyser-modal');
  modal.classList.remove('hidden');
  const data = await api('GET', '/servers/' + currentServerId + '/geyser');
  const statusEl = document.getElementById('geyser-modal-status');
  const infoEl = document.getElementById('geyser-modal-info');
  const portEl = document.getElementById('geyser-modal-port');
  const portVal = document.getElementById('geyser-port-value');
  const installBtn = document.getElementById('geyser-modal-install');
  const removeBtn = document.getElementById('geyser-modal-remove');
  if (data.installed && data.installed.length >= 2) {
    statusEl.innerHTML = '<span class="badge-on">Ready</span>';
    infoEl.textContent = 'Geyser + Floodgate installed. Bedrock players can connect.';
    portEl.style.display = 'block';
    portVal.textContent = data.bedrockPort || 19132;
    installBtn.classList.add('hidden');
    removeBtn.classList.remove('hidden');
  } else if (data.installed && data.installed.length === 1) {
    statusEl.innerHTML = '<span class="badge-warn">Partial</span>';
    infoEl.textContent = 'Only Geyser found. Floodgate missing — Bedrock players need Java account.';
    portEl.style.display = 'block';
    portVal.textContent = data.bedrockPort || 19132;
    installBtn.textContent = 'Install Floodgate';
    installBtn.classList.remove('hidden');
    removeBtn.classList.remove('hidden');
  } else {
    statusEl.innerHTML = data.geyser ? '<span class="badge-warn">Not Installed</span>' : '<span class="badge-off">Disabled</span>';
    infoEl.textContent = 'Geyser + Floodgate let Bedrock players join your server.';
    portEl.style.display = 'none';
    installBtn.textContent = 'Install Geyser + Floodgate';
    installBtn.classList.remove('hidden');
    removeBtn.classList.add('hidden');
  }
});

document.getElementById('geyser-modal-install').addEventListener('click', async () => {
  if (!currentServerId) return;
  showLoading();
  const btn = document.getElementById('geyser-modal-install');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Installing...';
  const result = await api('POST', '/servers/' + currentServerId + '/geyser/install');
  hideLoading();
  btn.disabled = false; btn.innerHTML = 'Install Geyser + Floodgate';
  toast(result.message || 'Installation complete!', result.success ? 'success' : 'info');
  loadGeyserStatus();
  document.getElementById('geyser-modal').classList.add('hidden');
});

document.getElementById('geyser-modal-remove').addEventListener('click', async () => {
  if (!currentServerId) return;
  if (!confirm('Remove Bedrock support?')) return;
  await api('DELETE', '/servers/' + currentServerId + '/geyser');
  toast('Removed', 'info');
  loadGeyserStatus();
  document.getElementById('geyser-modal').classList.add('hidden');
});

document.querySelector('#geyser-modal .modal-close-btn').addEventListener('click', () => {
  document.getElementById('geyser-modal').classList.add('hidden');
});

// ─── X-Ray Protection ──────────────────────────

async function loadXrayStatus() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/xray');
  if (data.error) return;
  const el = document.getElementById('info-xray');
  if (data.xray && data.paperAntiXray) el.innerHTML = '<span class="badge-on">Paper (Engine 2)</span>';
  else if (data.xray) el.innerHTML = '<span class="badge-warn">Pending Config</span>';
  else el.innerHTML = '<span class="badge-off">Off</span>';
}

document.getElementById('bottombar-xray').addEventListener('click', async () => {
  const modal = document.getElementById('xray-modal');
  modal.classList.remove('hidden');
  const data = await api('GET', '/servers/' + currentServerId + '/xray');
  const statusEl = document.getElementById('xray-modal-status');
  const infoEl = document.getElementById('xray-modal-info');
  const enableBtn = document.getElementById('xray-modal-enable');
  const disableBtn = document.getElementById('xray-modal-disable');
  const oreInstallBtn = document.getElementById('xray-modal-install-orebfuscator');
  const oreRemoveBtn = document.getElementById('xray-modal-remove-orebfuscator');

  if (data.paperAntiXray) {
    statusEl.innerHTML = '<span class="badge-on">Paper Anti-Xray Active</span>';
    infoEl.innerHTML = 'Engine mode 2: hides diamond/gold/iron/etc. as stone. <strong>Restart server</strong> for changes to take effect.';
    enableBtn.classList.add('hidden');
    disableBtn.classList.remove('hidden');
  } else if (data.xray) {
    statusEl.innerHTML = '<span class="badge-warn">Pending</span>';
    infoEl.textContent = 'X-ray enabled but config not applied. Click "Enable" to configure.';
    enableBtn.classList.remove('hidden');
    enableBtn.textContent = '<i class="fas fa-shield"></i> Apply Paper Anti-Xray';
    disableBtn.classList.add('hidden');
  } else {
    statusEl.innerHTML = '<span class="badge-off">Disabled</span>';
    infoEl.textContent = 'Paper built-in anti-xray hides ores from x-ray texture packs. Recommended for survival servers.';
    enableBtn.classList.remove('hidden');
    enableBtn.innerHTML = '<i class="fas fa-shield"></i> Enable Paper Anti-Xray';
    disableBtn.classList.add('hidden');
  }

  if (data.orebfuscator) {
    oreInstallBtn.classList.add('hidden');
    oreRemoveBtn.classList.remove('hidden');
  } else {
    oreInstallBtn.classList.remove('hidden');
    oreRemoveBtn.classList.add('hidden');
  }
});

document.getElementById('xray-modal-enable').addEventListener('click', async () => {
  if (!currentServerId) return;
  await api('POST', '/servers/' + currentServerId + '/xray/enable');
  toast('Anti-xray enabled! Restart server to apply.', 'success');
  loadXrayStatus();
  document.getElementById('xray-modal').classList.add('hidden');
});

document.getElementById('xray-modal-disable').addEventListener('click', async () => {
  if (!currentServerId) return;
  await api('POST', '/servers/' + currentServerId + '/xray/disable');
  toast('Anti-xray disabled', 'info');
  loadXrayStatus();
  document.getElementById('xray-modal').classList.add('hidden');
});

document.getElementById('xray-modal-install-orebfuscator').addEventListener('click', async () => {
  if (!currentServerId) return;
  showLoading();
  const btn = document.getElementById('xray-modal-install-orebfuscator');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Installing...';
  const result = await api('POST', '/servers/' + currentServerId + '/xray/orebfuscator/install');
  hideLoading();
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Install Orebfuscator';
  toast(result.message, result.success ? 'success' : 'info');
  if (result.success) document.getElementById('xray-modal').classList.add('hidden');
});

document.getElementById('xray-modal-remove-orebfuscator').addEventListener('click', async () => {
  if (!currentServerId) return;
  if (!confirm('Remove Orebfuscator?')) return;
  await api('POST', '/servers/' + currentServerId + '/xray/orebfuscator/remove');
  toast('Orebfuscator removed', 'info');
  document.getElementById('xray-modal').classList.add('hidden');
});

document.querySelector('#xray-modal .modal-close-btn').addEventListener('click', () => {
  document.getElementById('xray-modal').classList.add('hidden');
});

// ─── Crash Auto-Restart ──────────────────────────
async function loadCrashRestartSettings() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/crash-restart');
  if (data.error) return;
  document.getElementById('crash-restart-toggle').checked = data.enabled;
  document.getElementById('crash-restart-max').value = data.maxCrashes || 5;
  document.getElementById('crash-restart-label').textContent = data.enabled ? 'Enabled' : 'Disabled';
}

document.getElementById('crash-restart-toggle').addEventListener('change', async () => {
  if (!currentServerId) return;
  const enabled = document.getElementById('crash-restart-toggle').checked;
  const maxCrashes = parseInt(document.getElementById('crash-restart-max').value) || 5;
  document.getElementById('crash-restart-label').textContent = enabled ? 'Enabled' : 'Disabled';
  const result = await api('POST', '/servers/' + currentServerId + '/crash-restart', { enabled, maxCrashes });
  if (result.success) toast('Crash restart ' + (enabled ? 'enabled' : 'disabled'), 'success');
  else toast(result.error, 'error');
});

document.getElementById('crash-restart-max').addEventListener('change', async () => {
  if (!currentServerId) return;
  const enabled = document.getElementById('crash-restart-toggle').checked;
  const maxCrashes = parseInt(document.getElementById('crash-restart-max').value) || 5;
  const result = await api('POST', '/servers/' + currentServerId + '/crash-restart', { enabled, maxCrashes });
  if (result.success) toast('Max crashes updated to ' + maxCrashes, 'success');
});

// ─── Ban / Kick ─────────────────────────────────
async function loadBannedListDisplay() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/players/banned');
  const list = document.getElementById('banned-players-list');
  while (list.firstChild) list.removeChild(list.firstChild);
  if (!data.banned || data.banned.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No banned players</div>';
    return;
  }
  for (const b of data.banned) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border);font-size:12px;';
    el.innerHTML = '<i class="fas fa-ban" style="color:var(--red);font-size:10px;"></i><span style="flex:1;font-weight:500;">' + b.name + '</span><span style="color:var(--text-muted);font-size:10px;">' + (b.reason || '') + '</span>';
    list.appendChild(el);
  }
}

document.getElementById('bottombar-ban').addEventListener('click', () => {
  document.getElementById('ban-modal').classList.remove('hidden');
  loadBannedListDisplay();
});

document.querySelector('#ban-modal .modal-close-btn').addEventListener('click', () => document.getElementById('ban-modal').classList.add('hidden'));
document.getElementById('btn-ban-close').addEventListener('click', () => document.getElementById('ban-modal').classList.add('hidden'));

document.getElementById('btn-kick-player').addEventListener('click', async () => {
  const player = document.getElementById('ban-player-input').value.trim();
  const reason = document.getElementById('ban-reason-input').value.trim();
  if (!player) { toast('Enter a player name', 'error'); return; }
  if (!serverRunning) { toast('Server must be running', 'error'); return; }
  const result = await api('POST', '/servers/' + currentServerId + '/players/kick', { player, reason });
  if (result.success) toast('Kicked ' + player, 'info'); else toast(result.error, 'error');
  document.getElementById('ban-player-input').value = '';
});

document.getElementById('btn-ban-player').addEventListener('click', async () => {
  const player = document.getElementById('ban-player-input').value.trim();
  const reason = document.getElementById('ban-reason-input').value.trim();
  if (!player) { toast('Enter a player name', 'error'); return; }
  if (!serverRunning) { toast('Server must be running', 'error'); return; }
  const result = await api('POST', '/servers/' + currentServerId + '/players/ban', { player, reason });
  if (result.success) { toast('Banned ' + player, 'success'); loadBannedListDisplay(); } else toast(result.error, 'error');
});

document.getElementById('btn-unban-player').addEventListener('click', async () => {
  const player = document.getElementById('unban-player-input').value.trim();
  if (!player) { toast('Enter a player name', 'error'); return; }
  const result = await api('POST', '/servers/' + currentServerId + '/players/unban', { player });
  if (result.success) { toast('Unbanned ' + player, 'success'); loadBannedListDisplay(); } else toast(result.error, 'error');
});

// ─── Modal Helpers ───────────────────────────
document.querySelectorAll('.modal-overlay .modal-close-btn, .modal-overlay .btn-ghost[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.modal-overlay').classList.add('hidden');
  });
});

// ─── Whitelist ─────────────────────────────────
document.getElementById('bottombar-whitelist').addEventListener('click', () => {
  if (!currentServerId) return;
  document.getElementById('whitelist-modal').classList.remove('hidden');
  loadWhitelistDisplay();
});

async function loadWhitelistDisplay() {
  const data = await api('GET', '/servers/' + currentServerId + '/whitelist');
  const list = Array.isArray(data) ? data : [];
  const container = document.getElementById('whitelist-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:16px;text-align:center;">Whitelist is empty</div>';
    return;
  }
  for (const entry of list) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border);font-size:13px;';
    el.innerHTML = '<span><strong>' + entry.name + '</strong>' + (entry.uuid ? ' <span style="color:var(--text-muted);font-size:11px;font-family:var(--mono);">' + entry.uuid + '</span>' : '') + '</span>' +
      '<button class="btn-ghost danger" style="font-size:11px;padding:2px 8px;" data-player="' + entry.name + '"><i class="fas fa-times"></i> Remove</button>';
    el.querySelector('button').addEventListener('click', async () => {
      const r = await api('DELETE', '/servers/' + currentServerId + '/whitelist/' + entry.name);
      if (r.success) { toast('Removed ' + entry.name, 'success'); loadWhitelistDisplay(); } else toast(r.error, 'error');
    });
    container.appendChild(el);
  }
}

document.getElementById('whitelist-add-btn').addEventListener('click', async () => {
  const name = document.getElementById('whitelist-input').value.trim();
  if (!name) { toast('Enter a player name', 'error'); return; }
  const result = await api('POST', '/servers/' + currentServerId + '/whitelist', { name });
  if (result.success) { toast('Added ' + name, 'success'); document.getElementById('whitelist-input').value = ''; loadWhitelistDisplay(); }
  else toast(result.error, 'error');
});

document.getElementById('whitelist-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('whitelist-add-btn').click();
});

// ─── OPs ──────────────────────────────────────
document.getElementById('bottombar-ops').addEventListener('click', () => {
  if (!currentServerId) return;
  document.getElementById('ops-modal').classList.remove('hidden');
  loadOpsDisplay();
});

async function loadOpsDisplay() {
  const data = await api('GET', '/servers/' + currentServerId + '/ops');
  const list = Array.isArray(data) ? data : [];
  const container = document.getElementById('ops-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:16px;text-align:center;">No operators</div>';
    return;
  }
  for (const entry of list) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border);font-size:13px;';
    el.innerHTML = '<span><strong>' + entry.name + '</strong> <span style="color:var(--accent);font-size:11px;">Level ' + (entry.level || 4) + '</span></span>' +
      '<button class="btn-ghost danger" style="font-size:11px;padding:2px 8px;" data-player="' + entry.name + '"><i class="fas fa-times"></i> Deop</button>';
    el.querySelector('button').addEventListener('click', async () => {
      const r = await api('DELETE', '/servers/' + currentServerId + '/ops/' + entry.name);
      if (r.success) { toast('Deopped ' + entry.name, 'success'); loadOpsDisplay(); } else toast(r.error, 'error');
    });
    container.appendChild(el);
  }
}

document.getElementById('ops-add-btn').addEventListener('click', async () => {
  const name = document.getElementById('ops-input').value.trim();
  const level = parseInt(document.getElementById('ops-level').value);
  if (!name) { toast('Enter a player name', 'error'); return; }
  const result = await api('POST', '/servers/' + currentServerId + '/ops', { name, level });
  if (result.success) { toast('Opped ' + name, 'success'); document.getElementById('ops-input').value = ''; loadOpsDisplay(); }
  else toast(result.error, 'error');
});

document.getElementById('ops-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('ops-add-btn').click();
});

// Also close modals when clicking overlay background
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

// ─── Schedules Tab ──────────────────────────────
async function loadSchedules() {
  if (!currentServerId) return;
  const data = await api('GET', '/servers/' + currentServerId + '/schedules');
  const list = Array.isArray(data) ? data : [];
  const container = document.getElementById('schedules-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-clock"></i>No schedules yet</div>';
    return;
  }
  for (const s of list) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:var(--bg-card);';
    const actionLabels = { start_server: '▶ Start', stop_server: '■ Stop', restart_server: '⟳ Restart', create_backup: '⤴ Backup' };
    const nextDate = new Date(s.nextRun);
    el.innerHTML = `
      <span style="font-size:11px;font-weight:600;color:${s.disabled ? 'var(--text-muted)' : 'var(--accent)'}">${actionLabels[s.action] || s.action}</span>
      <span style="flex:1;font-size:13px;">${s.label || ''}</span>
      <span style="font-size:11px;color:var(--text-muted);">${s.interval ? 'Every ' + s.interval + ' min' : 'Once'}</span>
      <span style="font-size:11px;color:var(--text-muted);font-family:var(--mono);">${nextDate.toLocaleString()}</span>
      <button class="btn-ghost" style="font-size:11px;padding:2px 8px;" data-schedule-id="${s.id}">${s.disabled ? '<i class="fas fa-play"></i>' : '<i class="fas fa-pause"></i>'}</button>
      <button class="btn-ghost danger" style="font-size:11px;padding:2px 8px;" data-schedule-id="${s.id}"><i class="fas fa-trash"></i></button>
    `;
    const btns = el.querySelectorAll('button');
    btns[0].addEventListener('click', async () => {
      await api('POST', `/servers/${currentServerId}/schedules/${s.id}/toggle`);
      loadSchedules();
    });
    btns[1].addEventListener('click', async () => {
      if (!confirm('Delete schedule?')) return;
      await api('DELETE', `/servers/${currentServerId}/schedules/${s.id}`);
      loadSchedules();
    });
    container.appendChild(el);
  }
}

document.getElementById('schedule-add-btn').addEventListener('click', async () => {
  if (!currentServerId) return;
  const action = document.getElementById('schedule-action').value;
  const dtStr = document.getElementById('schedule-datetime').value;
  const interval = parseInt(document.getElementById('schedule-interval').value) || 0;
  const label = document.getElementById('schedule-label').value.trim() || action;
  if (!dtStr) { toast('Select a date/time', 'error'); return; }
  const runAt = new Date(dtStr).toISOString();
  const result = await api('POST', `/servers/${currentServerId}/schedules`, { action, runAt, interval: interval > 0 ? interval : null, label });
  if (result.success) { toast('Schedule added', 'success'); document.getElementById('schedule-label').value = ''; loadSchedules(); }
  else toast(result.error, 'error');
});

// Hook into tab switch for schedules
document.querySelector('.tab-btn[data-tab="schedules"]').addEventListener('click', () => {
  if (currentServerId) loadSchedules();
});

// ─── Delete Server ──────────────────────────────
document.getElementById('info-delete-btn').addEventListener('click', async () => {
  if (!currentServerId) return;
  if (!confirm('Delete "' + currentServerId + '"? All files will be lost.')) return;
  await api('DELETE', '/servers/' + currentServerId);
  toast('Server deleted', 'success');
  showListView();
  loadServers();
});

// ─── AI Bot tab refresh ─────────────────────────
document.querySelector('.tab-btn[data-tab="aibot"]').addEventListener('click', () => {
  if (currentServerId) loadAIBotStatus();
});

// ─── Init ───────────────────────────────────────
checkAuth();
