import { useLayoutEffect, useRef } from 'react';
import { useUi } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import Message from './Message';
import styles from './MessageList.module.css';

const BOTTOM_SLOP = 2;

export default function MessageList() {
  const { settings } = useUi();
  const { items, query } = useChat();
  const scroll = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastId = useRef<string | undefined>(undefined);

  // 맨 아래를 보고 있을 때나 내가 보냈을 때만 따라 내려간다. 위로 올려 읽는 중에는 위치를 유지한다.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const last = items[items.length - 1];
    const sent = last?.kind === 'msg' && last.own && last.id !== lastId.current;
    lastId.current = last?.id;
    if (query) el.scrollTop = 0;
    else if (atBottom.current || sent) { el.scrollTop = el.scrollHeight; atBottom.current = true; }
  }, [items, query]);

  function onScroll() {
    const el = scroll.current;
    if (el && !query) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLOP;
  }

  return (
    <div className={styles.scroll} ref={scroll} onScroll={onScroll}>
      {items.length === 0 && <div className={`${styles.presence} ${styles.empty}`}>{query ? '검색 결과가 없습니다' : '대화를 기다리고 있습니다'}</div>}
      {items.map((item, i) => {
        if (item.kind === 'presence') {
          return settings.presence ? <div key={item.id} className={styles.presence}>{item.text}</div> : null;
        }
        // 직전 항목이 같은 발신자의 메시지가 아니면 묶음의 첫 메시지(lead)
        const prev = items[i - 1];
        const lead = !(prev && prev.kind === 'msg' && prev.sender === item.sender);
        return <Message key={item.id} message={item} lead={lead} afterNotice={settings.presence && prev?.kind === 'presence'} />;
      })}
    </div>
  );
}
