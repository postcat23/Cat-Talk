// 상자 자동 오픈 흐름 검증(D-019): 실게임 없이 가짜 게임 폴더 + DLL 사본 + 실제 패처로 돌린다.
// 게임 실행·종료·Steam 상태는 가짜 함수다. 실게임 폴더·프로세스·Steam을 건드리지 않는다.
// 사용: node tools/auto_chest/test-flow.js <Assembly-CSharp.dll 사본> <빈 작업 폴더>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createAutoChest, FLAG_NAME } = require('../../electron/auto-chest');

const [copy, work] = process.argv.slice(2);
if (!copy || !work) { console.error('usage: test-flow.js <copy> <work>'); process.exit(2); }
if (/\\BongoCat_Data\\Managed\\/i.test(path.resolve(copy))) { console.error('use a copy outside the game folder'); process.exit(2); }
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
  const dll = path.join(managed, 'Assembly-CSharp.dll');
  fs.copyFileSync(copy, dll);
  const w = { root, dll, flag: path.join(root, FLAG_NAME), log: [], notes: [], running: !!opts.running, steam: !!opts.running, data: path.join(base, 'data') };
  const sys = {
    findGame: async () => (opts.noGame ? null : { root, appId: '1' }),
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
  check('6 패치돼 있으면 재적용 안 함', r.ok === false && r.reason === 'on' && !w.notes.some((n) => n.kind === 'reapply'), JSON.stringify(r));
  w.running = false; w.log.length = 0;
  fs.copyFileSync(copy, w.dll);   // Steam 업데이트로 패치 소실
  check('6a 설정 ON + clean -> 재적용 필요', (await w.chest.status(true)).state === 'needs_reapply');
  w.onSleep = () => { if (w.notes.some((n) => n.kind === 'reapply' && n.seconds === 3)) w.chest.cancel(); };
  r = await w.chest.reapply();
  check('6b 재적용 카운트다운 취소 -> 아무것도 안 함', r.reason === 'cancelled' && w.log.length === 0 && sha(w.dll) === origSha, JSON.stringify(r));
  w.onSleep = null; w.notes.length = 0;
  r = await w.chest.reapply();
  check('6c 재적용: 카운트다운 후 켜기와 같은 흐름', r.ok && w.notes.filter((n) => n.kind === 'reapply').length === 5 && before(w.log, 'stopWorker', 'launch') && before(w.log, 'launch', 'startWorker'), JSON.stringify(r) + ' ' + w.log.join(','));
  check('6d 재적용 후 상태 = 켜짐', fs.existsSync(w.flag) && (await w.chest.status(true)).state === 'on');
  w.log.length = 0;
  fs.copyFileSync(copy, w.dll);   // 게임이 켜진 채로 패치 소실
  w.steam = true;
  r = await w.chest.reapply();
  check('6e 게임 실행 중 재적용: worker -> 게임 종료 -> 재실행', r.ok && before(w.log, 'stopWorker', 'closeGame') && before(w.log, 'closeGame', 'launch'), JSON.stringify(r) + ' ' + w.log.join(','));
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

  w = world('nogame', { noGame: true });
  check('13 게임 없음', (await w.chest.status(false)).state === 'no_game');
  r = await w.chest.enable();
  check('13b 켜기 거부', r.reason === 'no_game');

  console.log(failed ? `FAILED: ${failed}` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
