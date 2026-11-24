// 문구 트리거 이벤트(1.0.10) 렌더러 규칙 검증: 활성 기간(매년 11/24~12/25, 양 끝 포함·현지 날짜)·문구 매칭(부분 일치·대소문자 무시)·
// 10초 쿨다운(재생 중 포함)·토글·플레이 행, 새로 올라온 글 판정(시작 시 기록·옛 글·검색 결과 제외, 로비 바뀌면 기준선 다시).
// 실제 모듈을 esbuild로 묶어 부른다(test-play.js와 같은 방식). 사용: node tools/play/test-event.js
const os = require('os');
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');
const esbuild = require(require.resolve('esbuild', { paths: [REPO] }));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cattalk-event-'));
esbuild.buildSync({
  entryPoints: ['events', 'arrivals', 'play'].map((m) => path.join(REPO, 'renderer', 'src', 'chat', `${m}.ts`)),
  bundle: true, platform: 'node', format: 'cjs', outdir: out, logLevel: 'error',
});
const ev = require(path.join(out, 'events.js'));
const arr = require(path.join(out, 'arrivals.js'));
const play = require(path.join(out, 'play.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);   // 현지 시각
const hit = (text, date = at(2026, 12, 1)) => ev.matchEvent(text, date)?.id ?? null;

// ── 활성 기간 ──
check('11/23 23:59 -> off', hit('메리 크리스마스', at(2026, 11, 23, 23, 59)) === null);
check('11/24 00:00 -> on (start inclusive)', hit('메리 크리스마스', at(2026, 11, 24, 0, 0)) === 'christmas');
check('12/25 23:59 -> on (end inclusive)', hit('메리 크리스마스', at(2026, 12, 25, 23, 59)) === 'christmas');
check('12/26 00:00 -> off', hit('메리 크리스마스', at(2026, 12, 26, 0, 0)) === null);
check('mid-year (7/1) -> off', hit('크리스마스', at(2026, 7, 1)) === null);
check('every year (2027-12-10) -> on', hit('크리스마스', at(2027, 12, 10)) === 'christmas');
check('year-wrapping window (12/30~1/2) works', ev.inWindow({ start: { month: 12, day: 30 }, end: { month: 1, day: 2 } }, at(2027, 1, 1))
  && !ev.inWindow({ start: { month: 12, day: 30 }, end: { month: 1, day: 2 } }, at(2027, 1, 3)));

// ── 문구 매칭(부분 일치·대소문자 무시) — 사용자 명세 12개 전부 ──
const PHRASES = ['메리 크리스마스', 'merry christmas', 'christmas', '크리스마스', '트리', '선물', '산타', '산타클로스', '루돌프', '겨우살이', '화이트 크리스마스', 'Xmas'];
check('event phrases = spec list', same(ev.EVENTS[0].phrases, PHRASES));
check('every phrase triggers alone', PHRASES.every((p) => hit(p) === 'christmas'));
check('case-insensitive (MERRY CHRISTMAS / xMaS / XMAS)', ['MERRY CHRISTMAS', 'xMaS', 'XMAS!!'].every((t) => hit(t) === 'christmas'));
check('substring inside a sentence', ['다들 메리크리스마스~ 아니 메리 크리스마스!', '트리 만들자', '나무트리장식', 'Happy XMAS eve', '산타할아버지'].every((t) => hit(t) === 'christmas'));
check('unrelated text -> no trigger', ['안녕하세요', '새해 복 많이', 'merry', 'Christ', '크리스', '선 물'].every((t) => hit(t) === null));
check('empty text -> no trigger', hit('') === null);

// ── 쿨다운(10초, 재생 중 포함)·토글 ──
check('cooldown is 10s (same as warn/praise coalescing)', ev.EVENT_COOLDOWN_MS === 10000);
check('duration 4s', ev.EVENT_DURATION_MS === 4000);
const playing = { id: 'christmas:1', effect: 'christmas', at: 0 };
check('first trigger admitted', ev.admitEvent(true, null, null, 1000));
check('ignored while one is pending/playing', !ev.admitEvent(true, playing, null, 1000));
check('ignored within 10s of play start (after it ended)', !ev.admitEvent(true, null, 1000, 1000 + 9999));
check('admitted again at 10s', ev.admitEvent(true, null, 1000, 1000 + 10000));
check('toggle off -> never admitted', !ev.admitEvent(false, null, null, 1000));

// ── 플레이 행 ──
const row = play.PLAY_FEATURES.find((f) => f.key === 'playEvent');
check('play row: 이벤트 모션 / 숨겨진 문구 찾기 / not a mention feature', !!row && row.label === '이벤트 모션' && row.hint === '숨겨진 문구 찾기' && row.mention === false);
check('play row order: 경고, 칭찬, 이벤트 모션', same(play.PLAY_FEATURES.map((f) => f.label), ['경고', '칭찬', '이벤트 모션']));
check('@ autocomplete unaffected by event toggle', play.mentionEnabled({ playWarn: false, playPraise: false, playEvent: true }) === false);

// ── 새로 올라온 글 판정 ──
const m = (seq, body, extra = {}) => ({ seq, id: `m${seq}`, sender: 's', name: 'n', body, received: 0, own: 0, status: 'received', ...extra });
const view = (messages, latest, lobby = 'L1') => ({ context: { account: 'A', lobby, generation: 'g' }, messages, latest_seq: latest });
let t = arr.takeArrivals(null, view([m(1, '메리 크리스마스'), m(2, '트리')], 2), false);
check('first response = baseline only (startup history never triggers)', t.fresh.length === 0 && t.next.seq === 2);
let u = arr.takeArrivals(t.next, view([m(1, 'a'), m(2, 'b'), m(3, '선물 받았다')], 3), false);
check('new seq after baseline -> fresh', same(u.fresh.map((x) => x.id), ['m3']) && u.next.seq === 3);
check('same response again -> nothing new', arr.takeArrivals(u.next, view([m(3, '선물')], 3), false).fresh.length === 0);
check('older messages loaded later (load more) -> not fresh', arr.takeArrivals(u.next, view([m(0, '산타')], 3), false).fresh.length === 0);
const own = arr.takeArrivals(u.next, view([m(4, '루돌프', { own: 1, status: 'pending' })], 4), false);
check('own message counts (본인 포함)', own.fresh.length === 1 && own.fresh[0].own === 1);
check('status change of the same message does not re-trigger', arr.takeArrivals(own.next, view([m(4, '루돌프', { own: 1, status: 'accepted' })], 4), false).fresh.length === 0);
const pres = arr.takeArrivals(u.next, view([m(5, '', { kind: 'member_joined' })], 5), false);
check('presence rows are not chat', pres.fresh.length === 0 && pres.next.seq === 5);
const search = arr.takeArrivals(u.next, view([m(9, '트리')], 9), true);
check('while searching: no trigger but baseline moves (no late trigger after search)', search.fresh.length === 0 && search.next.seq === 9
  && arr.takeArrivals(search.next, view([m(9, '트리')], 9), false).fresh.length === 0);
const moved = arr.takeArrivals(u.next, view([m(1, '크리스마스'), m(2, 'Xmas')], 2, 'L2'), false);
check('lobby changed -> new baseline, its backlog does not trigger', moved.fresh.length === 0 && moved.next.seq === 2 && moved.next.context.endsWith('L2'));
const vol = arr.takeArrivals(u.next, view([m(undefined, '산타', { id: 'v1', unsaved: true })], 3), false);
check('unsaved (no seq) new message -> fresh once', vol.fresh.length === 1 && arr.takeArrivals(vol.next, view([m(undefined, '산타', { id: 'v1', unsaved: true })], 3), false).fresh.length === 0);
const hist = arr.takeArrivals(u.next, view([m(7, '겨우살이')], 7), false);   // HISTORY 모드(limit 1)는 최신 글 하나만 온다
check('HISTORY mode newest message -> fresh', hist.fresh.length === 1);

fs.rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
