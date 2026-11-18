// 플레이리스트 공유(D-053, /플리) 입력 규칙과 문구. 저장·합치기는 사이드카(sidecar/playlist.py)가 로비 멤버 데이터 cattalk.pl로 하고,
// 제목 조회·외부 브라우저 재생은 Electron main(electron/playlist.js)이 한다. 렌더러는 영상 ID만 다룬다.

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const MAX_ENTRIES = 10;          // 사용자당 최대 곡 수(사용자 명세). 사이드카 playlist.MAX_ENTRIES와 같다
export const COMMAND_MAX_LEN = 500;     // '/플리' 명령은 채팅 50자 제한을 받지 않는다(사용자 명세). 대신 이 길이까지(사용자 결정)
export const CARD_MS = 5000;            // 추가 알림·랜덤 카드 유지 시간(사용자 명세·결정)

// 문구: 앞 다섯은 사용자 명세 그대로, 나머지는 사용자 결정(2026-11-18 권장안)
export const PL_ONLY_VIDEO = '단일 영상만 추가 가능';
export const PL_ONLY_YOUTUBE = '유튜브 링크만 추가 가능';
export const PL_FULL = '최대 10개';
export const PL_EXISTS = '이미 플리에 존재하는 url입니다';
export const PL_EMPTY = '등록된 곡이 없습니다';
export const PL_MINE_EMPTY = '내가 등록한 곡이 없습니다';
export const PL_USAGE = '사용법: /플리 추가 (링크) · 랜덤 · 목록 · 삭제';
export const PL_ADD_FAILED = '플리에 추가하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.';
export const PL_REMOVE_FAILED = '플리에서 삭제하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.';
export const PL_OPEN_FAILED = '브라우저에서 열지 못했습니다.';

// '/플리'로 시작하면 채팅이 아니라 명령(사이드카 playlist.COMMAND와 같은 규칙 — 이 모양은 채팅으로 보내지 않는다)
const PREFIX = /^\s*\/플리(?:\s|$)/;
export const isPlaylistCommand = (text: string) => PREFIX.test(text);

export type PlaylistCommand = { kind: 'add'; link: string } | { kind: 'random' } | { kind: 'list' } | { kind: 'delete' } | { kind: 'usage' };

// '/플리 추가 (링크)' · '/플리 랜덤' · '/플리 목록' · '/플리 삭제'. 그 밖(하위 명령 없음·모르는 명령·남는 글자)은 사용법 안내
export function parsePlaylistCommand(text: string): PlaylistCommand | null {
  if (!isPlaylistCommand(text)) return null;
  const rest = text.trim().slice('/플리'.length).trim();
  const space = rest.search(/\s/);
  const sub = space < 0 ? rest : rest.slice(0, space);
  const arg = space < 0 ? '' : rest.slice(space).trim();
  if (sub === '추가') return arg ? { kind: 'add', link: arg } : { kind: 'usage' };
  if (arg) return { kind: 'usage' };
  if (sub === '랜덤') return { kind: 'random' };
  if (sub === '목록') return { kind: 'list' };
  if (sub === '삭제') return { kind: 'delete' };
  return { kind: 'usage' };
}

export type LinkKind = { kind: 'video'; id: string } | { kind: 'not_video' } | { kind: 'not_youtube' };

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

// 단일 영상 링크만(사용자 명세): youtube.com/watch · youtu.be · m.youtube.com · /shorts/ · music.youtube.com/watch.
// 재생목록·앨범(list= 가 붙은 링크, /playlist, /browse/MPREb_…)과 그 밖의 유튜브 주소(채널 등)는 not_video, 유튜브가 아니면 not_youtube
export function classifyLink(raw: string): LinkKind {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { kind: 'not_youtube' };
  }
  const host = url.hostname.toLowerCase();
  const short = SHORT_HOSTS.has(host);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || (!short && !YOUTUBE_HOSTS.has(host))) return { kind: 'not_youtube' };
  if (url.searchParams.has('list') || /^\/(playlist|browse)(\/|$)/.test(url.pathname)) return { kind: 'not_video' };
  const parts = url.pathname.split('/').filter(Boolean);
  const id = short ? parts[0]
    : url.pathname === '/watch' ? url.searchParams.get('v')
    : parts[0] === 'shorts' && parts.length === 2 ? parts[1]
    : null;
  return id && VIDEO_ID.test(id) ? { kind: 'video', id } : { kind: 'not_video' };
}

// 제목을 아직 모르거나 찾지 못했을 때 보이는 짧은 링크(사용자 결정)
export const shortLink = (id: string) => `youtu.be/${id}`;

// 외부 브라우저로 연다(1개 = 단일, 여러 개 = 등록순 임시 재생목록). 브라우저 dev에는 main이 없어 새 탭으로 연다. 못 열면 false
export async function openVideos(ids: string[]): Promise<boolean> {
  const valid = ids.filter((id) => VIDEO_ID.test(id));
  if (valid.length === 0) return false;
  const shell = window.catTalk?.playlist;
  if (shell) {
    try { return (await shell.open(valid)).ok; } catch { return false; }
  }
  const url = valid.length === 1 ? `https://www.youtube.com/watch?v=${valid[0]}` : `https://www.youtube.com/watch_videos?video_ids=${valid.slice(0, 50).join(',')}`;
  return window.open(url, '_blank') !== null;
}
