const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;
let tray = null;
let forceQuit = false;

function startServer() {
  const publicDir = path.join(app.getPath('userData'), 'public');
  const srcPublic = path.join(__dirname, 'public');
  if (fs.existsSync(srcPublic)) {
    try {
      if (fs.existsSync(publicDir)) fs.rmSync(publicDir, { recursive: true, force: true });
      fs.mkdirSync(publicDir, { recursive: true });
      copyDirSync(srcPublic, publicDir);
    } catch (e) { console.error('Failed to copy public dir:', e.message); }
  }

  return new Promise((resolve, reject) => {
    serverProcess = fork(path.join(__dirname, 'server.js'), [], {
      env: {
        ...process.env,
        ELECTRON: 'true',
        PORT: '3000',
        HOST: '127.0.0.1',
        FLASMC_DATA_DIR: app.getPath('userData')
      },
      silent: false,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    serverProcess.on('message', (msg) => {
      if (msg === 'server-listening') resolve();
    });

    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      if (text.includes('http://localhost:3000') || text.includes('http://127.0.0.1:3000')) {
        setTimeout(() => resolve(), 500);
      }
    });

    serverProcess.on('error', reject);
    serverProcess.on('exit', (code) => {
      if (code !== 0) console.log(`Server process exited with code ${code}`);
    });

    setTimeout(() => resolve(), 3000);
  });
}

function createTray() {
  // Create a simple 16x16 tray icon from a colored square
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const offset = i * 4;
    canvas[offset] = 108;     // R
    canvas[offset + 1] = 99;  // G
    canvas[offset + 2] = 255; // B
    canvas[offset + 3] = 255; // A
  }
  const icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });

  tray = new Tray(icon);
  tray.setToolTip('Flasmc - Server çalışıyor');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Pencereyi Göster',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Browser ile Aç',
      click: () => {
        require('child_process').exec('start http://127.0.0.1:3000');
      }
    },
    { type: 'separator' },
    {
      label: 'Çıkış (Sunucuyu Durdur)',
      click: () => {
        forceQuit = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Flasmc - Minecraft Server Manager',
    icon: path.join(__dirname, 'public', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#0d0d10',
    show: false,
    frame: true,
    autoHideMenuBar: true
  });

  mainWindow.loadURL('http://127.0.0.1:3000');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Close → hide to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!forceQuit) {
      event.preventDefault();
      mainWindow.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: 'Flasmc',
          body: 'Sunucu arka planda çalışmaya devam ediyor.\nTepsiden tekrar açabilirsin.',
          silent: true
        }).show();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    await startServer();
    createTray();
    createWindow();
  } catch (err) {
    dialog.showErrorBox('Flasmc Error', `Failed to start server: ${err.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Don't quit on window close — keep running in tray
  if (forceQuit) {
    if (serverProcess) serverProcess.kill();
    app.quit();
  }
});

app.on('before-quit', () => {
  if (forceQuit && serverProcess) {
    serverProcess.kill();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

function copyDirSync(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
