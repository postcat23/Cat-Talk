// 상자 자동 오픈·투명화·차단 멤버 고양이 숨김 흐름 검증(D-019·D-028·D-033 3단계): 실게임 없이 가짜 게임 폴더 + DLL 사본 + 실제 패처로 돌린다.
// 게임 실행·종료·Steam 상태는 가짜 함수다. 실게임 폴더·프로세스·Steam을 건드리지 않는다.
// 사용: node tools/auto_chest/test-flow.js <Assembly-CSharp.dll 사본> <게임 Managed 폴더 사본> <빈 작업 폴더> [v1 패처 커밋] [v2 패처 커밋]
// Managed 사본은 패처의 참조 해석 검증용으로 가짜 게임 폴더의 Managed에 함께 넣는다.
// 이전 패치 세트는 그 시점 패처를 작업 폴더에 빌드해 만든다(test-copy.ps1과 같은 방식): v1(자동 오픈만) 3b89d14, v2(+ 투명화) 73f8de5.
// 사전 점검의 연결 호환성 지문은 실제 업스트림 FeatureProbe·계약으로 본다(선행: tools/prepare-compatibility.ps1).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { createAutoChest, FLAG_NAME, TRANSPARENT_FLAG_NAME, HIDDEN_NAME } = require('../../electron/auto-chest');

const [copy, managedRefs, work, legacyCommit = '3b89d14', v2Commit = '73f8de5'] = process.argv.slice(2);
if (!copy || !managedRefs || !work) { console.error('usage: test-flow.js <copy> <managed copy> <work>'); process.exit(2); }
if (/\\BongoCat_Data\\Managed(\\|$)/i.test(path.resolve(copy)) || /\\BongoCat_Data\\Managed(\\|$)/i.test(path.resolve(managedRefs))) { console.error('use copies outside the game folder'); process.exit(2); }
const refs = fs.readdirSync(managedRefs).filter((n) => /\.dll$/i.test(n) && n !== 'Assembly-CSharp.dll');
const patcherExe = path.join(__dirname, '..', '..', 'artifacts', 'auto_chest', 'AutoChestPatcher.exe');
// 사전 점검의 Cat Talk 연결 호환성 지문(D-033 3단계): 실제 업스트림 도구·계약을 쓴다(tools/prepare-compatibility.ps1이 만든다)
const probeExe = path.join(__dirname, '..', '..', 'artifacts', 'compatibility', 'FeatureProbe.exe');
const featureContract = path.join(__dirname, '..', '..', 'src', 'bongo_chat', 'feature-contract.json');
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
  const w = { root, dll, flag: path.join(root, FLAG_NAME), tflag: path.join(root, TRANSPARENT_FLAG_NAME), hidden: path.join(root, HIDDEN_NAME), managed,
    log: [], notes: [], changes: 0, running: !!opts.running, steam: !!opts.running, data: path.join(base, 'data') };
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
    dataDir: w.data, patcherExe: opts.patcherExe ?? patcherExe, probeExe: opts.probeExe ?? probeExe, featureContract: opts.featureContract ?? featureContract, sys,
    stopWorker: async () => { w.log.push('stopWorker'); w.workerStopped = true; },
    startWorker: async () => { w.log.push('startWorker'); w.workerStopped = false; },
    notify: (p) => w.notes.push(p),
    changed: () => { w.changes++; },
  });
  return w;
}

// '다른 빌드의 원본'(원본 복원 버전 확인 시험, D-038): 사용자 문자열 힙(#US)에서 영문 4자 이상 문자열 하나의 첫 글자 대소문자만 바꾼다.
// 길이·구조가 같아 패처가 clean으로 읽지만, verify는 ldstr 값을 비교하므로(Op) '현재 DLL = 이 백업 + 훅'이 아니게 된다.
function otherBuild(buf) {
  const b = Buffer.from(buf);
  const pe = b.readUInt32LE(0x3c), opt = pe + 24, sections = opt + b.readUInt16LE(pe + 20);
  const dirs = opt + (b.readUInt16LE(opt) === 0x20b ? 112 : 96);
  const off = (rva) => {
    for (let s = 0; s < b.readUInt16LE(pe + 6); s++) {
      const h = sections + s * 40, va = b.readUInt32LE(h + 12), size = Math.max(b.readUInt32LE(h + 8), b.readUInt32LE(h + 16));
      if (rva >= va && rva < va + size) return rva - va + b.readUInt32LE(h + 20);
    }
    throw new Error('rva');
  };
  const md = off(b.readUInt32LE(off(b.readUInt32LE(dirs + 14 * 8)) + 8));
  if (b.readUInt32LE(md) !== 0x424a5342) throw new Error('metadata');
  let h = md + 16 + b.readUInt32LE(md + 12) + 4;
  for (let n = b.readUInt16LE(md + 16 + b.readUInt32LE(md + 12) + 2); n > 0; n--) {
    const start = md + b.readUInt32LE(h), size = b.readUInt32LE(h + 4);
    let e = h + 8; while (b[e]) e++;
    const name = b.toString('ascii', h + 8, e);
    h = (e + 4) & ~3;
    if (name !== '#US') continue;
    for (let p = start + 1; p < start + size;) {
      let len = b[p], hdr = 1;
      if ((len & 0xc0) === 0x80) { len = ((len & 0x3f) << 8) | b[p + 1]; hdr = 2; } else if ((len & 0xe0) === 0xc0) { len = ((len & 0x1f) << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]; hdr = 4; }
      const chars = (len - 1) / 2, text = p + hdr;
      if (chars >= 4 && [...Array(chars).keys()].every((i) => /[A-Za-z]/.test(String.fromCharCode(b.readUInt16LE(text + i * 2))))) {
        b[text] ^= 0x20;   // 첫 글자 대소문자 반전
        return b;
      }
      p += hdr + len;
    }
  }
  throw new Error('no user string');
}
const before = (log, a, b) => log.includes(a) && log.includes(b) && log.indexOf(a) < log.indexOf(b);

// 이전 패처를 그 커밋 소스로 빌드한다. v1 = 3인자 CLI(자동 오픈만), v2 = Managed 인자 4개(+ 투명화)
function buildAt(commit, name) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'AutoChestPatcher.cs');
  fs.writeFileSync(src, execFileSync('git', ['-C', path.join(__dirname, '..', '..'), 'show', `${commit}:tools/auto_chest/AutoChestPatcher.cs`]));
  const cecil = path.join(path.dirname(patcherExe), 'Mono.Cecil.dll');
  fs.copyFileSync(cecil, path.join(dir, 'Mono.Cecil.dll'));
  const exe = path.join(dir, `${name}.exe`);
  execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    ['/nologo', '/optimize+', '/target:exe', `/out:${exe}`, `/reference:${cecil}`, '/reference:System.Web.Extensions.dll', src]);
  return exe;
}
const buildLegacy = () => buildAt(legacyCommit, 'legacy');
function makeV1(legacy, w) {
  const out = path.join(path.dirname(w.data), 'v1.dll');
  execFileSync(legacy, ['patch', w.dll, out, w.flag]);
  fs.copyFileSync(out, w.dll);
}
function makeV2(legacy2, w) {
  const out = path.join(path.dirname(w.data), 'v2.dll');
  execFileSync(legacy2, ['patch', w.dll, out, w.flag, w.managed]);
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

  // 이전 패치 세트(v1, 자동 오픈만) → v3
  const legacy = buildLegacy();
  w = world('v1t', { running: true });
  execFileSync(patcherExe, ['backup', w.dll, path.join(w.data, 'auto_chest', 'backup')]);   // v1 설치 때 만들어진 원본 백업
  makeV1(legacy, w);
  fs.writeFileSync(w.flag, '');
  check('17 v1 + 설정 ON -> 재적용 필요(outdated)', (await w.chest.status(true)).state === 'needs_reapply');
  r = await w.chest.enable('transparent');
  st = await w.chest.status(true);
  check('17b v1에서 투명화 켜기 -> 설치 흐름으로 v3, 투명화 켜짐, 자동 오픈 플래그 유지', r.ok && w.log.includes('launch') && st.state === 'on' && st.transparent === 'on', JSON.stringify(r) + ' ' + JSON.stringify(st));
  check('17c 백업은 원본(v1 아님)', sha(path.join(w.data, 'auto_chest', 'backup', 'Assembly-CSharp.dll.orig')) === origSha);

  w = world('v1r');
  await w.chest.enable();   // 직접 설치한 v3 바이트를 기준으로 삼는다(백업도 여기서 생긴다)
  const v3sha = sha(w.dll);
  fs.copyFileSync(copy, w.dll);
  makeV1(legacy, w);
  w.log.length = 0;
  r = await w.chest.reapply(['chest']);
  check('17d v1 + 자동 오픈만 켜짐 -> 토스트 재적용으로 v3(직접 설치와 같은 바이트), 투명화 플래그 없음',
    r.ok && sha(w.dll) === v3sha && fs.existsSync(w.flag) && !fs.existsSync(w.tflag), JSON.stringify(r));

  // ---- 이전 패치 세트(v2, 자동 오픈 + 투명화) → v3(D-033 3단계): v1→v2 때처럼 '재적용 필요' → 게임 한 번 재시작 ----
  const legacy2 = buildAt(v2Commit, 'legacy2');
  w = world('v2t', { running: true });
  await w.chest.enable('transparent');   // 같은 세계(같은 플래그 리터럴)에서 직접 설치한 v3 바이트를 기준으로 삼는다(원본 백업도 여기서)
  const directV3 = sha(w.dll);
  fs.copyFileSync(copy, w.dll);
  makeV2(legacy2, w);   // 투명화를 켜 둔 v2 설치본(플래그는 위에서 켜짐)
  const v2bytes = sha(w.dll);
  st = await w.chest.status(true);
  check('22 v2 + 설정 ON -> 재적용 필요(outdated)', st.state === 'needs_reapply' && st.transparent === 'needs_reapply', JSON.stringify(st));
  w.log.length = 0; w.notes.length = 0;
  r = await w.chest.reapply(['transparent']);
  st = await w.chest.status(true);
  check('22b [재시작] -> 카운트다운 없이 게임 한 번 재시작해 v3, 투명화 그대로 켜짐',
    r.ok && !w.notes.some((n) => n.phase === 'countdown') && w.log.filter((x) => x === 'launch').length === 1 && st.transparent === 'on' && st.state === 'off',
    JSON.stringify(r) + ' ' + w.log.join(',') + ' ' + JSON.stringify(st));
  check('22c 결과는 원본에서 직접 설치한 v3와 같은 바이트', sha(w.dll) === directV3 && directV3 !== v2bytes);
  check('22d 백업은 원본(v2 아님)', sha(path.join(w.data, 'auto_chest', 'backup', 'Assembly-CSharp.dll.orig')) === origSha);

  // ---- 차단 멤버 고양이 숨김 목록 파일(D-033 3단계): 세트 3 설치 상태에서만 통째로 쓴다 ----
  const ID1 = '76561198000000011', ID2 = '76561198000000012';
  const hiddenOf = (x) => (fs.existsSync(x.hidden) ? fs.readFileSync(x.hidden, 'ascii') : null);
  w = world('hid', { running: true });
  r = await w.chest.setHidden([ID2, ID1]);
  check('23 미설치(clean) -> 목록 파일 안 씀', r.ok === false && r.reason === 'not_installed' && hiddenOf(w) === null, JSON.stringify(r));
  r = await w.chest.enable('transparent');
  check('23b 설치가 끝나면 마지막 목록을 쓴다(정렬, 줄마다 LF)', r.ok && hiddenOf(w) === `${ID1}\n${ID2}\n`, JSON.stringify(hiddenOf(w)));
  w.log.length = 0;
  r = await w.chest.setHidden([ID1]);
  check('23c 목록 변경 -> 통째로 다시 씀, 게임·worker 조작 없음', r.ok && hiddenOf(w) === `${ID1}\n` && w.log.length === 0, JSON.stringify(r));
  r = await w.chest.setHidden([]);
  check('23d 빈 목록 -> 빈 파일(아무도 안 숨김)', r.ok && hiddenOf(w) === '', JSON.stringify(r));
  r = await w.chest.setHidden(['abc', ID2, ID2, '0123', 5, `${ID1}\n${ID2}`, '9'.repeat(21)]);
  check('23e 형식이 틀린 항목·중복은 뺀다', r.ok && hiddenOf(w) === `${ID2}\n`, JSON.stringify(hiddenOf(w)));
  check('23f 임시 파일을 남기지 않는다', !fs.existsSync(`${w.hidden}.cattalk-new`));
  check('23g 목록 아닌 값 거부', (await w.chest.setHidden('x')).reason === 'invalid' && hiddenOf(w) === `${ID2}\n`);
  await w.chest.disable('transparent');
  r = await w.chest.setHidden([ID1, ID2]);
  check('23h 기능 플래그를 꺼도(패치는 그대로) 목록은 쓴다', r.ok && hiddenOf(w) === `${ID1}\n${ID2}\n`, JSON.stringify(r));
  fs.copyFileSync(copy, w.dll);   // 게임 업데이트로 패치 소실
  r = await w.chest.setHidden([ID1]);
  check('23i 패치 소실(clean) -> 쓰지 않음(파일은 이전 그대로)', r.ok === false && hiddenOf(w) === `${ID1}\n${ID2}\n`, JSON.stringify(r));
  r = await w.chest.reapply(['transparent']);
  check('23j 재적용으로 v3가 되면 마지막 목록을 쓴다', r.ok && hiddenOf(w) === `${ID1}\n`, JSON.stringify(r) + ' ' + JSON.stringify(hiddenOf(w)));

  // 교체 실패(게임이 마침 읽는 중 등): 같은 목록으로 POLL_MS 뒤 다시 쓴다
  fs.rmSync(w.hidden, { force: true });
  fs.mkdirSync(w.hidden);   // 교체가 실패하도록 같은 이름의 폴더를 둔다
  r = await w.chest.setHidden([ID2]);
  check('23k 교체 실패 -> write_failed, 임시 파일 정리', r.ok === false && r.reason === 'write_failed' && !fs.existsSync(`${w.hidden}.cattalk-new`), JSON.stringify(r));
  fs.rmdirSync(w.hidden);
  await new Promise((res) => setTimeout(res, 1300));
  check('23l 재시도로 기록', hiddenOf(w) === `${ID2}\n`, JSON.stringify(hiddenOf(w)));

  w = world('hidv2', { running: true });
  execFileSync(patcherExe, ['backup', w.dll, path.join(w.data, 'auto_chest', 'backup')]);
  makeV2(legacy2, w);
  r = await w.chest.setHidden([ID1]);
  check('24 v2 설치본(재적용 전) -> 쓰지 않음', r.ok === false && r.reason === 'needs_reapply' && hiddenOf(w) === null, JSON.stringify(r));
  w = world('hidinc');
  fs.copyFileSync(path.join(path.dirname(patcherExe), 'Mono.Cecil.dll'), w.dll);
  r = await w.chest.setHidden([ID1]);
  check('24b 호환 안 됨 -> 쓰지 않음', r.ok === false && r.reason === 'incompatible' && hiddenOf(w) === null, JSON.stringify(r));
  w = world('hidold', { patcherExe: legacy2 });
  r = await w.chest.setHidden([ID1]);
  check('24c 패처가 세트 2(앱 재설치 필요) -> 쓰지 않음', r.ok === false && r.reason === 'patcher_mismatch' && hiddenOf(w) === null, JSON.stringify(r));
  w = world('hidnone', { noGame: true });
  r = await w.chest.setHidden([ID1]);
  check('24d 게임 없음 -> 쓰지 않음', r.ok === false && r.reason === 'no_game', JSON.stringify(r));
  w = world('hidfail', { running: true, launchFails: true });
  r = await w.chest.setHidden([ID1]);
  r = await w.chest.enable();
  check('24e 설치 실패(자동 복원) -> 쓰지 않음', !r.ok && r.rolledBack && hiddenOf(w) === null, JSON.stringify(r));

  // ---- 설치 도구 버전·사전 점검(D-029): 안 되는 설치는 worker·게임을 건드리기 전에 끝낸다 ----
  const phases = (x) => x.notes.map((n) => n.phase).join(',');
  const untouched = (x) => x.log.length === 0 && sha(x.dll) === origSha && !fs.existsSync(x.flag) && !fs.existsSync(x.tflag);

  // 구버전 패처(version 명령 없음, 3인자 CLI): 2026-11-09 서브 기기 실측 상황
  w = world('oldtool', { running: true, patcherExe: legacy });
  st = await w.chest.status(true);
  check('18 구버전 패처 -> 앱 재설치 필요', st.state === 'patcher_mismatch' && st.transparent === 'patcher_mismatch' && st.reason === 'mismatch', JSON.stringify(st));
  r = await w.chest.enable();
  check('18b 켜기 거부, 알림·worker·게임·DLL 그대로', r.reason === 'patcher_mismatch' && w.notes.length === 0 && untouched(w) && w.running, JSON.stringify(r) + ' ' + w.log.join(','));
  fs.writeFileSync(w.flag, '');   // 설정 ON + clean(재적용 대상)이어도
  r = await w.chest.reapply();
  check('18c 재적용 거부, 알림·worker·게임·DLL 그대로', r.reason === 'patcher_mismatch' && w.notes.length === 0 && w.log.length === 0 && w.running && sha(w.dll) === origSha, JSON.stringify(r));

  w = world('notool', { patcherExe: path.join(work, 'none', 'AutoChestPatcher.exe') });
  st = await w.chest.status(false);
  check('18d 패처 없음 -> 앱 재설치 필요(missing)', st.state === 'patcher_mismatch' && st.reason === 'missing', JSON.stringify(st));

  // 판정은 패처·Mono.Cecil 파일이 바뀔 때만 다시 한다: 다시 빌드하면 곧바로 풀리고, 의존 DLL이 빠지면 다시 막힌다
  const swapDir = path.join(work, 'swaptool');   // world()가 지우는 세계 폴더와 겹치지 않게
  fs.rmSync(swapDir, { recursive: true, force: true });
  fs.mkdirSync(swapDir, { recursive: true });
  fs.copyFileSync(path.join(path.dirname(patcherExe), 'Mono.Cecil.dll'), path.join(swapDir, 'Mono.Cecil.dll'));
  const swapExe = path.join(swapDir, 'AutoChestPatcher.exe');
  fs.copyFileSync(legacy, swapExe);
  w = world('swap', { patcherExe: swapExe });
  const s1 = await w.chest.status(false);
  fs.copyFileSync(patcherExe, swapExe);
  const s2 = await w.chest.status(false);
  check('18e 패처를 다시 빌드하면 재판정', s1.state === 'patcher_mismatch' && s1.reason === 'mismatch' && s2.state === 'not_installed', `${JSON.stringify(s1)} -> ${s2.state}`);
  fs.rmSync(path.join(swapDir, 'Mono.Cecil.dll'));
  const s3 = await w.chest.status(false);
  check('18f 의존 DLL 누락(백신 격리 등) -> 앱 재설치 필요', s3.state === 'patcher_mismatch' && s3.reason === 'mismatch', JSON.stringify(s3));

  // 사전 점검 통과: 점검이 맨 앞, 그 뒤는 종전 순서
  w = world('order', { running: true });
  r = await w.chest.enable();
  check('19 사전 점검 -> 카운트다운 -> 설치', r.ok && w.notes[0].phase === 'checking' && w.notes[1].phase === 'countdown' && w.notes.at(-1).phase === 'done', phases(w));

  // 런타임 참조 부족(스트리핑된 게임 런타임, D-028 2a 실패 유형): 판정은 통과하지만 패치가 거부된다
  w = world('preref', { running: true });
  fs.rmSync(path.join(w.root, 'BongoCat_Data', 'Managed', 'UnityEngine.UIModule.dll'));
  check('19a 판정은 통과(미설치)', (await w.chest.status(false)).state === 'not_installed');
  r = await w.chest.enable();
  check('19b 켜기 -> 사전 점검에서 중단, 카운트다운·worker·게임 조작 없음', r.reason === 'incompatible' && untouched(w) && w.running && phases(w) === 'checking,failed', JSON.stringify(r) + ' ' + phases(w));
  fs.writeFileSync(w.flag, '');
  w.notes.length = 0;
  r = await w.chest.reapply();
  check('19c 재적용 -> 사전 점검에서 중단, worker·게임 조작 없음', r.reason === 'incompatible' && w.log.length === 0 && w.running && sha(w.dll) === origSha && phases(w) === 'checking,failed', JSON.stringify(r) + ' ' + phases(w));
  check('19d 사전 점검 산출물 남기지 않음', !fs.existsSync(path.join(w.data, 'auto_chest', 'staging', 'preflight', 'Assembly-CSharp.dll')));

  // 원본 백업 손상 + v1 재적용: 종전엔 게임을 끈 뒤 restore에서야 실패해 게임만 재시작됐다
  w = world('badbak', { running: true });
  execFileSync(patcherExe, ['backup', w.dll, path.join(w.data, 'auto_chest', 'backup')]);
  makeV1(legacy, w);
  fs.writeFileSync(w.flag, '');
  const v1sha = sha(w.dll);
  const bak = path.join(w.data, 'auto_chest', 'backup', 'Assembly-CSharp.dll.orig');
  const bytes = fs.readFileSync(bak); bytes[1000] ^= 0xff; fs.writeFileSync(bak, bytes);
  check('20 v1 + 설정 ON -> 재적용 필요', (await w.chest.status(true)).state === 'needs_reapply');
  r = await w.chest.reapply(['chest']);
  check('20b 백업 손상 -> 사전 점검에서 중단, worker·게임·DLL 그대로', r.reason === 'preflight_failed' && w.log.length === 0 && w.running && sha(w.dll) === v1sha && phases(w) === 'checking,failed', JSON.stringify(r) + ' ' + phases(w));

  // ---- Cat Talk 연결 호환성 지문 사전 점검(D-033 3단계 사고 재발 방지): 지문이 바뀌는 패치는 게임을 건드리기 전에 막는다 ----
  // 가짜 지문 도구: DLL 바이트 해시를 지문으로 낸다(패치하면 반드시 달라진다 = '패치가 지문을 바꾸는' 상황)
  const fakeDir = path.join(work, 'fakeprobe');
  fs.mkdirSync(fakeDir, { recursive: true });
  const fakeSrc = path.join(fakeDir, 'FakeProbe.cs');
  fs.writeFileSync(fakeSrc, [
    'using System; using System.IO; using System.Security.Cryptography;',
    'static class FakeProbe { static int Main(string[] a) {',
    '  var h = BitConverter.ToString(SHA256.Create().ComputeHash(File.ReadAllBytes(Path.Combine(a[0], "Assembly-CSharp.dll")))).Replace("-", "").ToLowerInvariant();',
    '  Console.WriteLine("{\\"privacy\\":\\"" + h + "\\",\\"chat\\":\\"" + h + "\\"}"); return 0; } }',
  ].join('\n'));
  const fakeProbe = path.join(fakeDir, 'FakeProbe.exe');
  execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), ['/nologo', '/target:exe', `/out:${fakeProbe}`, fakeSrc]);

  w = world('probe-diff', { running: true, probeExe: fakeProbe });
  r = await w.chest.enable('transparent');
  check('25 지문이 바뀌는 패치 -> 사전 점검에서 호환 안 됨, 카운트다운·worker·게임·DLL 그대로', r.reason === 'incompatible' && untouched(w) && w.running && phases(w) === 'checking,failed', JSON.stringify(r) + ' ' + phases(w));
  check('25b 지문 작업 파일을 남기지 않음', !fs.existsSync(path.join(w.data, 'auto_chest', 'staging', 'probe')));
  fs.writeFileSync(w.flag, '');
  w.notes.length = 0;
  r = await w.chest.reapply();
  check('25c 재적용도 같은 점검에서 중단', r.reason === 'incompatible' && w.log.length === 0 && w.running && sha(w.dll) === origSha && phases(w) === 'checking,failed', JSON.stringify(r) + ' ' + phases(w));

  w = world('probe-missing', { running: true, probeExe: path.join(work, 'none', 'FeatureProbe.exe') });
  r = await w.chest.enable();
  check('25d 지문 도구 없음 -> 사전 점검 실패, 게임 그대로', r.reason === 'preflight_failed' && untouched(w) && w.running && phases(w) === 'checking,failed', JSON.stringify(r) + ' ' + phases(w));

  w = world('probe-contract', { running: true, featureContract: path.join(work, 'none', 'feature-contract.json') });
  r = await w.chest.enable();
  check('25e 지문 계약 파일 없음 -> 사전 점검 실패, 게임 그대로', r.reason === 'preflight_failed' && untouched(w) && w.running && phases(w) === 'checking,failed', JSON.stringify(r) + ' ' + phases(w));

  // ── 원본 복원(D-038) ──
  // 제안: 패치본 + 설정 OFF + 기능 플래그 없음 + 숨김 목록(사이드카 알림)이 빔. 목록을 아직 모르면 판정하지 않는다.
  // 복원: 백업 SHA + verify(현재 DLL = 백업 + 훅)로 버전을 확인한 뒤, 게임이 켜져 있으면 카운트다운 → worker → 종료 → 복원 → 재실행.
  w = world('restore', { running: true });
  check('26 clean -> 복원 제안 없음', (await w.chest.status(false)).restorable === false);
  r = await w.chest.enable('transparent');
  check('26a 준비: 투명화 설치', r.ok === true, JSON.stringify(r));
  const restoreBase = sha(w.dll);
  check('26b 기능 켜짐 -> 제안 없음', (await w.chest.status(true)).restorable === false);
  await w.chest.disable('transparent');
  check('26c 기능 꺼짐 + 숨김 목록 모름 -> 제안 없음(판정 보류)', (await w.chest.status(false)).restorable === false);
  await w.chest.setHidden(['76561198000000001']);
  check('26d 숨길 사람 있음 -> 제안 없음, 변경 알림 1회', (await w.chest.status(false)).restorable === false && w.changes === 1, String(w.changes));
  await w.chest.setHidden([]);
  check('26e 숨김 목록 빔 + 기능 꺼짐 -> 제안, 변경 알림 2회', (await w.chest.status(false)).restorable === true && w.changes === 2, String(w.changes));
  check('26f 설정이 켜져 있으면 제안 없음', (await w.chest.status(true)).restorable === false);
  fs.writeFileSync(w.flag, '');
  check('26g 기능 플래그가 남아 있으면 제안 없음', (await w.chest.status(false)).restorable === false);
  w.log.length = 0; w.notes.length = 0;
  r = await w.chest.restore();
  check('26h 플래그가 있으면 복원 거부(still_needed), 게임·DLL 그대로', r.reason === 'still_needed' && w.log.length === 0 && sha(w.dll) === restoreBase, JSON.stringify(r));
  fs.rmSync(w.flag);
  check('26i 숨김 목록 파일은 설치 상태라 써져 있음(빈 목록)', fs.existsSync(w.hidden) && fs.readFileSync(w.hidden, 'utf-8') === '');
  w.notes.length = 0;
  r = await w.chest.restore();
  check('26j 게임 켜짐 복원: 카운트다운 5회, worker → 게임 종료 → 재실행 → worker', r.ok === true && w.notes.filter((n) => n.phase === 'countdown').length === 5
    && before(w.log, 'stopWorker', 'closeGame') && before(w.log, 'closeGame', 'launch') && before(w.log, 'launch', 'startWorker'), JSON.stringify(r) + ' ' + w.log.join(','));
  check('26k DLL이 원본과 바이트 동일, 숨김 목록·기능 플래그 파일 없음', sha(w.dll) === origSha && !fs.existsSync(w.hidden) && !fs.existsSync(w.flag) && !fs.existsSync(w.tflag));
  check('26l 진행 알림은 모두 action=restore, 복원 → 재실행 → 완료', w.notes.every((n) => n.action === 'restore') && /restoring,launching,done$/.test(phases(w)), phases(w));
  r = await w.chest.status(false);
  check('26m 복원 후 미설치, 제안 없음', r.state === 'not_installed' && r.restorable === false, JSON.stringify(r));

  w = world('restore-off', { running: true });
  await w.chest.enable('chest'); await w.chest.disable('chest'); await w.chest.setHidden([]);
  w.running = false; w.steam = false; w.log.length = 0; w.notes.length = 0;
  r = await w.chest.restore();
  check('26n 게임 꺼짐: 카운트다운·게임·worker 조작 없이 바로 복원', r.ok === true && w.log.length === 0 && phases(w) === 'restoring,done' && sha(w.dll) === origSha, JSON.stringify(r) + ' ' + phases(w));

  w = world('restore-cancel', { running: true });
  await w.chest.enable('chest'); await w.chest.disable('chest'); await w.chest.setHidden([]);
  const cancelBase = sha(w.dll);
  w.log.length = 0; w.notes.length = 0;
  w.onSleep = () => { if (w.notes.some((n) => n.phase === 'countdown' && n.seconds === 3)) w.chest.cancel(); };
  r = await w.chest.restore();
  w.onSleep = null;
  check('26o 카운트다운 취소 -> 게임·worker·DLL 그대로, 취소 알림', r.reason === 'cancelled' && w.log.length === 0 && w.running && sha(w.dll) === cancelBase && w.notes.slice(-1)[0].phase === 'cancelled', JSON.stringify(r));

  w = world('restore-mismatch', { running: true });
  await w.chest.enable('chest'); await w.chest.disable('chest'); await w.chest.setHidden([]);
  const mismatchBase = sha(w.dll);
  const otherBak = path.join(w.data, 'auto_chest', 'backup', 'Assembly-CSharp.dll.orig');
  fs.writeFileSync(otherBak, otherBuild(fs.readFileSync(copy)));
  fs.writeFileSync(`${otherBak}.sha256`, `${sha(otherBak)}\n`);
  check('26p 시험 준비: 바꾼 백업도 패처가 clean으로 읽음', JSON.parse(execFileSync(patcherExe, ['inspect', otherBak]).toString()).state === 'clean');
  w.log.length = 0; w.notes.length = 0;
  r = await w.chest.restore();
  check('26q 백업이 지금 DLL의 원본이 아님 -> version_mismatch, 덮어쓰지 않음·게임 조작 없음', r.reason === 'version_mismatch' && sha(w.dll) === mismatchBase && w.log.length === 0
    && phases(w) === 'failed' && w.notes[0].action === 'restore', JSON.stringify(r) + ' ' + phases(w));
  fs.rmSync(`${otherBak}.sha256`);
  r = await w.chest.restore();
  check('26r 백업 기록이 없어도 같은 안내(덮어쓰지 않음)', r.reason === 'version_mismatch' && sha(w.dll) === mismatchBase, JSON.stringify(r));

  console.log(failed ? `FAILED: ${failed}` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
