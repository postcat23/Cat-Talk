const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let win = null, sidecar = null, nextId = 1, stdoutBuf = '';
const pending = new Map();   // id -> {resolve, reject}

if (!app.requestSingleInstanceLock()) { app.quit(); }

function startSidecar() {
  const py = process.env.CATTALK_PYTHON || 'python';   // python 안 잡히면 CATTALK_PYTHON=py 등으로 override
  sidecar = spawn(py, [path.join(__dirname, '..', 'sidecar', 'server.py')], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  sidecar.stdout.setEncoding('utf-8');
  sidecar.stdout.on('data', (chunk) => {
    stdoutBuf += chunk;
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl); stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p.resolve(JSON.stringify(msg.result)); }
    }
  });
  sidecar.on('exit', () => {
    for (const p of pending.values()) p.reject(new Error('sidecar_exited'));
    pending.clear(); sidecar = null;
  });
}

function sidecarRequest(payloadString) {
  return new Promise((resolve, reject) => {
    if (!sidecar) { reject(new Error('sidecar_down')); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    let args; try { args = JSON.parse(payloadString); } catch (e) { reject(e); return; }
    sidecar.stdin.write(JSON.stringify({ id, args }) + '\n');
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 840, minWidth: 400, minHeight: 500, title: 'Cat-Talk (dev)',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('bridge-request', async (_e, payloadString) => {
  try { return await sidecarRequest(payloadString); }
  catch (e) { return JSON.stringify({ error: 'bridge_down' }); }
});

app.whenReady().then(() => { startSidecar(); createWindow(); });
app.on('window-all-closed', () => { if (sidecar) sidecar.kill(); app.quit(); });
