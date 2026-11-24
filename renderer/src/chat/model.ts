// view 응답(docs/ipc-contract.md §3)과 그것을 UI 값으로 바꾸는 순수 변환.
import type { Settings, Theme } from '../state/UiContext';

export type ConnState = 'good' | 'off' | 'nolobby' | 'checking';

export interface Participant {
  id: string;
  name: string;    // 표시 이름: 닉네임 덮어쓰기(D-032)가 있으면 그 값, 없으면 base
  base: string;    // 원본 Steam 이름. 닉네임 모달 placeholder
  color: string;   // 아바타 배경
  avatar?: string; // 실아바타 data URI(스킨+모자 합성 정지 PNG). 없으면 실루엣 폴백(Cat)
  warns: number;   // 경고 총횟수(D-052, 로비 Cat Talk 사용자들이 준 경고 합). 이름 뒤 옐로카드 + 숫자
  praises: number; // 칭찬 총횟수(1.0.8, 경고의 거울). 이름 뒤 별 + 숫자
}

export interface ChatMessage {
  kind: 'msg';
  id: string;
  seq?: number;    // 저장되지 않은 메시지에는 없다
  sender: string;  // participant id
  author: Participant;
  own: boolean;
  text: string;
  time: string;    // HH:MM
  status?: string; // 내 메시지 전송 상태(화면 문구)
  // ↻ 재전송 대상: 내 메시지이고 상태 코드가 failed인 저장된 행. unknown(결과 불명)은 실제로 나갔을 수 있어 제외하고,
  // 미저장 행(저장 실패로 보내지 않음 — 글이 입력창에 남는다)도 제외한다
  resendable?: boolean;
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
  hat?: number;   // 게임 아이템 번호(벗으면 -1). 렌더러는 쓰지 않는다(모자는 실아바타 합성 이미지에 포함)
  blocked?: boolean;       // participants 항목에만: 앱에서 차단한 멤버(D-033). 목록·참여자 수에서 숨긴다
}

// 발동 이벤트(공개수배 D-052·칭찬 도장 1.0.8). id = 로비:대상:발동 시각(칭찬은 앞에 'praise:' — 같은 발동은 한 번).
// at = 렌더러가 받은 시각(Date.now) — 화면이 가려져 보류할 때 기한 판정용. 같은 대상의 발동이 더 와서 하나로 묶이면 at은 가장 최근에 받은 시각
export interface WantedEvent { id: string; target: string; at?: number }
// 처리 결과(진단 로그 wanted_display·praised_display, 결과 코드만): 끝까지 재생 / 같은 대상과 묶여 생략 / 플레이 > 경고(칭찬) 꺼짐 /
// 가려진 채 1분 지남 / 대상이 목록에 없음
export type WantedResult = 'shown' | 'coalesce' | 'off' | 'expired' | 'absent';

export interface BlockedUser { steam_id: string; name: string }   // 차단 시점의 Steam 이름(모르면 '')

// 플리 공유(D-053). 항목 = 영상 ID·넣은 사람·추가한 Steam 서버 시각. 추가 알림 id = 로비:사람:영상:시각(한 번만 온다)
export interface PlaylistEntry { id: string; by: string; t: number }
export interface PlaylistAdded { id: string; video: string; by: string }

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

export interface LastSpeaker { id: string; sender: string; name: string; own: boolean }

export interface ViewReaction {
  id: string;
  sender: string;
  kind: 'meow' | 'emote';
  text?: string;     // meow 문구
  avatar?: string;   // 발신자 정지 PNG data URI(반응 시점 외형). 반응은 1회만 실려 id로 바꾸지 않는다
  image?: string;    // emote 이미지 PNG data URI
  expires_in_ms: number;
}

export interface UiSettings {
  chat_opacity: number;
  presence_notices: boolean;
  clear_cats: boolean;
  auto_open_chest: boolean;
  play_warn: boolean;   // 드로어 '플레이 > 경고'
  play_praise?: boolean;   // 드로어 '플레이 > 칭찬'(1.0.8). 이전 사이드카에는 없다
  play_event?: boolean;    // 드로어 '플레이 > 이벤트 모션'(1.0.10). 이전 사이드카에는 없다
}

export interface ViewResponse {
  context: ViewContext;
  state: string;
  notice: string;
  game_build: string;
  connected: boolean;
  lobby_verified: boolean;
  can_send: boolean;
  // 1.0.8 티어. 이전 사이드카에는 없다(없으면 can_send·[]로 본다)
  can_command?: boolean;   // 로비 확인됨 — Cat Talk 명령(경고·칭찬·플리, T0) 가능. 채팅 송신(can_send)과 별개
  degraded?: string[];     // 멈춘 게이트: 'chat_send'(T1) · 'avatars'(T2)
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
  default_avatar_id?: string; // 게임 기본 고양이. 아바타 미해결·스킨 변경 중 플레이스홀더(사이드카 경로만)
  reactions?: ViewReaction[];
  draft?: string;             // 현재 로비의 저장된 초안
  has_more: boolean;          // 응답 창보다 과거가 더 있다
  has_newer: boolean;         // 응답 창보다 최신이 더 있다
  latest_seq: number;
  incoming_count?: number;    // 수락된 타인 메시지 누적 수(사이드카 경로만)
  // 플로팅 아바타(1.0.10): 대화 목록에 보이는 마지막 채팅(입퇴장 제외)의 발화자, 본인 포함. 검색·HISTORY와 무관하게 매번 온다.
  // name = 그 메시지에 남은 이름(나간 사람 표시용). 대화가 없으면 null, 이전 사이드카에는 없다
  last_speaker?: LastSpeaker | null;
  nicknames: Record<string, string>;   // 현재 계정의 표시 이름 덮어쓰기(steam_id → 이름, D-032). 사이드카가 항상 {} 이상 보낸다
  blocks_ready: boolean;               // 차단 목록을 읽었는지. false면 업스트림이 상대 대화를 보류한다(D-033)
  blocked_users: BlockedUser[];        // 앱 차단 목록(steam_id 순)
  // 경고·공개수배(D-052, Cat-Talk 사이드카). warns = 대상별 경고 총횟수(0 제외), wanted = 새로 생긴 공개수배(한 번만 온다),
  // warn_failed = 지난 view 뒤 실패한 경고 쓰기 수. 사이드카가 못 읽은 회차·검색 응답에는 없을 수 있다
  warns?: Record<string, number>;
  wanted?: WantedEvent[];
  warn_failed?: number;
  // 칭찬(1.0.8, 경고의 거울). praises = 대상별 칭찬 총횟수(0 제외), praised = 새로 생긴 칭찬 도장 발동(한 번만 온다),
  // praise_failed = 지난 view 뒤 실패한 칭찬 쓰기 수
  praises?: Record<string, number>;
  praised?: WantedEvent[];
  praise_failed?: number;
  // 플리 공유(D-053, Cat-Talk 사이드카). playlist = 보이는 멤버(차단 제외) 곡의 합집합(등록순), playlist_mine = 내 곡(내가 넣은 순),
  // playlist_added = 새 추가 알림, playlist_failed = 지난 view 뒤 실패한 쓰기의 오류 코드(둘 다 검색이 아닐 때 한 번만 온다)
  playlist?: PlaylistEntry[];
  playlist_mine?: string[];
  playlist_added?: PlaylistAdded[];
  playlist_failed?: string[];
}

// 표시 이름: 닉네임 덮어쓰기가 있으면 그 값, 없거나 비었으면 base(Steam 이름)
export const displayName = (uid: string, base: string, nicks?: Record<string, string>) => nicks?.[uid]?.trim() || base;

// view에 색 정보가 없어 uid 해시로 목업 팔레트에서 고른다. 같은 uid는 항상 같은 색.
const PALETTE = ['#f2c0a0', '#ffe08a', '#b7e0ff', '#ffc2d1', '#d8c0ff', '#c8f0c8', '#cfd6ff', '#ffd27d', '#ffd0b0', '#ccffee', '#ffccdd'];

function paletteColor(uid: string) {
  let hash = 0;
  for (const c of uid) hash = (hash * 31 + c.charCodeAt(0)) % 2147483647;
  return PALETTE[hash % PALETTE.length];
}

// avatar_id → 받아 둔 data URI. 아직 없거나 아바타가 준비 전이면 undefined(실루엣 폴백)
export type AvatarLookup = (avatarId: string | undefined) => string | undefined;

// 보낸 사람 → 마지막으로 본 avatar_id(렌더러가 기억, useChatView). view.profiles에는 지금 로비 멤버만 온다(worker·service가
// 멤버로 거른다) — 나간 사람의 지난 메시지·플로팅 아바타는 이것으로 스킨을 유지한다
export type AuthorAvatars = Record<string, string>;

// 메시지 작성자의 프로필: view에 있으면 그것, 없으면(나간 사람) 기억해 둔 avatar_id만. 이름은 채우지 않는다 — 나간 사람은 지금처럼
// 메시지에 남은 이름으로 표시한다
export function authorProfile(view: ViewResponse, uid: string, remembered?: AuthorAvatars): ViewProfile | undefined {
  const avatarId = remembered?.[uid];
  return view.profiles[uid] ?? (avatarId ? { avatar_id: avatarId } : undefined);
}

export function toParticipant(uid: string, profile: ViewProfile | undefined, fallbackName: string, avatarOf?: AvatarLookup,
  nicks?: Record<string, string>, warns?: Record<string, number>, praises?: Record<string, number>): Participant {
  const base = profile?.name || fallbackName;
  return {
    id: uid, name: displayName(uid, base, nicks), base, color: profile?.color ?? paletteColor(uid),
    avatar: avatarOf?.(profile?.avatar_id),
    warns: warns?.[uid] ?? 0,
    praises: praises?.[uid] ?? 0,
  };
}

// 목업 표기를 기준으로 하되, 목업에 없는 상태는 upstream 문구를 쓴다.
const STATUS_LABEL: Record<string, string> = {
  pending: '전송 중…',
  accepted: '전송됨',
  failed: '전송 실패',
  unknown: '전송 결과를 알 수 없습니다',
};
const UNSAVED_LABEL = '이 기록은 저장되지 않았습니다';

function clock(received: number) {
  const d = new Date(received * 1000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export const isPresence = (m: ViewMessage) => m.kind === 'member_joined' || m.kind === 'member_left';

export function toChatItems(view: ViewResponse, avatarOf?: AvatarLookup, remembered?: AuthorAvatars): ChatItem[] {
  return view.messages.map((m): ChatItem => {
    if (isPresence(m)) {
      const name = displayName(m.sender, m.name || '이름 확인 중', view.nicknames);
      return { kind: 'presence', id: m.id, text: `${name}님이 ${m.kind === 'member_joined' ? '들어왔습니다.' : '나갔습니다.'}` };
    }
    const own = Boolean(m.own);
    return {
      kind: 'msg', id: m.id, seq: m.seq, sender: m.sender, own, text: m.body, time: clock(m.received),
      // 나간 참여자는 profiles에 없어도 메시지에 남은 이름으로, 아바타는 기억해 둔 스킨으로 표시한다
      author: toParticipant(m.sender, authorProfile(view, m.sender, remembered), m.name || (own ? '나' : '이름 확인 중'), avatarOf,
        view.nicknames, view.warns, view.praises),
      status: m.unsaved ? UNSAVED_LABEL : STATUS_LABEL[m.status],
      resendable: own && m.status === 'failed' && !m.unsaved,
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
  playWarn: 'play_warn',
  playPraise: 'play_praise',
  playEvent: 'play_event',
};

export function settingsFromView(view: ViewResponse): Partial<Settings> {
  const ui = view.ui_settings;
  return {
    theme: view.theme,
    taskbarAlert: view.notifications.notification_flash,
    toastAlert: view.notifications.notification_toast,
    catInteraction: view.reactions_enabled,
    ...(ui && { opacity: ui.chat_opacity, presence: ui.presence_notices, clearCats: ui.clear_cats, autoOpenChest: ui.auto_open_chest,
      playWarn: ui.play_warn, ...(typeof ui.play_praise === 'boolean' && { playPraise: ui.play_praise }),
      ...(typeof ui.play_event === 'boolean' && { playEvent: ui.play_event }) }),
  };
}
