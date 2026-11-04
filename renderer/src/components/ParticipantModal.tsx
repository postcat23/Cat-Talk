import { useUi } from '../state/UiContext';
import { ME_ID, PARTICIPANTS } from '../mock/mockData';
import Cat from './Cat';
import styles from './ParticipantModal.module.css';

// '나' 최상단 고정, 나머지는 한국어 로캘 정렬
const SORTED = [
  ...PARTICIPANTS.filter((p) => p.id === ME_ID),
  ...PARTICIPANTS.filter((p) => p.id !== ME_ID).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
];

export default function ParticipantModal() {
  const { overlays, dispatch } = useUi();
  return (
    <div className={overlays.modalOpen ? `${styles.modal} ${styles.show}` : styles.modal} aria-label="참여자">
      <div className={styles.mhead}>
        <button className={styles.close} aria-label="닫기" onClick={() => dispatch({ type: 'closeOverlays' })}>×</button>
        <h2><Cat /> 함께 있는 고양이</h2>
        <p>탭하면 Steam 프로필을 열 수 있어요.</p>
      </div>
      <div className={styles.mlist}>
        {SORTED.map((p) => (
          <div key={p.id} className={styles.prow}>
            <span className={styles.av} style={{ background: p.color }}><Cat /></span>
            <span className={styles.nm}>{p.name}</span>
            {p.id === ME_ID
              ? <span className={styles.meBadge}>나</span>
              : <button className={styles.dots} aria-label="메뉴">⋯</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
