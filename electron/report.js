// 버그 신고·요청 사항(D-050): Discord 포럼 웹훅으로 스레드를 만든다(thread_name·applied_tags, 버그는 로그 첨부).
// 웹훅 URL은 빌드 시크릿이다 — 레포에 없다. 설치본은 GitHub Actions 시크릿 CATTALK_REPORT_WEBHOOK을 release.yml이
// electron/report-webhook.json(gitignore)으로 써 넣어 asar에 들어가고, dev는 같은 파일이나 같은 이름의 환경 변수를 쓴다.
// 태그 ID가 틀려도 Discord는 에러 없이 무시한다(2026-11-16 실측) — 태그가 붙었는지는 포럼 화면으로만 확인된다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const FORUM_TAGS = { bug: '1570698427388526612', request: '1570698371096911893' };   // 버그신고·요청사항(사용자 제공)
const TITLE_MAX = 100;      // Discord thread_name 상한
const CONTENT_MAX = 2000;   // Discord content 상한(본문 + 메타데이터)
const BODY_MAX = 1800;      // 메타데이터 몫을 남긴 본문 상한
// Discord 첨부 상한: 파일당 20 MiB(공식 문서 Uploading Files, 기본값). 여유를 두고 19 MiB 밑으로 묶는다
const ATTACH_MAX = 19 * 1024 * 1024;
const WEBHOOK = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;
const LOG_FILES = ['main.log.1', 'main.log', 'sidecar.log.1', 'sidecar.log', 'worker.log.1', 'worker.log',
  'faulthandler-sidecar.log', 'faulthandler-worker.log'];

function webhookUrl() {
  let url = process.env.CATTALK_REPORT_WEBHOOK;
  if (!url) {
    try { url = JSON.parse(fs.readFileSync(path.join(__dirname, 'report-webhook.json'), 'utf8')).url; } catch (e) { url = ''; }
  }
  return typeof url === 'string' && WEBHOOK.test(url) ? url : null;
}

// 식별자 지우기: 사용자 폴더·사용자 이름·17~20자리 숫자(SteamID64·로비 ID). 로그 원칙상 거의 없지만 첨부 직전에 한 번 더
function scrubber() {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const home = os.homedir();
  const user = (() => { try { return os.userInfo().username; } catch (e) { return ''; } })();
  const rules = [];
  if (home) rules.push([new RegExp(esc(home), 'gi'), '%USERPROFILE%'], [new RegExp(esc(home.replace(/\\/g, '/')), 'gi'), '%USERPROFILE%']);
  rules.push([/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, '$1<user>']);
  // 영문 이름은 단어 경계로(다른 낱말 속 일부는 남긴다), 한글 등 비영문 이름은 경계 없이
  if (user && user.length >= 2) rules.push([new RegExp(/^\w+$/.test(user) ? `\\b${esc(user)}\\b` : esc(user), 'gi'), '<user>']);
  rules.push([/\b\d{17,20}\b/g, '<id>']);
  return (text) => rules.reduce((t, [re, to]) => t.replace(re, to), text);
}

function readLogs(dir) {
  const scrub = scrubber();
  const parts = [];
  for (const name of LOG_FILES) {
    let text;
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch (e) { continue; }
    parts.push({ name, text: scrub(text) });
  }
  return parts;
}

// 첨부 한 개: 파일별 머리글 + 내용. 19 MiB를 넘으면 gzip, 그래도 넘으면 오래된 쪽(앞)부터 잘라 낸다
function bundle(dir) {
  const parts = readLogs(dir);
  let text = parts.map((p) => `===== ${p.name} =====\n${p.text}`).join('\n');
  if (!text) text = '(로그 없음)\n';
  let data = Buffer.from(text, 'utf8'), name = 'cattalk-logs.txt';
  if (data.length > ATTACH_MAX) {
    name = 'cattalk-logs.txt.gz';
    data = zlib.gzipSync(data);
    while (data.length > ATTACH_MAX) {
      text = text.slice(Math.floor(text.length / 4));
      data = zlib.gzipSync(Buffer.from(text, 'utf8'));
    }
  }
  return { parts: parts.map((p) => ({ name: p.name, bytes: Buffer.byteLength(p.text) })), name, data };
}

function createReporter({ logDir, log, openPath }) {
  return {
    available: () => webhookUrl() !== null,
    // 보내기 전 확인: 첨부될 파일 목록·크기
    preview() {
      const b = bundle(logDir);
      return { parts: b.parts, name: b.name, bytes: b.data.length };
    },
    // 첨부될 내용 그대로(지운 뒤)를 임시 파일로 써서 연다. gzip이면 압축 전 텍스트를 보여 준다
    async openPreview() {
      const parts = readLogs(logDir);
      const file = path.join(os.tmpdir(), 'cattalk-report-preview.txt');
      fs.writeFileSync(file, parts.map((p) => `===== ${p.name} =====\n${p.text}`).join('\n') || '(로그 없음)\n', 'utf8');
      const error = await openPath(file);
      return { ok: !error };
    },
    async submit(args) {
      const url = webhookUrl();
      if (!url) return { ok: false, reason: 'unavailable' };
      const kind = args?.kind;
      const title = typeof args?.title === 'string' ? args.title.trim() : '';
      const body = typeof args?.body === 'string' ? args.body.trim() : '';
      if (!(kind in FORUM_TAGS) || !title || [...title].length > TITLE_MAX || !body || [...body].length > BODY_MAX) {
        return { ok: false, reason: 'invalid' };
      }
      const conn = typeof args?.conn === 'string' ? args.conn.slice(0, 40) : '';
      const meta = [`앱 v${require('electron').app.getVersion()}`, `${os.version?.() || 'Windows'} (${os.release()}, ${os.arch()})`, conn && `연결: ${conn}`]
        .filter(Boolean).join(' · ');
      const content = `${body}\n\n-# ${meta}`.slice(0, CONTENT_MAX);
      const payload = { content, thread_name: title, applied_tags: [FORUM_TAGS[kind]], allowed_mentions: { parse: [] } };
      const form = new FormData();
      let attached = null;
      if (kind === 'bug') {
        const b = bundle(logDir);
        payload.attachments = [{ id: 0, filename: b.name }];
        form.append('files[0]', new Blob([b.data]), b.name);
        attached = { name: b.name, bytes: b.data.length };
      }
      form.append('payload_json', JSON.stringify(payload));
      try {
        const res = await fetch(`${url}?wait=true`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
        log.main('report_submit', { kind, status: res.status, attached });
        if (!res.ok) return { ok: false, reason: res.status === 429 ? 'rate_limited' : 'http_error' };
        return { ok: true };
      } catch (e) {
        log.main('report_submit', { kind, error: e.name });
        return { ok: false, reason: 'network' };
      }
    },
  };
}

module.exports = { createReporter, scrubber, bundle, FORUM_TAGS, TITLE_MAX, BODY_MAX, ATTACH_MAX };
