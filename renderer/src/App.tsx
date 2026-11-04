import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { MAX_CARDS, OVERLAY_HEIGHT, UiProvider, useUi, type ChatHeight } from './state/UiContext';
import { useReactionStack } from './hooks/useReactionStack';
import { useClickThrough } from './hooks/useClickThrough';
import { CONNECTION, INITIAL_ITEMS, ME_ID, PARTICIPANTS, type ChatItem } from './mock/mockData';
import CollapseTab from './components/CollapseTab';
import TopBar from './components/TopBar';
import SearchBar from './components/SearchBar';
import Conversation from './components/Conversation';
import Composer from './components/Composer';

const HEIGHT_PCT: Record<ChatHeight, 100 | 70 | 50> = { '100%': 100, '70%': 70, '50%': 50 };
const SEND_ACK_MS = 700;   // 목업의 '전송 중…' → '전송됨' 시뮬레이션. 실제 send는 2e-2c

function now() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function Panel() {
  const { settings, overlays } = useUi();
  const [items, setItems] = useState<ChatItem[]>(INITIAL_ITEMS);
  const reactions = useReactionStack(MAX_CARDS[settings.height], settings.catInteraction);

  const send = useCallback((text: string) => {
    const id = 'local-' + Date.now();
    setItems((xs) => [...xs, { kind: 'msg', id, sender: ME_ID, text, time: now(), status: '전송 중…' }]);
    window.setTimeout(() => {
      setItems((xs) => xs.map((x) => (x.id === id && x.kind === 'msg' ? { ...x, status: '전송됨' } : x)));
    }, SEND_ACK_MS);
  }, []);

  // 도크 위치·채팅 높이·작업표시줄: Electron이면 창(BrowserWindow)이 맡고, 브라우저 dev면 패널 CSS로 시뮬레이션.
  // 패널·탭이 어느 쪽에 오는지는 두 모드 모두 data-side가 정한다. --ovh·반응 카드 최대 수는 설정값 기준 공통.
  const shell = window.catTalk;
  useEffect(() => { shell?.setDockSide(settings.side); }, [shell, settings.side]);
  useEffect(() => { shell?.setChatHeight(HEIGHT_PCT[settings.height]); }, [shell, settings.height]);
  useEffect(() => { shell?.setSkipTaskbar(settings.hideTaskbarIcon); }, [shell, settings.hideTaskbarIcon]);
  useClickThrough();

  const style = {
    height: shell ? undefined : settings.height,
    '--ovh': OVERLAY_HEIGHT[settings.height],
  } as CSSProperties;

  return (
    <section className={overlays.collapsed ? 'panel collapsed' : 'panel'} data-side={settings.side} style={style}>
      <CollapseTab />
      {/* 채팅 투명도는 창(setOpacity)이 아니라 본체 CSS opacity. 투명 창 위에서 데스크톱이 비친다 */}
      <div className="panel-body" style={{ opacity: settings.opacity / 100 }}>
        <TopBar conn={CONNECTION} count={PARTICIPANTS.length} />
        <SearchBar />
        <Conversation items={items} reactions={reactions} />
        <Composer disabled={CONNECTION !== 'good'} onSend={send} />
      </div>
    </section>
  );
}

export default function App() {
  return (
    <UiProvider>
      <Panel />
    </UiProvider>
  );
}
