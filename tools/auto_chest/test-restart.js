// 드로어 '게임 재시작'·'게임 실행' 흐름 검증(electron/auto-chest.js restartGame). 게임 실행·종료·Steam 상태는 가짜 함수다.
// 실게임·Steam·패처를 건드리지 않는다(재시작은 패처를 부르지 않는다). 사용: node tools/auto_chest/test-restart.js
const os = require('os');
const path = require('path');
const { createAutoChest } = require('../../electron/auto-chest');

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };

// opts: running(시작 시 게임 켜짐) · closeHangs · steamStuck · launchFails · noGame · releaseAfter(게임 종료 뒤 Steam이 풀리기까지 폴링 수)
function world(opts = {}) {
  const w = { log: [], notes: [], running: !!opts.running, steam: !!opts.running, polls: 0, onSleep: null };
  const sys = {
    findGame: async () => (opts.noGame ? null : { root: path.join(os.tmpdir(), 'no-such-game'), appId: '3419430' }),
    gameRunning: async () => w.running,
    closeGame: async () => { w.log.push('closeGame'); if (!opts.closeHangs) { w.running = false; w.polls = 0; } },
    // 게임이 꺼지면 사이드카가 worker를 바꿔 Steam이 몇 번의 폴링 뒤 풀린다(실제: worker 종료 2~3초 뒤)
    steamRunning: async () => {
      if (opts.steamStuck) return true;
      if (w.running) return true;
      w.polls++;
      if (w.polls > (opts.releaseAfter ?? 3)) w.steam = false;
      return w.steam;
    },
    launch: async () => { w.log.push('launch'); if (!opts.launchFails) { w.running = true; w.steam = true; } },
    sleep: async () => { await new Promise((r) => setImmediate(r)); if (w.onSleep) await w.onSleep(); },
  };
  w.chest = createAutoChest({
    dataDir: path.join(os.tmpdir(), 'cattalk-restart-test'), patcherExe: 'none', probeExe: 'none', featureContract: 'none', sys,
    stopWorker: async () => { w.log.push('stopWorker'); }, startWorker: async () => { w.log.push('startWorker'); },
    notify: (p) => w.notes.push(p),
  });
  w.phases = () => w.notes.map((n) => n.phase + (n.phase === 'countdown' ? n.seconds : ''));
  return w;
}

(async () => {
  // 1. 켜진 게임 재시작: 카운트다운 5→1 → 종료 → Steam 해제 대기 → 재실행 → 완료. worker·사이드카 조작 없음
  {
    const w = world({ running: true });
    const r = await w.chest.restartGame();
    check('restart ok', r.ok === true, JSON.stringify(r));
    check('restart phases', w.phases().join(',') === 'countdown5,countdown4,countdown3,countdown2,countdown1,closing_game,waiting_steam,launching,done', w.phases().join(','));
    check('restart action', w.notes.every((n) => n.action === 'restart'));
    check('restart sys calls', w.log.join(',') === 'closeGame,launch', w.log.join(','));
    check('restart game running after', w.running === true);
  }
  // 2. 꺼진 게임 실행: 카운트다운·종료 없이 Steam 해제 확인 → 실행
  {
    const w = world({ running: false });
    const r = await w.chest.restartGame();
    check('launch ok', r.ok === true, JSON.stringify(r));
    check('launch phases', w.phases().join(',') === 'waiting_steam,launching,done', w.phases().join(','));
    check('launch action', w.notes.every((n) => n.action === 'launch'));
    check('launch sys calls', w.log.join(',') === 'launch', w.log.join(','));
  }
  // 3. 카운트다운 취소: 게임은 그대로
  {
    const w = world({ running: true });
    w.onSleep = async () => { if (w.notes.at(-1)?.seconds === 4) w.chest.cancel(); };
    const r = await w.chest.restartGame();
    check('cancel result', r.ok === false && r.reason === 'cancelled', JSON.stringify(r));
    check('cancel untouched', w.log.length === 0 && w.running === true, w.log.join(','));
    check('cancel note', w.notes.at(-1).phase === 'cancelled' && w.notes.at(-1).action === 'restart');
  }
  // 4. 게임이 안 꺼짐: 중단, 실행하지 않음(게임은 켜진 그대로)
  {
    const w = world({ running: true, closeHangs: true });
    const r = await w.chest.restartGame();
    check('close hang reason', r.reason === 'game_close_failed', JSON.stringify(r));
    check('close hang no launch', w.log.join(',') === 'closeGame' && w.running === true, w.log.join(','));
  }
  // 5. 재시작 중 Steam이 안 풀림: 실패 + 켜져 있던 게임을 한 번 다시 실행해 본다(설치·복원과 같은 규칙)
  {
    const w = world({ running: true, steamStuck: true });
    const r = await w.chest.restartGame();
    check('restart steam stuck reason', r.reason === 'steam_still_running', JSON.stringify(r));
    check('restart steam stuck recovery launch', w.log.join(',') === 'closeGame,launch', w.log.join(','));
  }
  // 6. 실행 중 Steam이 안 풀림: 실패, 실행하지 않음(원래 꺼져 있었다)
  {
    const w = world({ running: false, steamStuck: true });
    const r = await w.chest.restartGame();
    check('launch steam stuck reason', r.reason === 'steam_still_running', JSON.stringify(r));
    check('launch steam stuck no launch', w.log.length === 0, w.log.join(','));
  }
  // 7. 재실행했는데 게임이 안 뜸: 실패, 실행은 한 번만
  {
    const w = world({ running: true, launchFails: true });
    const r = await w.chest.restartGame();
    check('start fail reason', r.reason === 'game_start_failed', JSON.stringify(r));
    check('start fail single launch', w.log.join(',') === 'closeGame,launch', w.log.join(','));
  }
  // 8. 겹침 방지: 재시작 카운트다운 중 상자 켜기·두 번째 재시작은 busy
  {
    const w = world({ running: true });
    let enable = null, second = null;
    w.onSleep = async () => {
      if (enable === null && w.notes.at(-1)?.phase === 'countdown') {
        enable = await w.chest.enable('chest');
        second = await w.chest.restartGame();
      }
    };
    await w.chest.restartGame();
    check('busy blocks chest enable', enable?.reason === 'busy', JSON.stringify(enable));
    check('busy blocks second restart', second?.reason === 'busy', JSON.stringify(second));
  }
  // 9. 게임을 못 찾음
  {
    const w = world({ noGame: true });
    const r = await w.chest.restartGame();
    const s = await w.chest.gameStatus();
    check('no game', r.reason === 'no_game' && w.notes.length === 0, JSON.stringify(r));
    check('no game status', s.found === false && s.running === false, JSON.stringify(s));
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
})();
