import type { ChatMessage } from '../chat/model';
import CatBadge from './CatBadge';
import styles from './Message.module.css';

interface Props {
  message: ChatMessage;
  lead: boolean;          // 발화 묶음 첫 메시지: 고양이+닉 머리를 붙인다
  afterNotice?: boolean;  // 바로 위가 표시 중인 입퇴장 공지
  jumped?: boolean;       // 검색에서 막 점프해 온 메시지
  onJump?: () => void;    // 검색 결과일 때만: 누르면 대화의 그 위치로 간다
  onResend?: () => void;  // 재전송 대상(message.resendable)일 때만: ↻
  resendDisabled?: boolean;   // 전송 쿨다운 중(전송과 공유)
}

export default function Message({ message, lead, afterNotice, jumped, onJump, onResend, resendDisabled }: Props) {
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
        {/* 내 메시지 행은 row-reverse라 세 번째 자식이 화면상 맨 왼쪽(말풍선·'전송 실패' 바깥)에 온다 */}
        {onResend && message.resendable && (
          <button type="button" className={styles.resend} aria-label="재전송" title="재전송" disabled={resendDisabled} onClick={onResend}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
