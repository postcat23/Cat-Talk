import type { Participant } from '../chat/model';
import Cat from './Cat';
import styles from './CatBadge.module.css';

// 발화 묶음 첫 메시지에서 말풍선 위에 걸터앉는 고양이(발은 말풍선 뒤).
// 실아바타는 콘텐츠 높이를 고정해 말풍선 상단에 밀착한다(Message의 sprite 규칙).
// '모든 고양이 투명화'(clearCats)는 게임 고양이(패치)용이라 앱이 그리는 이 고양이에는 걸지 않는다.
export default function CatBadge({ participant }: { participant: Participant }) {
  const cls = [styles.cat, participant.avatar && styles.sprite].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      <Cat src={participant.avatar} framing="sprite" />
      {!participant.avatar && participant.hat && <span className={styles.hat}>{participant.hat}</span>}
    </span>
  );
}
