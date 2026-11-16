import type { Participant } from '../chat/model';
import Cat from './Cat';
import styles from './CatBadge.module.css';

// 발화 묶음 첫 메시지에서 말풍선 위에 앉는 고양이. 칸 높이를 고정하고 그림(실아바타·실루엣)은 칸 바닥에 붙인다:
// 스킨이 바뀌거나 아바타가 늦게 도착해도 메시지 행 높이가 그대로라 대화 스크롤이 튀지 않는다.
// 모자는 실아바타 합성 이미지에만 있다. 실아바타가 없으면 실루엣만 그린다.
// '모든 고양이 투명화'(clearCats)는 게임 고양이(패치)용이라 앱이 그리는 이 고양이에는 걸지 않는다.
export default function CatBadge({ participant }: { participant: Participant }) {
  return (
    <span className={styles.cat}>
      <Cat src={participant.avatar} framing="sprite" />
    </span>
  );
}
