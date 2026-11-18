// 플레이리스트 공유(D-053, /플리): 유튜브 영상 제목 조회와 외부 브라우저 재생. 렌더러 CSP(connect-src 'self')가 막는 네트워크라 main이 맡는다.
// 렌더러는 영상 ID만 넘기고, URL은 여기서 ID로 다시 만든다 — 남이 로비 멤버 데이터에 넣은 값을 그대로 열지 않는다(사용자 명세).
// 제목: oEmbed(title) → 실패하면 영상 페이지의 og:title → 그래도 없으면 null(렌더러가 링크로 표시). ID별로 이번 실행 동안만 메모리에 둔다.
// 재생: 단일 = watch?v=ID. 연속 = watch_videos?video_ids=…(비공식 주소)가 임시 재생목록(list=TL…)으로 넘기는지 확인하고 열고,
// 아니면 첫 곡 단일로 연다(사용자 명세). YouTube는 앞 50개만 반영하므로(2026-11-18 실측: 51·60·100개도 같은 목록)
// 50곡 이하면 전체를 등록순, 넘으면 누를 때마다 랜덤 50곡을 뽑은 순서(무작위)대로 넘긴다(beta.5 사용자 명세·결정, listIds).
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TIMEOUT_MS = 5000;
const MAX_TITLE = 200;
const MAX_CACHE = 300;
const WATCH_VIDEOS_MAX = 50;
const TEMP_LIST = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}&list=TL[A-Za-z0-9_-]+$/;

const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

// 연속재생 곡: 중복을 뺀 뒤 50곡 이하면 그대로(등록순), 넘으면 섞어서(Fisher–Yates) 앞 50곡. 렌더러 chat/playlist.ts listIds와 같은 규칙
function listIds(ids, random = Math.random) {
  const unique = [...new Set(ids)];
  if (unique.length <= WATCH_VIDEOS_MAX) return unique;
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return unique.slice(0, WATCH_VIDEOS_MAX);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[name.toLowerCase()] ?? m;
  });
}

const clean = (title) => (typeof title === 'string' && title.trim() ? title.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE) : null);

function createPlaylistLinks({ net, openExternal, log, random = Math.random }) {
  const cache = new Map();      // id → 제목 또는 null(조회 실패도 이번 실행 동안 다시 묻지 않는다)
  const inflight = new Map();   // id → 진행 중인 조회

  async function get(url) {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return response;
  }

  async function lookup(id) {
    const target = encodeURIComponent(watchUrl(id));
    try {
      const data = await (await get(`https://www.youtube.com/oembed?url=${target}&format=json`)).json();
      const title = clean(data?.title);
      if (title) return title;
    } catch (e) { /* 404(없는 영상·비공개)·네트워크 → og:title */ }
    try {
      const html = await (await get(watchUrl(id))).text();
      const og = /<meta\s+property="og:title"\s+content="([^"]*)"/i.exec(html);
      return clean(og ? decodeEntities(og[1]) : null);
    } catch (e) {
      return null;
    }
  }

  function title(id) {
    if (typeof id !== 'string' || !VIDEO_ID.test(id)) return Promise.resolve(null);
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    if (inflight.has(id)) return inflight.get(id);
    const pending = lookup(id).then((value) => {
      inflight.delete(id);
      cache.set(id, value);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      return value;
    });
    inflight.set(id, pending);
    return pending;
  }

  // watch_videos가 넘겨 주는 주소(redirect를 따라가지 않고 Location만 읽는다). 임시 재생목록 모양이 아니면 null
  function tempList(ids) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
      const request = net.request({ url: `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}`, redirect: 'manual' });
      const timer = setTimeout(() => { request.abort(); finish(null); }, TIMEOUT_MS);
      request.on('redirect', (_status, _method, location) => { request.abort(); finish(TEMP_LIST.test(location) ? location : null); });
      request.on('response', () => finish(null));
      request.on('error', () => finish(null));
      request.end();
    });
  }

  // ids: 등록순 영상 ID. 1개면 단일, 여러 개면 연속(listIds). 검증에 실패하면 아무것도 열지 않는다
  async function open(ids) {
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && VIDEO_ID.test(id))) {
      return { ok: false, reason: 'invalid' };
    }
    const unique = listIds(ids, random);
    let url = watchUrl(unique[0]), mode = 'single';
    if (unique.length > 1) {
      const location = await tempList(unique);
      if (location) { url = location; mode = 'list'; }
      else mode = 'fallback';
    }
    try {
      await openExternal(url);
      log?.('playlist_open', { requested: ids.length, opened: unique.length, mode });
      return { ok: true, mode };
    } catch (e) {
      log?.('playlist_open_failed', { requested: ids.length, mode });
      return { ok: false, reason: 'open_failed' };
    }
  }

  return { title, open };
}

module.exports = { createPlaylistLinks, listIds, VIDEO_ID, WATCH_VIDEOS_MAX };
