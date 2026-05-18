'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');

const PORT = 3001;
const HOST = '127.0.0.1';

// Support --remote-url <url> to connect to external server without starting local one
const remoteUrlArg = (() => {
  const idx = process.argv.indexOf('--remote-url');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

let mainWindow = null;
let serverProcess = null;
let usesExternalServer = false;

function configureElectronStorage() {
  try {
    const profileDirName = process.env.ELECTRON_DEV_PROFILE === '1'
      ? 'electron-profile-dev'
      : 'electron-profile';
    const profileRoot = path.join(__dirname, 'tmp', profileDirName);
    const sessionData = path.join(profileRoot, 'session');
    const diskCache = path.join(profileRoot, 'cache');

    fs.mkdirSync(sessionData, { recursive: true });
    fs.mkdirSync(diskCache, { recursive: true });

    app.setPath('userData', profileRoot);
    app.setPath('sessionData', sessionData);
    app.commandLine.appendSwitch('disk-cache-dir', diskCache);
  } catch (error) {
    console.warn('[electron] Storage configuration warning:', error.message);
  }
}

configureElectronStorage();

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'server.js');
    serverProcess = spawn(process.execPath, [serverPath], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN: '1' }
    });

    serverProcess.stdout.on('data', (data) => {
      process.stdout.write(`[server] ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
      process.stderr.write(`[server] ${data}`);
    });

    serverProcess.on('error', reject);
    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[server] process exited with code ${code}`);
      }
    });

    resolve();
  });
}

function waitForPort(port, host, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function tryConnect() {
      const sock = new net.Socket();
      sock.setTimeout(600);

      sock.connect(port, host, () => {
        sock.destroy();
        resolve();
      });

      sock.on('error', () => {
        sock.destroy();
        if (Date.now() < deadline) {
          setTimeout(tryConnect, 300);
        } else {
          reject(new Error(`Serwer nie odpowiedział na ${host}:${port} w ciągu ${timeoutMs}ms`));
        }
      });

      sock.on('timeout', () => {
        sock.destroy();
        if (Date.now() < deadline) {
          setTimeout(tryConnect, 300);
        } else {
          reject(new Error(`Timeout połączenia z ${host}:${port}`));
        }
      });
    }

    tryConnect();
  });
}

function waitForHealthyServer(port, host, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host,
      port,
      path: '/api/health',
      method: 'GET',
      timeout: timeoutMs
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          const payload = JSON.parse(raw || '{}');
          if (response.statusCode === 200 && payload && payload.ok === true) {
            resolve();
            return;
          }
        } catch (_error) {
          // handled below
        }
        reject(new Error('Port jest zajęty, ale endpoint /api/health nie wygląda na x265-converter.'));
      });
    });

    request.on('error', (err) => reject(err));
    request.on('timeout', () => {
      request.destroy(new Error('Timeout podczas weryfikacji /api/health'));
    });
    request.end();
  });
}

function killServer() {
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch (_e) {
      // ignore
    }
    serverProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 920,
    minWidth: 820,
    minHeight: 600,
    title: 'x265 Converter',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const appUrl = remoteUrlArg || `http://${HOST}:${PORT}`;
  mainWindow.loadURL(appUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(appUrl)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1460, height: 920, title: 'x265 Converter — Podgląd' } };
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('open-folder-dialog', async () => {
  const win = mainWindow;
  if (!win) return null;

  const result = await dialog.showOpenDialog(win, {
    title: 'Wybierz folder z plikami video',
    properties: ['openDirectory']
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-files-dialog', async () => {
  const win = mainWindow;
  if (!win) return [];

  const result = await dialog.showOpenDialog(win, {
    title: 'Wybierz pliki video',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Video',
        extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v', 'mpg', 'mpeg']
      }
    ]
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths.map((filePath) => {
    const normalized = String(filePath || '').trim();
    let sizeBytes = 0;
    try {
      sizeBytes = Number(fs.statSync(normalized).size || 0);
    } catch (_error) {
      sizeBytes = 0;
    }

    return {
      path: normalized,
      name: path.basename(normalized),
      sizeBytes
    };
  });
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  try {
    if (remoteUrlArg) {
      // Remote mode: connect directly to external server, skip local startup
      usesExternalServer = true;
      console.log(`[electron] Remote mode: connecting to ${remoteUrlArg}`);
    } else {
      try {
        await waitForPort(PORT, HOST, 1200);
        await waitForHealthyServer(PORT, HOST, 2000);
        usesExternalServer = true;
        console.log(`[electron] Reusing existing server at http://${HOST}:${PORT}`);
      } catch (_error) {
        usesExternalServer = false;
        await startServer();
        await waitForPort(PORT, HOST);
      }
    }

    await createWindow();
  } catch (err) {
    console.error('[electron] Nie udało się uruchomić:', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  killServer();
  app.quit();
});

app.on('before-quit', () => {
  if (!usesExternalServer) {
    killServer();
  }
});
