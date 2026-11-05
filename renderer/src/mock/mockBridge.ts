// 브리지 없는 브라우저 dev(npm run dev)용 사이드카 대역. 메모리에서만 동작하고 어디에도 송신하지 않는다.
import type { UiSettings, ViewResponse } from '../chat/model';
import type { Theme } from '../state/UiContext';
import { INITIAL_MESSAGES, ME_ID, PROFILES } from './mockData';

const SEND_ACK_MS = 700;   // 목업의 '전송 중…' → '전송됨' 시뮬레이션

const messages = [...INITIAL_MESSAGES];
let nextSeq = messages.length + 1;
let revision = 1;
let theme: Theme = 'system';
const notifications = { notification_flash: true, notification_toast: true };
let reactionsEnabled = true;
const uiSettings: UiSettings = { chat_opacity: 100, presence_notices: true, clear_cats: false, auto_open_chest: false, taskbar_flash: true };

const CONTEXT = { account: ME_ID, lobby: 'mock-lobby', generation: 'mock' };

function view(query: string): ViewResponse {
  const needle = query.toLowerCase();
  return {
    context: CONTEXT, state: 'ready', notice: '', game_build: '',
    connected: true, lobby_verified: true, can_send: true, storage_error: false, revision,
    messages: needle ? messages.filter((m) => !m.kind && m.body.toLowerCase().includes(needle)) : messages.map((m) => ({ ...m })),
    profiles: PROFILES, participants: PROFILES,
    theme, notifications: { ...notifications }, reactions_enabled: reactionsEnabled, ui_settings: { ...uiSettings }, reactions: [],
  };
}

function send(text: string) {
  const seq = nextSeq++;
  const row = { seq, id: 'local-' + seq, sender: ME_ID, name: PROFILES[ME_ID].name ?? '', body: text, received: Date.now() / 1000, own: 1, status: 'pending' };
  messages.push(row);
  revision++;
  window.setTimeout(() => { row.status = 'accepted'; revision++; }, SEND_ACK_MS);
  return { id: row.id };
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
    case 'view': return view((args.query as string | undefined) ?? '');
    case 'send': return send(args.text as string);
    case 'setting': return setting(args.key as string, args.value);
    case 'refresh': return { ok: true };
    case 'open_steam_profile': return { ok: true };
    default: return { error: 'not_wired' };
  }
}

export const mockBridge = {
  async request(payload: string) {
    return JSON.stringify(dispatch(JSON.parse(payload)));
  },
};
