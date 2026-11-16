// 진단 로그(관측 전용, D-050). %LOCALAPPDATA%\CatTalk\logs\ 에 줄 단위로 바로 쓴다(appendFileSync = 쓰자마자 디스크).
// 파일마다 5MB를 넘으면 <name>.1 로 밀고 새로 연다 — 파일당 최대 2개(현재 + .1, 사용자 결정). 쓰기 실패는 앱 동작에 영향을 주지 않는다.
// 대화 본문·Steam ID·경로 같은 식별자는 남기지 않는 것이 원칙이고, 신고 첨부 때는 report.js가 한 번 더 지운다.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;

function createLogger(dir) {
  const sizes = new Map();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 로그 없이 계속 */ }

  function write(name, text) {
    const file = path.join(dir, name);
    try {
      let size = sizes.get(name);
      if (size === undefined) { try { size = fs.statSync(file).size; } catch (e) { size = 0; } }
      const bytes = Buffer.byteLength(text);
      if (size > 0 && size + bytes > MAX_BYTES) {
        fs.renameSync(file, file + '.1');   // 이전 .1은 덮어쓴다
        size = 0;
      }
      fs.appendFileSync(file, text);
      sizes.set(name, size + bytes);
    } catch (e) { sizes.delete(name); }
  }

  const stamp = () => new Date().toISOString();
  return {
    dir,
    // main.log: "시각 이벤트 {필드}" 한 줄
    main(event, fields) { write('main.log', `${stamp()} ${event}${fields ? ' ' + JSON.stringify(fields) : ''}\n`); },
    // sidecar.log: 사이드카·worker stderr를 받은 그대로(단계 표식 [diag] 포함). 줄 앞에 받은 시각을 붙인다
    sidecar(chunk) {
      const lines = String(chunk).split(/\r?\n/).filter((l) => l.length);
      if (lines.length) write('sidecar.log', lines.map((l) => `${stamp()} ${l}\n`).join(''));
    },
  };
}

module.exports = { createLogger, MAX_BYTES };
