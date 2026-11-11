// 창 상태 영속: 도크 위치·높이·작업표시줄 숨김·소속 디스플레이를 데이터 디렉터리의 JSON에 저장한다.
// 사이드카(settings.sqlite3)와 같은 디렉터리를 쓰되, 창 생성 전에 동기로 읽어야 하므로 메인이 직접 관리한다.
const fs = require('fs');
const path = require('path');

const DEFAULTS = { side: 'right', heightPct: 100, hideTaskbar: false, display: null };
const HEIGHT_PCTS = [100, 70, 50];
const SAVE_DELAY_MS = 300;

// 데이터 폴더 %LOCALAPPDATA%\CatTalk(D-041. 전에는 CatTalk-dev — 옮기지 않는다). dev(electron .)와 설치본이 함께 쓴다.
// 창 상태·패처 백업(auto_chest)·토스트 아이콘, 그리고 main이 CATTALK_DATA로 넘겨 사이드카가 쓰는 설정 DB(settings.sqlite3)가 여기 있다.
function dataDir() {
  return process.env.CATTALK_DATA || path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'CatTalk');
}

const file = () => path.join(dataDir(), 'window-state.json');

// 손상·누락 필드는 기본값으로 되돌린다(최초 실행 = 주 모니터·오른쪽·100%).
function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf-8')); } catch { /* 없음/손상 → 기본값 */ }
  const display = raw.display && Number.isFinite(raw.display.id) && raw.display.bounds ? raw.display : null;
  return {
    side: raw.side === 'left' ? 'left' : 'right',
    heightPct: HEIGHT_PCTS.includes(raw.heightPct) ? raw.heightPct : DEFAULTS.heightPct,
    hideTaskbar: raw.hideTaskbar === true,
    display,
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
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file());
  } catch (e) {
    console.error('[window-state] save failed:', e.message);
  }
}

module.exports = { load, save, flush, dataDir, HEIGHT_PCTS };
