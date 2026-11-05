import type { ChatMessage } from '../chat/model';
import CatBadge from './CatBadge';
import styles from './Message.module.css';

interface Props {
  message: ChatMessage;
  lead: boolean;          // 발화 묶음 첫 메시지: 고양이+닉 머리를 붙인다
  afterNotice?: boolean;  // 바로 위가 표시 중인 입퇴장 공지
}

export default function Message({ message, lead, afterNotice }: Props) {
  const sender = message.author;
  const cls = [styles.msg, message.own ? styles.me : styles.peer, lead && styles.lead, lead && sender.avatar && styles.sprite,
    lead && afterNotice && styles.afterNotice]
    .filter(Boolean).join(' ');
  return (
    <div className={cls}>
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
