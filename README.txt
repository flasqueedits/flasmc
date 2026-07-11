
✦ Flasernos — Minecraft Server Manager
========================================

Web-based Minecraft server manager. Create, start, stop, and manage
multiple Minecraft servers from your browser. Supports cracked
(offline-mode) clients and includes a media gallery for screenshots.

Requires: Node.js 18+ and Java 21+


Features
--------
• Web dashboard to create/manage servers (Paper, Vanilla, Spigot)
• Live console with real-time output via Socket.IO
  - Command history (Arrow Up/Down)
  - Clear console button
• Server properties editor (GUI)
• RAM allocation per server
• Plugin/Mod Manager
  - Upload .jar files
  - Enable/disable plugins with one click
  - Bulk enable/disable all
  - Search plugins
  - Plugin manager modal
• World Manager
  - List worlds with size info
  - Download worlds as .zip
  - Upload worlds from .zip
  - Delete worlds (with safety checks)
• Media gallery — upload screenshots, videos, audio
• Anti-Cheat — built-in GrimAC (free, 1.21.4)
• X-Ray Protection — Paper built-in (engine mode 2) + Orebfuscator option
• Bedrock Support — Geyser + Floodgate built-in (PE, Xbox, PS, Switch join Java)
• Ban / Kick / Unban — built-in UI for player moderation
• Discord Bot — control your server from Discord
  - !status, !start, !stop, !list, !console, !help
  - Console output forwarding to a Discord channel
• Live server stats (TPS, player count, memory usage)
• Cracked/offline-mode support (online-mode=false)
• Auto port retry if 25565 is in use
• Production-ready (PM2 ecosystem, health endpoint, graceful shutdown)


Quick Start
-----------
1. Install Node.js (https://nodejs.org) and Java 21+ (https://adoptium.net)

2. Run setup:
   setup.bat        (Windows — double-click)

3. Start the app:
   npm start         (Electron desktop app)
   — OR —
   npm run web       (Web browser — http://localhost:3000)


Manual Setup
------------
npm install
npm start           # Electron app
npm run web         # Web-only mode


PM2 (Web Mode - Production)
---------------------------
npm install -g pm2
pm2 start ecosystem.config.js
pm2 logs flasernos
pm2 stop flasernos


Environment Variables (.env)
----------------------------
PORT=3000              Web UI port
HOST=0.0.0.0           Bind address (0.0.0.0 = all interfaces)
NODE_ENV=production


Discord Bot Setup
-----------------
1. Create a bot at https://discord.com/developers/applications
2. Enable Gateway Intents: Guilds, Guild Messages, Message Content
3. Invite the bot to your server with "bot" scope
4. Get your bot token and channel ID
5. In Flasernos, go to Discord Settings in the sidebar
6. Enter token and channel ID, click Connect
7. Bot commands: !status, !start, !stop, !list, !console, !help

Or set DISCORD_TOKEN environment variable for auto-connect.


External Access (Play with Friends)
-----------------------------------
Option A — Playit.gg (recommended, free):
  1. Download playit.exe from https://playit.gg
  2. Run: playit.exe
  3. Follow the tunnel setup, point to 25565

Option B — ngrok (TCP requires paid account):
  ngrok tcp 25565


Connecting to Your Server
-------------------------
1. Create a server in the web UI and click Start
2. Wait for "Done (X.XXXs)!" in the console
3. In Minecraft (cracked/offline):
   - Server Address: 127.0.0.1:25565 (local)
   - or use your public IP/tunnel address for friends
4. online-mode is set to false by default


Bedrock Support (Geyser + Floodgate)
-------------------------------------
Let Bedrock Edition players (PE, Xbox, PS, Switch, Windows 10) join
your Java server — no extra client needed.

• Enable during server creation or install later from the sidebar
• Auto-installs Geyser-Spigot + Floodgate
• Floodgate lets Bedrock players join without a Java account
• Bedrock port: 19132 UDP (configurable)
• Works with cracked/offline-mode servers (auto-sets online-mode=false)

Note: Open port 19132 UDP in your firewall/tunnel for Bedrock players.


Anti-Cheat
----------
Flasernos includes built-in support for GrimAC (free anti-cheat).

• Enable during server creation via the checkbox
• Or install later from the server detail sidebar
• Auto-downloads from GitHub on creation (falls back gracefully)
• Works with cracked/offline-mode servers
• Remove anytime with one click


Media Gallery
-------------
While viewing a server, use the Media section in the sidebar
to upload images, videos, or audio. Click thumbnails to preview.
Supported: jpg, png, gif, webp, mp4, webm, mp3, ogg


Tech Stack
----------
Backend:  Node.js, Express, Socket.IO, Multer
Frontend: Vanilla JS, CSS
Server:   Paper/Vanilla/Spigot Minecraft JARs


License
-------
MIT
