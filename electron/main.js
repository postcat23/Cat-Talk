const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const REQUEST_TIMEOUT_MS = 5000;

let win = null, sidecar = null, nextId = 1, stdoutBuf = '';
const pending = new Map();   // id -> {resolve, reject, timer}

if (!app.requestSingleInstanceLock()) { app.quit(); }

function settle(id) {
  const p = pending.get(id);
  if (p) { pending.delete(id); clearTimeout(p.timer); }
  return p;
}

function startSidecar() {
  // upstream 소스는 3.10+ 문법(`dict | None`)이라 기본은 py 런처의 3.11. CATTALK_PYTHON으로 override.
  const [py, ...pyArgs] = process.env.CATTALK_PYTHON ? [process.env.CATTALK_PYTHON] : ['py', '-3.11'];
  sidecar = spawn(py, [...pyArgs, path.join(__dirname, '..', 'sidecar', 'server.py')], {
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
      const p = settle(msg.id);
      if (p) p.resolve(JSON.stringify(msg.result));
    }
  });
  sidecar.on('exit', () => {
    for (const id of [...pending.keys()]) settle(id).reject(new Error('sidecar_exited'));
    sidecar = null;
  });
}

function sidecarRequest(payloadString) {
  return new Promise((resolve, reject) => {
    if (!sidecar) { reject(new Error('sidecar_down')); return; }
    let args; try { args = JSON.parse(payloadString); } catch (e) { reject(e); return; }
    const id = nextId++;
    // 응답이 없거나 id가 매칭되지 않으면 영구 대기 대신 타임아웃으로 정리한다.
    const timer = setTimeout(() => { if (settle(id)) reject(new Error('sidecar_timeout')); }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
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
