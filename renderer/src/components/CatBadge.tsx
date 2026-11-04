import { useUi } from '../state/UiContext';
import type { Participant } from '../chat/model';
import Cat from './Cat';
import styles from './CatBadge.module.css';

// 발화 묶음 첫 메시지에서 말풍선 위에 걸터앉는 고양이(발은 말풍선 뒤)
export default function CatBadge({ participant }: { participant: Participant }) {
  const { settings } = useUi();
  return (
    <span className={settings.clearCats ? `${styles.cat} ${styles.clear}` : styles.cat}>
      <Cat />
      {participant.hat && <span className={styles.hat}>{participant.hat}</span>}
    </span>
  );
}
