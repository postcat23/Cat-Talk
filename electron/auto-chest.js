// 상자 자동 오픈(D-019)·모든 고양이 투명화(D-028): 패처 호출·게임 종료/재실행·백업/롤백·플래그를 메인 프로세스에서 조율한다.
// 두 기능은 패치 하나를 함께 쓰고 플래그만 따로다. 설치는 한 번(재실행), 이후 켜기/끄기는 플래그만(게임이 0.5초~ 주기로 본다).
// 시스템 조작(sys)과 worker 제어는 주입받아, 실게임 없이 사본으로 흐름을 검증할 수 있다(tools/auto_chest/test-flow.js).
// 설치·재적용은 worker·게임을 건드리기 전에 사전 점검(별도 파일에 패치·verify)을 통과해야 시작한다(D-029).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FLAG_NAME = 'CatTalkAutoChest.on';
const TRANSPARENT_FLAG_NAME = 'CatTalkTransparent.on';   // 패처가 FLAG_NAME 옆에 정하는 이름(AutoChestPatcher.cs)
const FEATURE_FLAGS = { chest: FLAG_NAME, transparent: TRANSPARENT_FLAG_NAME };
const GAME_EXE = 'BongoCat.exe';
const COUNTDOWN_SECONDS = 5;
const POLL_MS = 500;
const GAME_CLOSE_MS = 20000;     // 일반 종료 요청 후 대기. 넘기면 강제 종료하지 않고 중단한다
const STEAM_RELEASE_MS = 15000;  // Steam이 앱을 '실행 중'에서 풀 때까지(D-019: worker가 살아 있으면 안 풀린다)
const LAUNCH_MS = 60000;
const STABLE_MS = 20000;         // 기동 후 이 시간 살아 있어야 성공
// 앱이 기대하는 패처(AutoChestPatcher.cs의 CliVersion·PatchVersion). 다르거나 패처가 없으면 설치·재적용을 막는다(D-029).
const PATCHER_CLI = 2;
const PATCH_VERSION = 2;

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

function createAutoChest({ dataDir, patcherExe, sys, stopWorker, startWorker, notify: notifyRaw }) {
  const home = path.join(dataDir, 'auto_chest');
  const backupDir = path.join(home, 'backup');
  const staging = path.join(home, 'staging', 'Assembly-CSharp.dll');
  const original = path.join(backupDir, 'Assembly-CSharp.dll.orig');
  const preflightOut = path.join(home, 'staging', 'preflight', 'Assembly-CSharp.dll');
  let busy = false, cancelled = false;
  let toolCheck = null;   // 맞다고 확인한 패처·Mono.Cecil 파일의 (수정 시각·크기). 바뀌면 다시 묻는다

  // managed: 패처가 결과의 모든 참조를 게임 런타임 어셈블리로 해석해 보는 폴더(스트리핑된 API 차단, D-028)
  // flag: 패처에 넘기는 상자 자동 오픈 플래그(투명화 플래그 경로는 패처가 이 옆으로 정한다)
  const paths = (game) => {
    const managed = path.join(game.root, 'BongoCat_Data', 'Managed');
    return { managed, dll: path.join(managed, 'Assembly-CSharp.dll'), flag: path.join(game.root, FLAG_NAME) };
  };
  const featureFlag = (game, feature) => path.join(game.root, FEATURE_FLAGS[feature]);
  const known = (feature) => Object.hasOwn(FEATURE_FLAGS, feature);

  async function patcher(...args) {
    const r = await run(patcherExe, args);
    let json = {};
    try { json = JSON.parse(r.stdout); } catch { /* 실행 실패 */ }
    return { code: r.code, json };
  }

  // 패처가 앱과 같은 규약인지(D-029). 패처는 기기마다 빌드하는 산출물이라 소스보다 오래된 것이 남을 수 있다
  // (2026-11-09 실측: 구버전이 5인자 호출을 거부해 재적용 때마다 게임만 재시작되고 실패). 'ok' | 'missing' | 'mismatch'.
  async function patcherState() {
    const stamp = (f) => { try { const s = fs.statSync(f); return `${s.mtimeMs}:${s.size}`; } catch { return null; } };
    const exe = stamp(patcherExe);
    if (!exe) return 'missing';
    // 의존 DLL이 빠지거나 바뀌어도(백신 격리 등) 다시 묻는다. 빠지면 version이 CLR 예외로 끝나 불일치가 된다(실측).
    const key = `${exe}|${stamp(path.join(path.dirname(patcherExe), 'Mono.Cecil.dll'))}`;
    if (toolCheck === key) return 'ok';
    const r = await patcher('version');
    if (r.code !== 0 || r.json.cli !== PATCHER_CLI || r.json.patchVersion !== PATCH_VERSION) return 'mismatch';   // 실패는 기억하지 않는다(일시 잠금 등은 다음 판정에서 풀린다)
    toolCheck = key;
    return 'ok';
  }

  // 원본 백업이 기록된 SHA와 같은지(패처 restore가 게임을 끈 뒤에야 하던 확인을 앞당긴다). 없거나 다르면 false.
  function backupIntact() {
    try {
      const want = fs.readFileSync(`${original}.sha256`, 'utf-8').trim().toLowerCase();
      return crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex') === want;
    } catch { return false; }
  }

  // 판정만 한다(쓰기 없음). wanted = 어느 기능이든 설정 ON 여부: 켜 뒀는데 clean이면 업데이트로 패치가 사라진 것.
  // state = 설치 상태(설치돼 있으면 상자 자동 오픈 플래그로 on/off), transparent = 같은 판정에서 투명화 플래그로 on/off.
  async function status(wanted) {
    const s = await installState(wanted);
    if (s.state !== 'installed') return { ...s, transparent: s.state };
    return { state: fs.existsSync(featureFlag(s.game, 'chest')) ? 'on' : 'off', transparent: fs.existsSync(featureFlag(s.game, 'transparent')) ? 'on' : 'off' };
  }

  async function installState(wanted) {
    if (busy) return { state: 'installing' };
    const game = await sys.findGame();
    if (!game) return { state: 'no_game' };
    const tool = await patcherState();
    if (tool !== 'ok') return { state: 'patcher_mismatch', reason: tool };   // 재적용으로는 못 고친다: 앱 재설치(dev는 build.ps1)
    const { dll, flag } = paths(game);
    const r = await patcher('inspect', dll);
    if (r.code === 2) return { state: 'incompatible', reason: r.json.reason };
    if (r.code !== 0) return { state: 'error', reason: r.json.reason };
    if (r.json.state === 'clean') return { state: wanted ? 'needs_reapply' : 'not_installed' };
    if (!samePath(r.json.flag, flag)) return { state: 'needs_reapply', reason: 'flag_path_changed' };   // 게임 경로가 바뀜
    if (r.json.upToDate === false) return { state: 'needs_reapply', reason: 'outdated' };   // 이전 패치 세트(v1: 자동 오픈만) → 재적용으로 v2(D-028)
    return { state: 'installed', game };
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

  // 사전 점검(D-029): worker·게임을 건드리기 전에, 실제 설치와 같은 입력으로 별도 파일에 패치·verify를 해 본다.
  // 통과하지 못하면 여기서 끝낸다(게임 종료·재실행 없음). 쓰는 곳은 데이터 폴더의 preflightOut뿐이다.
  // 이미 패치된 DLL(재적용)은 원본 백업에서 다시 만들므로(patchInstalled의 restore) 백업도 여기서 확인한다.
  async function preflight(game, features) {
    const notify = (p) => notifyRaw({ ...p, features });
    busy = true;
    notify({ phase: 'checking' });
    try {
      const { managed, dll, flag } = paths(game);
      let r = await patcher('inspect', dll);
      if (r.code !== 0) throw new Failure(r.code === 2 ? 'incompatible' : 'preflight_failed');
      let source = dll;
      if (r.json.state === 'patched') {
        if (!backupIntact()) throw new Failure('preflight_failed');
        source = original;
      }
      fs.mkdirSync(path.dirname(preflightOut), { recursive: true });
      fs.rmSync(preflightOut, { force: true });
      r = await patcher('patch', source, preflightOut, flag, managed);
      if (r.code !== 0) throw new Failure(r.code === 2 ? 'incompatible' : 'preflight_failed');   // 참조 해석 실패(스트리핑)도 2
      if ((await patcher('verify', source, preflightOut, flag, managed)).code !== 0) throw new Failure('preflight_failed');
      return { ok: true };
    } catch (e) {
      const reason = e instanceof Failure ? e.message : 'preflight_failed';
      notify({ phase: 'failed', reason, rolledBack: false });
      return { ok: false, reason, rolledBack: false };
    } finally {
      try { fs.rmSync(preflightOut, { force: true }); } catch { /* 다음 점검이 지운다 */ }
      busy = false;
    }
  }

  // features: 설치가 끝나면 켤 기능들. 진행 알림에도 실어 렌더러가 기능 이름으로 문구를 쓴다.
  async function install(game, features) {
    const notify = (p) => notifyRaw({ ...p, features });
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
      for (const f of features) fs.writeFileSync(featureFlag(game, f), '');
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

  async function countdown(features) {
    cancelled = false;
    for (let s = COUNTDOWN_SECONDS; s > 0; s--) {
      notifyRaw({ phase: 'countdown', seconds: s, features });
      await sys.sleep(1000);
      if (cancelled) { notifyRaw({ phase: 'cancelled', features }); return false; }
    }
    return true;
  }

  return {
    status,
    cancel() { cancelled = true; },

    // 켜기(feature = 'chest' | 'transparent'): 설치돼 있으면 그 기능 플래그만(즉시, 재실행 없음). 아니면 사전 점검 → 카운트다운 → 설치.
    // 이전 패치 세트(v1)도 여기서 재적용 대상이라 설치 흐름으로 v2가 된다.
    async enable(feature = 'chest') {
      if (!known(feature)) return { ok: false, reason: 'unknown_feature' };
      if (busy) return { ok: false, reason: 'busy' };
      const current = await installState(false);
      if (['incompatible', 'error', 'no_game', 'patcher_mismatch'].includes(current.state)) return { ok: false, reason: current.state };
      if (current.state === 'installed') { fs.writeFileSync(featureFlag(current.game, feature), ''); return { ok: true }; }
      const game = await sys.findGame();
      const pre = await preflight(game, [feature]);   // 카운트다운 전에: 안 되는 설치로 게임을 끄지 않는다
      if (!pre.ok) return pre;
      if (!(await countdown([feature]))) return { ok: false, reason: 'cancelled' };
      return install(game, [feature]);
    },

    // 끄기: 그 기능 플래그만 삭제(즉시). 패치와 다른 기능은 그대로다.
    async disable(feature = 'chest') {
      if (!known(feature)) return { ok: false, reason: 'unknown_feature' };
      const game = await sys.findGame();
      if (game) fs.rmSync(featureFlag(game, feature), { force: true });
      return { ok: true };
    },

    // 재적용(features = 설정이 켜진 기능들): 업데이트로 패치가 사라졌을 때 토스트의 [재시작]으로만 불린다(버튼이 곧 확인이라 카운트다운 없음).
    // 재적용이 필요한 상태가 아니면(구조가 바뀌어 호환 안 됨·패처 불일치 포함) 아무것도 하지 않는다. 사전 점검을 통과해야 시작한다.
    async reapply(features = ['chest']) {
      if (!Array.isArray(features) || features.length === 0 || !features.every(known)) return { ok: false, reason: 'unknown_feature' };
      if (busy) return { ok: false, reason: 'busy' };
      const current = await status(true);
      if (current.state !== 'needs_reapply') return { ok: false, reason: current.state };
      const game = await sys.findGame();
      const wanted = [...new Set(features)];
      const pre = await preflight(game, wanted);
      if (!pre.ok) return pre;
      return install(game, wanted);
    },
  };
}

module.exports = { createAutoChest, defaultSys, FLAG_NAME, TRANSPARENT_FLAG_NAME, POLL_MS };
