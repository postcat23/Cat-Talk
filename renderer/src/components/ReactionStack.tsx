import type { ReactionStack as Stack } from '../hooks/useReactionStack';
import { participantById } from '../mock/mockData';
import Cat from './Cat';
import NoticeCard from './NoticeCard';
import styles from './ReactionStack.module.css';

// 대화 영역 위에 뜨는 카드 스택: 반응 카드(최신이 위) + 안내 카드(아래)
export default function ReactionStack({ stack }: { stack: Stack }) {
  return (
    <div className={styles.stack}>
      {stack.cards.map((c) => {
        const p = participantById(c.sender);
        return (
          <div key={c.id} className={c.leaving ? `${styles.card} ${styles.leaving}` : styles.card}>
            <span className={styles.rcat} style={{ background: p?.color }}><Cat /></span>
            <span className={styles.rtxt}><b>{p?.name ?? c.sender}</b> {c.kind === 'meow' ? '야옹~' : c.content}</span>
            <span className={styles.mul}>{c.n > 1 ? `×${c.n}` : ''}</span>
          </div>
        );
      })}
      <NoticeCard />
    </div>
  );
}
