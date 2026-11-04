// view 응답(docs/ipc-contract.md §3)과 그것을 UI 값으로 바꾸는 순수 변환.
import type { Settings, Theme } from '../state/UiContext';

export type ConnState = 'good' | 'off' | 'nolobby' | 'checking';

export interface Participant {
  id: string;
  name: string;
  color: string;   // 아바타 배경
  hat: string;     // 고양이 모자(이모지 임시 표시). 없거나 실제 아이템 번호면 ''
  avatar?: string; // 실아바타 data URI(스킨+모자 합성 정지 PNG). 없으면 이모지 폴백
}

export interface ChatMessage {
  kind: 'msg';
  id: string;
  sender: string;  // participant id
  author: Participant;
  own: boolean;
  text: string;
  time: string;    // HH:MM
  status?: string; // 내 메시지 전송 상태
}

export interface PresenceItem {
  kind: 'presence';
  id: string;
  text: string;
}

export type ChatItem = ChatMessage | PresenceItem;

export interface ViewContext { account: string; lobby: string; generation: string }

export interface ViewProfile {
  name?: string;
  avatar_id?: string;   // 이미지는 avatars 액션으로 받는다
  color?: string;  // 목업 데이터 전용. 실제 view에는 없다
  hat?: string | number;   // 목업은 이모지 문자열, 실제 view는 게임 아이템 번호(벗으면 -1)라 표시하지 않는다
}

export interface ViewMessage {
  seq?: number;
  id: string;
  sender: string;
  name: string;
  body: string;
  received: number;   // epoch 초
  own: number;
  status: string;
  kind?: string;
  unsaved?: boolean;
}

export interface ViewReaction {
  id: string;
  sender: string;
  kind: 'meow' | 'emote';
  text?: string;
  expires_in_ms: number;
}

export interface UiSettings {
  chat_opacity: number;
  presence_notices: boolean;
  clear_cats: boolean;
  auto_open_chest: boolean;
}

export interface ViewResponse {
  context: ViewContext;
  state: string;
  notice: string;
  game_build: string;
  connected: boolean;
  lobby_verified: boolean;
  can_send: boolean;
  messages: ViewMessage[];
  profiles: Record<string, ViewProfile>;
  participants: Record<string, ViewProfile>;
  storage_error: boolean;
  revision: number;
  theme: Theme;
  notifications: { notification_flash: boolean; notification_toast: boolean };
  reactions_enabled: boolean;
  ui_settings?: UiSettings;   // 사이드카가 설정을 읽지 못한 회차에는 없다
  avatar_stage?: string;      // disabled·loading·ready·unavailable
  avatar_error?: string;
  reactions?: ViewReaction[];
}

// view에 색 정보가 없어 uid 해시로 목업 팔레트에서 고른다. 같은 uid는 항상 같은 색.
const PALETTE = ['#f2c0a0', '#ffe08a', '#b7e0ff', '#ffc2d1', '#d8c0ff', '#c8f0c8', '#cfd6ff', '#ffd27d', '#ffd0b0', '#ccffee', '#ffccdd'];

function paletteColor(uid: string) {
  let hash = 0;
  for (const c of uid) hash = (hash * 31 + c.charCodeAt(0)) % 2147483647;
  return PALETTE[hash % PALETTE.length];
}

export function toParticipant(uid: string, profile: ViewProfile | undefined, fallbackName: string): Participant {
  return { id: uid, name: profile?.name || fallbackName, color: profile?.color ?? paletteColor(uid), hat: typeof profile?.hat === 'string' ? profile.hat : '' };
}

// 목업 표기를 기준으로 하되, 목업에 없는 상태는 upstream 문구를 쓴다.
const STATUS_LABEL: Record<string, string> = {
  pending: '전송 중…',
  accepted: '전송됨',
  failed: '전송 실패',
  unknown: '전송 결과 확인 불가 · 자동 재전송 안 함',
};
const UNSAVED_LABEL = '이 기록은 저장되지 않았어요';

function clock(received: number) {
  const d = new Date(received * 1000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function toChatItems(view: ViewResponse): ChatItem[] {
  return view.messages.map((m): ChatItem => {
    if (m.kind === 'member_joined' || m.kind === 'member_left') {
      const name = m.name || '이름 확인 중';
      return { kind: 'presence', id: m.id, text: `${name}님이 ${m.kind === 'member_joined' ? '들어왔습니다.' : '나갔습니다.'}` };
    }
    const own = Boolean(m.own);
    return {
      kind: 'msg', id: m.id, sender: m.sender, own, text: m.body, time: clock(m.received),
      // 나간 참여자는 profiles에 없어도 메시지에 남은 이름으로 표시한다
      author: toParticipant(m.sender, view.profiles[m.sender], m.name || (own ? '나' : '이름 확인 중')),
      status: m.unsaved ? UNSAVED_LABEL : STATUS_LABEL[m.status],
    };
  });
}

export function connState(view: ViewResponse | null): ConnState {
  if (!view || view.state === 'checking' || view.notice === 'checking') return 'checking';
  if (view.connected && view.lobby_verified) return 'good';
  // 게임은 잡혔는데 로비에 없으면 worker는 connected=false로 no_lobby를 보낸다(실게임 실측)
  return view.connected || view.state === 'no_lobby' ? 'nolobby' : 'off';
}

export function accountStatus(view: ViewResponse | null) {
  if (!view?.connected) return '연결 확인 중';
  return view.lobby_verified ? 'Bongo Cat 연결됨' : 'Steam 연결됨 · 로비 확인 중';
}

// UI 설정 ↔ 사이드카 setting 키. 창 배치(side·height·hideTaskbarIcon)는 window-state.json이 맡아 여기 없다.
export const SETTING_KEYS: Partial<Record<keyof Settings, string>> = {
  theme: 'theme',
  opacity: 'chat_opacity',
  taskbarAlert: 'notification_flash',
  toastAlert: 'notification_toast',
  catInteraction: 'reactions_enabled',
  presence: 'presence_notices',
  clearCats: 'clear_cats',
  autoOpenChest: 'auto_open_chest',
};

export function settingsFromView(view: ViewResponse): Partial<Settings> {
  const ui = view.ui_settings;
  return {
    theme: view.theme,
    taskbarAlert: view.notifications.notification_flash,
    toastAlert: view.notifications.notification_toast,
    catInteraction: view.reactions_enabled,
    ...(ui && { opacity: ui.chat_opacity, presence: ui.presence_notices, clearCats: ui.clear_cats, autoOpenChest: ui.auto_open_chest }),
  };
}
