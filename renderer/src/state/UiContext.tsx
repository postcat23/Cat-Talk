import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export type Side = 'left' | 'right';
export type ChatHeight = '100%' | '70%' | '50%';

export interface Settings {
  theme: Theme;
  side: Side;
  height: ChatHeight;
  opacity: number;          // 20~100
  taskbarAlert: boolean;    // 토글 UI만, 동작 연결은 후속
  toastAlert: boolean;      // 토글 UI만, 동작 연결은 후속
  catInteraction: boolean;
  clearCats: boolean;
  presence: boolean;
  hideTaskbarIcon: boolean; // 토글 UI만, 동작 연결은 2e-2b
  autoOpenChest: boolean;   // true=켜기 활성. 켜기/끄기 버튼 UI만, 적용/복원 로직은 보류
}

export interface Overlays {
  collapsed: boolean;
  drawerOpen: boolean;
  modalOpen: boolean;
  searchOpen: boolean;
}

export interface UiState { settings: Settings; overlays: Overlays }

export type UiAction =
  | { type: 'setSettings'; patch: Partial<Settings> }
  | { type: 'toggleCollapsed' }
  | { type: 'expand' }
  | { type: 'toggleDrawer' }
  | { type: 'toggleModal' }
  | { type: 'closeOverlays' }
  | { type: 'toggleSearch' };

// 채팅 높이에 연동되는 값: 드로어·모달 최대 높이(--ovh), 반응 카드 최대 개수
export const OVERLAY_HEIGHT: Record<ChatHeight, string> = { '100%': '70%', '70%': '50%', '50%': '50%' };
export const MAX_CARDS: Record<ChatHeight, number> = { '100%': 5, '70%': 4, '50%': 3 };

// Electron이면 메인이 디스크에서 읽은 창 설정으로 시작한다(기본값이 복원된 창을 덮어쓰지 않게).
const saved = window.catTalk?.initial;
const SAVED_HEIGHT: Record<number, ChatHeight> = { 100: '100%', 70: '70%', 50: '50%' };

const initialState: UiState = {
  settings: {
    theme: 'system', side: saved?.side ?? 'right', height: (saved && SAVED_HEIGHT[saved.heightPct]) ?? '100%', opacity: 100,
    taskbarAlert: true, toastAlert: true, catInteraction: true, clearCats: false, presence: true,
    hideTaskbarIcon: saved?.hideTaskbar ?? false, autoOpenChest: false,
  },
  overlays: { collapsed: false, drawerOpen: false, modalOpen: false, searchOpen: false },
};

function reducer(state: UiState, action: UiAction): UiState {
  const o = state.overlays;
  switch (action.type) {
    case 'setSettings': return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'toggleCollapsed': return { ...state, overlays: { ...o, collapsed: !o.collapsed } };
    case 'expand': return o.collapsed ? { ...state, overlays: { ...o, collapsed: false } } : state;
    // 드로어·모달은 한쪽만 열린다. 열린 쪽 버튼을 다시 누르면 닫힘, 다른 쪽을 누르면 전환.
    case 'toggleDrawer': return { ...state, overlays: { ...o, drawerOpen: !o.drawerOpen, modalOpen: false } };
    case 'toggleModal': return { ...state, overlays: { ...o, modalOpen: !o.modalOpen, drawerOpen: false } };
    case 'closeOverlays': return { ...state, overlays: { ...o, drawerOpen: false, modalOpen: false } };
    case 'toggleSearch': return { ...state, overlays: { ...o, searchOpen: !o.searchOpen } };
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
