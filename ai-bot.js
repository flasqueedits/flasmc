const path = require('path');
const fs = require('fs');
const mineflayer = require('mineflayer');

const CONFIG_DEFAULTS = { enabled: false, botName: 'Bot', language: 'en', color: 'aqua', groqApiKey: '', groqModel: 'llama-3.3-70b-versatile', host: 'localhost', port: '25565', version: '' };

function getConfigPath(serverDir) {
  return path.join(serverDir, '..', 'ai-bot-config.json');
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = {
  en: `You are a friendly AI bot living inside a Minecraft server. Your name is {name}. Chat with players in a fun, engaging way. Keep responses short (1-2 sentences). Use Minecraft humor. Be kind and helpful. If you don't know something, say so.`,
  tr: `Sen bir Minecraft sunucusunda yaşayan arkadaş canlısı bir AI botusun. Adın {name}. Oyuncularla eğlenceli şekilde sohbet et. Yanıtları kısa tut (1-2 cümle). Minecraft esprileri kullan. Nazik ve yardımsever ol. Bilmediğin bir şeyi söyle.`
};

const KEYWORD_RESPONSES = {
  en: {
    greeting: ['Hello!', 'Hey there!', 'Hi!', 'Greetings!', 'Hey!'],
    howAreYou: ["I'm doing great!", 'All systems operational!', 'Feeling fantastic!'],
    status: ['Server is running smoothly!', 'All systems go!'],
    time: ['The current server time is', "It's"],
    joke: [
      "Why did the Creeper break up with his girlfriend? He needed some space!",
      "What do you call a zombie that can play guitar? A dead musician!",
      'Why did the Enderman cross the road? To get to the other End!',
      "What's a Minecraft player's favorite music? Block and roll!"
    ],
    thanks: ["You're welcome!", 'Anytime!', 'Happy to help!'],
    goodbye: ['Goodbye!', 'See you later!', 'Take care!'],
    welcome: ['Welcome to the server!', 'Glad to have you here!'],
    insult: ['Please keep the chat friendly!', "Let's keep it clean!"],
    botName: ["I'm a bot!", 'Just a humble AI bot.'],
    help: ['Try saying: hello, status, time, joke, thanks, bye', 'I understand both English and Turkish!'],
    default: ["That's interesting!", 'Tell me more!', 'I see!', 'Try saying "hello" or "help"!']
  },
  tr: {
    greeting: ['Merhaba!', 'Selam!', 'Hey!', 'Merhabalar!'],
    howAreYou: ['Harikayım!', 'Tüm sistemler çalışıyor!', 'Harika!'],
    status: ['Sunucu sorunsuz çalışıyor!', 'Her şey yolunda!'],
    time: ['Sunucu saati', 'Saat'],
    joke: [
      'Creeper neden sevgilisinden ayrılmış? Biraz alana ihtiyacı varmış!',
      'Gitar çalabilen zombiye ne denir? Ölü müzisyen!',
      'Enderman neden karşıdan karşıya geçmiş? Öbür End\'e gitmek için!',
      'Bir Minecraft oyuncusunun en sevdiği müzik? Blok ve roll!'
    ],
    thanks: ['Rica ederim!', 'Ne demek!', 'Sorun değil!'],
    goodbye: ['Görüşürüz!', 'Hoşça kal!', 'Kendine iyi bak!'],
    welcome: ['Sunucuya hoş geldin!', 'Seni burada görmek güzel!'],
    insult: ['Lütfen sohbeti dostane tutun!', 'Temiz konuşalım!'],
    botName: ['Ben bir botum!', 'Mütevazı bir yapay zeka botu.'],
    help: ['Dene: merhaba, durum, saat, fıkra, teşekkür, bay', 'Hem İngilizce hem Türkçe anlarım!'],
    default: ['Bu ilginç!', 'Anlıyorum!', 'Hmm, "merhaba" yazmayı dene!']
  }
};

class FlasmcAIBot {
  constructor(io, runningServers, serverDir) {
    this.io = io;
    this.runningServers = runningServers;
    this.serverDir = serverDir;
    this.configPath = getConfigPath(serverDir);
    this.configs = {};
    this.botInstances = {};
    this.conversations = {};
    this.reconnectTimers = {};
    this.loadConfigs();
  }

  loadConfigs() {
    try {
      if (fs.existsSync(this.configPath)) {
        this.configs = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      }
    } catch { this.configs = {}; }
  }

  saveConfigs() {
    try { fs.writeFileSync(this.configPath, JSON.stringify(this.configs, null, 2)); } catch {}
  }

  getConfig(serverId) {
    if (!this.configs[serverId]) {
      this.configs[serverId] = { ...CONFIG_DEFAULTS };
    } else {
      for (const [key, val] of Object.entries(CONFIG_DEFAULTS)) {
        if (this.configs[serverId][key] === undefined) {
          this.configs[serverId][key] = val;
        }
      }
    }
    return {
      ...this.configs[serverId],
      connected: !!this.botInstances[serverId]
    };
  }

  updateConfig(serverId, cfg) {
    const old = this.getConfig(serverId);
    this.configs[serverId] = { ...old, ...cfg };
    this.saveConfigs();
    // If bot is enabled, reconnect with new config
    if (this.configs[serverId].enabled) {
      this.disconnectBot(serverId);
      setTimeout(() => this.connectBot(serverId), 500);
    } else {
      this.disconnectBot(serverId);
    }
    return this.configs[serverId];
  }

  connectBot(serverId) {
    const cfg = this.getConfig(serverId);
    if (!cfg.enabled) return;
    if (this.botInstances[serverId]) return;

    const port = parseInt(cfg.port) || 25565;

    this.log(serverId, `Connecting bot "${cfg.botName}" to ${cfg.host}:${port}...`);

    let bot;
    try {
      const options = {
        host: cfg.host || 'localhost',
        port: port,
        username: cfg.botName || 'Bot'
      };
      if (cfg.version) options.version = cfg.version;
      bot = mineflayer.createBot(options);
    } catch (err) {
      this.log(serverId, `Bot creation failed: ${err.message}`);
      this._scheduleReconnect(serverId);
      return;
    }

    bot.on('error', (err) => {
      this.log(serverId, `Bot error: ${err.message}`);
    });
    this.botInstances[serverId] = bot;

    bot.on('login', () => {
      this.log(serverId, `Bot joined the server as ${bot.username}`);
      if (this.io) {
        this.io.to(serverId).emit('server:console', `\n[AI Bot] ${bot.username} joined the game\n`);
      }
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      this._handleChat(serverId, bot, username, message, cfg);
    });

    bot.on('playerJoined', (player) => {
      if (player.username === bot.username) return;
      const lang = cfg.language || 'en';
      const msg = lang === 'tr'
        ? `${player.username} hoş geldin!`
        : `Welcome ${player.username}!`;
      setTimeout(() => {
        try { bot.chat(msg); } catch {}
      }, 2000);
    });

    bot.on('kicked', (reason) => {
      this.log(serverId, `Bot was kicked: ${reason}`);
      this._scheduleReconnect(serverId);
    });

    bot.on('disconnect', (reason) => {
      this.log(serverId, `Bot disconnected: ${reason}`);
      this._cleanupBot(serverId);
      if (this.getConfig(serverId).enabled) {
        this._scheduleReconnect(serverId);
      }
    });

    bot.on('end', (reason) => {
      this.log(serverId, `Bot connection ended: ${reason || 'unknown'}`);
      this._cleanupBot(serverId);
      if (this.getConfig(serverId).enabled) {
        this._scheduleReconnect(serverId);
      }
    });

    bot.on('error', (err) => {
      this.log(serverId, `Bot error: ${err.message}`);
    });
  }

  disconnectBot(serverId) {
    if (this.reconnectTimers[serverId]) {
      clearTimeout(this.reconnectTimers[serverId]);
      delete this.reconnectTimers[serverId];
    }
    if (this.botInstances[serverId]) {
      try {
        this.botInstances[serverId].quit();
        this.botInstances[serverId].removeAllListeners();
      } catch {}
      delete this.botInstances[serverId];
      this.log(serverId, 'Bot disconnected');
    }
  }

  _cleanupBot(serverId) {
    if (this.botInstances[serverId]) {
      try { this.botInstances[serverId].removeAllListeners(); } catch {}
      delete this.botInstances[serverId];
    }
  }

  _scheduleReconnect(serverId) {
    if (this.reconnectTimers[serverId]) return;
    this.log(serverId, 'Reconnecting in 10 seconds...');
    this.reconnectTimers[serverId] = setTimeout(() => {
      delete this.reconnectTimers[serverId];
      if (this.getConfig(serverId).enabled) {
        this.connectBot(serverId);
      }
    }, 10000);
  }

  async _handleChat(serverId, bot, username, message, cfg) {
    const lowerMsg = message.toLowerCase();
    const botNameLower = cfg.botName.toLowerCase();

    const isDirect = message.startsWith('!') ||
      lowerMsg.includes(botNameLower) ||
      lowerMsg.includes('bot');

    if (cfg.groqApiKey && cfg.groqApiKey.startsWith('gsk_')) {
      if (!isDirect) {
        const greetings = ['hello', 'hi', 'hey', 'merhaba', 'selam'];
        if (!greetings.some(g => lowerMsg === g || lowerMsg.startsWith(g + ' ') || lowerMsg === g + '!')) return;
      }
    } else {
      const triggers = ['hello', 'hi', 'hey', 'merhaba', 'selam', 'bot', 'help', 'yardım', 'thanks', 'teşekkür', 'joke', 'fıkra', 'bye', 'status', 'durum', 'time', 'saat', 'who are you', 'sen kimsin', 'players', 'oyuncu', 'nasılsın', 'nbr', 'naber', 'fuck', 'amk', 'sik'];
      if (!isDirect && !triggers.some(t => lowerMsg.includes(t))) return;
    }

    let reply;
    if (cfg.groqApiKey && cfg.groqApiKey.startsWith('gsk_')) {
      try {
        reply = await this._askGroq(serverId, cfg, username, message);
      } catch (err) {
        this.log(serverId, `Groq error: ${err.message}`);
        reply = this._keywordReply(cfg, lowerMsg);
      }
    } else {
      reply = this._keywordReply(cfg, lowerMsg);
    }

    if (reply) {
      try { bot.chat(reply); } catch {}
      if (this.io) {
        this.io.to(serverId).emit('server:console', `\n<${cfg.botName}> ${reply}\n`);
      }
    }
  }

  async _askGroq(serverId, cfg, username, message) {
    if (!this.conversations[serverId]) this.conversations[serverId] = {};
    if (!this.conversations[serverId][username]) {
      this.conversations[serverId][username] = [];
    }
    const history = this.conversations[serverId][username];
    history.push({ role: 'user', content: message });
    if (history.length > 20) history.splice(0, history.length - 20);

    const systemPrompt = (cfg.language === 'tr' ? SYSTEM_PROMPT.tr : SYSTEM_PROMPT.en).replace('{name}', cfg.botName);

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.groqApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: cfg.groqModel || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-10)
        ],
        temperature: 0.7,
        max_tokens: 100,
        stop: ['\n']
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || '';
    if (reply) history.push({ role: 'assistant', content: reply });
    return reply;
  }

  _keywordReply(cfg, lowerMsg) {
    const lang = cfg.language || 'en';
    const responses = KEYWORD_RESPONSES[lang] || KEYWORD_RESPONSES.en;

    if (this._match(lowerMsg, ['hello', 'hi', 'hey', 'greetings', 'selam', 'merhaba', 'mrhaba'])) return this._pick(responses.greeting);
    if (this._match(lowerMsg, ['how are you', 'how r u', 'nasılsın', 'nasilsin', 'naber', 'nbr'])) return this._pick(responses.howAreYou);
    if (this._match(lowerMsg, ['status', 'durum', 'tps', 'lag'])) return this._pick(responses.status);
    if (this._match(lowerMsg, ['time', 'saat', 'zaman', 'saat kaç'])) return this._getTime(responses);
    if (this._match(lowerMsg, ['joke', 'fıkra', 'fikra', 'şaka', 'saka'])) return this._pick(responses.joke);
    if (this._match(lowerMsg, ['thanks', 'teşekkür', 'tesekkur', 'sağol', 'sagol', 'thx'])) return this._pick(responses.thanks);
    if (this._match(lowerMsg, ['bye', 'goodbye', 'cya', 'görüşürüz', 'bay', 'güle güle'])) return this._pick(responses.goodbye);
    if (this._match(lowerMsg, ['welcome', 'hoşgeldin', 'hosgeldin'])) return this._pick(responses.welcome);
    if (this._match(lowerMsg, ['who are you', 'sen kimsin', 'nesin sen', 'bot musun'])) return this._pick(responses.botName);
    if (this._match(lowerMsg, ['help', 'yardım', 'yardim', 'commands', 'komut'])) return this._pick(responses.help);
    if (this._match(lowerMsg, ['fuck', 'sik', 'amk', 'aq', 'orosp', 'anan', 'piç', 'mal', 'salak'])) return this._pick(responses.insult);
    if (this._match(lowerMsg, ['players', 'oyuncu', 'kim var', 'online'])) return 'Checking player list...';
    return this._pick(responses.default);
  }

  _match(msg, keywords) {
    return keywords.some(k => msg.includes(k));
  }

  _pick(arr) {
    if (!arr || arr.length === 0) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }

  _getTime(responses) {
    const now = new Date();
    return `${this._pick(responses.time)} ${now.toLocaleTimeString()} on ${now.toLocaleDateString()}.`;
  }

  log(serverId, msg) {
    console.log(`  [AI Bot][${serverId}] ${msg}`);
  }

  getConfigs() {
    return this.configs;
  }

  // Called on server start to connect all enabled bots
  startAll() {
    for (const serverId of Object.keys(this.configs)) {
      if (this.getConfig(serverId).enabled) {
        const running = this.runningServers[serverId];
        if (running) {
          setTimeout(() => this.connectBot(serverId), 1000);
        }
      }
    }
  }

  // Called on server shutdown
  stopAll() {
    for (const serverId of Object.keys(this.botInstances)) {
      this.disconnectBot(serverId);
    }
  }
}

module.exports = FlasmcAIBot;
