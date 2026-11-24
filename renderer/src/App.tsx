import { useCallback, useEffect, type CSSProperties } from 'react';
import { MAX_CARDS, OVERLAY_HEIGHT, UiProvider, useUi, type ChatHeight } from './state/UiContext';
import { useReactionStack } from './hooks/useReactionStack';
import { useClickThrough } from './hooks/useClickThrough';
import { useMessageAlerts } from './hooks/useMessageAlerts';
import { ChatContext, useChatView } from './hooks/useChatView';
import { AutoChestContext, useAutoChest } from './hooks/useAutoChest';
import { AppUpdateContext, useAppUpdate } from './hooks/useAppUpdate';
import { usePlaylistCommand } from './hooks/usePlaylistCommand';
import type { Feature } from './chat/autoChest';
import { mentionEnabled } from './chat/play';
import CollapseTab from './components/CollapseTab';
import TopBar from './components/TopBar';
import SearchBar from './components/SearchBar';
import Conversation from './components/Conversation';
import Composer from './components/Composer';
import NicknameModal from './components/NicknameModal';
import ReportModal from './components/ReportModal';
import FloatingAvatar from './components/FloatingAvatar';

const HEIGHT_PCT: Record<ChatHeight, 100 | 70 | 50> = { '100%': 100, '70%': 70, '50%': 50 };

function Panel() {
  const { settings, overlays, dispatch } = useUi();
  const reactions = useReactionStack(MAX_CARDS[settings.height], settings.catInteraction);
  const chat = useChatView(reactions.push, settings.catInteraction, settings.playWarn, settings.playPraise);
  const { saveSettings } = chat;
  const chestOff = useCallback((features: Feature[]) => {
    const patch = { ...(features.includes('chest') && { autoOpenChest: false }), ...(features.includes('transparent') && { clearCats: false }) };
    dispatch({ type: 'setSettings', patch });
    saveSettings(patch);
  }, [dispatch, saveSettings]);
  const chest = useAutoChest(settings.autoOpenChest, settings.clearCats, chestOff);
  const update = useAppUpdate();
  const playlistCommand = usePlaylistCommand(chat, dispatch);   // '/플리 …' 입력(D-053)

  // 도크 위치·채팅 높이·작업표시줄: Electron이면 창(BrowserWindow)이 맡고, 브라우저 dev면 패널 CSS로 시뮬레이션.
  // 패널·탭이 어느 쪽에 오는지는 두 모드 모두 data-side가 정한다. --ovh·반응 카드 최대 수는 설정값 기준 공통.
  const shell = window.catTalk;
  useEffect(() => { shell?.setDockSide(settings.side); }, [shell, settings.side]);
  useEffect(() => { shell?.setChatHeight(HEIGHT_PCT[settings.height]); }, [shell, settings.height]);
  useEffect(() => { shell?.setSkipTaskbar(settings.hideTaskbarIcon); }, [shell, settings.hideTaskbarIcon]);
  useEffect(() => { shell?.floating.setEnabled(settings.floatingAvatar); }, [shell, settings.floatingAvatar]);   // 켜짐 저장(창은 FloatingAvatar가 연다)
  useEffect(() => shell?.onExpand(() => dispatch({ type: 'expand' })), [shell, dispatch]);
  useClickThrough();
  const unread = useMessageAlerts(chat.incoming, overlays.collapsed, settings.toastAlert, settings.taskbarAlert);

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
            {/* 창이 작은 70%·50%에서 오버레이를 열면 입력창을 숨겨 오버레이(--ovh 100%)가 창 전체를 덮게 한다.
                입력창은 로비가 확인되면 연다(canCommand, 1.0.8): 채팅 송신이 멈춰도 경고·칭찬·플리 명령은 쓸 수 있고, 일반 글은 send가 안내한다 */}
            <Composer disabled={!chat.canCommand} hidden={settings.height !== '100%' && (overlays.drawerOpen || overlays.modalOpen || overlays.playlist !== null)}
              restored={chat.restoredDraft} cooldown={chat.cooldown} onSend={chat.send} onDraft={chat.saveDraft}
              participants={chat.participants} meId={chat.me?.id} onWarn={chat.warn} onPraise={chat.praise} onPlaylist={playlistCommand}
              onNotify={chat.notify} warnEnabled={settings.playWarn} praiseEnabled={settings.playPraise} mention={mentionEnabled(settings)} />
          </div>
          {/* 닉네임 변경(D-032): 패널 전체 기준 가운데. 대화 영역 오버레이와 달리 상단바·입력창까지 덮는다 */}
          <NicknameModal />
          <ReportModal />
        </section>
        {/* 플로팅 아바타(1.0.10): 패널 밖 별도 창(팝업)에 포털로 그린다. 꺼져 있으면 아무것도 그리지 않는다 */}
        <FloatingAvatar unread={unread} />
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
