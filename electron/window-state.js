// 창 상태 영속: 도크 위치·높이·작업표시줄 숨김·소속 디스플레이를 데이터 디렉터리의 JSON에 저장한다.
// 사이드카(settings.sqlite3)와 같은 디렉터리를 쓰되, 창 생성 전에 동기로 읽어야 하므로 메인이 직접 관리한다.
const fs = require('fs');
const path = require('path');

const DEFAULTS = { side: 'right', heightPct: 100, hideTaskbar: false, displayIndex: null };
const HEIGHT_PCTS = [100, 70, 50];
const SAVE_DELAY_MS = 300;

// 데이터 폴더 %LOCALAPPDATA%\CatTalk(D-041. 전에는 CatTalk-dev — 옮기지 않는다). dev(electron .)와 설치본이 함께 쓴다.
// 창 상태·패처 백업(auto_chest)·토스트 아이콘, 그리고 main이 CATTALK_DATA로 넘겨 사이드카가 쓰는 설정 DB(settings.sqlite3)가 여기 있다.
function dataDir() {
  return process.env.CATTALK_DATA || path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'CatTalk');
}

const file = () => path.join(dataDir(), 'window-state.json');

// 손상·누락 필드는 기본값으로 되돌린다(최초 실행 = 주 모니터·오른쪽·100%).
// displayIndex: 디스플레이 번호(1부터, displays.js 순번 — 사용자 명세 2026-11-18). 그 번호 디스플레이가 없으면 main이 주 모니터로 폴백한다.
// legacyDisplay: 순번 저장 전 버전(≤1.0.5)이 남긴 {id,bounds}. 순번이 없을 때 첫 실행 1회만 모니터를 찾는 데 쓰고(이어받기,
// 사용자 결정 2026-11-18) 다시 쓰지 않는다(flush가 저장하지 않음).
function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf-8')); } catch { /* 없음/손상 → 기본값 */ }
  const displayIndex = Number.isInteger(raw.displayIndex) && raw.displayIndex >= 1 ? raw.displayIndex : DEFAULTS.displayIndex;
  const legacy = raw.display;
  const legacyDisplay = !displayIndex && legacy && Number.isFinite(legacy.id) && legacy.bounds ? legacy : null;
  return {
    side: raw.side === 'left' ? 'left' : 'right',
    heightPct: HEIGHT_PCTS.includes(raw.heightPct) ? raw.heightPct : DEFAULTS.heightPct,
    hideTaskbar: raw.hideTaskbar === true,
    displayIndex,
    legacyDisplay,
  };
}

let timer = null;
// 이동·변경이 연달아 와도 마지막 상태만 쓴다. 임시 파일 후 rename으로 반쯤 쓴 파일을 남기지 않는다.
function save(state) {
  clearTimeout(timer);
  timer = setTimeout(() => flush(state), SAVE_DELAY_MS);
}

function flush(state) {
  clearTimeout(timer);
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = file() + '.tmp';
    const { side, heightPct, hideTaskbar, displayIndex } = state;
    fs.writeFileSync(tmp, JSON.stringify({ side, heightPct, hideTaskbar, displayIndex }, null, 2));
    fs.renameSync(tmp, file());
  } catch (e) {
    console.error('[window-state] save failed:', e.message);
  }
}

module.exports = { load, save, flush, dataDir, HEIGHT_PCTS };
