// 상자 자동 오픈·투명화 흐름 검증(D-019·D-028): 실게임 없이 가짜 게임 폴더 + DLL 사본 + 실제 패처로 돌린다.
// 게임 실행·종료·Steam 상태는 가짜 함수다. 실게임 폴더·프로세스·Steam을 건드리지 않는다.
// 사용: node tools/auto_chest/test-flow.js <Assembly-CSharp.dll 사본> <게임 Managed 폴더 사본> <빈 작업 폴더> [이전 패처 커밋]
// Managed 사본은 패처의 참조 해석 검증용으로 가짜 게임 폴더의 Managed에 함께 넣는다.
// 패치 세트 v1(자동 오픈만)은 이전 패처 커밋(기본 3b89d14)을 작업 폴더에 빌드해 만든다(test-copy.ps1과 같은 방식).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { createAutoChest, FLAG_NAME, TRANSPARENT_FLAG_NAME } = require('../../electron/auto-chest');

const [copy, managedRefs, work, legacyCommit = '3b89d14'] = process.argv.slice(2);
if (!copy || !managedRefs || !work) { console.error('usage: test-flow.js <copy> <managed copy> <work>'); process.exit(2); }
if (/\\BongoCat_Data\\Managed(\\|$)/i.test(path.resolve(copy)) || /\\BongoCat_Data\\Managed(\\|$)/i.test(path.resolve(managedRefs))) { console.error('use copies outside the game folder'); process.exit(2); }
const refs = fs.readdirSync(managedRefs).filter((n) => /\.dll$/i.test(n) && n !== 'Assembly-CSharp.dll');
const patcherExe = path.join(__dirname, '..', '..', 'artifacts', 'auto_chest', 'AutoChestPatcher.exe');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const origSha = sha(copy);
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };

function world(name, opts = {}) {
  const base = path.join(work, name);
  fs.rmSync(base, { recursive: true, force: true });
  const root = path.join(base, 'game');
  const managed = path.join(root, 'BongoCat_Data', 'Managed');
  fs.mkdirSync(managed, { recursive: true });
  for (const n of refs) fs.copyFileSync(path.join(managedRefs, n), path.join(managed, n));
  const dll = path.join(managed, 'Assembly-CSharp.dll');
  fs.copyFileSync(copy, dll);
  const w = { root, dll, flag: path.join(root, FLAG_NAME), tflag: path.join(root, TRANSPARENT_FLAG_NAME), log: [], notes: [], running: !!opts.running, steam: !!opts.running, data: path.join(base, 'data') };
  const sys = {
    findGame: async () => (opts.noGame ? null : { root: w.lowerRoot ? root.toLowerCase() : root, appId: '1' }),
    gameRunning: async () => w.running,
    closeGame: async () => { w.log.push('closeGame'); if (!opts.closeHangs) { w.running = false; if (!opts.steamStuck) w.steam = false; } },
    steamRunning: async () => w.steam && !w.workerStopped ? true : w.steamHeld(),
    launch: async () => {
      w.log.push('launch');
      if (opts.launchFails) return;
      w.running = true;
      w.crash = !!opts.crashes;   // 기동은 되지만 다음 대기 중에 죽는다
    },
    sleep: async () => { await new Promise((r) => setImmediate(r)); if (w.crash) w.running = false; if (w.onSleep) w.onSleep(); },
  };
  w.steamHeld = () => !!opts.steamStuck;
  w.chest = createAutoChest({
    dataDir: w.data, patcherExe, sys,
    stopWorker: async () => { w.log.push('stopWorker'); w.workerStopped = true; },
    startWorker: async () => { w.log.push('startWorker'); w.workerStopped = false; },
    notify: (p) => w.notes.push(p),
  });
  return w;
}
const before = (log, a, b) => log.includes(a) && log.includes(b) && log.indexOf(a) < log.indexOf(b);

// 이전 패처(v1: 3인자 CLI, 자동 오픈만)를 빌드해 그 세계의 플래그 리터럴로 v1을 만든다
function buildLegacy() {
  const dir = path.join(work, 'legacy');
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'AutoChestPatcher.cs');
  fs.writeFileSync(src, execFileSync('git', ['-C', path.join(__dirname, '..', '..'), 'show', `${legacyCommit}:tools/auto_chest/AutoChestPatcher.cs`]));
  const cecil = path.join(path.dirname(patcherExe), 'Mono.Cecil.dll');
  fs.copyFileSync(cecil, path.join(dir, 'Mono.Cecil.dll'));
  const exe = path.join(dir, 'Legacy.exe');
  execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    ['/nologo', '/optimize+', '/target:exe', `/out:${exe}`, `/reference:${cecil}`, '/reference:System.Web.Extensions.dll', src]);
  return exe;
}
function makeV1(legacy, w) {
  const out = path.join(path.dirname(w.data), 'v1.dll');
  execFileSync(legacy, ['patch', w.dll, out, w.flag]);
  fs.copyFileSync(out, w.dll);
}

(async () => {
  let w, r;

  w = world('status');
  check('1 clean + 설정 OFF -> 미설치', (await w.chest.status(false)).state === 'not_installed');
  check('1b clean + 설정 ON -> 재적용 필요', (await w.chest.status(true)).state === 'needs_reapply');
  check('1c 판정은 DLL을 바꾸지 않음', sha(w.dll) === origSha);

  w = world('install', { running: true });
  r = await w.chest.enable();
  check('2 미설치 켜기 -> 설치 성공', r.ok === true, JSON.stringify(r));
  check('2b 카운트다운 5회', w.notes.filter((n) => n.phase === 'countdown').length === 5);
  check('2c worker 종료 -> 게임 종료 -> 재실행 순서', before(w.log, 'stopWorker', 'closeGame') && before(w.log, 'closeGame', 'launch'), w.log.join(','));
  check('2d worker 재시작은 재실행 뒤', before(w.log, 'launch', 'startWorker'));
  check('2e 플래그 생성', fs.existsSync(w.flag));
  check('2f 상태 = 켜짐', (await w.chest.status(true)).state === 'on');
  check('2g 백업이 원본과 같음', sha(path.join(w.data, 'auto_chest', 'backup', 'Assembly-CSharp.dll.orig')) === origSha);
  r = await w.chest.disable();
  check('3 끄기 -> 플래그 삭제, 상태 꺼짐', !fs.existsSync(w.flag) && (await w.chest.status(false)).state === 'off');
  const patchedSha = sha(w.dll);
  w.log.length = 0;
  r = await w.chest.enable();
  check('4 설치됨 켜기 -> 플래그만(재실행 없음)', r.ok && fs.existsSync(w.flag) && w.log.length === 0, w.log.join(','));
  check('4b DLL 그대로', sha(w.dll) === patchedSha);

  w = world('cancel', { running: true });
  w.onSleep = () => { if (w.notes.some((n) => n.phase === 'countdown' && n.seconds === 3)) w.chest.cancel(); };
  r = await w.chest.enable();
  check('5 카운트다운 취소 -> 아무것도 안 함', r.reason === 'cancelled' && w.log.length === 0 && sha(w.dll) === origSha && !fs.existsSync(w.flag), JSON.stringify(r));

  w = world('update');
  await w.chest.enable();
  r = await w.chest.reapply();
  check('6 패치돼 있으면 재적용 안 함', r.ok === false && r.reason === 'on', JSON.stringify(r));
  w.running = false; w.log.length = 0;
  fs.copyFileSync(copy, w.dll);   // Steam 업데이트로 패치 소실
  check('6a 설정 ON + clean -> 재적용 필요', (await w.chest.status(true)).state === 'needs_reapply');
  // 토스트 [X]: 플래그 삭제, 설정 끄기 -> 판정이 미설치가 되어 토스트가 다시 뜨지 않는다. 게임·worker·DLL은 그대로
  await w.chest.disable();
  check('6b [X] -> 플래그 없음, 설정 OFF면 미설치, 게임·worker·DLL 그대로', !fs.existsSync(w.flag) && (await w.chest.status(false)).state === 'not_installed' && w.log.length === 0 && sha(w.dll) === origSha);
  // [재시작](게임 꺼짐): 카운트다운 없이 바로 패치 -> 재실행 -> 플래그
  w.notes.length = 0;
  r = await w.chest.reapply();
  check('6c [재시작] 게임 꺼짐: 카운트다운 없음, 패치 -> 재실행 -> 플래그', r.ok && !w.notes.some((n) => n.phase === 'countdown') && !w.log.includes('closeGame') && before(w.log, 'stopWorker', 'launch') && before(w.log, 'launch', 'startWorker'), JSON.stringify(r) + ' ' + w.log.join(','));
  check('6d 재적용 후 상태 = 켜짐', fs.existsSync(w.flag) && (await w.chest.status(true)).state === 'on');
  w.log.length = 0; w.notes.length = 0;
  fs.copyFileSync(copy, w.dll);   // 게임이 켜진 채로 패치 소실
  w.steam = true;
  r = await w.chest.reapply();
  check('6e [재시작] 게임 켜짐: 카운트다운 없음, worker -> 게임 종료 -> 재실행', r.ok && !w.notes.some((n) => n.phase === 'countdown') && before(w.log, 'stopWorker', 'closeGame') && before(w.log, 'closeGame', 'launch'), JSON.stringify(r) + ' ' + w.log.join(','));
  w.log.length = 0; w.notes.length = 0;
  fs.copyFileSync(path.join(path.dirname(patcherExe), 'Mono.Cecil.dll'), w.dll);   // 구조가 바뀐 업데이트
  r = await w.chest.reapply();
  check('6f 구조 바뀜 -> 호환 안 됨, 카운트다운·게임 조작 없음', r.reason === 'incompatible' && w.notes.length === 0 && w.log.length === 0, JSON.stringify(r));

  w = world('incompatible', { running: true });
  fs.copyFileSync(path.join(path.dirname(patcherExe), 'Mono.Cecil.dll'), w.dll);
  const other = sha(w.dll);
  check('7 구조 다른 DLL -> 호환 안 됨', (await w.chest.status(false)).state === 'incompatible');
  r = await w.chest.enable();
  check('7b 켜기 거부, 게임·worker·DLL 그대로', r.reason === 'incompatible' && w.log.length === 0 && w.running && sha(w.dll) === other, JSON.stringify(r));

  w = world('startfail', { running: true, launchFails: true });
  r = await w.chest.enable();
  check('8 게임 기동 실패 -> 자동 복원', !r.ok && r.reason === 'game_start_failed' && r.rolledBack && sha(w.dll) === origSha && !fs.existsSync(w.flag), JSON.stringify(r));
  check('8b worker 재시작', w.log[w.log.length - 1] === 'startWorker', w.log.join(','));

  w = world('crash', { running: true, crashes: true });
  r = await w.chest.enable();
  check('9 기동 직후 크래시 -> 자동 복원', !r.ok && r.reason === 'game_crashed' && r.rolledBack && sha(w.dll) === origSha && !fs.existsSync(w.flag), JSON.stringify(r));

  w = world('closehang', { running: true, closeHangs: true });
  r = await w.chest.enable();
  check('10 게임이 안 꺼짐 -> 중단, DLL 그대로, worker 재시작', !r.ok && r.reason === 'game_close_failed' && sha(w.dll) === origSha && w.log.includes('startWorker') && !w.log.includes('launch'), JSON.stringify(r) + ' ' + w.log.join(','));

  w = world('steamstuck', { running: true, steamStuck: true });
  r = await w.chest.enable();
  check('11 Steam이 안 풀림 -> 중단, 게임 되살림', !r.ok && r.reason === 'steam_still_running' && sha(w.dll) === origSha && w.log.includes('launch'), JSON.stringify(r) + ' ' + w.log.join(','));

  w = world('moved');
  await w.chest.enable();
  const moved = path.join(path.dirname(w.root), 'game2');
  fs.renameSync(w.root, moved);
  w.root = moved; w.dll = path.join(moved, 'BongoCat_Data', 'Managed', 'Assembly-CSharp.dll');
  // findGame은 world의 root를 잡고 있으므로 새 세계에서 패치본을 다른 리터럴로 재현한다
  const w2 = world('moved2');
  fs.mkdirSync(path.join(w2.data, 'auto_chest'), { recursive: true });
  fs.cpSync(path.join(w.data, 'auto_chest', 'backup'), path.join(w2.data, 'auto_chest', 'backup'), { recursive: true });
  fs.copyFileSync(w.dll, w2.dll);
  check('12 다른 경로로 패치된 DLL -> 재적용 필요', (await w2.chest.status(true)).state === 'needs_reapply');
  r = await w2.chest.reapply();
  check('12b 재적용이 새 경로 리터럴로 고침', r.ok && (await w2.chest.status(true)).state === 'on', JSON.stringify(r));

  w = world('case');
  await w.chest.enable();
  await w.chest.disable();
  w.lowerRoot = true;   // 레지스트리 SteamPath처럼 소문자로 찾아진 경로(실측)
  check('14 경로 대소문자만 다르면 재적용 아님(꺼짐)', (await w.chest.status(false)).state === 'off');
  r = await w.chest.enable();
  check('14b 켜기 -> 플래그만, 설치 흐름 안 탐', r.ok && fs.existsSync(w.flag) && w.log.filter((x) => x === 'launch').length === 1 && !w.notes.slice(-1)[0].phase.startsWith('count'), JSON.stringify(r));

  w = world('nogame', { noGame: true });
  check('13 게임 없음', (await w.chest.status(false)).state === 'no_game');
  r = await w.chest.enable();
  check('13b 켜기 거부', r.reason === 'no_game');

  // ---- 모든 고양이 투명화(D-028): 같은 패치, 기능별 플래그 ----
  w = world('tp', { running: true });
  r = await w.chest.enable('transparent');
  check('15 미설치 투명화 켜기 -> 같은 설치 흐름', r.ok === true && before(w.log, 'stopWorker', 'closeGame') && before(w.log, 'closeGame', 'launch'), JSON.stringify(r) + ' ' + w.log.join(','));
  check('15b 진행 알림에 기능 = 투명화', w.notes.length > 0 && w.notes.every((n) => JSON.stringify(n.features) === '["transparent"]'));
  check('15c 투명화 플래그만 생성(자동 오픈은 그대로 꺼짐)', fs.existsSync(w.tflag) && !fs.existsSync(w.flag));
  let st = await w.chest.status(true);
  check('15d 상태: 자동 오픈 꺼짐, 투명화 켜짐', st.state === 'off' && st.transparent === 'on', JSON.stringify(st));
  w.log.length = 0;
  r = await w.chest.enable('chest');
  check('15e 설치됨 자동 오픈 켜기 -> 플래그만(재실행 없음)', r.ok && fs.existsSync(w.flag) && w.log.length === 0, w.log.join(','));
  r = await w.chest.disable('transparent');
  st = await w.chest.status(true);
  check('15f 투명화 끄기 -> 투명화 플래그만 삭제', r.ok && !fs.existsSync(w.tflag) && fs.existsSync(w.flag) && st.state === 'on' && st.transparent === 'off', JSON.stringify(st));
  r = await w.chest.enable('transparent');
  check('15g 투명화 다시 켜기 -> 플래그만(재실행 없음)', r.ok && fs.existsSync(w.tflag) && w.log.length === 0, w.log.join(','));
  check('15h 알 수 없는 기능 거부', (await w.chest.enable('other')).reason === 'unknown_feature' && (await w.chest.disable('other')).reason === 'unknown_feature'
    && (await w.chest.reapply(['other'])).reason === 'unknown_feature' && (await w.chest.reapply([])).reason === 'unknown_feature');

  w = world('tpc', { running: true });
  w.onSleep = () => { if (w.notes.some((n) => n.phase === 'countdown' && n.seconds === 3)) w.chest.cancel(); };
  r = await w.chest.enable('transparent');
  check('15i 투명화 카운트다운 취소 -> 아무것도 안 함', r.reason === 'cancelled' && w.log.length === 0 && sha(w.dll) === origSha && !fs.existsSync(w.tflag), JSON.stringify(r));

  // 패치 소실 후 재적용: 켜진 기능 플래그만 다시 쓴다
  w = world('tpu');
  await w.chest.enable('transparent');
  fs.copyFileSync(copy, w.dll);
  check('16 투명화 설정 ON + clean -> 재적용 필요', (await w.chest.status(true)).transparent === 'needs_reapply');
  fs.rmSync(w.tflag, { force: true });
  w.notes.length = 0;
  r = await w.chest.reapply(['transparent']);
  check('16b 재적용(투명화) -> 투명화 플래그만', r.ok && fs.existsSync(w.tflag) && !fs.existsSync(w.flag) && w.notes.every((n) => JSON.stringify(n.features) === '["transparent"]'), JSON.stringify(r));
  fs.copyFileSync(copy, w.dll);
  fs.rmSync(w.tflag, { force: true });
  r = await w.chest.reapply(['chest', 'transparent']);
  st = await w.chest.status(true);
  check('16c 재적용(둘 다) -> 두 플래그', r.ok && st.state === 'on' && st.transparent === 'on', JSON.stringify(st));

  // 이전 패치 세트(v1, 자동 오픈만) → v2
  const legacy = buildLegacy();
  w = world('v1t', { running: true });
  execFileSync(patcherExe, ['backup', w.dll, path.join(w.data, 'auto_chest', 'backup')]);   // v1 설치 때 만들어진 원본 백업
  makeV1(legacy, w);
  fs.writeFileSync(w.flag, '');
  check('17 v1 + 설정 ON -> 재적용 필요(outdated)', (await w.chest.status(true)).state === 'needs_reapply');
  r = await w.chest.enable('transparent');
  st = await w.chest.status(true);
  check('17b v1에서 투명화 켜기 -> 설치 흐름으로 v2, 투명화 켜짐, 자동 오픈 플래그 유지', r.ok && w.log.includes('launch') && st.state === 'on' && st.transparent === 'on', JSON.stringify(r) + ' ' + JSON.stringify(st));
  check('17c 백업은 원본(v1 아님)', sha(path.join(w.data, 'auto_chest', 'backup', 'Assembly-CSharp.dll.orig')) === origSha);

  w = world('v1r');
  await w.chest.enable();   // 직접 설치한 v2 바이트를 기준으로 삼는다(백업도 여기서 생긴다)
  const v2sha = sha(w.dll);
  fs.copyFileSync(copy, w.dll);
  makeV1(legacy, w);
  w.log.length = 0;
  r = await w.chest.reapply(['chest']);
  check('17d v1 + 자동 오픈만 켜짐 -> 토스트 재적용으로 v2(직접 설치와 같은 바이트), 투명화 플래그 없음',
    r.ok && sha(w.dll) === v2sha && fs.existsSync(w.flag) && !fs.existsSync(w.tflag), JSON.stringify(r));

  console.log(failed ? `FAILED: ${failed}` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
