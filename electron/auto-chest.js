// 상자 자동 오픈(D-019)·모든 고양이 투명화(D-028): 패처 호출·게임 종료/재실행·백업/롤백·플래그를 메인 프로세스에서 조율한다.
// 두 기능은 패치 하나를 함께 쓰고 플래그만 따로다. 설치는 한 번(재실행), 이후 켜기/끄기는 플래그만(게임이 0.5초~ 주기로 본다).
// 시스템 조작(sys)과 worker 제어는 주입받아, 실게임 없이 사본으로 흐름을 검증할 수 있다(tools/auto_chest/test-flow.js).
// 설치·재적용은 worker·게임을 건드리기 전에 사전 점검(별도 파일에 패치·verify)을 통과해야 시작한다(D-029).
// 사전 점검은 패치 결과의 Cat Talk 연결 호환성 지문(업스트림 FeatureProbe)이 원본과 같은지도 본다(D-033 3단계 사고 재발 방지).
// 차단 멤버 고양이 숨김(D-033 3단계): 같은 패치(세트 3)가 게임 폴더의 CatTalkHidden.ids를 0.5초마다 읽는다. 이 모듈은 사이드카가 알린
// (앱 차단 ∪ Steam 차단) 목록을 그 파일에 통째로 쓴다(세트 3 설치 상태에서만). 앱을 꺼도 파일은 남는다(결정 B).
// 원본 복원(D-038): 패치는 남았는데 패치를 쓰는 기능이 하나도 없으면(설정·플래그 꺼짐 + 숨김 목록 빔) 렌더러가 토스트로 제안하고,
// [원본 복원]이 백업이 지금 DLL의 원본인지 확인한 뒤 되돌린다(재적용과 대칭: 게임이 켜져 있으면 카운트다운 → 종료 → 복원 → 재실행).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FLAG_NAME = 'CatTalkAutoChest.on';
const TRANSPARENT_FLAG_NAME = 'CatTalkTransparent.on';   // 패처가 FLAG_NAME 옆에 정하는 이름(AutoChestPatcher.cs)
const FEATURE_FLAGS = { chest: FLAG_NAME, transparent: TRANSPARENT_FLAG_NAME };
const HIDDEN_NAME = 'CatTalkHidden.ids';   // 숨김 목록(한 줄에 SteamID64 하나, LF). 패처가 FLAG_NAME 옆으로 정하는 이름(AutoChestPatcher.cs)
const STEAM_ID64 = /^[1-9][0-9]{0,19}$/;   // 사이드카 목록 검증(bongo_chat.profiles와 같은 숫자 규칙). 게임 폴더 파일에 다른 내용이 들어가지 않게
const GAME_EXE = 'BongoCat.exe';
const COUNTDOWN_SECONDS = 5;
const POLL_MS = 500;
const GAME_CLOSE_MS = 20000;     // 일반 종료 요청 후 대기. 넘기면 강제 종료하지 않고 중단한다
const STEAM_RELEASE_MS = 15000;  // Steam이 앱을 '실행 중'에서 풀 때까지(D-019: worker가 살아 있으면 안 풀린다)
const LAUNCH_MS = 60000;
const STABLE_MS = 20000;         // 기동 후 이 시간 살아 있어야 성공
// 앱이 기대하는 패처(AutoChestPatcher.cs의 CliVersion·PatchVersion). 다르거나 패처가 없으면 설치·재적용을 막는다(D-029).
// 세트 3(D-033 3단계, 차단 멤버 고양이 숨김)은 인자 규약을 바꾸지 않아 CLI는 2 그대로다. 세트 2 설치본은 '재적용 필요'(outdated)가 된다.
const PATCHER_CLI = 2;
const PATCH_VERSION = 3;

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

// probeExe·featureContract: Cat Talk(업스트림)의 연결 호환성 지문 도구(FeatureProbe)와 그 계약 파일. 사전 점검이 실행만 한다(수정 없음).
// changed: 원본 복원 제안 판정에 쓰는 숨김 목록이 바뀌었음을 알린다(렌더러가 상태를 다시 묻는다). 없어도 된다.
function createAutoChest({ dataDir, patcherExe, probeExe, featureContract, sys, stopWorker, startWorker, notify: notifyRaw, changed = () => {} }) {
  const home = path.join(dataDir, 'auto_chest');
  const backupDir = path.join(home, 'backup');
  const staging = path.join(home, 'staging', 'Assembly-CSharp.dll');
  const original = path.join(backupDir, 'Assembly-CSharp.dll.orig');
  const preflightOut = path.join(home, 'staging', 'preflight', 'Assembly-CSharp.dll');
  const probeHome = path.join(home, 'staging', 'probe');
  let busy = false, cancelled = false;
  let busyKind = 'install';   // 진행 중인 일: 'install'(사전 점검·설치·재적용) | 'restore'(원본 복원). 판정이 상태 이름을 고른다
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

  // 패치를 쓰는 기능이 하나도 없음(D-038): 기능 플래그가 없고, 게임 고양이 숨김 목록(사이드카가 알린 앱 차단 ∪ 이번 실행에서 만난
  // Steam 차단)이 비었다. 목록을 아직 모르면(이번 실행에서 알림 전, null) 판정하지 않는다(false).
  const unneeded = (game) => hidden !== null && hidden.length === 0
    && !Object.keys(FEATURE_FLAGS).some((f) => fs.existsSync(featureFlag(game, f)));

  // 판정만 한다(쓰기 없음). wanted = 어느 기능이든 설정 ON 여부: 켜 뒀는데 clean이면 업데이트로 패치가 사라진 것.
  // state = 설치 상태(설치돼 있으면 상자 자동 오픈 플래그로 on/off), transparent = 같은 판정에서 투명화 플래그로 on/off.
  // restorable = 원본 복원 제안 대상(패치는 됐는데 설정 OFF + unneeded). 이전 세트·경로가 바뀐 패치본도 포함한다(복원 때 버전 확인).
  async function status(wanted) {
    const s = await installState(wanted);
    const restorable = !wanted && s.patched === true && unneeded(s.game);
    if (s.state !== 'installed') return { state: s.state, reason: s.reason, transparent: s.state, restorable };
    return { state: fs.existsSync(featureFlag(s.game, 'chest')) ? 'on' : 'off', transparent: fs.existsSync(featureFlag(s.game, 'transparent')) ? 'on' : 'off', restorable };
  }

  // patched·game은 패치본일 때만 싣는다(원본 복원 판정용). 렌더러로는 status가 고른 값만 나간다.
  async function installState(wanted) {
    if (busy) return { state: busyKind === 'restore' ? 'restoring' : 'installing' };
    const game = await sys.findGame();
    if (!game) return { state: 'no_game' };
    const tool = await patcherState();
    if (tool !== 'ok') return { state: 'patcher_mismatch', reason: tool };   // 재적용으로는 못 고친다: 앱 재설치(dev는 build.ps1)
    const { dll, flag } = paths(game);
    const r = await patcher('inspect', dll);
    if (r.code === 2) return { state: 'incompatible', reason: r.json.reason };
    if (r.code !== 0) return { state: 'error', reason: r.json.reason };
    if (r.json.state === 'clean') return { state: wanted ? 'needs_reapply' : 'not_installed' };
    if (!samePath(r.json.flag, flag)) return { state: 'needs_reapply', reason: 'flag_path_changed', game, patched: true };   // 게임 경로가 바뀜
    if (r.json.upToDate === false) return { state: 'needs_reapply', reason: 'outdated', game, patched: true };   // 이전 패치 세트(v1·v2) → 재적용으로 v3(D-028, D-033)
    return { state: 'installed', game, patched: true };
  }

  // ── 차단 멤버 고양이 숨김 목록(D-033 3단계) ──
  // hidden: 사이드카가 마지막으로 알린 목록(이번 실행에서 아직 없으면 null). 사이드카는 판정이 끝난 뒤 처음 한 번과 바뀔 때마다 알린다.
  let hidden = null, hiddenRun = null, hiddenAgain = false, hiddenRetry = null;
  const hiddenText = (ids) => ids.map((id) => `${id}\n`).join('');

  // 임시 파일에 쓰고 바꿔 끼운다(게임이 반쯤 쓴 파일을 읽지 않게). 게임이 마침 읽는 중이면 교체가 실패할 수 있다(그때는 재시도).
  function writeHiddenFile(game, text) {
    const file = path.join(game.root, HIDDEN_NAME);
    const tmp = `${file}.cattalk-new`;
    try {
      fs.writeFileSync(tmp, text, 'ascii');
      fs.renameSync(tmp, file);
      return true;
    } catch {
      try { fs.rmSync(tmp, { force: true }); } catch { /* 다음 쓰기가 덮는다 */ }
      return false;
    }
  }

  // 쓰기 실패는 같은 목록으로 POLL_MS 뒤 다시 쓴다(설치 판정은 다시 하지 않는다). 새 목록이 오거나 설치 중이면 그쪽이 맡는다.
  function retryHidden(game, ids) {
    clearTimeout(hiddenRetry);
    hiddenRetry = setTimeout(() => {
      hiddenRetry = null;
      if (hidden !== ids || busy) return;
      if (!writeHiddenFile(game, hiddenText(ids))) retryHidden(game, ids);
    }, POLL_MS);
    hiddenRetry.unref?.();
  }

  // 현재 목록을 파일에 쓴다. 세트 3 설치 상태가 아니면(미설치·이전 세트·호환 안 됨·패처 불일치·설치 중) 쓰지 않는다.
  // 겹쳐 불리면 진행 중인 것이 끝난 뒤 최신 목록으로 한 번 더 쓴다.
  async function syncHidden() {
    if (hidden === null) return { ok: false, reason: 'not_ready' };
    if (hiddenRun) { hiddenAgain = true; return hiddenRun; }
    hiddenRun = (async () => {
      let result;
      do {
        hiddenAgain = false;
        const ids = hidden;
        const s = await installState(false);
        if (s.state !== 'installed') { result = { ok: false, reason: s.state }; continue; }
        clearTimeout(hiddenRetry); hiddenRetry = null;
        if (writeHiddenFile(s.game, hiddenText(ids))) result = { ok: true, count: ids.length };
        else { retryHidden(s.game, ids); result = { ok: false, reason: 'write_failed' }; }
      } while (hiddenAgain);
      return result;
    })();
    try { return await hiddenRun; } finally { hiddenRun = null; }
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

  // Cat Talk 연결 호환성 지문(D-033 3단계 사고 재발 방지). Cat Talk(업스트림)는 연결 전에 FeatureProbe로 게임 코드 지문을 계산해
  // 지원 목록과 비교하고, 다르면 '지원하지 않는 게임 빌드'로 연결을 멈춘다(2026-11-10: 숨김 setter 훅이 privacy 지문을 바꿔 실제로 멈췄다).
  // 계약의 어셈블리(Assembly-CSharp·Heathen.Steamworks)를 데이터 폴더에 모아 지문을 낸다. 읽지 못하면 null.
  async function connectionFeatures(dll, managed, name) {
    let assemblies;
    try { assemblies = JSON.parse(fs.readFileSync(featureContract, 'utf-8')).assemblies; } catch { return null; }
    if (!Array.isArray(assemblies) || !assemblies.includes('Assembly-CSharp.dll')
      || !assemblies.every((a) => typeof a === 'string' && /^[A-Za-z0-9._-]+\.dll$/.test(a))) return null;
    const dir = path.join(probeHome, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const a of assemblies) fs.copyFileSync(a === 'Assembly-CSharp.dll' ? dll : path.join(managed, a), path.join(dir, a));
    const r = await run(probeExe, [dir, featureContract]);
    if (r.code !== 0) return null;
    try {
      const features = JSON.parse(r.stdout);
      const keys = Object.keys(features).sort();
      if (keys.length === 0 || !keys.every((k) => typeof features[k] === 'string' && /^[0-9a-f]{64}$/.test(features[k]))) return null;
      return JSON.stringify(keys.map((k) => [k, features[k]]));
    } catch { return null; }
  }

  // 사전 점검(D-029): worker·게임을 건드리기 전에, 실제 설치와 같은 입력으로 별도 파일에 패치·verify를 해 본다.
  // 통과하지 못하면 여기서 끝낸다(게임 종료·재실행 없음). 쓰는 곳은 데이터 폴더의 preflightOut·probeHome뿐이다.
  // 이미 패치된 DLL(재적용)은 원본 백업에서 다시 만들므로(patchInstalled의 restore) 백업도 여기서 확인한다.
  // 패치 결과의 Cat Talk 연결 호환성 지문이 원본과 다르면 'incompatible', 지문을 내지 못하면 'preflight_failed'(D-033 3단계).
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
      const before = await connectionFeatures(source, managed, 'original');
      const after = await connectionFeatures(preflightOut, managed, 'patched');
      if (before === null || after === null) throw new Failure('preflight_failed');
      if (before !== after) throw new Failure('incompatible');   // 설치하면 Cat Talk가 이 게임에 연결하지 못한다
      return { ok: true };
    } catch (e) {
      const reason = e instanceof Failure ? e.message : 'preflight_failed';
      notify({ phase: 'failed', reason, rolledBack: false });
      return { ok: false, reason, rolledBack: false };
    } finally {
      try { fs.rmSync(preflightOut, { force: true }); } catch { /* 다음 점검이 지운다 */ }
      try { fs.rmSync(probeHome, { recursive: true, force: true }); } catch { /* 다음 점검이 지운다 */ }
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

  // action: 진행 알림의 일 종류('install' | 'restore'). 렌더러가 문구를 고른다.
  async function countdown(features, action = 'install') {
    cancelled = false;
    for (let s = COUNTDOWN_SECONDS; s > 0; s--) {
      notifyRaw({ phase: 'countdown', seconds: s, features, action });
      await sys.sleep(1000);
      if (cancelled) { notifyRaw({ phase: 'cancelled', features, action }); return false; }
    }
    return true;
  }

  // 원본 복원 실행(D-038). restore()가 버전 확인·카운트다운을 마친 뒤 부른다.
  // 게임이 켜져 있었으면 worker → 게임 종료(강제 아님) → Steam 해제 대기 → 복원 → 재실행(설치와 같은 순서·이유, D-019).
  // 꺼져 있었으면 복원만 한다(재실행·worker 조작 없음). 성공하면 기능 플래그와 숨김 목록 파일을 지운다(배포 체크리스트 '패치를 되돌릴 때').
  async function restoreNow(game, wasRunning) {
    const notify = (p) => notifyRaw({ ...p, action: 'restore' });
    let restored = false, restarted = false;
    busy = true; busyKind = 'restore';
    try {
      if (!unneeded(game)) throw new Failure('still_needed');   // 카운트다운 사이 기능을 켰거나 숨길 사람이 생김
      if (wasRunning) {
        notify({ phase: 'stopping_worker' });
        await stopWorker();
        notify({ phase: 'closing_game' });
        await sys.closeGame();
        if (!(await waitFor(async () => !(await sys.gameRunning()), GAME_CLOSE_MS))) throw new Failure('game_close_failed');
        if (!(await waitFor(async () => !(await sys.steamRunning(game.appId)), STEAM_RELEASE_MS))) throw new Failure('steam_still_running');
      }
      if (await sys.gameRunning()) throw new Failure('game_running');   // 켜진 게임의 DLL은 건드리지 않는다
      notify({ phase: 'restoring' });
      if ((await patcher('restore', backupDir, paths(game).dll)).code !== 0) throw new Failure('restore_failed');
      restored = true;
      for (const name of [...Object.values(FEATURE_FLAGS), HIDDEN_NAME]) {
        try { fs.rmSync(path.join(game.root, name), { force: true }); } catch { /* 패치가 없으면 게임이 읽지 않는다 */ }
      }
      if (wasRunning) {
        notify({ phase: 'launching' });
        await sys.launch(game.appId);
        restarted = true;
        if (!(await waitFor(() => sys.gameRunning(), LAUNCH_MS))) throw new Failure('game_start_failed');
      }
      notify({ phase: 'done' });
      return { ok: true };
    } catch (e) {
      const reason = e instanceof Failure ? e.message : 'unexpected';
      // 켜져 있던 게임은 되살린다(재실행까지 갔거나 아직 켜져 있으면 그대로 둔다)
      if (wasRunning && !restarted && !(await sys.gameRunning())) await sys.launch(game.appId);
      notify({ phase: 'failed', reason, restored });
      return { ok: false, reason, restored };
    } finally {
      busy = false; busyKind = 'install';
      if (wasRunning) await startWorker();
    }
  }

  // 설치·재적용이 끝나면(성공이면 이제 세트 3) 마지막 목록을 쓴다. 설치 중(busy)에 온 목록은 판정에서 건너뛰었으므로 여기서 맡는다.
  // 실패(복원됨)면 판정이 설치 상태가 아니라 쓰지 않는다. 쓰기 결과는 설치 결과에 섞지 않는다.
  async function installThenSync(game, features) {
    const result = await install(game, features);
    await syncHidden().catch(() => {});
    return result;
  }

  return {
    status,
    cancel() { cancelled = true; },

    // 사이드카가 알린 (앱 차단 ∪ Steam 차단) SteamID64 목록(D-033 3단계). 형식이 틀린 항목은 빼고, 세트 3 설치 상태면 파일에 쓴다.
    setHidden(ids) {
      if (!Array.isArray(ids)) return Promise.resolve({ ok: false, reason: 'invalid' });
      hidden = [...new Set(ids.filter((id) => typeof id === 'string' && STEAM_ID64.test(id)))].sort();
      changed();   // 원본 복원 제안 판정이 바뀔 수 있다(첫 확인·마지막 차단 해제, D-038)
      return syncHidden();
    },

    // 원본 복원(D-038): 토스트 [원본 복원]. 패치본이고 패치를 쓰는 기능이 없을 때만 한다.
    // 백업이 지금 DLL의 원본인지 먼저 본다(백업 SHA + verify: 현재 DLL = 백업 + 우리 훅). 아니면(게임 업데이트·이전 세트·경로 변경 등)
    // 덮어쓰지 않고 'version_mismatch'로 끝낸다(렌더러가 Steam 무결성 확인을 안내). 게임이 켜져 있으면 카운트다운(취소 가능) 뒤 진행한다.
    async restore() {
      if (busy) return { ok: false, reason: 'busy' };
      const s = await installState(false);
      if (!s.patched) return { ok: false, reason: s.state };
      if (!unneeded(s.game)) return { ok: false, reason: 'still_needed' };
      const { managed, dll, flag } = paths(s.game);
      let matches = false;
      busy = true; busyKind = 'restore';
      try { matches = backupIntact() && (await patcher('verify', original, dll, flag, managed)).code === 0; }
      finally { busy = false; busyKind = 'install'; }
      if (!matches) {
        notifyRaw({ phase: 'failed', reason: 'version_mismatch', restored: false, action: 'restore' });
        return { ok: false, reason: 'version_mismatch', restored: false };
      }
      const wasRunning = await sys.gameRunning();
      if (wasRunning && !(await countdown([], 'restore'))) return { ok: false, reason: 'cancelled' };
      return restoreNow(s.game, wasRunning);
    },

    // 켜기(feature = 'chest' | 'transparent'): 설치돼 있으면 그 기능 플래그만(즉시, 재실행 없음). 아니면 사전 점검 → 카운트다운 → 설치.
    // 이전 패치 세트(v1·v2)도 여기서 재적용 대상이라 설치 흐름으로 v3가 된다.
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
      return installThenSync(game, [feature]);
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
      return installThenSync(game, wanted);
    },
  };
}

module.exports = { createAutoChest, defaultSys, FLAG_NAME, TRANSPARENT_FLAG_NAME, HIDDEN_NAME, POLL_MS };
