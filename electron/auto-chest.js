// 상자 자동 오픈(D-019): 패처 호출·게임 종료/재실행·백업/롤백·플래그를 메인 프로세스에서 조율한다.
// 시스템 조작(sys)과 worker 제어는 주입받아, 실게임 없이 사본으로 흐름을 검증할 수 있다(tools/auto_chest/test-flow.js).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FLAG_NAME = 'CatTalkAutoChest.on';
const GAME_EXE = 'BongoCat.exe';
const COUNTDOWN_SECONDS = 5;
const POLL_MS = 500;
const GAME_CLOSE_MS = 20000;     // 일반 종료 요청 후 대기. 넘기면 강제 종료하지 않고 중단한다
const STEAM_RELEASE_MS = 15000;  // Steam이 앱을 '실행 중'에서 풀 때까지(D-019: worker가 살아 있으면 안 풀린다)
const LAUNCH_MS = 60000;
const STABLE_MS = 20000;         // 기동 후 이 시간 살아 있어야 성공

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout) }));
});

// 설치 경로·앱 id는 Steam 설치에서 실측한다(레지스트리 → 라이브러리 → appmanifest의 installdir).
async function findGame() {
  const reg = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
  const steam = /SteamPath\s+REG_SZ\s+(.+)/.exec(reg.stdout)?.[1]?.trim();
  if (!steam) return null;
  // 레지스트리 SteamPath는 소문자·슬래시 표기라(실측) 정식 표기인 라이브러리 설정을 먼저 쓴다. 플래그 리터럴이 이 경로로 들어간다.
  const roots = [];
  try {
    const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf-8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) roots.push(m[1].replace(/\\\\/g, '\\'));
  } catch { /* 기본 라이브러리만 */ }
  roots.push(steam);
  for (const lib of new Set(roots)) {
    const apps = path.join(lib, 'steamapps');
    let names = [];
    try { names = fs.readdirSync(apps).filter((n) => /^appmanifest_\d+\.acf$/.test(n)); } catch { continue; }
    for (const name of names) {
      let text = '';
      try { text = fs.readFileSync(path.join(apps, name), 'utf-8'); } catch { continue; }
      const dir = /"installdir"\s+"([^"]+)"/.exec(text)?.[1];
      if (dir !== 'BongoCat') continue;
      const root = path.normalize(path.join(apps, 'common', dir));
      if (fs.existsSync(path.join(root, 'BongoCat_Data', 'Managed', 'Assembly-CSharp.dll'))) return { root, appId: /\d+/.exec(name)[0] };
    }
  }
  return null;
}

// openExternal은 electron shell을 쓰므로 main.js가 넣어 준다.
function defaultSys(openExternal) {
  return {
    findGame,
    async gameRunning() { return (await run('tasklist', ['/FI', `IMAGENAME eq ${GAME_EXE}`, '/FO', 'CSV', '/NH'])).stdout.includes(GAME_EXE); },
    async closeGame() { await run('taskkill', ['/IM', GAME_EXE]); },   // /F 없음: 창 닫기 요청만
    async steamRunning(appId) { return /Running\s+REG_DWORD\s+0x0*[1-9a-f]/i.test((await run('reg', ['query', `HKCU\\Software\\Valve\\Steam\\Apps\\${appId}`, '/v', 'Running'])).stdout); },
    launch: (appId) => openExternal(`steam://rungameid/${appId}`),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

class Failure extends Error {}

// Windows 경로는 대소문자를 구분하지 않는다. 표기만 다른 경로를 '게임이 옮겨졌다'로 오판하지 않게 한다.
const samePath = (a, b) => typeof a === 'string' && path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();

function createAutoChest({ dataDir, patcherExe, sys, stopWorker, startWorker, notify }) {
  const home = path.join(dataDir, 'auto_chest');
  const backupDir = path.join(home, 'backup');
  const staging = path.join(home, 'staging', 'Assembly-CSharp.dll');
  const original = path.join(backupDir, 'Assembly-CSharp.dll.orig');
  let busy = false, cancelled = false;

  // managed: 패처가 결과의 모든 참조를 게임 런타임 어셈블리로 해석해 보는 폴더(스트리핑된 API 차단, D-028)
  const paths = (game) => {
    const managed = path.join(game.root, 'BongoCat_Data', 'Managed');
    return { managed, dll: path.join(managed, 'Assembly-CSharp.dll'), flag: path.join(game.root, FLAG_NAME) };
  };

  async function patcher(...args) {
    const r = await run(patcherExe, args);
    let json = {};
    try { json = JSON.parse(r.stdout); } catch { /* 실행 실패 */ }
    return { code: r.code, json };
  }

  // 판정만 한다(쓰기 없음). wanted = 설정 ON 여부: 켜 뒀는데 clean이면 업데이트로 패치가 사라진 것.
  async function status(wanted) {
    if (busy) return { state: 'installing' };
    const game = await sys.findGame();
    if (!game) return { state: 'no_game' };
    const { dll, flag } = paths(game);
    const r = await patcher('inspect', dll);
    if (r.code === 2) return { state: 'incompatible', reason: r.json.reason };
    if (r.code !== 0) return { state: 'error', reason: r.json.reason };
    if (r.json.state === 'clean') return { state: wanted ? 'needs_reapply' : 'not_installed' };
    if (!samePath(r.json.flag, flag)) return { state: 'needs_reapply', reason: 'flag_path_changed' };   // 게임 경로가 바뀜
    return { state: fs.existsSync(flag) ? 'on' : 'off' };
  }

  async function waitFor(check, ms) {
    for (let waited = 0; waited < ms; waited += POLL_MS) {
      if (await check()) return true;
      await sys.sleep(POLL_MS);
    }
    return check();
  }

  // 게임이 꺼져 있을 때만 호출한다. 백업(clean일 때만) → 구조검증·패치(별도 파일) → verify → 교체 → 재검증.
  // onReplaced로 교체 사실을 알려, 호출자가 이후 실패 시 백업으로 복원하게 한다.
  async function patchInstalled(game, onReplaced) {
    const { managed, dll, flag } = paths(game);
    let r = await patcher('inspect', dll);
    if (r.code !== 0) throw new Failure(r.code === 2 ? 'incompatible' : 'inspect_failed');
    if (r.json.state === 'patched') {   // 경로가 바뀐 패치본: 원본으로 되돌린 뒤 새 리터럴로 다시 패치
      if ((await patcher('restore', backupDir, dll)).code !== 0) throw new Failure('restore_failed');
    } else if ((await patcher('backup', dll, backupDir)).code !== 0) throw new Failure('backup_failed');
    fs.mkdirSync(path.dirname(staging), { recursive: true });
    fs.rmSync(staging, { force: true });
    r = await patcher('patch', dll, staging, flag, managed);
    if (r.code !== 0) throw new Failure(r.code === 2 ? 'incompatible' : 'patch_failed');
    if ((await patcher('verify', original, staging, flag, managed)).code !== 0) throw new Failure('verify_failed');
    if (await sys.gameRunning()) throw new Failure('game_running');
    const tmp = `${dll}.cattalk-new`;
    fs.copyFileSync(staging, tmp);
    try { fs.renameSync(tmp, dll); } catch (e) { fs.rmSync(tmp, { force: true }); throw new Failure('replace_failed'); }
    onReplaced();
    if ((await patcher('verify', original, dll, flag, managed)).code !== 0) throw new Failure('post_verify_failed');
  }

  async function rollback(game) {
    await waitFor(async () => !(await sys.gameRunning()), GAME_CLOSE_MS);
    if (await sys.gameRunning()) return false;   // 켜진 게임의 DLL은 건드리지 않는다
    return (await patcher('restore', backupDir, paths(game).dll)).code === 0;
  }

  async function install(game) {
    const wasRunning = await sys.gameRunning();
    let replaced = false, restarted = false;
    busy = true;
    try {
      notify({ phase: 'stopping_worker' });
      await stopWorker();   // 재실행 전 필수: worker가 살아 있으면 Steam이 게임을 실행 중으로 본다(D-019)
      if (wasRunning) {
        notify({ phase: 'closing_game' });
        await sys.closeGame();
        if (!(await waitFor(async () => !(await sys.gameRunning()), GAME_CLOSE_MS))) throw new Failure('game_close_failed');
      }
      if (!(await waitFor(async () => !(await sys.steamRunning(game.appId)), STEAM_RELEASE_MS))) throw new Failure('steam_still_running');
      notify({ phase: 'patching' });
      await patchInstalled(game, () => { replaced = true; });
      notify({ phase: 'launching' });
      await sys.launch(game.appId);
      restarted = true;
      if (!(await waitFor(() => sys.gameRunning(), LAUNCH_MS))) throw new Failure('game_start_failed');
      notify({ phase: 'verifying' });
      await sys.sleep(STABLE_MS);
      if (!(await sys.gameRunning())) throw new Failure('game_crashed');
      fs.writeFileSync(paths(game).flag, '');
      notify({ phase: 'done' });
      return { ok: true };
    } catch (e) {
      const reason = e instanceof Failure ? e.message : 'unexpected';
      const rolledBack = replaced ? await rollback(game) : false;
      // 설치 전에 켜져 있던 게임은 되살린다(재실행까지 갔거나 아직 켜져 있으면 그대로 둔다).
      if (wasRunning && !restarted && !(await sys.gameRunning())) await sys.launch(game.appId);
      notify({ phase: 'failed', reason, rolledBack });
      return { ok: false, reason, rolledBack };
    } finally {
      busy = false;
      await startWorker();
    }
  }

  async function countdown() {
    cancelled = false;
    for (let s = COUNTDOWN_SECONDS; s > 0; s--) {
      notify({ phase: 'countdown', seconds: s });
      await sys.sleep(1000);
      if (cancelled) { notify({ phase: 'cancelled' }); return false; }
    }
    return true;
  }

  return {
    status,
    cancel() { cancelled = true; },

    // 켜기: 설치돼 있으면 플래그만(즉시, 재실행 없음). 아니면 카운트다운 후 설치.
    async enable() {
      if (busy) return { ok: false, reason: 'busy' };
      const current = await status(false);
      if (current.state === 'incompatible' || current.state === 'error' || current.state === 'no_game') return { ok: false, reason: current.state };
      const game = await sys.findGame();
      if (current.state === 'on') return { ok: true };
      if (current.state === 'off') { fs.writeFileSync(paths(game).flag, ''); return { ok: true }; }
      if (!(await countdown())) return { ok: false, reason: 'cancelled' };
      return install(game);
    },

    // 끄기: 플래그 삭제(즉시). 패치는 무해하게 남는다.
    async disable() {
      const game = await sys.findGame();
      if (game) fs.rmSync(paths(game).flag, { force: true });
      return { ok: true };
    },

    // 재적용: 업데이트로 패치가 사라졌을 때 토스트의 [재시작]으로만 불린다(버튼이 곧 확인이라 카운트다운 없음).
    // 재적용이 필요한 상태가 아니면(구조가 바뀌어 호환 안 됨 포함) 아무것도 하지 않는다.
    async reapply() {
      if (busy) return { ok: false, reason: 'busy' };
      const current = await status(true);
      if (current.state !== 'needs_reapply') return { ok: false, reason: current.state };
      return install(await sys.findGame());
    },
  };
}

module.exports = { createAutoChest, defaultSys, FLAG_NAME, POLL_MS };
