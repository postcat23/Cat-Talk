import { useCallback, useState, type CSSProperties } from 'react';
import { MAX_CARDS, OVERLAY_HEIGHT, UiProvider, useUi } from './state/UiContext';
import { useReactionStack } from './hooks/useReactionStack';
import { CONNECTION, INITIAL_ITEMS, ME_ID, PARTICIPANTS, ROOM_NAME, type ChatItem } from './mock/mockData';
import CollapseTab from './components/CollapseTab';
import TopBar from './components/TopBar';
import SearchBar from './components/SearchBar';
import Conversation from './components/Conversation';
import Composer from './components/Composer';

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

  // TODO(2e-2b): delegate to Electron main — 채팅 높이·투명도·도크 위치를 BrowserWindow에 반영.
  // 지금은 목업처럼 패널 CSS(height/opacity/data-side)로만 시뮬레이션한다.
  const style = {
    height: settings.height,
    opacity: settings.opacity / 100,
    '--ovh': OVERLAY_HEIGHT[settings.height],
  } as CSSProperties;

  return (
    <section className={overlays.collapsed ? 'panel collapsed' : 'panel'} data-side={settings.side} style={style}>
      <CollapseTab />
      <TopBar room={ROOM_NAME} conn={CONNECTION} count={PARTICIPANTS.length} />
      <SearchBar />
      <Conversation items={items} reactions={reactions} />
      <Composer disabled={CONNECTION !== 'good'} onSend={send} />
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
