import { useEffect, useState } from 'react';
import card from './ReactionStack.module.css';
import styles from './NoticeCard.module.css';

const SHOW_MS = 10000;

// 최초 1회 10초 표시되는 개발판 휘발 안내
export default function NoticeCard() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(false), SHOW_MS);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;
  return (
    <div className={`${card.card} ${styles.notice}`}>
      <span className={`${card.rtxt} ${styles.rtxt}`}>개발판 · 켜져 있는 동안의 대화만 보관하고 종료하면 지웁니다.</span>
      <button className={styles.x} aria-label="닫기" onClick={() => setVisible(false)}>×</button>
    </div>
  );
}
