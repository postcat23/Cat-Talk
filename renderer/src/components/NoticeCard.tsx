import { useEffect, useState } from 'react';
import card from './ReactionStack.module.css';
import styles from './NoticeCard.module.css';

// 안내 카드. showMs가 있으면 그 시간 뒤 사라지고, 없으면 닫거나 상태가 풀릴 때까지 남는다.
export default function NoticeCard({ text, showMs }: { text: string; showMs?: number }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (showMs === undefined) return;
    const t = window.setTimeout(() => setVisible(false), showMs);
    return () => clearTimeout(t);
  }, [showMs]);

  if (!visible) return null;
  return (
    <div className={`${card.card} ${styles.notice}`}>
      <span className={`${card.rtxt} ${styles.rtxt}`}>{text}</span>
      <button className={styles.x} aria-label="닫기" onClick={() => setVisible(false)}>×</button>
    </div>
  );
}
