import { useEffect, useState } from 'react';
import card from './ReactionStack.module.css';
import styles from './NoticeCard.module.css';

// 문장 끝 마침표(뒤에 공백) 기준으로 나눠 문장마다 한 줄. 'v1.0.0'·'50 UTF-16'처럼 공백 없는 점은 나누지 않는다.
const sentences = (text: string) => text.split(/(?<=\.)\s+/).filter(Boolean);

// 안내 카드. showMs가 있으면 그 시간 뒤 사라지고, 없으면 닫거나 상태가 풀릴 때까지 남는다.
// action: 버튼 하나(예: 카운트다운 취소, 재시작). onClose가 있으면 ×가 카드를 숨기는 대신 그것을 부른다.
// action만 있고 onClose가 없으면 ×를 보이지 않는다(카운트다운은 취소로만 닫는다).
export default function NoticeCard({ text, showMs, action, onClose }: { text: string; showMs?: number; action?: { label: string; onClick(): void }; onClose?(): void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (showMs === undefined) return;
    const t = window.setTimeout(() => setVisible(false), showMs);
    return () => clearTimeout(t);
  }, [showMs]);

  if (!visible) return null;
  return (
    <div className={`${card.card} ${styles.notice}`}>
      <span className={`${card.rtxt} ${styles.rtxt}`}>
        {sentences(text).map((line, i) => <span key={i} className={styles.line}>{line}</span>)}
      </span>
      {action && <button className={styles.action} onClick={action.onClick}>{action.label}</button>}
      {(!action || onClose) && <button className={styles.x} aria-label="닫기" onClick={onClose ?? (() => setVisible(false))}>×</button>}
    </div>
  );
}
