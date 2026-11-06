import type { ChatMessage } from '../chat/model';
import CatBadge from './CatBadge';
import styles from './Message.module.css';

interface Props {
  message: ChatMessage;
  lead: boolean;          // 발화 묶음 첫 메시지: 고양이+닉 머리를 붙인다
  afterNotice?: boolean;  // 바로 위가 표시 중인 입퇴장 공지
  jumped?: boolean;       // 검색에서 막 점프해 온 메시지
  onJump?: () => void;    // 검색 결과일 때만: 누르면 대화의 그 위치로 간다
}

export default function Message({ message, lead, afterNotice, jumped, onJump }: Props) {
  const sender = message.author;
  const cls = [styles.msg, message.own ? styles.me : styles.peer, lead && styles.lead, lead && sender.avatar && styles.sprite,
    lead && afterNotice && styles.afterNotice, jumped && styles.jumped, onJump && styles.jumpable]
    .filter(Boolean).join(' ');
  return (
    <div className={cls} data-id={message.id} onClick={onJump}>
      {lead && (
        <div className={styles.head}>
          <CatBadge participant={sender} />
          <span className={styles.nm}>{sender.name}</span>
        </div>
      )}
      <div className={styles.row}>
        <div className={styles.bubble}>{message.text}</div>
        <div className={styles.binfo}>
          {message.status && <span className={styles.status}>{message.status}</span>}
          <span className={styles.tm}>{message.time}</span>
        </div>
      </div>
    </div>
  );
}
