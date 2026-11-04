import { OVERLAY_HEIGHT, useUi } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import Cat from './Cat';
import styles from './ParticipantModal.module.css';

export default function ParticipantModal() {
  const { settings, overlays, dispatch } = useUi();
  const { participants, me } = useChat();
  // '나' 최상단 고정, 나머지는 한국어 로캘 정렬
  const sorted = [
    ...participants.filter((p) => p.id === me?.id),
    ...participants.filter((p) => p.id !== me?.id).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  ];
  return (
    <div className={[styles.modal, overlays.modalOpen && styles.show, OVERLAY_HEIGHT[settings.height] === '100%' && styles.full].filter(Boolean).join(' ')} aria-label="참여자">
      <div className={styles.mhead}>
        <button className={styles.close} aria-label="닫기" onClick={() => dispatch({ type: 'closeOverlays' })}>×</button>
        <h2><Cat /> 함께 있는 고양이</h2>
        <p>탭하면 Steam 프로필을 열 수 있어요.</p>
      </div>
      <div className={styles.mlist}>
        {sorted.map((p) => (
          <div key={p.id} className={styles.prow}>
            <span className={styles.av} style={{ background: p.color }}><Cat /></span>
            <span className={styles.nm}>{p.name}</span>
            {p.id === me?.id
              ? <span className={styles.meBadge}>나</span>
              : <button className={styles.dots} aria-label="메뉴">⋯</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
