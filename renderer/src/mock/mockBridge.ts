// 브리지 없는 브라우저 dev(npm run dev)용 사이드카 대역. 메모리에서만 동작하고 어디에도 송신하지 않는다.
import type { UiSettings, ViewResponse } from '../chat/model';
import type { Theme } from '../state/UiContext';
import { INITIAL_MESSAGES, INITIAL_NICKNAMES, ME_ID, PROFILES } from './mockData';

const SEND_ACK_MS = 700;   // 목업의 '전송 중…' → '전송됨' 시뮬레이션

const messages = [...INITIAL_MESSAGES];
let nextSeq = messages.length + 1;
let revision = 1;
let theme: Theme = 'system';
const notifications = { notification_flash: true, notification_toast: true };
let reactionsEnabled = true;
const uiSettings: UiSettings = { chat_opacity: 100, presence_notices: true, clear_cats: false, auto_open_chest: false };
const drafts = new Map<string, string>();
const nicknames: Record<string, string> = { ...INITIAL_NICKNAMES };
const blocked: Record<string, string> = {};   // 앱 차단(D-033): id → 차단 시점 이름
const NICKNAME_MAX = 15;   // 사이드카와 같은 상한(코드 포인트)

const CONTEXT = { account: ME_ID, lobby: 'mock-lobby', generation: 'mock' };

interface ViewArgs { query?: string; before?: number; start?: number; limit?: number }

// store.message_page와 같은 경계: before는 seq 미만 최신순, start는 seq 이상 오름차순, 둘 다 없으면 최신 limit개
function view({ query = '', before, start, limit = 100 }: ViewArgs): ViewResponse {
  const needle = query.toLowerCase();
  // 업스트림처럼 차단한 사람의 지난 메시지·입퇴장도 view에서 뺀다(D-033)
  const visible = messages.filter((m) => !(m.sender in blocked));
  const matching = needle ? visible.filter((m) => !m.kind && m.body.toLowerCase().includes(needle)) : visible;
  const bounded = matching.filter((m) => (before === undefined || m.seq! < before) && (start === undefined || m.seq! >= start));
  const rows = start === undefined ? bounded.slice(-limit) : bounded.slice(0, limit);
  const first = rows[0]?.seq ?? start, last = rows.at(-1)?.seq ?? before;
  return {
    context: CONTEXT, state: 'ready', notice: '', game_build: '',
    connected: true, lobby_verified: true, can_send: true, storage_error: false, revision,
    messages: rows.map((m) => ({ ...m })),
    has_more: first !== undefined && matching.some((m) => m.seq! < first),
    has_newer: last !== undefined && matching.some((m) => m.seq! > last),
    latest_seq: messages.at(-1)?.seq ?? 0,
    profiles: PROFILES,
    participants: Object.fromEntries(Object.entries(PROFILES).map(([id, p]) => [id, { ...p, blocked: id in blocked }])),
    blocks_ready: true,
    blocked_users: Object.keys(blocked).sort().map((steam_id) => ({ steam_id, name: blocked[steam_id] })),
    theme, notifications: { ...notifications }, reactions_enabled: reactionsEnabled, ui_settings: { ...uiSettings }, reactions: [],
    draft: drafts.get(CONTEXT.lobby) ?? '',
    nicknames: { ...nicknames },
  };
}

// 사이드카 set_nickname 대역(D-032). 목업 id(p1…)는 Steam ID가 아니어서 uint64 검증 대신 PROFILES에 있는지만 본다.
// 에러는 사이드카가 렌더러에 주는 코드와 맞춘다(account_changed·invalid_nickname은 request_failed로 접힘).
function setNickname({ account, steam_id: uid, name }: Record<string, unknown>) {
  if (account !== CONTEXT.account) return { error: 'request_failed' };
  if (typeof uid !== 'string' || !(uid in PROFILES)) return { error: 'invalid_steam_id' };
  if (typeof name !== 'string' || [...name.trim()].length > NICKNAME_MAX) return { error: 'request_failed' };
  if (name.trim()) nicknames[uid] = name.trim();
  else delete nicknames[uid];
  return { ok: true };
}

// 사이드카 block_user 대역(D-033): 업스트림 set_blocked처럼 현재 계정·bool·자기 자신 제외를 검사한다(아니면 block_unavailable).
// 이미 차단돼 있으면 처음 이름을 유지한다
function setBlocked({ account, steam_id: uid, blocked: on }: Record<string, unknown>) {
  if (account !== CONTEXT.account || typeof on !== 'boolean' || typeof uid !== 'string' || !(uid in PROFILES) || uid === ME_ID) {
    return { error: 'block_unavailable' };
  }
  if (!on) delete blocked[uid];
  else if (!(uid in blocked)) blocked[uid] = PROFILES[uid].name ?? '';
  return { ok: true };
}

// worker(업스트림)의 1초 규칙 대역: 직전 전송 시도 후 1.0초 안이면 Steam에 보내지 않고 failed. 실패는 시도로 세지 않는다
const WORKER_SEND_GAP_MS = 1000;
let lastAttempt = -Infinity;

function send(text: string) {
  const seq = nextSeq++;
  const row = { seq, id: 'local-' + seq, sender: ME_ID, name: PROFILES[ME_ID].name ?? '', body: text, received: Date.now() / 1000, own: 1, status: 'pending' };
  messages.push(row);
  revision++;
  const now = performance.now();
  const accepted = now - lastAttempt >= WORKER_SEND_GAP_MS;
  if (accepted) lastAttempt = now;
  window.setTimeout(() => { row.status = accepted ? 'accepted' : 'failed'; revision++; }, SEND_ACK_MS);
  return { id: row.id };
}

// 사이드카 resend 대역: 내 전송 실패 행만 지우고 같은 원문으로 다시 보낸다(새 행은 맨 아래). 아니면 resend_unavailable
function resend({ id }: Record<string, unknown>) {
  const index = messages.findIndex((m) => m.id === id && m.own === 1 && m.status === 'failed');
  if (index < 0) return { error: 'resend_unavailable' };
  const [old] = messages.splice(index, 1);
  return send(old.body);
}

function setting(key: string, value: unknown) {
  if (key === 'theme') theme = value as Theme;
  else if (key === 'reactions_enabled') reactionsEnabled = value as boolean;
  else if (key in notifications) notifications[key as keyof typeof notifications] = value as boolean;
  else if (key in uiSettings) Object.assign(uiSettings, { [key]: value });
  return { ok: true };
}

function dispatch(args: Record<string, unknown>) {
  switch (args.action) {
    case 'view': return view(args as ViewArgs);
    case 'send': return send(args.text as string);
    case 'resend': return resend(args);
    case 'setting': return setting(args.key as string, args.value);
    case 'draft': drafts.set(args.lobby as string, args.text as string); return { ok: true };
    case 'refresh': return { ok: true };
    case 'open_steam_profile': return { ok: true };
    case 'open_steam_trade': return { ok: true };
    case 'set_nickname': return setNickname(args);
    case 'block_user': return setBlocked(args);
    default: return { error: 'not_wired' };
  }
}

export const mockBridge = {
  async request(payload: string) {
    return JSON.stringify(dispatch(JSON.parse(payload)));
  },
};
