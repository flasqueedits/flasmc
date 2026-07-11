const { Client, GatewayIntentBits, Events, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const SERVERS_CACHE = new Map();
const PING_DATA = { start: 0 };

class FlasmcDiscordBot {
  constructor(io, runningServers, serverDir) {
    this.io = io;
    this.runningServers = runningServers;
    this.serverDir = serverDir;
    this.client = null;
    this.connected = false;
    this.consoleChannelId = null;
    this.statusChannelId = null;
    this.backupsChannelId = null;
    this.lastStatus = {};
    this.startTime = 0;
    this.prefix = '!';
    this.loadConfig();
  }

  loadConfig() {
    const configPath = path.join(this.serverDir, '..', 'discord-config.json');
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      this.token = cfg.token || process.env.DISCORD_TOKEN || null;
      this.consoleChannelId = cfg.consoleChannelId || null;
      this.statusChannelId = cfg.statusChannelId || null;
      this.backupsChannelId = cfg.backupsChannelId || null;
      this.prefix = cfg.prefix || '!';
    } catch {
      this.token = process.env.DISCORD_TOKEN || null;
    }
  }

  saveConfig() {
    const configPath = path.join(this.serverDir, '..', 'discord-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      token: this.token,
      consoleChannelId: this.consoleChannelId,
      statusChannelId: this.statusChannelId,
      backupsChannelId: this.backupsChannelId,
      prefix: this.prefix
    }, null, 2));
  }

  // ─── Slash Command Definitions ──────────────────────────────

  getSlashCommands() {
    return [
      new SlashCommandBuilder().setName('status').setDescription('Check server status').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(false)),
      new SlashCommandBuilder().setName('start').setDescription('Start a server').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('stop').setDescription('Stop a server').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('restart').setDescription('Restart a server').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('list').setDescription('List players on a server').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('console').setDescription('Run a console command').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('command').setDescription('Command to run').setRequired(true)),
      new SlashCommandBuilder().setName('create').setDescription('Create a new server').addStringOption(o => o.setName('name').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('type').setDescription('paper or vanilla').setRequired(false)).addStringOption(o => o.setName('version').setDescription('Minecraft version').setRequired(false)),
      new SlashCommandBuilder().setName('delete').setDescription('Delete a server').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('servers').setDescription('List all servers'),
      new SlashCommandBuilder().setName('info').setDescription('Detailed server info').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('motd').setDescription('Get or set MOTD').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('message').setDescription('New MOTD text').setRequired(false)),
      new SlashCommandBuilder().setName('say').setDescription('Broadcast a message to the server').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('message').setDescription('Message to broadcast').setRequired(true)),
      new SlashCommandBuilder().setName('kick').setDescription('Kick a player').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
      new SlashCommandBuilder().setName('ban').setDescription('Ban a player').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
      new SlashCommandBuilder().setName('unban').setDescription('Unban a player').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true)),
      new SlashCommandBuilder().setName('whitelist').setDescription('Manage whitelist').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('action').setDescription('add, remove, or list').setRequired(true)).addStringOption(o => o.setName('player').setDescription('Player name').setRequired(false)),
      new SlashCommandBuilder().setName('op').setDescription('Add operator').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true)),
      new SlashCommandBuilder().setName('deop').setDescription('Remove operator').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true)),
      new SlashCommandBuilder().setName('backup').setDescription('Create or list backups').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('action').setDescription('create or list').setRequired(true)),
      new SlashCommandBuilder().setName('backup-delete').setDescription('Delete a backup').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('name').setDescription('Backup name').setRequired(true)),
      new SlashCommandBuilder().setName('plugins').setDescription('List plugins').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('plugin').setDescription('Enable/disable/delete a plugin').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('action').setDescription('enable, disable, or delete').setRequired(true)).addStringOption(o => o.setName('plugin').setDescription('Plugin name').setRequired(true)),
      new SlashCommandBuilder().setName('worlds').setDescription('List worlds').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('schedules').setDescription('List schedules').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('properties').setDescription('List server properties').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('prop-set').setDescription('Set a server property').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('key').setDescription('Property key').setRequired(true)).addStringOption(o => o.setName('value').setDescription('Property value').setRequired(true)),
      new SlashCommandBuilder().setName('gamemode').setDescription('Set server gamemode').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('mode').setDescription('survival, creative, adventure, spectator').setRequired(true)),
      new SlashCommandBuilder().setName('difficulty').setDescription('Set server difficulty').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('level').setDescription('peaceful, easy, normal, hard').setRequired(true)),
      new SlashCommandBuilder().setName('time').setDescription('Set server time').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('value').setDescription('day, night, noon, midnight, or tick').setRequired(true)),
      new SlashCommandBuilder().setName('weather').setDescription('Set server weather').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)).addStringOption(o => o.setName('type').setDescription('clear, rain, thunder').setRequired(true)),
      new SlashCommandBuilder().setName('tps').setDescription('Show server TPS').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('memory').setDescription('Show server memory usage').addStringOption(o => o.setName('server').setDescription('Server name').setRequired(true)),
      new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
      new SlashCommandBuilder().setName('uptime').setDescription('Check bot uptime'),
      new SlashCommandBuilder().setName('about').setDescription('About Flasmc Bot'),
      new SlashCommandBuilder().setName('invite').setDescription('Get bot invite link'),
      new SlashCommandBuilder().setName('setup').setDescription('Auto-create Flasmc channel structure').addStringOption(o => o.setName('language').setDescription('Channel language').setRequired(false).addChoices({ name: '🇹🇷 Türkçe', value: 'tr' }, { name: '🇺🇸 English', value: 'en' }, { name: '🌍 Both (TR + EN)', value: 'all' })),
      new SlashCommandBuilder().setName('lock').setDescription('Lock a channel (disable send messages)').addChannelOption(o => o.setName('channel').setDescription('Channel to lock').setRequired(false)),
      new SlashCommandBuilder().setName('unlock').setDescription('Unlock a channel (enable send messages)').addChannelOption(o => o.setName('channel').setDescription('Channel to unlock').setRequired(false)),
      new SlashCommandBuilder().setName('prefix').setDescription('Change bot prefix').addStringOption(o => o.setName('newprefix').setDescription('New prefix character(s)').setRequired(true)),
      new SlashCommandBuilder().setName('role').setDescription('Send role selection panel'),
      new SlashCommandBuilder().setName('language').setDescription('Send language selection menu'),
      new SlashCommandBuilder().setName('help').setDescription('Show all commands').addStringOption(o => o.setName('category').setDescription('Command category').setRequired(false).addChoices({ name: 'Server', value: 'server' }, { name: 'Player', value: 'player' }, { name: 'Management', value: 'management' }, { name: 'Bot', value: 'bot' })),
    ];
  }

  // ─── Start / Stop ──────────────────────────────────────────

  async start(token) {
    if (this.connected) return;
    if (token) this.token = token;
    if (!this.token) return;

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });

    this.client.on(Events.ClientReady, async () => {
      this.connected = true;
      this.startTime = Date.now();
      console.log(`  🤖 Discord bot connected as ${this.client.user.tag}`);
      this.saveConfig();
      await this.registerSlashCommands();
    });

    this.client.on(Events.MessageCreate, (msg) => this.handleMessage(msg));
    this.client.on(Events.InteractionCreate, (interaction) => this.handleInteraction(interaction));
    this.client.on(Events.Error, (err) => console.error('  Discord bot error:', err.message));

    try {
      await this.client.login(this.token);
    } catch (err) {
      console.error('  Discord bot login failed:', err.message);
      this.connected = false;
    }
  }

  async stop() {
    if (this.client) {
      this.connected = false;
      await this.client.destroy();
      this.client = null;
    }
  }

  async registerSlashCommands() {
    try {
      const rest = new REST({ version: '10' }).setToken(this.token);
      const commands = this.getSlashCommands().map(c => c.toJSON());
      await rest.put(Routes.applicationCommands(this.client.user.id), { body: commands });
      console.log(`  ✅ Registered ${commands.length} slash commands`);
    } catch (err) {
      console.error('  ❌ Failed to register slash commands:', err.message);
    }
  }

  // ─── Message Handler (!prefix) ─────────────────────────────

  async handleMessage(msg) {
    if (msg.author.bot) return;
    if (!msg.content.startsWith(this.prefix)) return;
    const args = msg.content.slice(this.prefix.length).trim().split(/\s+/);
    const cmd = args[0].toLowerCase();
    const sid = args[1];
    const rest = args.slice(2).join(' ');

    const handlers = {
      status: () => this.cmdStatus(msg, sid),
      start: () => this.cmdStart(msg, sid),
      stop: () => this.cmdStop(msg, sid),
      restart: () => this.cmdRestart(msg, sid),
      list: () => this.cmdList(msg, sid),
      console: () => this.cmdConsole(msg, sid, rest),
      say: () => rest ? this.cmdSay(msg, sid, rest) : msg.reply('Usage: !say <server> <message>'),
      create: () => this.cmdCreate(msg, args.slice(1)),
      delete: () => this.cmdDelete(msg, sid),
      servers: () => this.cmdServers(msg),
      info: () => this.cmdInfo(msg, sid),
      motd: () => this.cmdMotd(msg, sid, rest),
      kick: () => this.cmdKick(msg, sid, args[2], rest),
      ban: () => this.cmdBan(msg, sid, args[2], rest),
      unban: () => this.cmdUnban(msg, sid, args[2]),
      whitelist: () => this.cmdWhitelist(msg, sid, args[2], args.slice(3).join(' ')),
      op: () => this.cmdOp(msg, sid, args[2]),
      deop: () => this.cmdDeop(msg, sid, args[2]),
      backup: () => this.cmdBackup(msg, sid, args[2]),
      'backup-delete': () => this.cmdBackupDelete(msg, sid, args[2]),
      plugins: () => this.cmdPlugins(msg, sid),
      plugin: () => this.cmdPlugin(msg, sid, args[2], args[3]),
      worlds: () => this.cmdWorlds(msg, sid),
      schedules: () => this.cmdSchedules(msg, sid),
      properties: () => this.cmdProperties(msg, sid),
      'prop-set': () => this.cmdPropSet(msg, sid, args[2], args.slice(3).join(' ')),
      tps: () => this.cmdTps(msg, sid),
      memory: () => this.cmdMemory(msg, sid),
      gamemode: () => this.cmdGamemode(msg, sid, args[2]),
      difficulty: () => this.cmdDifficulty(msg, sid, args[2]),
      time: () => this.cmdTime(msg, sid, args[2]),
      weather: () => this.cmdWeather(msg, sid, args[2]),
      ping: () => this.cmdPing(msg),
      uptime: () => this.cmdUptime(msg),
      about: () => this.cmdAbout(msg),
      invite: () => this.cmdInvite(msg),
      setup: () => this.cmdSetup(msg, args[1]),
      lock: () => this.cmdLock(msg, args[1]),
      unlock: () => this.cmdUnlock(msg, args[1]),
      prefix: () => this.cmdPrefix(msg, args[1]),
      help: () => this.cmdHelp(msg, args[1]),
      deploy: () => this.cmdDeploy(msg),
      role: () => this.cmdRole(msg),
      language: () => this.cmdLanguage(msg),
    };
    if (handlers[cmd]) await handlers[cmd]();
    else if (cmd) await msg.reply(`Unknown command \`${cmd}\`. Use \`!help\``);
  }

  // ─── Interaction Handler (/slash) ──────────────────────────

  async handleInteraction(interaction) {
    // Handle button clicks for role toggle
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('role_')) {
        const roleId = interaction.customId.slice(5);
        const role = interaction.guild?.roles.cache.get(roleId);
        if (!role) return interaction.reply({ content: '❌ Role not found', ephemeral: true });
        if (interaction.member.roles.cache.has(roleId)) {
          await interaction.member.roles.remove(role);
          await interaction.reply({ content: `✅ Removed role **${role.name}**`, ephemeral: true });
        } else {
          await interaction.member.roles.add(role);
          await interaction.reply({ content: `✅ Given role **${role.name}**`, ephemeral: true });
        }
      }
      return;
    }

    // Handle select menu for language
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'lang_select') {
        const lang = interaction.values[0];
        const langNames = { lang_tr: 'Türkçe', lang_en: 'English', lang_de: 'Deutsch', lang_fr: 'Français', lang_es: 'Español' };
        await interaction.reply({ content: `🌍 Language set to **${langNames[lang] || lang}**`, ephemeral: true });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;
    const sid = interaction.options.getString('server');
    const get = (n) => interaction.options.getString(n);

    const handlers = {
      status: () => this.cmdStatus(interaction, sid),
      start: () => this.cmdStart(interaction, sid),
      stop: () => this.cmdStop(interaction, sid),
      restart: () => this.cmdRestart(interaction, sid),
      list: () => this.cmdList(interaction, sid),
      console: () => this.cmdConsole(interaction, sid, get('command')),
      create: () => this.cmdCreate(interaction, [get('name'), get('type'), get('version')]),
      delete: () => this.cmdDelete(interaction, sid),
      servers: () => this.cmdServers(interaction),
      info: () => this.cmdInfo(interaction, sid),
      motd: () => this.cmdMotd(interaction, sid, get('message')),
      say: () => this.cmdSay(interaction, sid, get('message')),
      kick: () => this.cmdKick(interaction, sid, get('player'), get('reason')),
      ban: () => this.cmdBan(interaction, sid, get('player'), get('reason')),
      unban: () => this.cmdUnban(interaction, sid, get('player')),
      whitelist: () => this.cmdWhitelist(interaction, sid, get('action'), get('player')),
      op: () => this.cmdOp(interaction, sid, get('player')),
      deop: () => this.cmdDeop(interaction, sid, get('player')),
      backup: () => this.cmdBackup(interaction, sid, get('action')),
      'backup-delete': () => this.cmdBackupDelete(interaction, sid, get('name')),
      plugins: () => this.cmdPlugins(interaction, sid),
      plugin: () => this.cmdPlugin(interaction, sid, get('action'), get('plugin')),
      worlds: () => this.cmdWorlds(interaction, sid),
      schedules: () => this.cmdSchedules(interaction, sid),
      properties: () => this.cmdProperties(interaction, sid),
      'prop-set': () => this.cmdPropSet(interaction, sid, get('key'), get('value')),
      tps: () => this.cmdTps(interaction, sid),
      memory: () => this.cmdMemory(interaction, sid),
      gamemode: () => this.cmdGamemode(interaction, sid, get('mode')),
      difficulty: () => this.cmdDifficulty(interaction, sid, get('level')),
      time: () => this.cmdTime(interaction, sid, get('value')),
      weather: () => this.cmdWeather(interaction, sid, get('type')),
      ping: () => this.cmdPing(interaction),
      uptime: () => this.cmdUptime(interaction),
      about: () => this.cmdAbout(interaction),
      invite: () => this.cmdInvite(interaction),
      setup: () => this.cmdSetup(interaction, get('language')),
      lock: () => this.cmdLock(interaction, get('channel')),
      unlock: () => this.cmdUnlock(interaction, get('channel')),
      prefix: () => this.cmdPrefix(interaction, get('newprefix')),
      help: () => this.cmdHelp(interaction, get('category')),
      role: () => this.cmdRole(interaction),
      language: () => this.cmdLanguage(interaction),
    };
    if (handlers[cmd]) await handlers[cmd]();
    else await interaction.reply({ content: '❌ Unknown command', ephemeral: true });
  }

  // ─── Helper ────────────────────────────────────────────────

  reply(ctx, content) {
    if (ctx.reply) return ctx.reply(content);
    return ctx.channel.send(content);
  }

  serverRunning(sid) { return !!this.runningServers[sid]; }

  getServer(id) {
    if (id) {
      const d = path.join(this.serverDir, id);
      return fs.existsSync(d) ? id : null;
    }
    try {
      const dirs = fs.readdirSync(this.serverDir, { withFileTypes: true });
      const servers = dirs.filter(d => d.isDirectory()).map(d => d.name);
      return servers[0] || null;
    } catch { return null; }
  }

  getAllServers() {
    try {
      return fs.readdirSync(this.serverDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    } catch { return []; }
  }

  async sendMC(sid, command) {
    if (!this.runningServers[sid]) return false;
    try { this.runningServers[sid].proc.stdin.write(command + '\n'); return true; } catch { return false; }
  }

  readProps(sid) {
    const p = path.join(this.serverDir, sid, 'server.properties');
    if (!fs.existsSync(p)) return {};
    const props = {};
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      const t = line.trim();
      if (t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      props[t.substring(0, i).trim()] = t.substring(i + 1).trim();
    }
    return props;
  }

  readConfig(sid) {
    const p = path.join(this.serverDir, sid, 'server-config.json');
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
  }

  writeProps(sid, key, value) {
    const p = path.join(this.serverDir, sid, 'server.properties');
    let content = fs.readFileSync(p, 'utf-8');
    if (content.match(new RegExp('^' + key + '=', 'm'))) {
      content = content.replace(new RegExp('^' + key + '=.*$', 'm'), key + '=' + value);
    } else {
      content += '\n' + key + '=' + value + '\n';
    }
    fs.writeFileSync(p, content);
  }

  // ─── Commands ──────────────────────────────────────────────

  async cmdStatus(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    const running = this.serverRunning(sid);
    const status = running ? '🟢 Running' : '🔴 Stopped';
    const embed = {
      color: running ? 0x4caf7d : 0xe55f5f,
      title: `✦ ${sid}`,
      fields: [
        { name: 'Status', value: status, inline: true },
        { name: 'Players', value: running && this.lastStatus[sid]?.players ? this.lastStatus[sid].players : '-', inline: true },
        { name: 'TPS', value: running && this.lastStatus[sid]?.tps ? this.lastStatus[sid].tps.toFixed(1) : '-', inline: true },
        { name: 'Type', value: this.readConfig(sid).type || 'paper', inline: true },
        { name: 'Version', value: this.readConfig(sid).version || 'latest', inline: true },
      ],
      timestamp: new Date().toISOString()
    };
    await this.reply(ctx, { embeds: [embed] });
  }

  async cmdStart(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    if (this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server already running');
    this.io.to(sid).emit('server:console', `\n[Discord] started the server\n`);
    this.io.to(sid).emit('server:start-request', { id: sid });
    await this.reply(ctx, `✅ Starting **${sid}**...`);
  }

  async cmdStop(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    this.io.to(sid).emit('server:console', `\n[Discord] stopped the server\n`);
    await this.sendMC(sid, 'stop');
    await this.reply(ctx, `🛑 Stopping **${sid}**...`);
  }

  async cmdRestart(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    await this.sendMC(sid, 'say §cServer restarting...');
    await this.sendMC(sid, 'stop');
    this.io.to(sid).emit('server:console', `\n[Discord] restarted the server\n`);
    await this.reply(ctx, `🔄 Restarting **${sid}**... It will restart shortly.`);
  }

  async cmdList(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    await this.sendMC(sid, 'list');
    await this.reply(ctx, `👥 Requested player list for **${sid}**`);
  }

  async cmdConsole(ctx, serverId, command) {
    if (!command) return this.reply(ctx, '❌ No command provided');
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    await this.sendMC(sid, command);
    this.io.to(sid).emit('server:console', `\n[Discord]: /${command}\n`);
    await this.reply(ctx, `✅ \`${command}\` executed on **${sid}**`);
  }

  async cmdSay(ctx, serverId, message) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    await this.sendMC(sid, `say ${message}`);
    this.io.to(sid).emit('server:console', `\n[Discord] Broadcast: ${message}\n`);
    await this.reply(ctx, `📢 Broadcast sent to **${sid}**`);
  }

  async cmdCreate(ctx, args) {
    const name = args[0];
    if (!name) return this.reply(ctx, '❌ Usage: `!create <name> [type] [version]`');
    const serverDir = path.join(this.serverDir, name);
    if (fs.existsSync(serverDir)) return this.reply(ctx, '❌ Server already exists');
    if (name.includes(' ') || name.includes('/') || name.includes('\\')) return this.reply(ctx, '❌ Invalid server name');

    await this.reply(ctx, `⏳ Creating server **${name}**...`);
    const type = args[1] || 'paper';
    const version = args[2] || '1.21';

    try {
      fs.mkdirSync(serverDir, { recursive: true });
      if (type === 'paper') {
        const v = await (await fetch(`https://api.papermc.io/v2/projects/paper/versions/${version}`)).json();
        const b = v.builds[v.builds.length - 1];
        const r = await fetch(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${b}/downloads/paper-${version}-${b}.jar`);
        if (!r.ok) throw new Error('Download failed');
        fs.writeFileSync(path.join(serverDir, 'server.jar'), Buffer.from(await r.arrayBuffer()));
      } else if (type === 'vanilla') {
        const m = await (await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')).json();
        const vi = m.versions.find(v => v.id === version);
        if (!vi) throw new Error('Version not found');
        const pkg = await (await fetch(vi.url)).json();
        const r = await fetch(pkg.downloads.server.url);
        fs.writeFileSync(path.join(serverDir, 'server.jar'), Buffer.from(await r.arrayBuffer()));
      }
      fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');
      fs.writeFileSync(path.join(serverDir, 'server.properties'), '#Minecraft server properties\nmotd=A Flasmc Minecraft Server\nserver-port=25565\ngamemode=survival\ndifficulty=easy\nmax-players=20\nonline-mode=true\npvp=true\n');
      fs.writeFileSync(path.join(serverDir, 'server-config.json'), JSON.stringify({ type, version, anticheat: false, geyser: false, xray: false, crashRestart: true, maxCrashes: 5, createdAt: new Date().toISOString() }, null, 2));
      await this.reply(ctx, `✅ Server **${name}** created! (${type} ${version})`);
    } catch (err) {
      try { fs.rmSync(serverDir, { recursive: true, force: true }); } catch {}
      await this.reply(ctx, '❌ Error: ' + err.message);
    }
  }

  async cmdDelete(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    const d = path.join(this.serverDir, sid);
    try {
      fs.rmSync(d, { recursive: true, force: true });
      await this.reply(ctx, `🗑️ Server **${sid}** deleted`);
    } catch { await this.reply(ctx, '❌ Failed to delete server'); }
  }

  async cmdServers(ctx) {
    const servers = this.getAllServers();
    if (!servers.length) return this.reply(ctx, '📂 No servers created yet. Use `!create`');
    const list = servers.map(s => {
      const r = this.serverRunning(s) ? '🟢' : '🔴';
      const cfg = this.readConfig(s);
      return `${r} **${s}** — ${cfg.type || 'paper'} ${cfg.version || '?'}`;
    }).join('\n');
    await this.reply(ctx, `📂 **Servers (${servers.length})**\n${list}`);
  }

  async cmdInfo(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    try {
      const cfg = this.readConfig(sid);
      const props = this.readProps(sid);
      const running = this.serverRunning(sid);
      const embed = {
        color: 0x4caf7d,
        title: `📊 ${sid}`,
        fields: [
          { name: 'Type', value: cfg.type || 'paper', inline: true },
          { name: 'Version', value: cfg.version || 'latest', inline: true },
          { name: 'Port', value: props['server-port'] || '25565', inline: true },
          { name: 'Status', value: running ? '🟢 Running' : '🔴 Stopped', inline: true },
          { name: 'Players', value: props['max-players'] || '20', inline: true },
          { name: 'Gamemode', value: props.gamemode || 'survival', inline: true },
          { name: 'Difficulty', value: props.difficulty || 'easy', inline: true },
          { name: 'PvP', value: props.pvp === 'false' ? '❌ Off' : '✅ On', inline: true },
          { name: 'Online Mode', value: props['online-mode'] === 'false' ? '❌ Off (cracked)' : '✅ On', inline: true },
          { name: 'MOTD', value: props.motd ? props.motd.substring(0, 50) : 'A Flasmc Server', inline: false },
          { name: 'Anti-Cheat', value: cfg.anticheat ? '✅ On' : '❌ Off', inline: true },
          { name: 'Bedrock', value: cfg.geyser ? '✅ On' : '❌ Off', inline: true },
          { name: 'X-Ray', value: cfg.xray ? '✅ On' : '❌ Off', inline: true },
          { name: 'Crash Restart', value: cfg.crashRestart ? '✅ On' : '❌ Off', inline: true },
          { name: 'Created', value: cfg.createdAt ? new Date(cfg.createdAt).toLocaleDateString() : '-', inline: true },
        ],
        timestamp: new Date().toISOString()
      };
      await this.reply(ctx, { embeds: [embed] });
    } catch (err) {
      await this.reply(ctx, '❌ Error: ' + err.message);
    }
  }

  async cmdMotd(ctx, serverId, message) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    if (message) {
      this.writeProps(sid, 'motd', message.replace(/\n/g, '\\n'));
      await this.reply(ctx, `✅ MOTD updated for **${sid}**\n\`${message.substring(0, 100)}\``);
    } else {
      const props = this.readProps(sid);
      await this.reply(ctx, `📝 MOTD for **${sid}**:\n\`\`\`${props.motd || 'A Flasmc Server'}\`\`\``);
    }
  }

  async cmdKick(ctx, serverId, player, reason) {
    const sid = this.getServer(serverId);
    if (!sid || !player) return this.reply(ctx, '❌ Usage: kick <server> <player> [reason]');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    const cmd = `kick ${player}${reason ? ' ' + reason : ''}`;
    await this.sendMC(sid, cmd);
    await this.reply(ctx, `👢 Kicked **${player}** from **${sid}**${reason ? ' (' + reason + ')' : ''}`);
  }

  async cmdBan(ctx, serverId, player, reason) {
    const sid = this.getServer(serverId);
    if (!sid || !player) return this.reply(ctx, '❌ Usage: ban <server> <player> [reason]');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    const cmd = `ban ${player}${reason ? ' ' + reason : ''}`;
    await this.sendMC(sid, cmd);
    await this.reply(ctx, `🔨 Banned **${player}** from **${sid}**${reason ? ' (' + reason + ')' : ''}`);
  }

  async cmdUnban(ctx, serverId, player) {
    const sid = this.getServer(serverId);
    if (!sid || !player) return this.reply(ctx, '❌ Usage: unban <server> <player>');
    try {
      const bp = path.join(this.serverDir, sid, 'banned-players.json');
      if (fs.existsSync(bp)) {
        const data = JSON.parse(fs.readFileSync(bp, 'utf-8'));
        const idx = data.findIndex(b => b.name === player);
        if (idx !== -1) {
          data.splice(idx, 1);
          fs.writeFileSync(bp, JSON.stringify(data, null, 2));
          if (this.serverRunning(sid)) await this.sendMC(sid, `whitelist remove ${player}`);
          return this.reply(ctx, `✅ Unbanned **${player}** from **${sid}**`);
        }
      }
      if (this.serverRunning(sid)) {
        await this.sendMC(sid, `pardon ${player}`);
        await this.reply(ctx, `✅ Unbanned **${player}** from **${sid}**`);
      } else {
        await this.reply(ctx, '❌ Player not found in ban list');
      }
    } catch { await this.reply(ctx, '❌ Failed to unban'); }
  }

  async cmdWhitelist(ctx, serverId, action, player) {
    const sid = this.getServer(serverId);
    if (!sid || !action) return this.reply(ctx, '❌ Usage: whitelist <server> add/remove/list [player]');
    const wp = path.join(this.serverDir, sid, 'whitelist.json');
    if (action === 'list') {
      try {
        const data = JSON.parse(fs.readFileSync(wp, 'utf-8'));
        const list = data.map(w => w.name).join('\n') || 'None';
        return this.reply(ctx, `📋 **Whitelist — ${sid}**\n${list}`);
      } catch { return this.reply(ctx, '📋 Whitelist is empty'); }
    }
    if (!player) return this.reply(ctx, '❌ Player name required');
    if (action === 'add') {
      const data = fs.existsSync(wp) ? JSON.parse(fs.readFileSync(wp, 'utf-8')) : [];
      if (!data.find(w => w.name === player)) {
        data.push({ name: player, uuid: '' });
        fs.writeFileSync(wp, JSON.stringify(data, null, 2));
      }
      if (this.serverRunning(sid)) await this.sendMC(sid, `whitelist add ${player}`);
      await this.reply(ctx, `✅ Added **${player}** to whitelist`);
    } else if (action === 'remove') {
      try {
        const data = JSON.parse(fs.readFileSync(wp, 'utf-8'));
        const idx = data.findIndex(w => w.name === player);
        if (idx !== -1) {
          data.splice(idx, 1);
          fs.writeFileSync(wp, JSON.stringify(data, null, 2));
        }
        if (this.serverRunning(sid)) await this.sendMC(sid, `whitelist remove ${player}`);
        await this.reply(ctx, `✅ Removed **${player}** from whitelist`);
      } catch { await this.reply(ctx, '❌ Player not found'); }
    } else {
      await this.reply(ctx, '❌ Action must be add, remove, or list');
    }
  }

  async cmdOp(ctx, serverId, player) {
    const sid = this.getServer(serverId);
    if (!sid || !player) return this.reply(ctx, '❌ Usage: op <server> <player>');
    const opPath = path.join(this.serverDir, sid, 'ops.json');
    const data = fs.existsSync(opPath) ? JSON.parse(fs.readFileSync(opPath, 'utf-8')) : [];
    if (!data.find(o => o.name === player)) {
      data.push({ name: player, uuid: '', level: 4 });
      fs.writeFileSync(opPath, JSON.stringify(data, null, 2));
    }
    if (this.serverRunning(sid)) await this.sendMC(sid, `op ${player}`);
    await this.reply(ctx, `⭐ **${player}** is now OP on **${sid}**`);
  }

  async cmdDeop(ctx, serverId, player) {
    const sid = this.getServer(serverId);
    if (!sid || !player) return this.reply(ctx, '❌ Usage: deop <server> <player>');
    try {
      const opPath = path.join(this.serverDir, sid, 'ops.json');
      const data = JSON.parse(fs.readFileSync(opPath, 'utf-8'));
      const idx = data.findIndex(o => o.name === player);
      if (idx !== -1) { data.splice(idx, 1); fs.writeFileSync(opPath, JSON.stringify(data, null, 2)); }
      if (this.serverRunning(sid)) await this.sendMC(sid, `deop ${player}`);
      await this.reply(ctx, `✅ **${player}** is no longer OP on **${sid}**`);
    } catch { await this.reply(ctx, '❌ Player not found'); }
  }

  async cmdBackup(ctx, serverId, action) {
    const sid = this.getServer(serverId);
    if (!sid || !action) return this.reply(ctx, '❌ Usage: backup <server> create/list');
    if (action === 'create') {
      await this.reply(ctx, `⏳ Creating backup for **${sid}**...`);
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip();
        const serverDir = path.join(this.serverDir, sid);
        zip.addLocalFolder(serverDir);
        const backupDir = path.join(this.serverDir, '..', 'backups', sid);
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const name = `${sid}-${Date.now()}.zip`;
        zip.writeZip(path.join(backupDir, name));
        await this.reply(ctx, `✅ Backup created: **${name}**`);
      } catch (err) { await this.reply(ctx, '❌ Backup failed: ' + err.message); }
    } else if (action === 'list') {
      const backupDir = path.join(this.serverDir, '..', 'backups', sid);
      try {
        const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.zip'));
        if (!files.length) return this.reply(ctx, '📦 No backups for **' + sid + '**');
        const list = files.map(f => `📦 **${f}** — ${(fs.statSync(path.join(backupDir, f)).size / 1024 / 1024).toFixed(1)} MB`).join('\n');
        await this.reply(ctx, `📦 **Backups — ${sid}** (${files.length})\n${list}`);
      } catch { await this.reply(ctx, '📦 No backups for **' + sid + '**'); }
    }
  }

  async cmdBackupDelete(ctx, serverId, name) {
    const sid = this.getServer(serverId);
    if (!sid || !name) return this.reply(ctx, '❌ Usage: backup-delete <server> <name>');
    const fp = path.join(this.serverDir, '..', 'backups', sid, name);
    if (!fs.existsSync(fp)) return this.reply(ctx, '❌ Backup not found');
    try { fs.unlinkSync(fp); await this.reply(ctx, `🗑️ Deleted backup **${name}**`); }
    catch { await this.reply(ctx, '❌ Failed to delete'); }
  }

  async cmdPlugins(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    const pluginsDir = path.join(this.serverDir, sid, 'plugins');
    if (!fs.existsSync(pluginsDir)) return this.reply(ctx, '📂 No plugins directory');
    const plugins = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled'));
    if (!plugins.length) return this.reply(ctx, '📂 No plugins installed');
    const list = plugins.map(f => {
      const enabled = !f.endsWith('.disabled');
      const name = enabled ? f : f.replace('.disabled', '');
      return `${enabled ? '✅' : '❌'} **${name.replace('.jar', '')}**`;
    }).join('\n');
    await this.reply(ctx, `📂 **Plugins — ${sid}** (${plugins.length})\n${list}`);
  }

  async cmdPlugin(ctx, serverId, action, pluginName) {
    const sid = this.getServer(serverId);
    if (!sid || !action || !pluginName) return this.reply(ctx, '❌ Usage: plugin <server> enable/disable/delete <name>');
    const pluginsDir = path.join(this.serverDir, sid, 'plugins');
    if (!fs.existsSync(pluginsDir)) return this.reply(ctx, '❌ No plugins directory');
    const files = fs.readdirSync(pluginsDir).filter(f => f.includes(pluginName));
    if (!files.length) return this.reply(ctx, '❌ Plugin not found: ' + pluginName);
    const f = files[0];
    const fp = path.join(pluginsDir, f);
    if (action === 'enable') {
      if (!f.endsWith('.disabled')) return this.reply(ctx, '✅ Already enabled');
      fs.renameSync(fp, fp.replace('.disabled', ''));
      await this.reply(ctx, `✅ Enabled **${f.replace('.disabled', '').replace('.jar', '')}**`);
    } else if (action === 'disable') {
      if (f.endsWith('.disabled')) return this.reply(ctx, '❌ Already disabled');
      fs.renameSync(fp, fp + '.disabled');
      await this.reply(ctx, `⏸️ Disabled **${f.replace('.jar', '')}**`);
    } else if (action === 'delete') {
      fs.unlinkSync(fp);
      await this.reply(ctx, `🗑️ Deleted **${f.replace('.jar', '')}**`);
    } else {
      await this.reply(ctx, '❌ Action must be enable, disable, or delete');
    }
  }

  async cmdWorlds(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    const sd = path.join(this.serverDir, sid);
    const worlds = fs.readdirSync(sd).filter(f => {
      try { return fs.statSync(path.join(sd, f)).isDirectory() && (f === 'world' || f.startsWith('world_') || (fs.existsSync(path.join(sd, f, 'level.dat')))); }
      catch { return false; }
    });
    if (!worlds.length) return this.reply(ctx, '🌍 No worlds found');
    const list = worlds.map(w => {
      const size = (fs.statSync(path.join(sd, w)).size / 1024 / 1024).toFixed(1);
      return `🌍 **${w}** — ${size} MB`;
    }).join('\n');
    await this.reply(ctx, `🌍 **Worlds — ${sid}**\n${list}`);
  }

  async cmdSchedules(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    const sp = path.join(this.serverDir, '..', 'schedules.json');
    try {
      const data = JSON.parse(fs.readFileSync(sp, 'utf-8'));
      const scheds = data[sid] || [];
      if (!scheds.length) return this.reply(ctx, '⏰ No schedules for **' + sid + '**');
      const list = scheds.map((s, i) => `⏰ **#${i + 1}** — ${s.action} — ${s.interval || s.cron || s.time} — ${s.enabled ? '✅' : '❌'}`).join('\n');
      await this.reply(ctx, `⏰ **Schedules — ${sid}**\n${list}`);
    } catch { await this.reply(ctx, '⏰ No schedules'); }
  }

  async cmdProperties(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    const props = this.readProps(sid);
    const list = Object.entries(props).map(([k, v]) => `\`${k}=${v}\``).join('\n');
    await this.reply(ctx, `⚙️ **Properties — ${sid}**\n${list.substring(0, 1900)}`);
  }

  async cmdPropSet(ctx, serverId, key, value) {
    const sid = this.getServer(serverId);
    if (!sid || !key || value === undefined) return this.reply(ctx, '❌ Usage: prop-set <server> <key> <value>');
    this.writeProps(sid, key, value);
    await this.reply(ctx, `✅ Set \`${key}=${value}\` on **${sid}**\nRestart server to apply.`);
  }

  async cmdTps(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    const tps = this.lastStatus[sid]?.tps;
    await this.reply(ctx, tps ? `📊 **${sid}** TPS: \`${tps.toFixed(1)}\`` : '📊 No TPS data yet');
  }

  async cmdMemory(ctx, serverId) {
    const sid = this.getServer(serverId);
    if (!sid) return this.reply(ctx, '❌ Server not found');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    await this.sendMC(sid, 'memory');
    await this.reply(ctx, `💾 Memory info requested for **${sid}**`);
  }

  async cmdGamemode(ctx, serverId, mode) {
    const sid = this.getServer(serverId);
    if (!sid || !mode) return this.reply(ctx, '❌ Usage: gamemode <server> <survival|creative|adventure|spectator>');
    const valid = ['survival', 'creative', 'adventure', 'spectator', '0', '1', '2', '3'];
    if (!valid.includes(mode)) return this.reply(ctx, '❌ Invalid gamemode');
    this.writeProps(sid, 'gamemode', mode);
    await this.reply(ctx, `✅ Gamemode set to **${mode}** on **${sid}**\nRestart or use \`!console ${sid} defaultgamemode ${mode}\``);
  }

  async cmdDifficulty(ctx, serverId, level) {
    const sid = this.getServer(serverId);
    if (!sid || !level) return this.reply(ctx, '❌ Usage: difficulty <server> <peaceful|easy|normal|hard>');
    const valid = ['peaceful', 'easy', 'normal', 'hard', '0', '1', '2', '3'];
    if (!valid.includes(level)) return this.reply(ctx, '❌ Invalid difficulty');
    this.writeProps(sid, 'difficulty', level);
    if (this.serverRunning(sid)) await this.sendMC(sid, `difficulty ${level}`);
    await this.reply(ctx, `✅ Difficulty set to **${level}** on **${sid}**`);
  }

  async cmdTime(ctx, serverId, value) {
    const sid = this.getServer(serverId);
    if (!sid || !value) return this.reply(ctx, '❌ Usage: time <server> <day|night|noon|midnight|tick>');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    const map = { day: '1000', night: '13000', noon: '6000', midnight: '18000' };
    const tick = map[value] || value;
    await this.sendMC(sid, `time set ${tick}`);
    await this.reply(ctx, `⏰ Time set to **${value}** (${tick}) on **${sid}**`);
  }

  async cmdWeather(ctx, serverId, type) {
    const sid = this.getServer(serverId);
    if (!sid || !type) return this.reply(ctx, '❌ Usage: weather <server> <clear|rain|thunder>');
    if (!this.serverRunning(sid)) return this.reply(ctx, '⚠️ Server not running');
    await this.sendMC(sid, `weather ${type}`);
    await this.reply(ctx, `🌤️ Weather set to **${type}** on **${sid}**`);
  }

  async cmdPing(ctx) {
    const latency = this.client?.ws?.ping || 0;
    const embed = { color: 0x4caf7d, title: '🏓 Pong!', fields: [{ name: 'WebSocket', value: `${latency}ms`, inline: true }, { name: 'API Latency', value: `${Date.now() - (PING_DATA.start || Date.now())}ms`, inline: true }] };
    PING_DATA.start = Date.now();
    await this.reply(ctx, { embeds: [embed] });
  }

  async cmdUptime(ctx) {
    if (!this.startTime) return this.reply(ctx, '⏱️ Bot just started');
    const diff = Date.now() - this.startTime;
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (m) parts.push(m + 'm');
    parts.push(s + 's');
    const embed = { color: 0x4caf7d, title: '⏱️ Bot Uptime', fields: [{ name: 'Online Since', value: `<t:${Math.floor(this.startTime / 1000)}:F>` }, { name: 'Uptime', value: parts.join(' ') }, { name: 'Servers Managed', value: String(this.getAllServers().length) }, { name: 'Connected', value: this.connected ? '✅' : '❌' }] };
    await this.reply(ctx, { embeds: [embed] });
  }

  async cmdAbout(ctx) {
    const embed = {
      color: 0x4caf7d,
      title: '🤖 Flasmc Discord Bot',
      description: 'Minecraft server management bot for Flasmc',
      fields: [
        { name: 'Version', value: '1.0.0', inline: true },
        { name: 'Servers', value: String(this.getAllServers().length), inline: true },
        { name: 'Prefix', value: `\`${this.prefix}\``, inline: true },
        { name: 'Commands', value: '50+ prefix + slash commands', inline: true },
        { name: 'Features', value: 'Server management\nPlayer control\nBackups\nPlugins\nConsole\nAuto-setup\nRole panel\nMulti-language', inline: false },
      ]
    };
    await this.reply(ctx, { embeds: [embed] });
  }

  async cmdInvite(ctx) {
    const id = this.client?.user?.id;
    if (!id) return this.reply(ctx, '❌ Bot not ready');
    await this.reply(ctx, `🔗 **Invite Flasmc Bot**\nhttps://discord.com/oauth2/authorize?client_id=${id}&scope=bot&permissions=268504113`);
  }

  async cmdSetup(ctx, lang) {
    if (!ctx.guild) return this.reply(ctx, '❌ This command only works in a server');
    lang = lang || 'all';
    if (!['tr', 'en', 'all'].includes(lang)) return this.reply(ctx, '❌ Invalid language. Use `tr`, `en`, or leave empty for both.');
    await this.reply(ctx, '⏳ Setting up Flasmc roles, channels, and permissions...');
    try {
      const guild = ctx.guild;
      const everyone = guild.roles.everyone;

      // Create roles
      let adminRole = guild.roles.cache.find(r => r.name === 'Flasmc Admin');
      if (!adminRole) adminRole = await guild.roles.create({ name: 'Flasmc Admin', color: '#6c63ff', hoist: true, mentionable: true, reason: 'Flasmc setup' });
      let modRole = guild.roles.cache.find(r => r.name === 'Flasmc Mod');
      if (!modRole) modRole = await guild.roles.create({ name: 'Flasmc Mod', color: '#4caf7d', hoist: true, reason: 'Flasmc setup' });
      let memberRole = guild.roles.cache.find(r => r.name === 'Flasmc Member');
      if (!memberRole) memberRole = await guild.roles.create({ name: 'Flasmc Member', color: '#888888', reason: 'Flasmc setup' });
      try { await ctx.member.roles.add(adminRole); } catch {}

      const trChannels = (cat) => [
        { name: '📢 • duyurular', type: 0, parent: cat.id, perm: everyoneReadOnly },
        { name: '🚀 • updates', type: 0, parent: cat.id, perm: everyoneReadOnly },
        { name: '📜 • kurallar', type: 0, parent: cat.id, perm: everyoneReadOnly }
      ];
      const enChannels = (cat) => [
        { name: '📢 • announcements', type: 0, parent: cat.id, perm: everyoneReadOnly },
        { name: '🚀 • updates', type: 0, parent: cat.id, perm: everyoneReadOnly },
        { name: '📜 • rules', type: 0, parent: cat.id, perm: everyoneReadOnly }
      ];
      const trGeneral = (cat) => [
        { name: '💬 • sohbet', type: 0, parent: cat.id, perm: everyoneWrite },
        { name: '📷 • medya', type: 0, parent: cat.id, perm: everyoneMedia },
        { name: '🤖 • bot-komut', type: 0, parent: cat.id, perm: modsOnly }
      ];
      const enGeneral = (cat) => [
        { name: '💬 • chat', type: 0, parent: cat.id, perm: everyoneWrite },
        { name: '📷 • media', type: 0, parent: cat.id, perm: everyoneMedia },
        { name: '🤖 • bot-commands', type: 0, parent: cat.id, perm: modsOnly }
      ];
      const trAdmin = (cat) => [
        { name: '🛰️ • durum', type: 0, parent: cat.id, perm: everyoneReadOnly },
        { name: '📄 • konsol', type: 0, parent: cat.id, perm: modsCanWrite },
        { name: '💾 • yedekler', type: 0, parent: cat.id, perm: everyoneReadOnly },
        { name: '👑 • admin', type: 0, parent: cat.id, perm: adminsOnly }
      ];
      const enAdmin = (cat) => [
        { name: '🛰️ • status', type: 0, parent: cat.id, perm: everyoneReadOnly },
        { name: '📄 • console', type: 0, parent: cat.id, perm: modsCanWrite },
        { name: '💾 • backups', type: 0, parent: cat.id, perm: everyoneReadOnly },
        { name: '👑 • admin', type: 0, parent: cat.id, perm: adminsOnly }
      ];

      const everyoneReadOnly = [{ id: everyone.id, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }];
      const everyoneWrite = [{ id: everyone.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }];
      const everyoneMedia = [{ id: everyone.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'] }];
      const modsOnly = [{ id: everyone.id, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }, { id: adminRole.id, allow: ['SendMessages'] }, { id: modRole.id, allow: ['SendMessages'] }];
      const modsCanWrite = [{ id: everyone.id, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }, { id: adminRole.id, allow: ['SendMessages'] }, { id: modRole.id, allow: ['SendMessages'] }];
      const adminsOnly = [{ id: everyone.id, deny: ['ViewChannel'] }, { id: adminRole.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }];

      async function createChannels(configs) {
        for (const ch of configs) {
          if (!guild.channels.cache.find(c => c.name === ch.name)) {
            const { perm, ...rest } = ch;
            await guild.channels.create({ ...rest, permissionOverwrites: perm });
          }
        }
      }

      const summary = { tr: [], en: [] };

      if (lang === 'tr' || lang === 'all') {
        let cat1 = guild.channels.cache.find(c => c.type === 4 && c.name === '📊 | BİLGİLENDİRME');
        if (!cat1) cat1 = await guild.channels.create({ name: '📊 | BİLGİLENDİRME', type: 4 });
        await createChannels(trChannels(cat1));
        summary.tr.push('📊 | BİLGİLENDİRME ➜ 📢 duyurular, 🚀 updates, 📜 kurallar');

        let cat2 = guild.channels.cache.find(c => c.type === 4 && c.name === '💬 | GENEL');
        if (!cat2) cat2 = await guild.channels.create({ name: '💬 | GENEL', type: 4 });
        await createChannels(trGeneral(cat2));
        summary.tr.push('💬 | GENEL ➜ 💬 sohbet, 📷 medya, 🤖 bot-komut');

        let cat3 = guild.channels.cache.find(c => c.type === 4 && c.name === '💻 | YÖNETİM');
        if (!cat3) cat3 = await guild.channels.create({ name: '💻 | YÖNETİM', type: 4 });
        await createChannels(trAdmin(cat3));
        summary.tr.push('💻 | YÖNETİM ➜ 🛰️ durum, 📄 konsol, 💾 yedekler, 👑 admin');
      }

      if (lang === 'en' || lang === 'all') {
        let cat1 = guild.channels.cache.find(c => c.type === 4 && c.name === '📊 | INFORMATION');
        if (!cat1) cat1 = await guild.channels.create({ name: '📊 | INFORMATION', type: 4 });
        await createChannels(enChannels(cat1));
        summary.en.push('📊 | INFORMATION ➜ 📢 announcements, 🚀 updates, 📜 rules');

        let cat2 = guild.channels.cache.find(c => c.type === 4 && c.name === '💬 | GENERAL');
        if (!cat2) cat2 = await guild.channels.create({ name: '💬 | GENERAL', type: 4 });
        await createChannels(enGeneral(cat2));
        summary.en.push('💬 | GENERAL ➜ 💬 chat, 📷 media, 🤖 bot-commands');

        let cat3 = guild.channels.cache.find(c => c.type === 4 && c.name === '💻 | MANAGEMENT');
        if (!cat3) cat3 = await guild.channels.create({ name: '💻 | MANAGEMENT', type: 4 });
        await createChannels(enAdmin(cat3));
        summary.en.push('💻 | MANAGEMENT ➜ 🛰️ status, 📄 console, 💾 backups, 👑 admin');
      }

      // Auto-configure bot: find console/status/backups channels by keyword
      const findChan = (keywords) => guild.channels.cache.find(c => c.type === 0 && keywords.some(k => c.name.includes(k)));
      const consoleChan = findChan(['console', 'konsol']);
      const statusChan = findChan(['status', 'durum']);
      const backupsChan = findChan(['backups', 'yedekler']);
      if (consoleChan) this.consoleChannelId = consoleChan.id;
      if (statusChan) this.statusChannelId = statusChan.id;
      if (backupsChan) this.backupsChannelId = backupsChan.id;
      this.saveConfig();

      const t = summary.tr.map(l => l).join('\n');
      const e = summary.en.map(l => l).join('\n');
      const result = `✅ **Flasmc setup complete!**\n\n**Roller:** 👑 Flasmc Admin · 🛡️ Flasmc Mod · 👤 Flasmc Member\nAdmin rolü sana verildi.\n\n` +
        (t ? `**🇹🇷 Türkçe Kanallar:**\n${t}\n\n` : '') +
        (e ? `**🇺🇸 English Channels:**\n${e}` : '');

      await this.reply(ctx, result);
    } catch (err) {
      await this.reply(ctx, '❌ Setup failed: ' + err.message + '\n\nNeeds **Manage Roles** + **Manage Channels**.\nRe-invite: https://discord.com/oauth2/authorize?client_id=' + (this.client?.user?.id || '1525586847722373240') + '&scope=bot&permissions=268504113');
    }
  }

  async cmdLock(ctx, channelId) {
    if (!ctx.guild) return this.reply(ctx, '❌ This command only works in a server');
    const channel = channelId ? ctx.guild.channels.cache.get(channelId) || ctx.mentions?.channels?.first() : ctx.channel;
    if (!channel) return this.reply(ctx, '❌ Channel not found');
    try {
      await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: false });
      await this.reply(ctx, `🔒 Locked ${channel} — only admins can send messages now`);
    } catch (err) {
      await this.reply(ctx, '❌ Failed to lock channel: ' + err.message + '\nNeeds **Manage Channels** permission.');
    }
  }

  async cmdUnlock(ctx, channelId) {
    if (!ctx.guild) return this.reply(ctx, '❌ This command only works in a server');
    const channel = channelId ? ctx.guild.channels.cache.get(channelId) || ctx.mentions?.channels?.first() : ctx.channel;
    if (!channel) return this.reply(ctx, '❌ Channel not found');
    try {
      await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: null });
      await this.reply(ctx, `🔓 Unlocked ${channel} — everyone can send messages again`);
    } catch (err) {
      await this.reply(ctx, '❌ Failed to unlock channel: ' + err.message + '\nNeeds **Manage Channels** permission.');
    }
  }

  async cmdPrefix(ctx, newPrefix) {
    if (!newPrefix) return this.reply(ctx, `Current prefix: \`${this.prefix}\`\nUsage: \`${this.prefix}prefix <newprefix>\``);
    if (newPrefix.length > 5) return this.reply(ctx, '❌ Prefix too long (max 5 chars)');
    this.prefix = newPrefix;
    this.saveConfig();
    await this.reply(ctx, `✅ Prefix changed to \`${newPrefix}\`\nUse \`${newPrefix}help\` to see commands`);
  }

  async cmdRole(ctx) {
    if (!ctx.guild) return this.reply(ctx, '❌ This command only works in a server');
    try {
      // Auto-create roles if they don't exist
      const roles = [
        { name: '🎉 Etkinlik Katılımcısı', color: '#ff6b6b' },
        { name: '🎁 Çekiliş Katılımcısı', color: '#ffd93d' },
        { name: '🎮 Oyun Katılımcısı', color: '#6bcb77' },
        { name: '🛡️ Destek Ekibi', color: '#4d96ff' }
      ];
      const roleIds = [];
      for (const r of roles) {
        let role = ctx.guild.roles.cache.find(ro => ro.name === r.name);
        if (!role) role = await ctx.guild.roles.create({ name: r.name, color: r.color, reason: 'Role panel' });
        roleIds.push(role.id);
      }

      const embed = {
        color: 0x6c63ff,
        title: '🎭 **Rol Seçim Paneli**',
        description: 'Aşağıdaki butonlara basarak rollerinizi alabilir/bırakabilirsiniz.',
        fields: roleIds.map((id, i) => ({ name: roles[i].name, value: `Renk: \`${roles[i].color}\``, inline: true })),
        footer: { text: 'Butona tekrar basarsan rolü bırakırsın' }
      };
      const row = new ActionRowBuilder().addComponents(
        roleIds.map(id => new ButtonBuilder().setCustomId('role_' + id).setLabel(ctx.guild.roles.cache.get(id).name).setStyle(ButtonStyle.Secondary))
      );
      await this.reply(ctx, { embeds: [embed], components: [row] });
    } catch (err) {
      await this.reply(ctx, '❌ Role panel error: ' + err.message);
    }
  }

  async cmdLanguage(ctx) {
    const embed = {
      color: 0x4caf7d,
      title: '🌍 **Dil Seçimi / Language Selection**',
      description: 'Lütfen tercih ettiğiniz dili seçin.\nPlease select your preferred language.\n\n*Bu seçim sadece sizin için geçerlidir.*',
      fields: [
        { name: '🇹🇷 Türkçe', value: '`lang_tr`', inline: true },
        { name: '🇺🇸 English', value: '`lang_en`', inline: true },
        { name: '🇩🇪 Deutsch', value: '`lang_de`', inline: true },
        { name: '🇫🇷 Français', value: '`lang_fr`', inline: true },
        { name: '🇪🇸 Español', value: '`lang_es`', inline: true }
      ]
    };
    const menu = new StringSelectMenuBuilder()
      .setCustomId('lang_select')
      .setPlaceholder('🌐 Select a language...')
      .addOptions([
        { label: 'Türkçe', value: 'lang_tr', emoji: '🇹🇷', description: 'Türkçe kullan' },
        { label: 'English', value: 'lang_en', emoji: '🇺🇸', description: 'Use English' },
        { label: 'Deutsch', value: 'lang_de', emoji: '🇩🇪', description: 'Deutsch verwenden' },
        { label: 'Français', value: 'lang_fr', emoji: '🇫🇷', description: 'Utiliser le français' },
        { label: 'Español', value: 'lang_es', emoji: '🇪🇸', description: 'Usar español' }
      ]);
    const row = new ActionRowBuilder().addComponents(menu);
    await this.reply(ctx, { embeds: [embed], components: [row] });
  }

  async cmdHelp(ctx, category) {
    const full = `**📋 Flasmc Bot — All Commands**\n\n` +
      `**Server:**\n` +
      `\`/status\` \`/start\` \`/stop\` \`/restart\` \`/create\` \`/delete\` \`/servers\` \`/info\` \`/motd\` \`/properties\` \`/prop-set\` \`/say\`\n\n` +
      `**Player:**\n` +
      `\`/list\` \`/kick\` \`/ban\` \`/unban\` \`/whitelist\` \`/op\` \`/deop\`\n\n` +
      `**Management:**\n` +
      `\`/console\` \`/gamemode\` \`/difficulty\` \`/time\` \`/weather\` \`/tps\` \`/memory\` \`/backup\` \`/backup-delete\`\n` +
      `\`/plugins\` \`/plugin\` \`/worlds\` \`/schedules\`\n\n` +
      `**Bot:**\n` +
      `\`/ping\` \`/uptime\` \`/about\` \`/invite\` \`/setup\` \`/lock\` \`/unlock\` \`/prefix\` \`/role\` \`/language\` \`/help\`\n\n` +
      `Prefix (\`${this.prefix}\`) commands also work. Use \`${this.prefix}prefix <new>\` to change.`;

    const byCategory = {
      server: '**📋 Server Commands**\n`status` — Check server status\n`start` — Start server\n`stop` — Stop server\n`restart` — Restart server\n`create` — Create new server\n`delete` — Delete server\n`servers` — List all servers\n`info` — Detailed server info\n`motd` — Get/set MOTD\n`properties` — List properties\n`prop-set` — Set property\n`say` — Broadcast message',
      player: '**📋 Player Commands**\n`list` — List online players\n`kick` — Kick a player\n`ban` — Ban a player\n`unban` — Unban a player\n`whitelist` — Manage whitelist\n`op` — Add operator\n`deop` — Remove operator',
      management: '**📋 Management Commands**\n`console` — Run server command\n`gamemode` — Set gamemode\n`difficulty` — Set difficulty\n`time` — Set time\n`weather` — Set weather\n`tps` — Show TPS\n`memory` — Memory usage\n`backup` — Create/list backups\n`backup-delete` — Delete backup\n`plugins` — List plugins\n`plugin` — Enable/disable plugin\n`worlds` — List worlds\n`schedules` — List schedules\n`console` — Execute command',
      bot: '**📋 Bot Commands**\n`ping` — Check latency\n`uptime` — Bot uptime\n`about` — Bot info\n`invite` — Invite link\n`setup` — Auto-create channels\n`lock` — Lock a channel\n`unlock` — Unlock a channel\n`prefix` — Change bot prefix\n`role` — Role selection panel\n`language` — Language selection menu\n`help` — This message'
    };
    await this.reply(ctx, byCategory[category] || full);
  }

  async cmdDeploy(ctx) {
    await ctx.reply('⏳ Re-registering slash commands...');
    await this.registerSlashCommands();
    await ctx.reply('✅ Slash commands re-registered!');
  }

  // ─── Console Forwarding ────────────────────────────────────────

  sendToChannel(channelId, message) {
    if (!this.client || !channelId) return;
    try { const ch = this.client.channels.cache.get(channelId); if (ch) ch.send(message).catch(() => {}); } catch {}
  }

  forwardConsole(serverId, text) {
    if (!this.consoleChannelId || !this.connected) return;
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines.slice(0, 5)) {
      if (line.includes('issued server command') || line.match(/^\s*\[\d+:\d+:\d+\]/)) continue;
      this.sendToChannel(this.consoleChannelId, `\`${serverId}\` ${line}`);
    }
  }

  updateStatus(serverId, stats) {
    this.lastStatus[serverId] = stats;
    if (this.statusChannelId && this.connected) {
      const status = this.serverRunning(serverId) ? '🟢 Running' : '🔴 Stopped';
      this.sendToChannel(this.statusChannelId, `📊 **${serverId}** — ${status} | Players: ${stats.players || '-'} | TPS: ${stats.tps ? stats.tps.toFixed(1) : '-'}`);
    }
  }

  getConfig() {
    return {
      connected: this.connected,
      hasToken: !!this.token,
      token: null,
      consoleChannelId: this.consoleChannelId,
      statusChannelId: this.statusChannelId,
      backupsChannelId: this.backupsChannelId,
      prefix: this.prefix,
      botUser: this.client?.user?.tag || null
    };
  }

  updateConfig(cfg) {
    if (cfg.token !== undefined) this.token = cfg.token;
    if (cfg.consoleChannelId !== undefined) this.consoleChannelId = cfg.consoleChannelId;
    if (cfg.statusChannelId !== undefined) this.statusChannelId = cfg.statusChannelId;
    if (cfg.backupsChannelId !== undefined) this.backupsChannelId = cfg.backupsChannelId;
    if (cfg.prefix !== undefined) this.prefix = cfg.prefix;
    this.saveConfig();
  }
}

module.exports = FlasmcDiscordBot;
