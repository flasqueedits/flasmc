const path = require('path');
const fs = require('fs');
const mineflayer = require('mineflayer');

const CONFIG_DEFAULTS = { enabled: false, botName: 'Bot', language: 'en', color: 'aqua', groqApiKey: '', groqModel: 'llama-3.3-70b-versatile', host: 'localhost', port: '25565', version: '', eventsEnabled: true, eventInterval: 3600000 };
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const EVENTS = [
  { id: 'item_rain', name: '☔ Eşya Yağmuru', nameEn: '☔ Item Rain', emoji: '☔', cmd: (mc) => mc(`execute as @a at @s run give @s ${randItem()} ${randInt(1,5)}`) },
  { id: 'mob_rain', name: '👾 Mob Yağmuru', nameEn: '👾 Mob Rain', emoji: '👾', cmd: (mc) => mc(`execute as @a at @s run summon ${randMob()} ~ ~5 ~`) },
  { id: 'drop_party', name: '🎁 Drop Partisi', nameEn: '🎁 Drop Party', emoji: '🎁', cmd: (mc) => mc(`execute at @r run summon minecraft:item ~ ~2 ~ {Item:{id:"${randItem()}",Count:${randInt(8,64)}b}}`) },
  { id: 'super_powers', name: '⚡ Süper Güçler', nameEn: '⚡ Super Powers', emoji: '⚡', cmd: (mc) => { mc('effect give @a speed 60 3'); mc('effect give @a resistance 60 3'); mc('effect give @a jump_boost 60 3'); mc('effect give @a strength 60 2'); } },
  { id: 'creeper_apoc', name: '💥 Creeper Kıyameti', nameEn: '💥 Creeper Apocalypse', emoji: '💥', cmd: (mc) => { for (let i=0;i<5;i++) mc(`execute at @r run summon creeper ~ ~ ~ {ignited:1,Fuse:30}`); } },
  { id: 'anvil_rain', name: '🔨 Örs Yağmuru', nameEn: '🔨 Anvil Rain', emoji: '🔨', cmd: (mc) => mc(`execute as @a at @s run summon minecraft:falling_block ~ ~5 ~ {BlockState:{Name:"minecraft:anvil"},HurtEntities:1}`) },
  { id: 'tnt_rain', name: '💣 TNT Yağmuru', nameEn: '💣 TNT Rain', emoji: '💣', cmd: (mc) => mc(`execute as @a at @s run summon minecraft:tnt ~ ~5 ~ {Fuse:40}`) },
  { id: 'potion_madness', name: '🧪 İksir Çılgınlığı', nameEn: '🧪 Potion Madness', emoji: '🧪', cmd: (mc) => { mc(`effect give @a ${randEffect()} ${randInt(10,30)} ${randInt(1,3)}`); mc(`effect give @a ${randEffect()} ${randInt(10,30)} ${randInt(1,3)}`); mc(`effect give @a ${randEffect()} ${randInt(10,30)} ${randInt(1,3)}`); } },
  { id: 'random_tp', name: '🌀 Rastgele Işınlanma', nameEn: '🌀 Random Teleport', emoji: '🌀', cmd: (mc) => mc(`spreadplayers 0 0 5 100 false @a`) },
  { id: 'xp_rain', name: '✨ XP Yağmuru', nameEn: '✨ XP Rain', emoji: '✨', cmd: (mc) => mc(`execute as @a at @s run summon minecraft:experience_orb ~ ~ ~ {Value:${randInt(10,50)}}`) },
  { id: 'lightning', name: '⚡ Yıldırım Festivali', nameEn: '⚡ Lightning Festival', emoji: '⚡', cmd: (mc) => { for (let i=0;i<3;i++) mc(`execute at @r run summon minecraft:lightning_bolt ~ ~ ~`); } },
  { id: 'feed_party', name: '🍔 Doyurma Partisi', nameEn: '🍔 Feed Party', emoji: '🍔', cmd: (mc) => { mc('effect give @a saturation 30 5'); mc('effect give @a regeneration 30 3'); } },
];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

const ITEMS = ['diamond', 'emerald', 'gold_ingot', 'iron_ingot', 'netherite_ingot', 'ender_pearl', 'experience_bottle', 'cooked_beef', 'golden_apple', 'enchanted_golden_apple', 'diamond_sword', 'diamond_pickaxe', 'bow', 'arrow', 'shield', 'totem_of_undying', 'firework_rocket', 'elytra'];
const MOBS = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'slime', 'phantom', 'piglin_brute', 'warden', 'ravager', 'vindicator'];
const EFFECTS = ['speed', 'haste', 'strength', 'jump_boost', 'regeneration', 'resistance', 'fire_resistance', 'absorption', 'night_vision', 'water_breathing', 'invisibility', 'luck'];

function randItem() { return pick(ITEMS); }
function randMob() { return pick(MOBS); }
function randEffect() { return pick(EFFECTS); }

const SYSTEM_PROMPT = {
  en: `You are a friendly AI bot living inside a Minecraft minigame server. Your name is {name}. Chat with players in a fun, engaging way. Keep responses short (1-2 sentences). Use Minecraft humor. Be kind and helpful. If you don't know something, say so.`,
  tr: `Sen bir Minecraft minigame sunucusunda yaşayan arkadaş canlısı bir AI botusun. Adın {name}. Oyuncularla eğlenceli şekilde sohbet et. Yanıtları kısa tut (1-2 cümle). Minecraft esprileri kullan. Nazik ve yardımsever ol. Bilmediğin bir şeyi söyle.`
};

const KEYWORD_RESPONSES = {
  en: {
    greeting: ['Hello!', 'Hey there!', 'Hi!', 'Greetings!', 'Hey!'],
    howAreYou: ["I'm doing great!", 'All systems operational!', 'Feeling fantastic!'],
    status: ['Server is running smoothly!', 'All systems go!'],
    time: ['The current server time is', "It's"],
    joke: ['Why did the Creeper break up with his girlfriend? He needed some space!', "What do you call a zombie that can play guitar? A dead musician!", 'Why did the Enderman cross the road? To get to the other End!', "What's a Minecraft player's favorite music? Block and roll!"],
    thanks: ["You're welcome!", 'Anytime!', 'Happy to help!'],
    goodbye: ['Goodbye!', 'See you later!', 'Take care!'],
    welcome: ['Welcome to the server!', 'Glad to have you here!'],
    insult: ['Please keep the chat friendly!', "Let's keep it clean!"],
    botName: ["I'm a bot!", 'Just a humble AI bot.'],
    help: ['Try saying: hello, status, time, joke, thanks, bye', 'I understand both English and Turkish!'],
    event: ['Events happen every hour! Stay tuned for ☔ Item Rain, 👾 Mob Rain, 💥 Creeper Apocalypse and more!', 'Admin abuse events every hour! Get ready for crazy fun 🎉'],
    default: ["That's interesting!", 'Tell me more!', 'I see!', 'Try saying "hello" or "help"!']
  },
  tr: {
    greeting: ['Merhaba!', 'Selam!', 'Hey!', 'Merhabalar!'],
    howAreYou: ['Harikayım!', 'Tüm sistemler çalışıyor!', 'Harika!'],
    status: ['Sunucu sorunsuz çalışıyor!', 'Her şey yolunda!'],
    time: ['Sunucu saati', 'Saat'],
    joke: ['Creeper neden sevgilisinden ayrılmış? Biraz alana ihtiyacı varmış!', 'Gitar çalabilen zombiye ne denir? Ölü müzisyen!', 'Enderman neden karşıdan karşıya geçmiş? Öbür End\'e gitmek için!', 'Bir Minecraft oyuncusunun en sevdiği müzik? Blok ve roll!'],
    thanks: ['Rica ederim!', 'Ne demek!', 'Sorun değil!'],
    goodbye: ['Görüşürüz!', 'Hoşça kal!', 'Kendine iyi bak!'],
    welcome: ['Sunucuya hoş geldin!', 'Seni burada görmek güzel!'],
    insult: ['Lütfen sohbeti dostane tutun!', 'Temiz konuşalım!'],
    botName: ['Ben bir botum!', 'Mütevazı bir yapay zeka botu.'],
    help: ['Dene: merhaba, durum, saat, fıkra, teşekkür, bay', 'Hem İngilizce hem Türkçe anlarım!'],
    event: ['Etkinlikler her saat başı! ☔ Eşya Yağmuru, 👾 Mob Yağmuru, 💥 Creeper Kıyameti ve daha fazlası!', 'Admin abuse etkinlikleri her saat! Çılgın eğlenceye hazır ol 🎉'],
    default: ['Bu ilginç!', 'Anlıyorum!', 'Hmm, "merhaba" yazmayı dene!']
  }
};

class FlasmcAIBot {
  constructor(io, runningServers, serverDir) {
    this.io = io;
    this.runningServers = runningServers;
    this.serverDir = serverDir;
    this.configPath = path.join(serverDir, '..', 'ai-bot-config.json');
    this.configs = {};
    this.botInstances = {};
    this.conversations = {};
    this.reconnectTimers = {};
    this.eventTimers = {};
    this.loadConfigs();
  }

  loadConfigs() {
    try { if (fs.existsSync(this.configPath)) this.configs = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')); } catch { this.configs = {}; }
  }
  saveConfigs() {
    try { fs.writeFileSync(this.configPath, JSON.stringify(this.configs, null, 2)); } catch {}
  }

  mcCommand(serverId, cmd) {
    const proc = this.runningServers[serverId]?.proc;
    if (proc && proc.stdin) { proc.stdin.write(cmd + '\n'); return true; }
    return false;
  }

  getConfig(serverId) {
    if (!this.configs[serverId]) this.configs[serverId] = { ...CONFIG_DEFAULTS };
    else for (const [key, val] of Object.entries(CONFIG_DEFAULTS)) { if (this.configs[serverId][key] === undefined) this.configs[serverId][key] = val; }
    return { ...this.configs[serverId], connected: !!this.botInstances[serverId] };
  }

  updateConfig(serverId, cfg) {
    const old = this.getConfig(serverId);
    this.configs[serverId] = { ...old, ...cfg };
    this.saveConfigs();
    if (this.configs[serverId].enabled) { this.disconnectBot(serverId); setTimeout(() => this.connectBot(serverId), 500); }
    else this.disconnectBot(serverId);
    return this.configs[serverId];
  }

  connectBot(serverId) {
    const cfg = this.getConfig(serverId);
    if (!cfg.enabled || this.botInstances[serverId]) return;
    const port = parseInt(cfg.port) || 25565;
    this.log(serverId, `Connecting bot "${cfg.botName}" to ${cfg.host}:${port}...`);
    let bot;
    try {
      const options = { host: cfg.host || 'localhost', port: port, username: cfg.botName || 'Bot' };
      if (cfg.version) options.version = cfg.version;
      bot = mineflayer.createBot(options);
    } catch (err) { this.log(serverId, `Bot creation failed: ${err.message}`); this._scheduleReconnect(serverId); return; }

    bot.on('error', (err) => this.log(serverId, `Bot error: ${err.message}`));
    this.botInstances[serverId] = bot;

    bot.on('login', () => {
      this.log(serverId, `Bot joined the server as ${bot.username}`);
      if (this.io) this.io.to(serverId).emit('server:console', `\n[AI Bot] ${bot.username} joined the game\n`);
      this._startEvents(serverId, cfg);
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      this._handleChat(serverId, bot, username, message, cfg);
    });

    bot.on('playerJoined', (player) => {
      if (player.username === bot.username) return;
      const lang = cfg.language || 'en';
      const msg = lang === 'tr' ? `${player.username} hoş geldin!` : `Welcome ${player.username}!`;
      setTimeout(() => { try { bot.chat(msg); } catch {} }, 2000);
    });

    bot.on('kicked', (reason) => { this.log(serverId, `Bot was kicked: ${reason}`); this._cleanupBot(serverId); if (cfg.enabled) this._scheduleReconnect(serverId); });
    bot.on('disconnect', (reason) => { this.log(serverId, `Bot disconnected: ${reason}`); this._cleanupBot(serverId); if (this.getConfig(serverId).enabled) this._scheduleReconnect(serverId); });
    bot.on('end', (reason) => { this.log(serverId, `Bot connection ended: ${reason || 'unknown'}`); this._cleanupBot(serverId); if (this.getConfig(serverId).enabled) this._scheduleReconnect(serverId); });
  }

  disconnectBot(serverId) {
    if (this.reconnectTimers[serverId]) { clearTimeout(this.reconnectTimers[serverId]); delete this.reconnectTimers[serverId]; }
    this._stopEvents(serverId);
    if (this.botInstances[serverId]) { try { this.botInstances[serverId].quit(); this.botInstances[serverId].removeAllListeners(); } catch {} delete this.botInstances[serverId]; this.log(serverId, 'Bot disconnected'); }
  }

  _cleanupBot(serverId) {
    if (this.botInstances[serverId]) { try { this.botInstances[serverId].removeAllListeners(); } catch {} delete this.botInstances[serverId]; }
  }

  _scheduleReconnect(serverId) {
    if (this.reconnectTimers[serverId]) return;
    this.log(serverId, 'Reconnecting in 10 seconds...');
    this.reconnectTimers[serverId] = setTimeout(() => { delete this.reconnectTimers[serverId]; if (this.getConfig(serverId).enabled) this.connectBot(serverId); }, 10000);
  }

  // ═══ ADMIN ABUSE EVENT SYSTEM ═══

  _startEvents(serverId, cfg) {
    this._stopEvents(serverId);
    if (!cfg.eventsEnabled) return;
    const interval = cfg.eventInterval || 3600000;
    this.log(serverId, `Event scheduler started (every ${interval/60000} minutes)`);
    // First event after 5 minutes
    setTimeout(() => { this._triggerRandomEvent(serverId, cfg); }, 300000);
    this.eventTimers[serverId] = setInterval(() => { this._triggerRandomEvent(serverId, cfg); }, interval);
  }

  _stopEvents(serverId) {
    if (this.eventTimers[serverId]) { clearInterval(this.eventTimers[serverId]); delete this.eventTimers[serverId]; }
  }

  _triggerRandomEvent(serverId, cfg, specificEvent) {
    const event = specificEvent ? EVENTS.find(e => e.id === specificEvent) : pick(EVENTS);
    if (!event) return;
    const lang = cfg.language || 'en';
    const name = lang === 'tr' ? event.name : (event.nameEn || event.name);
    const mc = (cmd) => this.mcCommand(serverId, cmd);
    const bot = this.botInstances[serverId];

    // Announce
    const announce = `\n§6§l⚡ ADMIN ABUSE ⚡\n§e${name}§r§a başlıyor! Hazır olun!\n`;
    if (bot) try { bot.chat(`§6§l⚡ ${name} §r§a- Hazır olun!`); } catch {}
    if (this.io) this.io.to(serverId).emit('server:console', announce);
    this.log(serverId, `Event triggered: ${event.id}`);

    // Execute commands
    try { event.cmd(mc); } catch (err) { this.log(serverId, `Event error: ${err.message}`); }

    // Final message
    setTimeout(() => {
      if (bot) try { bot.chat(`§a✅ ${lang === 'tr' ? 'Etkinlik bitti! Bir sonraki etkinlik' : 'Event ended! Next event in'} ${cfg.eventInterval/60000} ${lang === 'tr' ? 'dakika sonra' : 'minutes'}`); } catch {}
    }, 3000);
  }

  triggerEvent(serverId, eventId) {
    const cfg = this.getConfig(serverId);
    if (!cfg.enabled || !this.botInstances[serverId]) return { error: 'Bot not connected' };
    this._triggerRandomEvent(serverId, cfg, eventId);
    return { success: true, event: eventId };
  }

  getEvents() {
    return EVENTS.map(e => ({ id: e.id, name: e.name, nameEn: e.nameEn, emoji: e.emoji }));
  }

  getNextEvent(serverId) {
    // Estimate next event time based on interval
    return { nextEventIn: (this.getConfig(serverId).eventInterval || 3600000) / 60000 + ' minutes' };
  }

  // ═══ CHAT HANDLING ═══

  async _handleChat(serverId, bot, username, message, cfg) {
    const lowerMsg = message.toLowerCase();
    const botNameLower = cfg.botName.toLowerCase();
    const isDirect = message.startsWith('!') || lowerMsg.includes(botNameLower) || lowerMsg.includes('bot');

    if (cfg.groqApiKey && cfg.groqApiKey.startsWith('gsk_')) {
      if (!isDirect) { const greetings = ['hello','hi','hey','merhaba','selam']; if (!greetings.some(g => lowerMsg === g || lowerMsg.startsWith(g+' ') || lowerMsg === g+'!')) return; }
    } else {
      const triggers = ['hello','hi','hey','merhaba','selam','bot','help','yardım','thanks','teşekkür','joke','fıkra','bye','status','durum','time','saat','who are you','sen kimsin','players','oyuncu','nasılsın','nbr','naber','fuck','amk','sik','event','etkinlik'];
      if (!isDirect && !triggers.some(t => lowerMsg.includes(t))) return;
    }

    let reply;
    if (lowerMsg.includes('event') || lowerMsg.includes('etkinlik')) {
      reply = this._keywordReply(cfg, 'event');
    } else if (cfg.groqApiKey && cfg.groqApiKey.startsWith('gsk_')) {
      try { reply = await this._askGroq(serverId, cfg, username, message); } catch { reply = this._keywordReply(cfg, lowerMsg); }
    } else {
      reply = this._keywordReply(cfg, lowerMsg);
    }

    if (reply) { try { bot.chat(reply); } catch {} if (this.io) this.io.to(serverId).emit('server:console', `\n<${cfg.botName}> ${reply}\n`); }
  }

  async _askGroq(serverId, cfg, username, message) {
    if (!this.conversations[serverId]) this.conversations[serverId] = {};
    if (!this.conversations[serverId][username]) this.conversations[serverId][username] = [];
    const history = this.conversations[serverId][username];
    history.push({ role: 'user', content: message });
    if (history.length > 20) history.splice(0, history.length - 20);
    const systemPrompt = (cfg.language === 'tr' ? SYSTEM_PROMPT.tr : SYSTEM_PROMPT.en).replace('{name}', cfg.botName);
    const response = await fetch(GROQ_API_URL, {
      method: 'POST', headers: { 'Authorization': 'Bearer '+cfg.groqApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.groqModel || 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, ...history.slice(-10)],
        temperature: 0.7, max_tokens: 100, stop: ['\n'] }
    )});
    if (!response.ok) throw new Error(`Groq API ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || '';
    if (reply) history.push({ role: 'assistant', content: reply });
    return reply;
  }

  _keywordReply(cfg, lowerMsg) {
    const lang = cfg.language || 'en';
    const responses = KEYWORD_RESPONSES[lang] || KEYWORD_RESPONSES.en;
    const m = (keywords) => keywords.some(k => lowerMsg.includes(k));
    if (m(['hello','hi','hey','greetings','selam','merhaba','mrhaba'])) return pick(responses.greeting);
    if (m(['how are you','how r u','nasılsın','nasilsin','naber','nbr'])) return pick(responses.howAreYou);
    if (m(['status','durum','tps','lag'])) return pick(responses.status);
    if (m(['time','saat','zaman','saat kaç'])) { const now = new Date(); return `${pick(responses.time)} ${now.toLocaleTimeString()} on ${now.toLocaleDateString()}.`; }
    if (m(['joke','fıkra','fikra','şaka','saka'])) return pick(responses.joke);
    if (m(['thanks','teşekkür','tesekkur','sağol','sagol','thx'])) return pick(responses.thanks);
    if (m(['bye','goodbye','cya','görüşürüz','bay','güle güle'])) return pick(responses.goodbye);
    if (m(['welcome','hoşgeldin','hosgeldin'])) return pick(responses.welcome);
    if (m(['who are you','sen kimsin','nesin sen','bot musun'])) return pick(responses.botName);
    if (m(['help','yardım','yardim','commands','komut'])) return pick(responses.help);
    if (m(['fuck','sik','amk','aq','orosp','anan','piç','mal','salak'])) return pick(responses.insult);
    if (m(['event','etkinlik','admin','abuse'])) return pick(responses.event);
    if (m(['players','oyuncu','kim var','online'])) return 'Checking player list...';
    return pick(responses.default);
  }

  log(serverId, msg) { console.log(`  [AI Bot][${serverId}] ${msg}`); }
  getConfigs() { return this.configs; }

  startAll() {
    for (const serverId of Object.keys(this.configs)) {
      if (this.getConfig(serverId).enabled && this.runningServers[serverId]) setTimeout(() => this.connectBot(serverId), 1000);
    }
  }
  stopAll() { for (const id of Object.keys(this.botInstances)) this.disconnectBot(id); }
}

module.exports = FlasmcAIBot;
