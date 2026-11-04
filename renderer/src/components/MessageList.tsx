import { useLayoutEffect, useRef } from 'react';
import { useUi } from '../state/UiContext';
import { ME_ID, participantById, type ChatItem } from '../mock/mockData';
import Message from './Message';
import styles from './MessageList.module.css';

export default function MessageList({ items }: { items: ChatItem[] }) {
  const { settings } = useUi();
  const scroll = useRef<HTMLDivElement>(null);

  // 새 항목이 붙으면 맨 아래로
  useLayoutEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div className={styles.scroll} ref={scroll}>
      {items.map((item, i) => {
        if (item.kind === 'presence') {
          return settings.presence ? <div key={item.id} className={styles.presence}>{item.text}</div> : null;
        }
        const sender = participantById(item.sender);
        if (!sender) return null;
        // 직전 항목이 같은 발신자의 메시지가 아니면 묶음의 첫 메시지(lead)
        const prev = items[i - 1];
        const lead = !(prev && prev.kind === 'msg' && prev.sender === item.sender);
        return <Message key={item.id} message={item} sender={sender} mine={item.sender === ME_ID} lead={lead} />;
      })}
    </div>
  );
}
