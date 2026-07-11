const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const FlasmcDiscordBot = require('./discord-bot');

const PORT = parseInt(process.env.DISCORD_APP_PORT) || 3001;
const DATA_DIR = process.env.FLASMC_DATA_DIR || __dirname;
const CONFIG_PATH = path.join(DATA_DIR, 'discord-config.json');
const webDir = path.join(__dirname, 'public');

const app = express();
app.use(express.json());
app.use(express.static(webDir));

let discordBot = null;

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// Serve bot-specific UI
app.get('/', (req, res) => {
  res.sendFile(path.join(webDir, 'discord-app.html'));
});

// API: Get bot status
app.get('/api/status', (req, res) => {
  const cfg = loadConfig();
  res.json({
    connected: discordBot?.connected || false,
    hasToken: !!cfg.token,
    botUser: discordBot?.client?.user?.tag || null,
    prefix: cfg.prefix || '!',
    consoleChannelId: cfg.consoleChannelId || null,
    statusChannelId: cfg.statusChannelId || null,
    backupsChannelId: cfg.backupsChannelId || null
  });
});

// API: Update config and start/stop
app.post('/api/config', (req, res) => {
  const { token, consoleChannelId, statusChannelId, backupsChannelId, prefix, action } = req.body;
  const cfg = loadConfig();
  if (token !== undefined) cfg.token = token;
  if (consoleChannelId !== undefined) cfg.consoleChannelId = consoleChannelId;
  if (statusChannelId !== undefined) cfg.statusChannelId = statusChannelId;
  if (backupsChannelId !== undefined) cfg.backupsChannelId = backupsChannelId;
  if (prefix !== undefined) cfg.prefix = prefix;
  saveConfig(cfg);

  if (action === 'start') {
    if (!cfg.token) return res.json({ error: 'Token required' });
    if (!discordBot) {
      discordBot = new FlasmcDiscordBot(null, {}, DATA_DIR);
      discordBot.io = null;
      discordBot.runningServers = {};
      discordBot.serversDir = DATA_DIR;
    }
    discordBot.start(cfg.token).catch(err => console.error('Bot start error:', err));
    res.json({ success: true, message: 'Starting bot...' });
  } else if (action === 'stop') {
    if (discordBot) discordBot.stop();
    res.json({ success: true, message: 'Bot stopped' });
  } else {
    res.json({ success: true });
  }
});

// API: Send console command to main server
app.post('/api/console', async (req, res) => {
  const { server, command } = req.body;
  try {
    const resp = await fetch(`http://127.0.0.1:3000/api/servers/${server}/console`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: command })
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.json({ error: 'Main server not reachable: ' + err.message });
  }
});

// API: Get servers from main server
app.get('/api/servers', async (req, res) => {
  try {
    const resp = await fetch('http://127.0.0.1:3000/api/servers');
    const data = await resp.json();
    res.json(data);
  } catch {
    res.json({ servers: [] });
  }
});

const server = http.createServer(app);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`  🌐 Discord Bot App running at http://127.0.0.1:${PORT}`);
  console.log(`  📝 Configure your bot token and settings in the web UI`);

  // Auto-start if token exists
  const cfg = loadConfig();
  if (cfg.token) {
    console.log('  🤖 Token found, starting Discord bot...');
    discordBot = new FlasmcDiscordBot(null, {}, DATA_DIR);
    discordBot.io = null;
    discordBot.runningServers = {};
    discordBot.serversDir = DATA_DIR;
    discordBot.start(cfg.token).catch(() => {});
  }
});
