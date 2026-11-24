import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export type Side = 'left' | 'right';
export type ChatHeight = '100%' | '70%' | '50%';

export interface Settings {
  theme: Theme;
  side: Side;
  height: ChatHeight;
  opacity: number;          // 20~100
  taskbarAlert: boolean;
  toastAlert: boolean;
  catInteraction: boolean;
  clearCats: boolean;
  presence: boolean;
  hideTaskbarIcon: boolean; // 토글 UI만, 동작 연결은 2e-2b
  autoOpenChest: boolean;   // true=켜기 활성. 켜기/끄기 버튼 UI만, 적용/복원 로직은 보류
  playWarn: boolean;        // 드로어 '플레이 > 경고'(기본 켜기). 끄면 내 화면의 노란 카드·공개수배 전단과 내 '@경고!' 입력만 멈춘다
  playPraise: boolean;      // 드로어 '플레이 > 칭찬'(1.0.8, 기본 켜기). 끄면 내 화면의 별 표시·칭찬 도장과 내 '@칭찬!' 입력만 멈춘다(경고와 독립)
  playEvent: boolean;       // 드로어 '플레이 > 이벤트 모션'(1.0.10, 기본 켜기). 끄면 트리거 문구가 와도 내 화면에 효과를 띄우지 않는다(chat/events.ts)
}

export type ReportKind = 'bug' | 'request';
// 플리(D-053) 모달: 로비 전체 목록([재생]·[연속재생]) / 내 곡 삭제
export type PlaylistMode = 'list' | 'delete';

export interface Overlays {
  collapsed: boolean;
  drawerOpen: boolean;
  modalOpen: boolean;
  searchOpen: boolean;
  nicknameFor: string | null;
  playlist: PlaylistMode | null;   // 플리 모달(D-053). 드로어·참여자 모달과 같은 자리에 뜨고 한 번에 하나만 열린다
  reportKind: ReportKind | null;   // 버그 신고·요청 사항 모달(D-050). 앱 가운데에 뜬다   // 닉네임 변경 모달 대상 참여자 id(D-032). 참여자 모달 위 앱 가운데에 뜬다
}

export interface UiState { settings: Settings; overlays: Overlays }

export type UiAction =
  | { type: 'setSettings'; patch: Partial<Settings> }
  | { type: 'toggleCollapsed' }
  | { type: 'expand' }
  | { type: 'toggleDrawer' }
  | { type: 'toggleModal' }
  | { type: 'closeOverlays' }
  | { type: 'toggleSearch' }
  | { type: 'openNickname'; id: string }
  | { type: 'closeNickname' }
  | { type: 'openPlaylist'; mode: PlaylistMode }
  | { type: 'openReport'; kind: ReportKind }
  | { type: 'closeReport' };

// 채팅 높이에 연동되는 값: 드로어·모달 최대 높이(--ovh), 반응 카드 최대 개수.
// 100%는 뒤 채팅이 보이게 70%로 캡, 창이 작은 70%·50%는 오버레이가 창 전체 높이를 채운다.
// 단 드로어는 100%에서도 캡 없이 대화 영역 전체까지 늘어난다(Drawer.module.css .tall) — 참여자 모달만 70%.
export const OVERLAY_HEIGHT: Record<ChatHeight, string> = { '100%': '70%', '70%': '100%', '50%': '100%' };
export const MAX_CARDS: Record<ChatHeight, number> = { '100%': 5, '70%': 4, '50%': 3 };

// Electron이면 메인이 디스크에서 읽은 창 설정으로 시작한다(기본값이 복원된 창을 덮어쓰지 않게).
const saved = window.catTalk?.initial;
const SAVED_HEIGHT: Record<number, ChatHeight> = { 100: '100%', 70: '70%', 50: '50%' };

const initialState: UiState = {
  settings: {
    theme: 'system', side: saved?.side ?? 'right', height: (saved && SAVED_HEIGHT[saved.heightPct]) ?? '100%', opacity: 100,
    taskbarAlert: true, toastAlert: true, catInteraction: true, clearCats: false, presence: true,
    hideTaskbarIcon: saved?.hideTaskbar ?? false, autoOpenChest: false, playWarn: true, playPraise: true, playEvent: true,
  },
  overlays: { collapsed: false, drawerOpen: false, modalOpen: false, searchOpen: false, nicknameFor: null, playlist: null, reportKind: null },
};

function reducer(state: UiState, action: UiAction): UiState {
  const o = state.overlays;
  switch (action.type) {
    case 'setSettings': return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'toggleCollapsed': return { ...state, overlays: { ...o, collapsed: !o.collapsed } };
    case 'expand': return o.collapsed ? { ...state, overlays: { ...o, collapsed: false } } : state;
    // 드로어·모달은 한쪽만 열린다. 열린 쪽 버튼을 다시 누르면 닫힘, 다른 쪽을 누르면 전환.
    case 'toggleDrawer': return { ...state, overlays: { ...o, drawerOpen: !o.drawerOpen, modalOpen: false, playlist: null } };
    case 'toggleModal': return { ...state, overlays: { ...o, modalOpen: !o.modalOpen, drawerOpen: false, playlist: null } };
    case 'closeOverlays': return { ...state, overlays: { ...o, drawerOpen: false, modalOpen: false, nicknameFor: null, playlist: null } };
    case 'openPlaylist': return { ...state, overlays: { ...o, playlist: action.mode, drawerOpen: false, modalOpen: false } };
    case 'toggleSearch': return { ...state, overlays: { ...o, searchOpen: !o.searchOpen } };
    // 닉네임 모달은 참여자 모달을 닫지 않고 그 위에 뜬다(저장 뒤 바뀐 이름을 목록에서 바로 본다)
    case 'openNickname': return { ...state, overlays: { ...o, nicknameFor: action.id } };
    case 'closeNickname': return { ...state, overlays: { ...o, nicknameFor: null } };
    case 'openReport': return { ...state, overlays: { ...o, reportKind: action.kind } };
    case 'closeReport': return { ...state, overlays: { ...o, reportKind: null } };
  }
}

const UiContext = createContext<(UiState & { dispatch: Dispatch<UiAction> }) | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // 시스템 테마는 속성을 제거해 prefers-color-scheme을 따르게 한다
  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.settings.theme);
  }, [state.settings.theme]);

  return <UiContext.Provider value={{ ...state, dispatch }}>{children}</UiContext.Provider>;
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}
