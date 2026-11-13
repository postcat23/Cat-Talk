import { useCallback, useEffect, type CSSProperties } from 'react';
import { MAX_CARDS, OVERLAY_HEIGHT, UiProvider, useUi, type ChatHeight } from './state/UiContext';
import { useReactionStack } from './hooks/useReactionStack';
import { useClickThrough } from './hooks/useClickThrough';
import { useMessageAlerts } from './hooks/useMessageAlerts';
import { ChatContext, useChatView } from './hooks/useChatView';
import { AutoChestContext, useAutoChest } from './hooks/useAutoChest';
import { AppUpdateContext, useAppUpdate } from './hooks/useAppUpdate';
import type { Feature } from './chat/autoChest';
import CollapseTab from './components/CollapseTab';
import TopBar from './components/TopBar';
import SearchBar from './components/SearchBar';
import Conversation from './components/Conversation';
import Composer from './components/Composer';
import NicknameModal from './components/NicknameModal';

const HEIGHT_PCT: Record<ChatHeight, 100 | 70 | 50> = { '100%': 100, '70%': 70, '50%': 50 };

function Panel() {
  const { settings, overlays, dispatch } = useUi();
  const reactions = useReactionStack(MAX_CARDS[settings.height], settings.catInteraction);
  const chat = useChatView(reactions.push, settings.catInteraction);
  const { saveSettings } = chat;
  const chestOff = useCallback((features: Feature[]) => {
    const patch = { ...(features.includes('chest') && { autoOpenChest: false }), ...(features.includes('transparent') && { clearCats: false }) };
    dispatch({ type: 'setSettings', patch });
    saveSettings(patch);
  }, [dispatch, saveSettings]);
  const chest = useAutoChest(settings.autoOpenChest, settings.clearCats, chestOff);
  const update = useAppUpdate();

  // 도크 위치·채팅 높이·작업표시줄: Electron이면 창(BrowserWindow)이 맡고, 브라우저 dev면 패널 CSS로 시뮬레이션.
  // 패널·탭이 어느 쪽에 오는지는 두 모드 모두 data-side가 정한다. --ovh·반응 카드 최대 수는 설정값 기준 공통.
  const shell = window.catTalk;
  useEffect(() => { shell?.setDockSide(settings.side); }, [shell, settings.side]);
  useEffect(() => { shell?.setChatHeight(HEIGHT_PCT[settings.height]); }, [shell, settings.height]);
  useEffect(() => { shell?.setSkipTaskbar(settings.hideTaskbarIcon); }, [shell, settings.hideTaskbarIcon]);
  useEffect(() => shell?.onExpand(() => dispatch({ type: 'expand' })), [shell, dispatch]);
  useClickThrough();
  useMessageAlerts(chat.incoming, overlays.collapsed, settings.toastAlert, settings.taskbarAlert);

  const style = {
    height: shell ? undefined : settings.height,
    '--ovh': OVERLAY_HEIGHT[settings.height],
  } as CSSProperties;

  return (
    <ChatContext.Provider value={chat}>
      <AutoChestContext.Provider value={chest}>
      <AppUpdateContext.Provider value={update}>
        <section className={overlays.collapsed ? 'panel collapsed' : 'panel'} data-side={settings.side} style={style}>
          <CollapseTab />
          {/* 채팅 투명도는 창(setOpacity)이 아니라 본체 CSS opacity. 투명 창 위에서 데스크톱이 비친다 */}
          <div className="panel-body" style={{ opacity: settings.opacity / 100 }}>
            <TopBar />
            <SearchBar />
            <Conversation reactions={reactions} />
            {/* 창이 작은 70%·50%에서 오버레이를 열면 입력창을 숨겨 오버레이(--ovh 100%)가 창 전체를 덮게 한다 */}
            <Composer disabled={!chat.canSend} hidden={settings.height !== '100%' && (overlays.drawerOpen || overlays.modalOpen)}
              restored={chat.restoredDraft} cooldown={chat.cooldown} onSend={chat.send} onDraft={chat.saveDraft} />
          </div>
          {/* 닉네임 변경(D-032): 패널 전체 기준 가운데. 대화 영역 오버레이와 달리 상단바·입력창까지 덮는다 */}
          <NicknameModal />
        </section>
      </AppUpdateContext.Provider>
      </AutoChestContext.Provider>
    </ChatContext.Provider>
  );
}

export default function App() {
  return (
    <UiProvider>
      <Panel />
    </UiProvider>
  );
}
