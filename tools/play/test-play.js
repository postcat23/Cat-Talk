// 칭찬(1.0.8)·경고 렌더러 규칙 검증: 명령 해석·자동완성 예외·대상 판정(자기 칭찬 거절)·이름 뒤 표시 형식(아이콘+숫자, 토글 독립)·
// 발동 화면 대기열(같은 대상 10초 취합, 끄면 버림). 실제 모듈을 esbuild로 묶어 부른다(레포의 esbuild). 사용: node tools/play/test-play.js
const os = require('os');
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');
const esbuild = require(require.resolve('esbuild', { paths: [REPO] }));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cattalk-play-'));
esbuild.buildSync({
  entryPoints: ['warns', 'play', 'playQueue'].map((m) => path.join(REPO, 'renderer', 'src', 'chat', `${m}.ts`)),
  bundle: true, platform: 'node', format: 'cjs', outdir: out, logLevel: 'error',
});
const warns = require(path.join(out, 'warns.js'));
const play = require(path.join(out, 'play.js'));
const queue = require(path.join(out, 'playQueue.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 명령 해석 ──
check('praise command', same(warns.parsePlayCommand('@고양이 칭찬!'), { kind: 'praise', name: '고양이' }));
check('praise with spaces in name', same(warns.parsePlayCommand('  @긴 이름  칭찬!  '), { kind: 'praise', name: '긴 이름' }));
check('warn command unchanged', same(warns.parsePlayCommand('@고양이 경고!'), { kind: 'warn', name: '고양이' }));
check('plain chat is not a command', warns.parsePlayCommand('칭찬! 잘했어') === null && warns.parsePlayCommand('@고양이 칭찬') === null);
check('@ autocomplete closes after the command word', warns.mentionAt('@고양이 칭찬', 7) === null && warns.mentionAt('@고양이 경고!', 8) === null);
check('@ autocomplete still opens while typing a name', same(warns.mentionAt('@고양', 3), { start: 0, query: '고양' }));

// ── 대상 판정 ──
const people = [{ id: 'me', name: '나비', base: 'Navi' }, { id: 'a', name: '치즈', base: 'Cheese' }, { id: 'b', name: '쌍둥', base: 'Twin' },
  { id: 'c', name: '쌍둥', base: 'Twin2' }];
check('praise self -> self (Steam ID)', warns.resolvePlayTarget('praise', '나비', people, null, 'me') === 'self');
check('praise self via autocomplete binding -> self', warns.resolvePlayTarget('praise', '나비', people, { id: 'me', name: '나비' }, 'me') === 'self');
check('warn self allowed (D-052)', warns.resolvePlayTarget('warn', '나비', people, null, 'me') === 'me');
// 사용자 결정(1.0.8): '@' 자동완성 목록에는 본인도 남는다 — 경고는 본인도 대상이고, 목록 시점엔 경고·칭찬을 가를 수 없다
check('@ autocomplete keeps self in the list', warns.filterParticipants('나', people).some((p) => p.id === 'me')
  && warns.filterParticipants('', people).length === people.length);
check('praise other -> id', warns.resolvePlayTarget('praise', '치즈', people, null, 'me') === 'a');
check('duplicate display name -> ambiguous', warns.resolvePlayTarget('praise', '쌍둥', people, null, 'me') === 'ambiguous');
check('duplicate name picked from list -> exact id', warns.resolvePlayTarget('praise', '쌍둥', people, { id: 'c', name: '쌍둥' }, 'me') === 'c');
check('unknown name -> none', warns.resolvePlayTarget('praise', '없음', people, null, 'me') === 'none');

// ── 이름 뒤 표시: 아이콘 + 숫자, 0은 숨김, 경고 먼저, 토글 독립 ──
const on = { playWarn: true, playPraise: true };
check('0/0 -> nothing', same(play.playMarks(0, 0, on), []));
check('warn only', same(play.playMarks(1, 0, on), [{ kind: 'warn', count: 1 }]));
check('praise only', same(play.playMarks(0, 2, on), [{ kind: 'praise', count: 2 }]));
check('both -> warn first then praise (🟨1 ⭐2)', same(play.playMarks(1, 2, on), [{ kind: 'warn', count: 1 }, { kind: 'praise', count: 2 }]));
check('one icon + number, not stacked (count 2 is one mark)', play.playMarks(0, 2, on).length === 1);
check('praise off hides only the star', same(play.playMarks(1, 2, { playWarn: true, playPraise: false }), [{ kind: 'warn', count: 1 }]));
check('warn off hides only the card', same(play.playMarks(1, 2, { playWarn: false, playPraise: true }), [{ kind: 'praise', count: 2 }]));
check('both off -> nothing', same(play.playMarks(1, 2, { playWarn: false, playPraise: false }), []));
check('label', play.playMarkLabel(play.playMarks(1, 2, on)) === '경고 1회, 칭찬 2회');

// ── 드로어 행·'@' 자동완성 ──
const praiseRow = play.PLAY_FEATURES.find((f) => f.key === 'playPraise');
check('drawer row under warn, default hint', play.PLAY_FEATURES[0].key === 'playWarn' && play.PLAY_FEATURES[1] === praiseRow
  && praiseRow.label === '칭찬' && praiseRow.hint === '@사용자이름 칭찬!');
check('@ autocomplete on if either is on', play.mentionEnabled({ playWarn: false, playPraise: true }) && play.mentionEnabled({ playWarn: true, playPraise: false }));
check('@ autocomplete off when both off', !play.mentionEnabled({ playWarn: false, playPraise: false }));

// ── 발동 화면 대기열(공개수배·칭찬 도장 공통) ──
const ended = new Map();
let r = queue.admitEvents([], [{ id: 'p1', target: 'a' }], true, ended, 1000);
check('first fire queued', r.queue.length === 1 && r.queue[0].at === 1000 && r.reports.length === 0);
r = queue.admitEvents(r.queue, [{ id: 'p1', target: 'a' }], true, ended, 2000);
check('same id ignored', r.queue.length === 1 && r.reports.length === 0);
r = queue.admitEvents(r.queue, [{ id: 'p2', target: 'a' }], true, ended, 3000);
check('same target while pending -> coalesce, hold restarts', r.queue.length === 1 && r.queue[0].at === 3000 && same(r.reports, ['coalesce']));
r = queue.admitEvents(r.queue, [{ id: 'p3', target: 'b' }], true, ended, 3500);
check('other target queued separately', r.queue.length === 2 && r.queue[1].target === 'b');
let q2 = queue.finishEvent(r.queue, 'p1', 'shown', ended, 5000);
check('finish shown records end time', q2.length === 1 && ended.get('a') === 5000);
r = queue.admitEvents(q2, [{ id: 'p4', target: 'a' }], true, ended, 5000 + queue.COALESCE_MS - 1);
check('same target within 10s of end -> coalesce', same(r.reports, ['coalesce']) && r.queue.length === 1);
r = queue.admitEvents(q2, [{ id: 'p5', target: 'a' }], true, ended, 5000 + queue.COALESCE_MS);
check('after 10s -> shown again', r.queue.length === 2 && r.queue[1].id === 'p5');
check('unknown id finish -> null', queue.finishEvent(r.queue, 'zz', 'shown', ended, 1) === null);
check('expired does not record end time', (() => { const e = new Map(); queue.finishEvent([{ id: 'x', target: 't' }], 'x', 'expired', e, 9); return e.size === 0; })());
r = queue.admitEvents([], [{ id: 'p6', target: 'c' }], false, new Map(), 1);
check('toggle off -> dropped with off report', r.queue.length === 0 && same(r.reports, ['off']));

fs.rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
