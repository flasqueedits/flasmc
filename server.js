const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Prevent unhandled promise rejections from crashing the process
process.on('unhandledRejection', (err) => {
  console.error('  [!] Unhandled rejection:', err?.message || err);
});
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const multer = require('multer');
const FlasmcDiscordBot = require('./discord-bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// In production (packaged Electron), store data in user data directory
const DATA_DIR = process.env.FLASMC_DATA_DIR || __dirname;

const SERVERS_DIR = path.join(DATA_DIR, 'servers');
const MEDIA_DIR = path.join(DATA_DIR, 'public', 'media');

// Discord bot (initialized after server starts)
let discordBot;

// AI Bot
const FlasmcAIBot = require('./ai-bot');
let aiBot;

// ─── Authentication ──────────────────────────────────────────────
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS = {}; // token -> { username, expiry }

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {}
  return {};
}

function saveUsers(users) {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch {}
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === derived;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, data] of Object.entries(SESSIONS)) {
    if (data.expiry < now) delete SESSIONS[token];
  }
}

// Auth middleware
function authRequired(req, res, next) {
  // Skip auth for login, health, and static files
  const publicPaths = ['/api/auth/login', '/api/auth/logout', '/api/auth/setup', '/api/health', '/api/auth/status'];
  if (publicPaths.includes(req.path)) return next();
  if (req.path.startsWith('/media/')) return next();

  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  cleanExpiredSessions();
  const session = SESSIONS[token];
  if (!session) return res.status(401).json({ error: 'Invalid or expired token' });

  req.authUser = session.username;
  next();
}

// Initialize users
let users = loadUsers();
const isFirstRun = Object.keys(users).length === 0;

// Body parser (must be before routes)
app.use(express.json({ limit: '50mb' }));
// In dev mode, the public dir is alongside server.js
const publicDirPath = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : path.join(DATA_DIR, 'public');
app.use(express.static(publicDirPath));
app.use('/media', express.static(MEDIA_DIR));

// Auth routes
app.post('/api/auth/setup', (req, res) => {
  if (!isFirstRun && Object.keys(loadUsers()).length > 0) {
    return res.status(400).json({ error: 'Already set up. Log in instead.' });
  }
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  users = {};
  users[username] = hashPassword(password);
  saveUsers(users);
  const token = generateToken();
  SESSIONS[token] = { username, expiry: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  res.json({ success: true, token, username, isNewSetup: true });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const usersNow = loadUsers();
  if (Object.keys(usersNow).length === 0) return res.status(400).json({ error: 'No users configured. First-time setup required.' });
  if (!usersNow[username]) return res.status(401).json({ error: 'Invalid credentials' });
  if (!verifyPassword(password, usersNow[username])) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken();
  SESSIONS[token] = { username, expiry: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  res.json({ success: true, token, username });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) delete SESSIONS[token];
  res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
  const token = req.headers['x-auth-token'];
  const usersNow = loadUsers();
  const hasUsers = Object.keys(usersNow).length > 0;
  if (token) {
    cleanExpiredSessions();
    const session = SESSIONS[token];
    if (session) return res.json({ authenticated: true, username: session.username, needsSetup: false });
  }
  res.json({ authenticated: false, username: null, needsSetup: !hasUsers });
});

// Apply auth middleware to all /api routes
app.use('/api', authRequired);

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SERVERS_DIR)) fs.mkdirSync(SERVERS_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
// Ensure public dir exists in data dir for media
const publicDir = path.join(DATA_DIR, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const serverId = req.params.id;
    const dir = path.join(MEDIA_DIR, serverId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: mediaStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|webm|mp3|ogg)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Only images, videos, and audio files allowed'));
    }
  }
});

// ─── Scheduler ──────────────────────────────────────────────────
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedules.json');
function loadSchedules() {
  try { return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8')); } catch { return []; }
}
function saveSchedules(schedules) {
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules, null, 2));
}

// Check schedules every 30 seconds
setInterval(() => {
  const now = new Date();
  const schedules = loadSchedules();
  for (const s of schedules) {
    if (s.disabled) continue;
    if (!s.serverId) continue;
    const nextRun = new Date(s.nextRun);
    if (nextRun <= now) {
      // Execute action
      if (s.action === 'start_server') {
        // We can only start via socket (requires a client), so we add to a pending queue
        // For now, just log it — full implementation would need server to manage processes
        io.to(s.serverId).emit('server:console', `\n[Scheduler] Starting ${s.serverId}...\n`);
        // Attempt to start server directly using the startServer helper
        startServerDirect(s.serverId);
      } else if (s.action === 'stop_server') {
        stopServerProcess(s.serverId);
        io.to(s.serverId).emit('server:console', `\n[Scheduler] Stopped ${s.serverId}\n`);
      } else if (s.action === 'restart_server') {
        stopServerProcess(s.serverId);
        io.to(s.serverId).emit('server:console', `\n[Scheduler] Restarting ${s.serverId} in 3s...\n`);
        setTimeout(() => startServerDirect(s.serverId), 3000);
      } else if (s.action === 'create_backup') {
        const backupDir = path.join(SERVERS_DIR, s.serverId, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        try {
          const zip = new AdmZip();
          const serverDir = path.join(SERVERS_DIR, s.serverId);
          const entries = fs.readdirSync(serverDir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name === 'backups' || e.name === 'libraries' || e.name === 'versions' || e.name.startsWith('.')) continue;
            const fullPath = path.join(serverDir, e.name);
            if (e.isDirectory()) zip.addLocalFolder(fullPath, e.name);
            else zip.addLocalFile(fullPath);
          }
          const backupName = `scheduled-backup-${Date.now()}.zip`;
          zip.writeZip(path.join(backupDir, backupName));
          io.to(s.serverId).emit('server:console', `\n[Scheduler] Backup created: ${backupName}\n`);
          // Cleanup old backups if retention set
          const retention = s.retention || 0;
          if (retention > 0) {
            try {
              const backupDir = path.join(SERVERS_DIR, s.serverId, 'backups');
              if (fs.existsSync(backupDir)) {
                const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('scheduled-backup-')).sort();
                while (backups.length > retention) {
                  fs.unlinkSync(path.join(backupDir, backups.shift()));
                }
              }
            } catch {}
          }
        } catch {}
      }
      // Compute next run
      if (s.interval) {
        const next = new Date(now.getTime() + s.interval * 60000);
        s.nextRun = next.toISOString();
      } else {
        // One-time task, disable it
        s.disabled = true;
      }
      saveSchedules(schedules);
    }
  }
}, 30000);

function startServerDirect(id) {
  const serverDir = path.join(SERVERS_DIR, id);
  if (!fs.existsSync(serverDir) || runningServers[id]) return;
  try {
    const jv = getJavaVersion();
    const configPath = path.join(serverDir, 'server-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    let ram = '4G';
    const propsPath = path.join(serverDir, 'server.properties');
    if (fs.existsSync(propsPath)) {
      const propsContent = fs.readFileSync(propsPath, 'utf-8');
      ram = '4G';
    }
    const proc = spawn('java', ['-Xms1G', '-Xmx' + ram, '-jar', 'server.jar', 'nogui'], { cwd: serverDir });
    runningServers[id] = { proc, socketIds: new Set(), startedAt: Date.now(), minRam: '1G', maxRam: ram };
    proc.stdout.on('data', (d) => { io.to(id).emit('server:console', d.toString()); });
    proc.stderr.on('data', (d) => { io.to(id).emit('server:console', d.toString()); });
    proc.on('close', (code) => {
      io.to(id).emit('server:console', `\n[Server closed with code ${code}]\n`);
      io.to(id).emit('server:status', code === 0 ? 'stopped' : 'crashed');
      if (runningServers[id]?.statsInterval) clearInterval(runningServers[id].statsInterval);
      delete runningServers[id];
      saveRunningState();
    });
    io.to(id).emit('server:status', 'running');
    saveRunningState();
  } catch (e) {
    io.to(id).emit('server:error', `Auto-start failed: ${e.message}`);
  }
}

// Schedule API routes
app.get('/api/servers/:id/schedules', (req, res) => {
  const all = loadSchedules();
  res.json(all.filter(s => s.serverId === req.params.id));
});

app.post('/api/servers/:id/schedules', (req, res) => {
  const { action, interval, runAt, label } = req.body;
  if (!action) return res.status(400).json({ error: 'Action required' });
  const schedule = {
    id: crypto.randomBytes(4).toString('hex'),
    serverId: req.params.id,
    action,
    label: label || action,
    interval: interval || null, // in minutes, null = one-time
    nextRun: runAt || new Date(Date.now() + 60000).toISOString(),
    disabled: false,
    createdAt: new Date().toISOString()
  };
  const all = loadSchedules();
  all.push(schedule);
  saveSchedules(all);
  res.json({ success: true, schedule });
});

app.delete('/api/servers/:id/schedules/:scheduleId', (req, res) => {
  let all = loadSchedules();
  all = all.filter(s => !(s.serverId === req.params.id && s.id === req.params.scheduleId));
  saveSchedules(all);
  res.json({ success: true });
});

app.post('/api/servers/:id/schedules/:scheduleId/toggle', (req, res) => {
  const all = loadSchedules();
  const s = all.find(s => s.serverId === req.params.id && s.id === req.params.scheduleId);
  if (!s) return res.status(404).json({ error: 'Not found' });
  s.disabled = !s.disabled;
  saveSchedules(all);
  res.json({ success: true, disabled: s.disabled });
});

// ─── API Routes ──────────────────────────────────────────────────

// Server list
app.get('/api/servers', (req, res) => {
  try {
    const dirs = fs.readdirSync(SERVERS_DIR, { withFileTypes: true });
    const servers = dirs.filter(d => d.isDirectory()).map(d => {
      const cfgPath = path.join(SERVERS_DIR, d.name, 'server-config.json');
      let config = {};
      try { config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch {}
      return { id: d.name, ...config };
    });
    res.json(servers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create server
app.post('/api/servers', async (req, res) => {
  const { id, type, version, anticheat, geyser, xray, minigame } = req.body;
  if (!id) return res.status(400).json({ error: 'Server ID required' });

  const serverDir = path.join(SERVERS_DIR, id);
  if (fs.existsSync(serverDir)) return res.status(400).json({ error: 'Server already exists' });

  fs.mkdirSync(serverDir, { recursive: true });

  try {
    if (type === 'paper') {
      const v = version?.version || '1.21';
      const b = version?.build || 'latest';
      let url;
      if (b === 'latest' || !b) {
        const verResp = await fetch(`https://api.papermc.io/v2/projects/paper/versions/${v}`);
        const verData = await verResp.json();
        const latestBuild = verData.builds[verData.builds.length - 1];
        url = `https://api.papermc.io/v2/projects/paper/versions/${v}/builds/${latestBuild}/downloads/paper-${v}-${latestBuild}.jar`;
      } else {
        url = `https://api.papermc.io/v2/projects/paper/versions/${v}/builds/${b}/downloads/paper-${v}-${b}.jar`;
      }
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(path.join(serverDir, 'server.jar'), buffer);
    } else if (type === 'vanilla') {
      const manifestResp = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      const manifest = await manifestResp.json();
      const vInfo = manifest.versions.find(v => v.id === (version?.version || '1.21'));
      if (vInfo) {
        const pkgResp = await fetch(vInfo.url);
        const pkg = await pkgResp.json();
        const jarResp = await fetch(pkg.downloads.server.url);
        fs.writeFileSync(path.join(serverDir, 'server.jar'), Buffer.from(await jarResp.arrayBuffer()));
      }
    }

    // EULA
    fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');

    // Default server.properties
    const propsPath = path.join(serverDir, 'server.properties');
    if (!fs.existsSync(propsPath)) {
      let props = '#Minecraft server properties\nmotd=A Flasmc Minecraft Server\nserver-port=25565\ngamemode=survival\ndifficulty=easy\nmax-players=20\nonline-mode=true\npvp=true\n';
      if (minigame) {
        props = '#Minecraft server properties (Minigame)\nmotd=§6§l⚡ Flasmc Minigame Server\nserver-port=25565\ngamemode=adventure\ndifficulty=normal\nmax-players=50\nonline-mode=true\npvp=true\nspawn-protection=0\n';
      }
      fs.writeFileSync(propsPath, props);
    }

    // Config
    const config = {
      type,
      version: version?.version || 'latest',
      anticheat: anticheat || false,
      geyser: geyser || false,
      xray: xray || false,
      minigame: minigame || false,
      crashRestart: true,
      maxCrashes: 5,
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(serverDir, 'server-config.json'), JSON.stringify(config, null, 2));

    // Auto-install anti-cheat if requested
    if (anticheat) {
      const pluginsDir = path.join(serverDir, 'plugins');
      if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
      try {
        const ac = ANTICHEAT_SOURCES.grim;
        const resp = await fetch(ac.url);
        if (resp.ok) {
          const buffer = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(path.join(pluginsDir, ac.file), buffer);
        }
      } catch {}
    }

    // Auto-install Geyser if requested
    if (geyser) {
      const pluginsDir = path.join(serverDir, 'plugins');
      if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
      for (const gs of Object.values(GEYSER_SOURCES)) {
        try {
          const resp = await fetch(gs.url);
          if (resp.ok) {
            const buffer = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(path.join(pluginsDir, gs.file), buffer);
          }
        } catch {}
      }
    }

    // Auto-install minigame plugins if requested
    if (minigame) {
      const pluginsDir = path.join(serverDir, 'plugins');
      if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
      for (const mg of MINIGAME_PLUGINS) {
        try {
          console.log(`  [Minigame] Downloading ${mg.name}...`);
          const resp = await fetch(mg.url);
          if (resp.ok) {
            const buffer = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(path.join(pluginsDir, mg.file), buffer);
            console.log(`  [Minigame] Installed ${mg.file}`);
          } else {
            console.log(`  [Minigame] Failed to download ${mg.name} (${resp.status})`);
          }
        } catch (err) {
          console.log(`  [Minigame] Error downloading ${mg.name}: ${err.message}`);
        }
      }
    }

    // Configure Paper anti-xray if requested
    if (xray && type === 'paper') {
      configurePaperAntiXray(serverDir);
    }

    const mg = minigame ? ', minigame plugins' : '';
    res.json({ success: true, id, anticheat: anticheat || false, geyser: geyser || false, xray: xray || false, minigame: minigame || false });
  } catch (err) {
    fs.rmSync(serverDir, { recursive: true, force: true });
    res.status(500).json({ error: err.message });
  }
});

// Delete server
app.delete('/api/servers/:id', (req, res) => {
  const dir = path.join(SERVERS_DIR, req.params.id);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
  stopServerProcess(req.params.id);
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ success: true });
});

// Server properties
app.get('/api/servers/:id/properties', (req, res) => {
  const propsPath = path.join(SERVERS_DIR, req.params.id, 'server.properties');
  if (!fs.existsSync(propsPath)) return res.json({});
  const content = fs.readFileSync(propsPath, 'utf-8');
  const props = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    props[t.substring(0, i).trim()] = t.substring(i + 1).trim();
  }
  res.json(props);
});

app.put('/api/servers/:id/properties', (req, res) => {
  const propsPath = path.join(SERVERS_DIR, req.params.id, 'server.properties');
  let content = '#Minecraft server properties\n#Generated by Flasmc\n' + new Date().toISOString() + '\n\n';
  for (const [k, v] of Object.entries(req.body)) {
    content += `${k}=${v}\n`;
  }
  fs.writeFileSync(propsPath, content);
  res.json({ success: true });
});

// ─── MOTD API ────────────────────────────────────
app.get('/api/servers/:id/motd', (req, res) => {
  const propsPath = path.join(SERVERS_DIR, req.params.id, 'server.properties');
  if (!fs.existsSync(propsPath)) return res.json({ motd: 'A Flasmc Minecraft Server' });
  const content = fs.readFileSync(propsPath, 'utf-8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.startsWith('motd=')) {
      let val = t.substring(5);
      // Replace \n escapes with actual newlines for the editor
      val = val.replace(/\\n/g, '\n');
      return res.json({ motd: val, raw: val });
    }
  }
  res.json({ motd: 'A Flasmc Minecraft Server' });
});

app.put('/api/servers/:id/motd', (req, res) => {
  const propsPath = path.join(SERVERS_DIR, req.params.id, 'server.properties');
  let newMotd = req.body.motd || '';
  // Replace actual newlines with \n escapes for properties file
  newMotd = newMotd.replace(/\n/g, '\\n');
  if (!fs.existsSync(propsPath)) return res.status(404).json({ error: 'No server.properties found' });
  let content = fs.readFileSync(propsPath, 'utf-8');
  if (content.match(/^motd=/m)) {
    content = content.replace(/^motd=.*$/m, 'motd=' + newMotd);
  } else {
    content += '\nmotd=' + newMotd + '\n';
  }
  fs.writeFileSync(propsPath, content);
  res.json({ success: true, motd: newMotd.replace(/\\n/g, '\n') });
});

// File tree (for browsing server files)
app.get('/api/servers/:id/files', (req, res) => {
  const dir = path.join(SERVERS_DIR, req.params.id);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
  try {
    const tree = buildTree(dir, dir);
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/servers/:id/files/read', (req, res) => {
  const filePath = path.join(SERVERS_DIR, req.params.id, req.query.path || '');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  if (fs.statSync(filePath).isDirectory()) return res.status(400).json({ error: 'Is a directory' });
  const ext = path.extname(filePath).toLowerCase();
  const binaryExts = ['.jar', '.zip', '.gz', '.tar', '.rar', '.7z', '.exe', '.dll', '.so', '.class', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.ogg', '.mp3', '.mp4', '.webm', '.webp'];
  if (binaryExts.includes(ext)) return res.json({ binary: true, size: fs.statSync(filePath).size });
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content, binary: false });
  } catch {
    res.json({ binary: true, size: fs.statSync(filePath).size });
  }
});

app.post('/api/servers/:id/files/write', (req, res) => {
  const filePath = path.join(SERVERS_DIR, req.params.id, req.body.path || '');
  if (!fs.existsSync(path.dirname(filePath))) return res.status(404).json({ error: 'Directory not found' });
  fs.writeFileSync(filePath, req.body.content || '', 'utf-8');
  res.json({ success: true });
});

app.delete('/api/servers/:id/files', (req, res) => {
  const filePath = path.join(SERVERS_DIR, req.params.id, req.query.path || '');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(filePath, { recursive: true, force: true });
  res.json({ success: true });
});

app.post('/api/servers/:id/files/mkdir', (req, res) => {
  const dirPath = path.join(SERVERS_DIR, req.params.id, req.body.path || '');
  if (fs.existsSync(dirPath)) return res.status(400).json({ error: 'Already exists' });
  fs.mkdirSync(dirPath, { recursive: true });
  res.json({ success: true });
});

app.post('/api/servers/:id/files/rename', (req, res) => {
  const oldPath = path.join(SERVERS_DIR, req.params.id, req.body.oldPath || '');
  const newPath = path.join(SERVERS_DIR, req.params.id, req.body.newPath || '');
  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Not found' });
  if (fs.existsSync(newPath)) return res.status(400).json({ error: 'Target already exists' });
  fs.renameSync(oldPath, newPath);
  res.json({ success: true });
});

const fileUpload = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(SERVERS_DIR, req.params.id, req.body.dir || '');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
}) });

app.post('/api/servers/:id/files/upload', fileUpload.single('file'), (req, res) => {
  res.json({ success: true, name: req.file.filename });
});

app.get('/api/servers/:id/files/download', (req, res) => {
  const filePath = path.join(SERVERS_DIR, req.params.id, req.query.path || '');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.download(filePath);
});

// ─── Server Thumbnail ───────────────────────
app.post('/api/servers/:id/thumbnail', (req, res) => {
  const serverDir = path.join(SERVERS_DIR, req.params.id);
  if (!fs.existsSync(serverDir)) return res.status(404).json({ error: 'Server not found' });
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image data' });
  const matches = image.match(/data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)/);
  if (!matches) return res.status(400).json({ error: 'Invalid image data (base64 PNG/JPEG/GIF/WEBP)' });
  const buffer = Buffer.from(matches[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 5MB)' });
  const thumbPath = path.join(serverDir, 'thumbnail.png');
  fs.writeFileSync(thumbPath, buffer);
  res.json({ success: true });
});

app.get('/api/servers/:id/thumbnail', (req, res) => {
  const thumbPath = path.join(SERVERS_DIR, req.params.id, 'thumbnail.png');
  if (!fs.existsSync(thumbPath)) return res.status(404).json({ error: 'No thumbnail' });
  res.sendFile(thumbPath);
});

app.delete('/api/servers/:id/thumbnail', (req, res) => {
  const thumbPath = path.join(SERVERS_DIR, req.params.id, 'thumbnail.png');
  if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  res.json({ success: true });
});

// Java detection & version check
function getJavaVersion() {
  try {
    const out = execSync('java -version 2>&1', { encoding: 'utf-8', timeout: 5000 });
    const m = out.match(/version\s+"?(\d+)/);
    const full = out.match(/(\d+\.\d+\.\d+[^"\s]*)/);
    if (m) {
      const major = parseInt(m[1]);
      return { found: true, major: major === 1 ? 8 : major, full: full ? full[1] : m[1] };
    }
    return { found: true, major: 8, full: 'unknown' };
  } catch {
    return { found: false, major: 0, full: null };
  }
}

function javaVersionSuffix(major) {
  if (major >= 21) return '';
  if (major >= 17) return '-java17';
  if (major >= 16) return '-java16';
  return '-java8';
}

app.get('/api/java/detect', (req, res) => {
  const jv = getJavaVersion();
  res.json({
    found: jv.found,
    path: 'java',
    version: jv.full,
    major: jv.major,
    compatible: jv.major >= 21,
    minRequired: 21,
    error: jv.found && jv.major < 21
      ? `Java ${jv.full} detected. Paper 1.21+ requires Java 21+. Install Java 21+ from https://adoptium.net`
      : jv.error
  });
});

// Versions (with Java compatibility check)
app.get('/api/versions/:type', async (req, res) => {
  const jv = getJavaVersion();
  try {
    if (req.params.type === 'paper') {
      const r = await fetch('https://api.papermc.io/v2/projects/paper');
      const d = await r.json();
      let versions = d.versions.reverse().slice(0, 20);
      res.json({
        java: { version: jv.full, major: jv.major, compatible: jv.major >= 21 },
        versions: versions.map(v => {
          const vMajor = parseInt(v.split('.')[1]) || 0;
          const needsJava21 = vMajor >= 21;
          const compatible = jv.major >= 21 || !needsJava21;
          return {
            version: v,
            name: `Paper ${v}${needsJava21 && !compatible ? ' (needs Java 21+)' : ''}`,
            compatible
          };
        })
      });
    } else if (req.params.type === 'vanilla') {
      const r = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      const d = await r.json();
      const versions = d.versions.filter(v => v.type === 'release').slice(0, 20);
      res.json({
        java: { version: jv.full, major: jv.major, compatible: jv.major >= 21 },
        versions: versions.map(v => {
          const vMajor = parseInt(v.id.split('.')[1]) || 0;
          const needsJava21 = vMajor >= 21;
          const compatible = jv.major >= 21 || !needsJava21;
          return {
            version: v.id,
            name: `Vanilla ${v.id}${needsJava21 && !compatible ? ' (needs Java 21+)' : ''}`,
            compatible
          };
        })
      });
    } else {
      res.json({ versions: [{ version: 'latest', name: 'Latest' }] });
    }
  } catch {
    res.json({
      java: { version: jv.full, major: jv.major, compatible: jv.major >= 21 },
      versions: [{ version: 'latest', name: 'Latest' }]
    });
  }
});

// ─── Media Upload API ────────────────────────────────────────────

app.post('/api/servers/:id/media/upload', upload.single('file'), (req, res) => {
  const serverId = req.params.id;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    success: true,
    url: `/media/${serverId}/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size
  });
});

app.get('/api/servers/:id/media', (req, res) => {
  const dir = path.join(MEDIA_DIR, req.params.id);
  if (!fs.existsSync(dir)) return res.json({ files: [] });
  try {
    const files = fs.readdirSync(dir).map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return {
        name: f,
        url: `/media/${req.params.id}/${f}`,
        size: stat.size,
        time: stat.mtimeMs,
        ext: path.extname(f).toLowerCase()
      };
    }).sort((a, b) => b.time - a.time);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/servers/:id/media/:file', (req, res) => {
  const fp = path.join(MEDIA_DIR, req.params.id, req.params.file);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── Anti-Cheat API ──────────────────────────────────────────────

const ANTICHEAT_SOURCES = {
  grim: {
    name: 'GrimAC',
    description: 'Free, open-source, actively maintained. Best for 1.21.4.',
    url: 'https://github.com/GrimAnticheat/Grim/releases/latest/download/Grim.jar',
    file: 'Grim.jar',
    configFiles: ['config.yml', 'messages.yml', 'permissions.yml']
  }
};

app.get('/api/servers/:id/anticheat', (req, res) => {
  const pluginsDir = path.join(SERVERS_DIR, req.params.id, 'plugins');
  const configPath = path.join(SERVERS_DIR, req.params.id, 'server-config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}

  const installed = [];
  for (const [key, ac] of Object.entries(ANTICHEAT_SOURCES)) {
    const jarPath = path.join(pluginsDir, ac.file);
    if (fs.existsSync(jarPath)) {
      const stat = fs.statSync(jarPath);
      const configs = {};
      for (const cf of ac.configFiles) {
        const cfp = path.join(pluginsDir, 'Grim', cf);
        if (fs.existsSync(cfp)) {
          configs[cf] = fs.readFileSync(cfp, 'utf-8');
        }
      }
      installed.push({
        key,
        name: ac.name,
        description: ac.description,
        size: stat.size,
        installedAt: stat.mtimeMs,
        configs
      });
    }
  }

  res.json({
    anticheat: config.anticheat || false,
    installed
  });
});

app.post('/api/servers/:id/anticheat/install', async (req, res) => {
  const serverDir = path.join(SERVERS_DIR, req.params.id);
  const pluginsDir = path.join(serverDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });

  const ac = ANTICHEAT_SOURCES.grim;
  const jarPath = path.join(pluginsDir, ac.file);

  if (fs.existsSync(jarPath)) {
    return res.json({ success: true, message: 'Already installed' });
  }

  // Update config
  const configPath = path.join(serverDir, 'server-config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  config.anticheat = true;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  try {
    const resp = await fetch(ac.url);
    if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(jarPath, buffer);
    res.json({ success: true, message: `Installed ${ac.name}` });
  } catch (err) {
    // Download failed — still mark as enabled but inform user
    res.json({
      success: true,
      message: `Marked as enabled. Download failed (no internet). Upload ${ac.file} manually to the plugins folder.`,
      downloadFailed: true,
      downloadUrl: ac.url
    });
  }
});

app.delete('/api/servers/:id/anticheat', (req, res) => {
  const pluginsDir = path.join(SERVERS_DIR, req.params.id, 'plugins');
  const configPath = path.join(SERVERS_DIR, req.params.id, 'server-config.json');

  for (const ac of Object.values(ANTICHEAT_SOURCES)) {
    const jarPath = path.join(pluginsDir, ac.file);
    if (fs.existsSync(jarPath)) fs.unlinkSync(jarPath);
    // Remove config folder
    const configDir = path.join(pluginsDir, 'Grim');
    if (fs.existsSync(configDir)) fs.rmSync(configDir, { recursive: true, force: true });
  }

  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  config.anticheat = false;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  res.json({ success: true, message: 'Anti-cheat removed' });
});

// ─── Geyser (Bedrock Edition Support) ───────────────────────────

const GEYSER_SOURCES = {
  geyser: {
    name: 'Geyser-Spigot',
    description: 'Allows Bedrock Edition players to join your Java server.',
    url: 'https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot',
    file: 'Geyser-Spigot.jar',
    configFiles: ['config.yml']
  },
  floodgate: {
    name: 'Floodgate',
    description: 'Allows Bedrock players to join without a Java account (for offline servers).',
    url: 'https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot',
    file: 'Floodgate-Spigot.jar',
    configFiles: ['config.yml']
  }
};

const MINIGAME_PLUGINS = [
  { name: 'BedWars1058', file: 'BedWars1058.jar', url: 'https://github.com/tommy356/BedWars1058/releases/latest/download/BedWars1058.jar' },
  { name: 'uSkyBlock', file: 'uSkyBlock.jar', url: 'https://github.com/rlf10/uSkyBlock/releases/latest/download/uSkyBlock.jar' },
  { name: 'Multiverse-Core', file: 'Multiverse-Core.jar', url: 'https://dev.bukkit.org/projects/multiverse-core/files/latest/download' },
  { name: 'Multiverse-Inventories', file: 'Multiverse-Inventories.jar', url: 'https://dev.bukkit.org/projects/multiverse-inventories/files/latest/download' },
  { name: 'EssentialsX', file: 'EssentialsX.jar', url: 'https://github.com/EssentialsX/Essentials/releases/latest/download/EssentialsX-2.21.1.jar' },
  { name: 'PlaceholderAPI', file: 'PlaceholderAPI.jar', url: 'https://github.com/PlaceholderAPI/PlaceholderAPI/releases/latest/download/PlaceholderAPI-2.11.6.jar' },
  { name: 'Vault', file: 'Vault.jar', url: 'https://github.com/MilkBowl/Vault/releases/latest/download/Vault.jar' },
  { name: 'LuckPerms', file: 'LuckPerms.jar', url: 'https://download.luckperms.net/1532/bukkit/loader/LuckPerms-Bukkit-5.4.163.jar' },
  { name: 'WorldEdit', file: 'WorldEdit.jar', url: 'https://dev.bukkit.org/projects/worldedit/files/latest/download' },
  { name: 'ClearLag', file: 'ClearLag.jar', url: 'https://github.com/psgsdev/Clearlag/releases/latest/download/Clearlag-3.1.3.jar' },
];

app.get('/api/servers/:id/geyser', (req, res) => {
  const pluginsDir = path.join(SERVERS_DIR, req.params.id, 'plugins');
  const configPath = path.join(SERVERS_DIR, req.params.id, 'server-config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}

  const installed = [];
  for (const [key, gs] of Object.entries(GEYSER_SOURCES)) {
    const jarPath = path.join(pluginsDir, gs.file);
    if (fs.existsSync(jarPath)) {
      const stat = fs.statSync(jarPath);
      installed.push({
        key,
        name: gs.name,
        file: gs.file,
        size: stat.size,
        installedAt: stat.mtimeMs
      });
    }
  }

  // Check if config.yml exists for Geyser to read port
  let bedrockPort = 19132;
  try {
    const geyserConfig = path.join(pluginsDir, 'Geyser-Spigot', 'config.yml');
    if (fs.existsSync(geyserConfig)) {
      const content = fs.readFileSync(geyserConfig, 'utf-8');
      const portMatch = content.match(/^\s*port:\s*(\d+)/m);
      if (portMatch) bedrockPort = parseInt(portMatch[1]);
    }
  } catch {}

  res.json({
    geyser: config.geyser || false,
    installed,
    bedrockPort
  });
});

app.post('/api/servers/:id/geyser/install', async (req, res) => {
  const serverDir = path.join(SERVERS_DIR, req.params.id);
  const pluginsDir = path.join(serverDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });

  // Update config
  const configPath = path.join(serverDir, 'server-config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  config.geyser = true;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const results = [];
  for (const [key, gs] of Object.entries(GEYSER_SOURCES)) {
    const jarPath = path.join(pluginsDir, gs.file);
    if (fs.existsSync(jarPath)) {
      results.push({ key, status: 'already-installed' });
      continue;
    }
    try {
      const resp = await fetch(gs.url);
      if (resp.ok) {
        const buffer = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(jarPath, buffer);
        results.push({ key, status: 'installed' });
      } else {
        results.push({ key, status: 'download-failed', error: `HTTP ${resp.status}` });
      }
    } catch (err) {
      results.push({ key, status: 'download-failed', error: err.message });
    }
  }

  // Also set online-mode=false in server.properties if floodgate is installed
  const propsPath = path.join(serverDir, 'server.properties');
  if (fs.existsSync(propsPath)) {
    let props = fs.readFileSync(propsPath, 'utf-8');
    if (props.includes('online-mode=true')) {
      props = props.replace('online-mode=true', 'online-mode=false');
      fs.writeFileSync(propsPath, props);
    } else if (!props.includes('online-mode=false')) {
      props += '\nonline-mode=false\n';
      fs.writeFileSync(propsPath, props);
    }
  }

  const allOk = results.every(r => r.status === 'installed' || r.status === 'already-installed');
  const someFailed = results.some(r => r.status === 'download-failed');

  res.json({
    success: allOk,
    message: allOk
      ? 'Geyser + Floodgate installed! Bedrock players can now connect on port 19132 (UDP).'
      : someFailed
        ? 'Partially installed. Some downloads failed — upload .jar files manually to plugins/.'
        : 'Already installed.',
    results
  });
});

app.delete('/api/servers/:id/geyser', (req, res) => {
  const pluginsDir = path.join(SERVERS_DIR, req.params.id, 'plugins');
  const configPath = path.join(SERVERS_DIR, req.params.id, 'server-config.json');

  for (const gs of Object.values(GEYSER_SOURCES)) {
    const jarPath = path.join(pluginsDir, gs.file);
    if (fs.existsSync(jarPath)) fs.unlinkSync(jarPath);
    // Remove config dirs
    for (const dirName of ['Geyser-Spigot', 'Floodgate']) {
      const configDir = path.join(pluginsDir, dirName);
      if (fs.existsSync(configDir)) fs.rmSync(configDir, { recursive: true, force: true });
    }
  }

  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  config.geyser = false;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  res.json({ success: true, message: 'Geyser + Floodgate removed' });
});

// ─── X-Ray Protection ───────────────────────────────────────────

function configurePaperAntiXray(serverDir) {
  // Paper 1.21.4 uses paper-global.yml (or paper-world.yml for per-world)
  // Best approach: use the global config or create it
  const globalConfigPath = path.join(serverDir, 'config', 'paper-global.yml');
  const worldConfigPath = path.join(serverDir, 'config', 'paper-world-defaults.yml');

  // Ensure config directory exists
  const configDir = path.join(serverDir, 'config');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  // Configure paper-global.yml
  let globalConfig = '';
  try { globalConfig = fs.readFileSync(globalConfigPath, 'utf-8'); } catch {}

  const antiXrayConfig = `
  anti-xray:
    enabled: true
    engine-mode: 2
    hidden-blocs:
    - chest
    - coal_ore
    - deepslate_coal_ore
    - iron_ore
    - deepslate_iron_ore
    - raw_iron_block
    - copper_ore
    - deepslate_copper_ore
    - raw_copper_block
    - gold_ore
    - deepslate_gold_ore
    - raw_gold_block
    - diamond_ore
    - deepslate_diamond_ore
    - emerald_ore
    - deepslate_emerald_ore
    - redstone_ore
    - deepslate_redstone_ore
    - lapis_ore
    - deepslate_lapis_ore
    - nether_gold_ore
    - nether_quartz_ore
    - ancient_debris
    lava-obscures: true
    use-permission: false
    hidden-blocks: []
    replacement-blocks:
    - stone
    - deepslate
    - netherrack
`;

  // Insert anti-xray into the global config
  if (!globalConfig.includes('anti-xray')) {
    globalConfig += `\nworld-settings:\n  default:\n${antiXrayConfig}`;
    try { fs.writeFileSync(globalConfigPath, globalConfig); } catch {}
  }

  // Also write paper-world-defaults.yml for older Paper versions
  let worldConfig = '';
  try { worldConfig = fs.readFileSync(worldConfigPath, 'utf-8'); } catch {}
  if (!worldConfig.includes('anti-xray')) {
    worldConfig = `# Paper world defaults\n_comment: "Configured by Flasmc"\n` + antiXrayConfig;
    try { fs.writeFileSync(worldConfigPath, worldConfig); } catch {}
  }

  // Also set in server.properties via paper settings commands — done via config files
}

const XRAY_SOURCES = {
  orebfuscator: {
    name: 'Orebfuscator',
    description: 'Advanced anti-xray plugin with more features than Paper built-in.',
    url: 'https://github.com/lishid/Orebfuscator/releases/latest/download/Orebfuscator.jar',
    file: 'Orebfuscator.jar',
    configFiles: ['config.yml']
  }
};

// ─── Minigame Plugin Manager ─────────────────────────────

app.get('/api/servers/:id/minigame', (req, res) => {
  const pluginsDir = path.join(SERVERS_DIR, req.params.id, 'plugins');
  const configPath = path.join(SERVERS_DIR, req.params.id, 'server-config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}

  const installed = [];
  for (const mg of MINIGAME_PLUGINS) {
    const jarPath = path.join(pluginsDir, mg.file);
    installed.push({
      name: mg.name,
      file: mg.file,
      installed: fs.existsSync(jarPath),
      size: fs.existsSync(jarPath) ? fs.statSync(jarPath).size : 0
    });
  }
  res.json({ minigame: config.minigame || false, plugins: installed });
});

app.post('/api/servers/:id/minigame/install', async (req, res) => {
  const serverDir = path.join(SERVERS_DIR, req.params.id);
  const pluginsDir = path.join(serverDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });

  const pluginName = req.body.plugin;
  const mg = MINIGAME_PLUGINS.find(p => p.name === pluginName);
  if (!mg) return res.status(400).json({ error: 'Plugin not found' });

  const jarPath = path.join(pluginsDir, mg.file);
  if (fs.existsSync(jarPath)) return res.json({ success: true, message: 'Already installed' });

  try {
    const resp = await fetch(mg.url);
    if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(jarPath, buffer);
    res.json({ success: true, message: `Installed ${mg.name}` });
  } catch (err) {
    res.json({ success: true, message: `Marked. Download failed - upload ${mg.file} manually.`, downloadFailed: true, downloadUrl: mg.url });
  }
});

app.post('/api/servers/:id/minigame/uninstall', (req, res) => {
  const pluginsDir = path.join(SERVERS_DIR, req.params.id, 'plugins');
  const pluginName = req.body.plugin;
  const mg = MINIGAME_PLUGINS.find(p => p.name === pluginName);
  if (!mg) return res.status(400).json({ error: 'Plugin not found' });
  const jarPath = path.join(pluginsDir, mg.file);
  if (fs.existsSync(jarPath)) fs.rmSync(jarPath);
  res.json({ success: true, message: `Removed ${mg.name}` });
});

// ─── X-Ray / Anti-Xray ───────────────────────────────────

app.get('/api/servers/:id/xray', (req, res) => {
  const serverDir = path.join(SERVERS_DIR, req.params.id);
  const configPath = path.join(serverDir, 'server-config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}

  // Check Paper anti-xray config
  let paperEnabled = false;
  try {
    const globalConfigPath = path.join(serverDir, 'config', 'paper-global.yml');
    if (fs.existsSync(globalConfigPath)) {
      const content = fs.readFileSync(globalConfigPath, 'utf-8');
      paperEnabled = content.includes('enabled: true') && content.includes('engine-mode: 2');
    }
  } catch {}

  // Check Orebfuscator plugin
  const pluginsDir = path.join(serverDir, 'plugins');
  const orebfuscatorInstalled = fs.existsSync(path.join(pluginsDir, 'Orebfuscator.jar'));

  res.json({
    xray: config.xray || false,
    paperAntiXray: paperEnabled,
    orebfuscator: orebfuscatorInstalled,
    engineMode: paperEnabled ? 2 : 0
  });
});

app.post('/api/servers/:id/xray/enable', (req, res) => {
  const serverDir = path.join(SERVERS_DIR, req.params.id);
  const configPath = path.join(serverDir, 'server-config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  config.xray = true;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  configurePaperAntiXray(serverDir);

  res.json({ success: true, message: 'Paper anti-xray enabled (engine-mode: 2)' });
});

app.post('/api/servers/:id/xray/disable', (req, res) => {
  const serverDir = path.join(SERVERS_DIR, req.params.id);
  const configPath = path.join(serverDir, 'server-config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  config.xray = false;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Disable by removing anti-xray from config
  try {
    const globalConfigPath = path.join(serverDir, 'config', 'paper-global.yml');
    if (fs.existsSync(globalConfigPath)) {
      let content = fs.readFileSync(globalConfigPath, 'utf-8');
      // Replace anti-xray block
      content = content.replace(/  anti-xray:\n(?:    .*\n?)*/g, '');
      content = content.replace(/world-settings:\n  default:\n/g, '');
      fs.writeFileSync(globalConfigPath, content);
    }
  } catch {}

  res.json({ success: true, message: 'X-ray protection disabled' });
});

app.post('/api/servers/:id/xray/orebfuscator/install', async (req, res) => {
  const pluginsDir = path.join(SERVERS_DIR, req.params.id, 'plugins');
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });

  const jarPath = path.join(pluginsDir, 'Orebfuscator.jar');
  if (fs.existsSync(jarPath)) return res.json({ success: true, message: 'Already installed' });

  try {
    const resp = await fetch('https://github.com/lishid/Orebfuscator/releases/latest/download/Orebfuscator.jar');
    if (resp.ok) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(jarPath, buffer);
      res.json({ success: true, message: 'Orebfuscator installed!' });
    } else {
      res.json({ success: false, message: 'Download failed. Install manually.', downloadUrl: 'https://github.com/lishid/Orebfuscator/releases' });
    }
  } catch {
    res.json({ success: false, message: 'Download failed (no internet). Install manually.', downloadUrl: 'https://github.com/lishid/Orebfuscator/releases' });
  }
});

app.post('/api/servers/:id/xray/orebfuscator/remove', (req, res) => {
  const jarPath = path.join(SERVERS_DIR, req.params.id, 'plugins', 'Orebfuscator.jar');
  if (fs.existsSync(jarPath)) fs.unlinkSync(jarPath);
  res.json({ success: true, message: 'Orebfuscator removed' });
});

// ─── Backup ─────────────────────────────────
app.get('/api/servers/:id/backups', (req, res) => {
  const backupDir = path.join(SERVERS_DIR, req.params.id, 'backups');
  if (!fs.existsSync(backupDir)) return res.json([]);
  try {
    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.zip')).map(f => {
      const stat = fs.statSync(path.join(backupDir, f));
      return { name: f, size: stat.size, modified: stat.mtimeMs, isScheduled: f.startsWith('scheduled-backup-') };
    }).sort((a, b) => b.modified - a.modified);
    res.json(backups);
  } catch {
    res.json([]);
  }
});

app.post('/api/servers/:id/backups', (req, res) => {
  const backupDir = path.join(SERVERS_DIR, req.params.id, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  try {
    const zip = new AdmZip();
    const serverDir = path.join(SERVERS_DIR, req.params.id);
    const entries = fs.readdirSync(serverDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'backups' || e.name === 'libraries' || e.name === 'versions' || e.name.startsWith('.')) continue;
      const fullPath = path.join(serverDir, e.name);
      if (e.isDirectory()) zip.addLocalFolder(fullPath, e.name);
      else zip.addLocalFile(fullPath);
    }
    const backupName = `backup-${Date.now()}.zip`;
    zip.writeZip(path.join(backupDir, backupName));
    res.json({ success: true, name: backupName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/servers/:id/backups/:name', (req, res) => {
  const filePath = path.join(SERVERS_DIR, req.params.id, 'backups', req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

app.get('/api/servers/:id/backups/retention', (req, res) => {
  const configPath = path.join(SERVERS_DIR, req.params.id, 'server-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    res.json({ retention: config.backupRetention || 0 });
  } catch {
    res.json({ retention: 0 });
  }
});

app.post('/api/servers/:id/backups/retention', (req, res) => {
  const configPath = path.join(SERVERS_DIR, req.params.id, 'server-config.json');
  try {
    let config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.backupRetention = req.body.retention || 0;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true, retention: config.backupRetention });
  } catch {
    res.status(500).json({ error: 'Failed to save' });
  }
});

// ─── Crash Auto-Restart Settings ─────────────
app.get('/api/servers/:id/crash-restart', (req, res) => {
  const configPath = path.join(SERVERS_DIR, req.params.id, 'server-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    res.json({ enabled: config.crashRestart !== false, maxCrashes: config.maxCrashes || 5, crashCount: config.crashCount || 0 });
  } catch {
    res.json({ enabled: true, maxCrashes: 5, crashCount: 0 });
  }
});

app.post('/api/servers/:id/crash-restart', (req, res) => {
  const configPath = path.join(SERVERS_DIR, req.params.id, 'server-config.json');
  try {
    let config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.crashRestart = req.body.enabled !== false;
    config.maxCrashes = req.body.maxCrashes || 5;
    config.crashCount = config.crashCount || 0;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true, enabled: config.crashRestart, maxCrashes: config.maxCrashes });
  } catch {
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// ─── Plugin/Mod Manager ──────────────────────────────────────────

const pluginUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(SERVERS_DIR, req.params.id, 'plugins');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.jar')) cb(null, true);
    else cb(new Error('Only .jar files allowed'));
  }
});

app.get('/api/servers/:id/plugins', (req, res) => {
  const pluginsDir = path.join(SERVERS_DIR, req.params.id, 'plugins');
  if (!fs.existsSync(pluginsDir)) return res.json({ plugins: [] });
  try {
    const plugins = fs.readdirSync(pluginsDir)
      .filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
      .map(f => {
        const fp = path.join(pluginsDir, f);
        const stat = fs.statSync(fp);
        const enabled = !f.endsWith('.disabled');
        const name = enabled ? f : f.replace('.disabled', '');
        return {
          name,
          displayName: name.replace('.jar', ''),
          fileName: f,
          enabled,
          size: stat.size,
          sizeFormatted: (stat.size / 1024 / 1024).toFixed(2) + ' MB',
          modified: stat.mtimeMs
        };
      }).sort((a, b) => a.displayName.localeCompare(b.displayName));
    res.json({ plugins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/servers/:id/plugins/upload', pluginUpload.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  res.json({
    success: true,
    count: req.files.length,
    files: req.files.map(f => ({ name: f.originalname, size: f.size }))
  });
});

app.post('/api/servers/:id/plugins/:file/toggle', (req, res) => {
  const pluginsDir = path.join(SERVERS_DIR, req.params.id, 'plugins');
  const file = req.params.file;
  const fp = path.join(pluginsDir, file);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  const enabled = file.endsWith('.disabled');
  const newName = enabled ? file.replace('.disabled', '') : file + '.disabled';
  fs.renameSync(fp, path.join(pluginsDir, newName));
  res.json({ success: true, enabled, fileName: newName });
});

app.delete('/api/servers/:id/plugins/:file', (req, res) => {
  const fp = path.join(SERVERS_DIR, req.params.id, 'plugins', req.params.file);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(fp);
  res.json({ success: true });
});

// Plugin store — browse popular plugins from Hangar
app.get('/api/plugins/browse', async (req, res) => {
  try {
    const categories = [
      { id: 'anticheat', name: 'Anti-Cheat' },
      { id: 'economy', name: 'Economy' },
      { id: 'minigame', name: 'Minigames' },
      { id: 'admin', name: 'Admin Tools' },
      { id: 'chat', name: 'Chat' },
      { id: 'world', name: 'World Management' }
    ];
    res.json({ categories });
  } catch { res.json({ categories: [] }); }
});

// ─── World Manager ───────────────────────────────────────────────

const worldUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(SERVERS_DIR, req.params.id, '__world_upload_temp');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.zip')) cb(null, true);
    else cb(new Error('Only .zip files allowed'));
  }
});

// ─── Discord Bot API ────────────────────────────────────────────

app.get('/api/discord/status', (req, res) => {
  if (!discordBot) return res.json({ connected: false });
  res.json(discordBot.getConfig());
});

app.post('/api/discord/start', async (req, res) => {
  const { token } = req.body;
  if (!discordBot) discordBot = new FlasmcDiscordBot(io, runningServers, SERVERS_DIR);
  if (token) discordBot.updateConfig({ token });
  await discordBot.start(token);
  res.json(discordBot.getConfig());
});

app.post('/api/discord/stop', async (req, res) => {
  if (discordBot) await discordBot.stop();
  res.json({ connected: false });
});

app.post('/api/discord/config', (req, res) => {
  if (!discordBot) discordBot = new FlasmcDiscordBot(io, runningServers, SERVERS_DIR);
  discordBot.updateConfig(req.body);
  res.json(discordBot.getConfig());
});

// ─── AI Bot API ────────────────────────────────────────────────

app.get('/api/ai-bot/:id', (req, res) => {
  if (!aiBot) aiBot = new FlasmcAIBot(io, runningServers, SERVERS_DIR);
  res.json(aiBot.getConfig(req.params.id));
});

app.post('/api/ai-bot/:id', (req, res) => {
  if (!aiBot) aiBot = new FlasmcAIBot(io, runningServers, SERVERS_DIR);
  const config = aiBot.updateConfig(req.params.id, req.body);
  res.json(config);
});

// ─── Event API ─────────────────────────────────────────────────────

app.get('/api/events/:id', (req, res) => {
  if (!aiBot) aiBot = new FlasmcAIBot(io, runningServers, SERVERS_DIR);
  res.json({ events: aiBot.getEvents(), nextEvent: aiBot.getNextEvent(req.params.id) });
});

app.post('/api/events/:id/trigger', (req, res) => {
  if (!aiBot) aiBot = new FlasmcAIBot(io, runningServers, SERVERS_DIR);
  const result = aiBot.triggerEvent(req.params.id, req.body.event);
  res.json(result || { error: 'Bot not connected' });
});

// ─── Ban / Kick API ──────────────────────────────────────────────

app.get('/api/servers/:id/players/banned', (req, res) => {
  const bannedPath = path.join(SERVERS_DIR, req.params.id, 'banned-players.json');
  if (!fs.existsSync(bannedPath)) return res.json({ banned: [] });
  try {
    const data = JSON.parse(fs.readFileSync(bannedPath, 'utf-8'));
    const banned = data.map(b => ({
      name: b.name || b.uuid,
      uuid: b.uuid,
      reason: b.reason || 'Banned',
      created: b.created || Date.now(),
      source: b.source || 'Unknown'
    }));
    res.json({ banned });
  } catch {
    res.json({ banned: [] });
  }
});

app.post('/api/servers/:id/players/ban', (req, res) => {
  const { player, reason } = req.body;
  if (!player) return res.status(400).json({ error: 'Player name required' });
  const proc = runningServers[req.params.id];
  if (proc && proc.proc.stdin) {
    const cmd = `ban ${player} ${reason || 'Banned by Flasmc'}`;
    proc.proc.stdin.write(cmd + '\n');
    io.to(req.params.id).emit('server:console', `\n[Flasmc] Ban: ${player}\n`);
    res.json({ success: true, message: `Ban command sent for ${player}` });
  } else {
    res.status(400).json({ error: 'Server not running' });
  }
});

app.post('/api/servers/:id/players/kick', (req, res) => {
  const { player, reason } = req.body;
  if (!player) return res.status(400).json({ error: 'Player name required' });
  const proc = runningServers[req.params.id];
  if (proc && proc.proc.stdin) {
    const cmd = `kick ${player} ${reason || 'Kicked by Flasmc'}`;
    proc.proc.stdin.write(cmd + '\n');
    io.to(req.params.id).emit('server:console', `\n[Flasmc] Kick: ${player}\n`);
    res.json({ success: true, message: `Kick command sent for ${player}` });
  } else {
    res.status(400).json({ error: 'Server not running' });
  }
});

app.post('/api/servers/:id/players/unban', (req, res) => {
  const { player } = req.body;
  if (!player) return res.status(400).json({ error: 'Player name required' });
  const proc = runningServers[req.params.id];
  if (proc && proc.proc.stdin) {
    proc.proc.stdin.write(`pardon ${player}\n`);
    io.to(req.params.id).emit('server:console', `\n[Flasmc] Unban: ${player}\n`);
    res.json({ success: true, message: `Unban command sent for ${player}` });
  } else {
    // Even if server is offline, try to edit the banned-players.json directly
    const bannedPath = path.join(SERVERS_DIR, req.params.id, 'banned-players.json');
    if (fs.existsSync(bannedPath)) {
      try {
        let data = JSON.parse(fs.readFileSync(bannedPath, 'utf-8'));
        data = data.filter(b => b.name !== player && b.uuid !== player);
        fs.writeFileSync(bannedPath, JSON.stringify(data, null, 2));
        res.json({ success: true, message: `${player} unbanned (offline)` });
      } catch {
        res.status(500).json({ error: 'Failed to edit ban list' });
      }
    } else {
      res.status(400).json({ error: 'Server not running and no ban list found' });
    }
  }
});

// ─── Whitelist ───────────────────────────────
function readJSONFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return []; }
}
function writeJSONFile(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); }

app.get('/api/servers/:id/whitelist', (req, res) => {
  const whitelistPath = path.join(SERVERS_DIR, req.params.id, 'whitelist.json');
  const whitelist = readJSONFile(whitelistPath);
  res.json(whitelist);
});

app.post('/api/servers/:id/whitelist', (req, res) => {
  const { name, uuid } = req.body;
  if (!name) return res.status(400).json({ error: 'Player name required' });
  const whitelistPath = path.join(SERVERS_DIR, req.params.id, 'whitelist.json');
  const whitelist = readJSONFile(whitelistPath);
  if (whitelist.some(w => w.name === name)) return res.status(400).json({ error: 'Already whitelisted' });
  whitelist.push({ name, uuid: uuid || '', added: new Date().toISOString() });
  writeJSONFile(whitelistPath, whitelist);
  // Reload whitelist on running server
  const proc = runningServers[req.params.id];
  if (proc && proc.proc.stdin) { proc.proc.stdin.write('whitelist reload\n'); }
  res.json({ success: true, whitelist });
});

app.delete('/api/servers/:id/whitelist/:player', (req, res) => {
  const whitelistPath = path.join(SERVERS_DIR, req.params.id, 'whitelist.json');
  const whitelist = readJSONFile(whitelistPath);
  const filtered = whitelist.filter(w => w.name !== req.params.player);
  writeJSONFile(whitelistPath, filtered);
  const proc = runningServers[req.params.id];
  if (proc && proc.proc.stdin) { proc.proc.stdin.write('whitelist reload\n'); }
  res.json({ success: true, whitelist: filtered });
});

// ─── OPs ─────────────────────────────────────
app.get('/api/servers/:id/ops', (req, res) => {
  const opsPath = path.join(SERVERS_DIR, req.params.id, 'ops.json');
  const ops = readJSONFile(opsPath);
  res.json(ops);
});

app.post('/api/servers/:id/ops', (req, res) => {
  const { name, uuid, level } = req.body;
  if (!name) return res.status(400).json({ error: 'Player name required' });
  const opsPath = path.join(SERVERS_DIR, req.params.id, 'ops.json');
  const ops = readJSONFile(opsPath);
  if (ops.some(o => o.name === name)) return res.status(400).json({ error: 'Already operator' });
  ops.push({ name, uuid: uuid || '', level: level || 4, added: new Date().toISOString() });
  writeJSONFile(opsPath, ops);
  const proc = runningServers[req.params.id];
  if (proc && proc.proc.stdin) { proc.proc.stdin.write(`op ${name}\n`); }
  res.json({ success: true, ops });
});

app.delete('/api/servers/:id/ops/:player', (req, res) => {
  const opsPath = path.join(SERVERS_DIR, req.params.id, 'ops.json');
  const ops = readJSONFile(opsPath);
  const filtered = ops.filter(o => o.name !== req.params.player);
  writeJSONFile(opsPath, filtered);
  const proc = runningServers[req.params.id];
  if (proc && proc.proc.stdin) { proc.proc.stdin.write(`deop ${req.params.player}\n`); }
  res.json({ success: true, ops: filtered });
});

app.get('/api/servers/:id/worlds', (req, res) => {
  const serverDir = path.join(SERVERS_DIR, req.params.id);
  if (!fs.existsSync(serverDir)) return res.status(404).json({ error: 'Not found' });
  try {
    const worlds = [];
    const entries = fs.readdirSync(serverDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      // Skip hidden and config directories
      if (name.startsWith('.') || name === 'plugins' || name === 'logs' || name === 'cache'
        || name === 'crash-reports' || name === 'libraries' || name === 'versions'
        || name === '__world_upload_temp') continue;
      // Check if it looks like a Minecraft world (has level.dat)
      const levelDat = path.join(serverDir, name, 'level.dat');
      const regionDir = path.join(serverDir, name, 'region');
      const stat = fs.statSync(path.join(serverDir, name));
      const size = getDirSize(path.join(serverDir, name));
      worlds.push({
        name,
        size,
        sizeFormatted: formatBytes(size),
        hasLevelDat: fs.existsSync(levelDat),
        hasRegion: fs.existsSync(regionDir),
        modified: stat.mtimeMs
      });
    }
    res.json({ worlds: worlds.sort((a, b) => b.modified - a.modified) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/servers/:id/worlds/download', async (req, res) => {
  const worldName = req.body.name;
  const worldDir = path.join(SERVERS_DIR, req.params.id, worldName);
  if (!fs.existsSync(worldDir)) return res.status(404).json({ error: 'World not found' });
  try {
    const zip = new AdmZip();
    zip.addLocalFolder(worldDir);
    const buf = zip.toBuffer();
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${worldName}.zip"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/servers/:id/worlds/upload', worldUpload.single('world'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const zipPath = req.file.path;
    const worldName = req.body.name || req.file.originalname.replace('.zip', '');
    const targetDir = path.join(SERVERS_DIR, req.params.id, worldName);

    if (fs.existsSync(targetDir)) {
      fs.rmSync(zipPath, { force: true });
      return res.status(400).json({ error: `World "${worldName}" already exists` });
    }

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(targetDir, true);

    // Check if the zip contained a single folder — if so, move contents up
    const entries = fs.readdirSync(targetDir);
    if (entries.length === 1 && fs.statSync(path.join(targetDir, entries[0])).isDirectory()) {
      const innerDir = path.join(targetDir, entries[0]);
      const innerEntries = fs.readdirSync(innerDir);
      for (const ie of innerEntries) {
        fs.renameSync(path.join(innerDir, ie), path.join(targetDir, ie));
      }
      fs.rmSync(innerDir, { recursive: true, force: true });
    }

    fs.rmSync(zipPath, { force: true });
    res.json({ success: true, name: worldName });
  } catch (err) {
    const zipPath = req.file.path;
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/servers/:id/worlds/:name', (req, res) => {
  const worldDir = path.join(SERVERS_DIR, req.params.id, req.params.name);
  if (!fs.existsSync(worldDir)) return res.status(404).json({ error: 'Not found' });
  // Safety: only delete if it looks like a world
  if (!fs.existsSync(path.join(worldDir, 'level.dat')) && !req.query.force) {
    return res.status(400).json({ error: 'Not a valid world (no level.dat). Use ?force=true to delete anyway.' });
  }
  fs.rmSync(worldDir, { recursive: true, force: true });
  res.json({ success: true });
});

// ─── Running Servers Status API ───────────────────────────────────

app.get('/api/servers/running', (req, res) => {
  const running = {};
  for (const [id, data] of Object.entries(runningServers)) {
    running[id] = { running: true, startedAt: data.startedAt || null };
  }
  res.json(running);
});

// ─── Production Health Check ─────────────────────────────────────

app.get('/api/health', (req, res) => {
  const jv = getJavaVersion();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    java: jv.found ? jv.full : 'not found',
    servers: fs.readdirSync(SERVERS_DIR).filter(d => {
      try { return fs.statSync(path.join(SERVERS_DIR, d)).isDirectory(); } catch { return false; }
    }).length,
    time: new Date().toISOString()
  });
});

// ─── Minecraft Server Process Management ─────────────────────────

const runningServers = {};
const STATE_FILE = path.join(SERVERS_DIR, '..', 'running-state.json');

// Persist running state to disk
function saveRunningState() {
  const state = {};
  for (const [id, data] of Object.entries(runningServers)) {
    state[id] = {
      minRam: data.minRam || '1G',
      maxRam: data.maxRam || '4G',
      startedAt: data.startedAt
    };
  }
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
}

function loadRunningState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function stopServerProcess(id) {
  if (runningServers[id]) {
    try {
      runningServers[id].proc.stdin.write('stop\n');
    } catch {}
    setTimeout(() => {
      try { runningServers[id].proc.kill(); } catch {}
      delete runningServers[id];
      saveRunningState();
    }, 5000);
  }
}

// Socket.IO auth middleware
io.use((socket, next) => {
  const token = socket.handshake.query.token || socket.handshake.headers['x-auth-token'];
  if (!token) return next(new Error('Authentication required'));
  cleanExpiredSessions();
  const session = SESSIONS[token];
  if (!session) return next(new Error('Invalid or expired token'));
  socket.authUser = session.username;
  next();
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id, '(user: ' + socket.authUser + ')');

  socket.on('server:start', async (data) => {
    const { id, minRam, maxRam, javaArgs } = data;
    const serverDir = path.join(SERVERS_DIR, id);
    if (!fs.existsSync(serverDir)) {
      socket.emit('server:error', 'Server directory not found');
      return;
    }

    if (runningServers[id]) {
      socket.emit('server:error', 'Server already running');
      return;
    }

    try {
      const config = JSON.parse(fs.readFileSync(path.join(serverDir, 'server-config.json'), 'utf-8'));
      const isBedrock = config.type === 'bedrock';

      // Check Java version for Java servers
      if (!isBedrock) {
        const jv = getJavaVersion();
        if (!jv.found) {
          io.to(id).emit('server:console', '\n[x] Java not found! Install Java 21+ from https://adoptium.net\n');
          socket.emit('server:error', 'Java not found — install Java 21+ from https://adoptium.net');
          return;
        }
        if (jv.major < 21) {
          const msg = `Java ${jv.full} detected — too old. Paper 1.21+ needs Java 21+.\n   📥 Download: https://adoptium.net\n   After installing, restart Flasmc and try again.`;
          io.to(id).emit('server:console', `\n[x] ${msg}\n`);
          socket.emit('server:error', `Java ${jv.full} is too old. Install Java 21+ from https://adoptium.net`);
          return;
        }
      }

      const proc = isBedrock
        ? spawn(path.join(serverDir, 'bedrock_server'), [], { cwd: serverDir })
        : spawn('java', [
            `-Xms${minRam || '1G'}`, `-Xmx${maxRam || '4G'}`,
            ...(javaArgs ? javaArgs.split(' ') : []),
            '-jar', 'server.jar', 'nogui'
          ], { cwd: serverDir });

      runningServers[id] = {
        proc, socketIds: new Set(), startedAt: Date.now(),
        minRam: minRam || '1G', maxRam: maxRam || '4G'
      };
      runningServers[id].socketIds.add(socket.id);
      saveRunningState();

      proc.stdout.on('data', (d) => {
        const text = d.toString();
        // Parse server stats from console output
        const tpsMatch = text.match(/AMS from last (\d+)s.*?mean\s*\/\s*(\d+\.?\d*)/i);
        const listMatch = text.match(/There are (\d+) of a max of (\d+) players online/i);
        const doneMatch = text.match(/Done \(([\d.]+)s\)!/);
        const memMatch = text.match(/Memory: (\d+\.?\d*)\s*\/\s*(\d+\.?\d*)\s*MB/i);
        if (tpsMatch) {
          const tps = parseFloat(tpsMatch[2]);
          io.to(id).emit('server:stats', { tps });
          if (discordBot) discordBot.updateStatus(id, { tps });
        }
        if (listMatch) {
          const players = parseInt(listMatch[1]);
          const maxPlayers = parseInt(listMatch[2]);
          io.to(id).emit('server:stats', { players, maxPlayers });
          if (discordBot) discordBot.updateStatus(id, { players });
        }
        if (doneMatch) {
          const startTime = parseFloat(doneMatch[1]);
          io.to(id).emit('server:stats', { startTime });
          if (discordBot) discordBot.sendToChannel(discordBot.consoleChannelId, `✅ **${id}** started in ${startTime}s!`);
        }
        if (memMatch) {
          io.to(id).emit('server:stats', { usedMem: parseFloat(memMatch[2]) - parseFloat(memMatch[1]), totalMem: parseFloat(memMatch[2]) });
        }
        io.to(id).emit('server:console', text);
        // Forward to Discord
        if (discordBot && discordBot.connected) discordBot.forwardConsole(id, text);
      });
      proc.stderr.on('data', (d) => {
        io.to(id).emit('server:console', d.toString());
      });
      proc.on('close', (code) => {
        io.to(id).emit('server:console', `\n[Server closed with code ${code}]\n`);
        io.to(id).emit('server:status', code === 0 ? 'stopped' : 'crashed');
        if (runningServers[id] && runningServers[id].statsInterval) {
          clearInterval(runningServers[id].statsInterval);
        }
        const oldProc = runningServers[id];
        delete runningServers[id];
        saveRunningState();

        // Auto-restart on crash
        if (code !== 0) {
          try {
            const cfgPath = path.join(SERVERS_DIR, id, 'server-config.json');
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
            if (cfg.crashRestart !== false) {
              const maxCrashes = cfg.maxCrashes || 5;
              cfg.crashCount = (cfg.crashCount || 0) + 1;
              fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
              if (cfg.crashCount <= maxCrashes) {
                const delay = Math.min(5000 * cfg.crashCount, 30000);
                io.to(id).emit('server:console', `\n[Auto-restart in ${delay/1000}s (attempt ${cfg.crashCount}/${maxCrashes})]\n`);
                setTimeout(async () => {
                  io.to(id).emit('server:console', `\n[Auto-restarting ${id}...]\n`);
                  try {
                    const jv = getJavaVersion();
                    const minRam = oldProc?.minRam || '1G';
                    const maxRam = oldProc?.maxRam || '4G';
                    const args = (oldProc?.javaArgs || '').split(' ').filter(Boolean);
                    const newProc = spawn('java', [
                      `-Xms${minRam}`, `-Xmx${maxRam}`, ...args, '-jar', 'server.jar', 'nogui'
                    ], { cwd: path.join(SERVERS_DIR, id) });
                    runningServers[id] = { proc: newProc, socketIds: new Set(), startedAt: Date.now(), minRam, maxRam };
                    newProc.stdout.on('data', (d) => { io.to(id).emit('server:console', d.toString()); });
                    newProc.stderr.on('data', (d) => { io.to(id).emit('server:console', d.toString()); });
                    newProc.on('close', (code2) => {
                      io.to(id).emit('server:console', `\n[Server closed with code ${code2}]\n`);
                      io.to(id).emit('server:status', code2 === 0 ? 'stopped' : 'crashed');
                      if (runningServers[id]?.statsInterval) clearInterval(runningServers[id].statsInterval);
                      delete runningServers[id];
                      saveRunningState();
                    });
                    io.to(id).emit('server:status', 'running');
                    saveRunningState();
                  } catch (e) {
                    io.to(id).emit('server:error', 'Auto-restart failed: ' + e.message);
                  }
                }, delay);
              } else {
                io.to(id).emit('server:console', `\n[Max restart attempts (${maxCrashes}) reached. Manual restart required.]\n`);
              }
            }
          } catch {}
        }
      });

      // Periodic server stats
      runningServers[id].statsInterval = setInterval(() => {
        try {
          if (proc.stdin && !proc.killed) {
            proc.stdin.write('tps\n');
            proc.stdin.write('list\n');
          }
        } catch {}
      }, 15000);

      socket.join(id);
      socket.emit('server:status', 'running');
      socket.emit('server:console', 'Server starting...\n');
    } catch (err) {
      socket.emit('server:error', err.message);
    }
  });

  socket.on('server:stop', (id) => {
    stopServerProcess(id);
  });

  socket.on('server:command', (data) => {
    const proc = runningServers[data.id];
    if (proc && proc.proc.stdin) {
      proc.proc.stdin.write(data.cmd + '\n');
    }
  });

  socket.on('server:subscribe', (id) => {
    socket.join(id);
    if (runningServers[id]) {
      runningServers[id].socketIds.add(socket.id);
      // Send current status to the newly connected client
      socket.emit('server:status', 'running');
      socket.emit('server:console', '\n[Server is already running]\n');
    } else {
      socket.emit('server:status', 'stopped');
    }
  });
});

// ─── Utility ─────────────────────────────────────────────────────

function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dirPath, e.name);
      if (e.isDirectory()) size += getDirSize(fp);
      else if (e.isFile()) size += fs.statSync(fp).size;
    }
  } catch {}
  return size;
}

function formatBytes(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function buildTree(dirPath, basePath) {
  basePath = basePath || dirPath;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const tree = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(basePath, fullPath).replace(/\\/g, '/');
    tree.push({
      name: entry.name,
      path: relPath,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: entry.isDirectory() ? null : fs.statSync(fullPath).size,
      ...(entry.isDirectory() ? { children: buildTree(fullPath, basePath) } : {})
    });
  }
  return tree.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ─── Start ───────────────────────────────────────────────────────

function tryListen(port) {
  server.listen(port, HOST);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`  Port ${port} is in use, trying ${port + 1}...`);
      tryListen(port + 1);
    } else {
      console.error('  Server error:', err.message);
      process.exit(1);
    }
  });
}

server.on('listening', () => {
  const addr = server.address();
  const url = HOST === '0.0.0.0' ? `http://localhost:${addr.port}` : `http://${HOST}:${addr.port}`;
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║        ✦ Flasmc Server Manager            ║
  ║                                              ║
  ║   🌐 Local:    ${url.padEnd(40)}
  ║   📁 Servers:  ${(fs.readdirSync(SERVERS_DIR).filter(d => {
    try { return fs.statSync(path.join(SERVERS_DIR, d)).isDirectory(); } catch { return false; }
  }).length + ' created').padEnd(40)}
  ║   ☕ Java:     ${(getJavaVersion().found ? getJavaVersion().full : 'not found').padEnd(40)}
  ║                                              ║
  ║   Press Ctrl+C to stop                       ║
  ╚═══════════════════════════════════════════════╝
  `);

  // Notify parent process (Electron) that server is ready
  if (process.send) process.send('server-listening');

  // Auto-start Discord bot if token is configured
  discordBot = new FlasmcDiscordBot(io, runningServers, SERVERS_DIR);
  if (process.env.DISCORD_TOKEN) {
    discordBot.start().catch(() => {});
  }

  // Initialize AI Bot
  aiBot = new FlasmcAIBot(io, runningServers, SERVERS_DIR);
  aiBot.startAll();

  // Auto-restart servers that were running before restart
  const previousState = loadRunningState();
  for (const [id, state] of Object.entries(previousState)) {
    const serverDir = path.join(SERVERS_DIR, id);
    if (fs.existsSync(serverDir)) {
      console.log(`  ♻️ Auto-restarting ${id} (was running before restart)...`);
      setTimeout(() => {
        io.emit('server:console', `\n[Auto-restarting ${id} — was running before restart]\n`);
        // Spawn directly without socket
        const proc = spawn('java', [
          `-Xms${state.minRam || '1G'}`, `-Xmx${state.maxRam || '4G'}`,
          '-jar', 'server.jar', 'nogui'
        ], { cwd: serverDir });
        runningServers[id] = { proc, socketIds: new Set(), startedAt: Date.now(), minRam: state.minRam, maxRam: state.maxRam };
        proc.stdout.on('data', (d) => { io.to(id).emit('server:console', d.toString()); });
        proc.stderr.on('data', (d) => { io.to(id).emit('server:console', d.toString()); });
        proc.on('close', (code) => {
          io.to(id).emit('server:console', `\n[Server closed with code ${code}]\n`);
          io.to(id).emit('server:status', code === 0 ? 'stopped' : 'crashed');
          if (runningServers[id]?.statsInterval) clearInterval(runningServers[id].statsInterval);
          delete runningServers[id];
          saveRunningState();
          // This is an auto-restart scenario; no further auto-restart chaining to avoid loops
        });
        io.to(id).emit('server:status', 'running');
        io.to(id).emit('server:console', 'Server auto-restarted after Flasmc restart...\n');
      }, 2000);
    }
  }
});

// Handle process signals gracefully
process.on('SIGINT', () => {
  console.log('\n  Shutting down...');
  if (aiBot) aiBot.stopAll();
  for (const id of Object.keys(runningServers)) {
    stopServerProcess(id);
  }
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  if (aiBot) aiBot.stopAll();
  for (const id of Object.keys(runningServers)) {
    stopServerProcess(id);
  }
  server.close(() => process.exit(0));
});

tryListen(PORT);
