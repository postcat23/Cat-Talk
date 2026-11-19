import { useUi } from '../state/UiContext';
import { playMarkLabel, playMarks } from '../chat/play';
import PraiseStar from './PraiseStar';
import styles from './PlayMarks.module.css';

// 이름 뒤 경고·칭찬 누적 표시(D-052·1.0.8, 사용자 명세): 쌓지 않고 아이콘 하나 + 숫자(이름이 길어지지 않게).
// 경고 = 옐로카드(축구 옐로카드 모양의 노란 직사각형), 칭찬 = 빨강~분홍 별(PraiseStar). 숫자는 아이콘과 같은 색(사용자 지정).
// 0이면 그리지 않고, 둘 다면 경고 먼저(🟨1 ⭐2).
// 드로어 '플레이 > 경고'·'칭찬'은 서로 독립이다 — 끈 쪽만 숨긴다(내 화면만).
// 붙이는 곳은 채팅창 메시지 이름·참여자 목록·'@' 자동완성 목록뿐이다(사용자 결정 2026-11-18 — 반응 카드·드로어 프로필·새 메시지 미리보기에는 붙이지 않는다)
export default function PlayMarks({ warns, praises }: { warns: number; praises: number }) {
  const { settings } = useUi();
  const marks = playMarks(warns, praises, settings);
  if (marks.length === 0) return null;
  const label = playMarkLabel(marks);
  return (
    <span className={styles.marks} role="img" aria-label={label} title={label}>
      {marks.map((m) => (
        <span key={m.kind} className={styles.mark}>
          {m.kind === 'warn' ? <span className={styles.card} /> : <PraiseStar className={styles.star} />}
          <span className={`${styles.num} ${m.kind === 'warn' ? styles.warnNum : styles.praiseNum}`}>{m.count}</span>
        </span>
      ))}
    </span>
  );
}
