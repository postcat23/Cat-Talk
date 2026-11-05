import type { ReactionStack as Stack } from '../hooks/useReactionStack';
import { useChat } from '../hooks/useChatView';
import Cat from './Cat';
import NoticeCard from './NoticeCard';
import styles from './ReactionStack.module.css';

const DEV_NOTICE = '켜져 있는 동안의 대화만 보관하고 종료하면 지웁니다.';
// 야옹 반응은 게임이 보낸 원문(언어별, 예: '야옹 야옹')을 그대로 쓴다. 없을 때만 한국어 원문
const MEOW_FALLBACK = '야옹 야옹';
const DEV_NOTICE_MS = 10000;   // 최초 1회
const TOAST_MS = 4000;         // upstream 토스트와 같은 시간

// 대화 영역 위에 뜨는 카드 스택: 반응 카드(최신이 위) + 안내 카드(아래).
// key로 문구·회차가 바뀌면 카드를 새로 만들어, 닫았던 안내도 새 상태면 다시 보이게 한다.
export default function ReactionStack({ stack }: { stack: Stack }) {
  const { byId, notice, toast } = useChat();
  return (
    <div className={styles.stack}>
      {stack.cards.map((c) => {
        const p = byId(c.sender);
        const avatar = c.avatar ?? p?.avatar;
        return (
          <div key={c.id} className={[styles.card, styles.reaction, c.leaving && styles.leaving].filter(Boolean).join(' ')}>
            <span className={avatar ? `${styles.rcat} ${styles.stand}` : styles.rcat}><Cat src={avatar} framing="sprite" /></span>
            <span className={styles.rtxt}>
              <b>{p?.name ?? c.sender}</b>
              {c.kind === 'meow' ? <span className={styles.act}>{c.content || MEOW_FALLBACK}</span> : c.content && <span className={styles.act}>{c.content}</span>}
            </span>
            {c.kind === 'emote' && c.image && <img className={styles.emote} src={c.image} alt="" draggable={false} />}
            <span className={styles.mul}>{c.n > 1 ? `×${c.n}` : ''}</span>
          </div>
        );
      })}
      {toast && <NoticeCard key={toast.id} text={toast.text} showMs={TOAST_MS} />}
      {notice && <NoticeCard key={notice} text={notice} />}
      <NoticeCard text={DEV_NOTICE} showMs={DEV_NOTICE_MS} />
    </div>
  );
}
