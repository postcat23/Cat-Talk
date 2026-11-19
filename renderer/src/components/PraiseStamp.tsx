import type { CSSProperties } from 'react';
import { useChat } from '../hooks/useChatView';
import { useHeldPlayback, usePageVisible } from '../hooks/useHeldPlayback';
import { useUi } from '../state/UiContext';
import stampImage from '../assets/stamp.png';
import Cat from './Cat';
import PraiseStar from './PraiseStar';
import styles from './PraiseStamp.module.css';

// PraiseStamp.module.css 애니메이션 전체 길이(등장 → 별 셋 → 도장 쾅 → 사라짐)와 같게. 공개수배 전단과 같은 길이
const DURATION_MS = 4600;
// 별 3개: 아바타 머리 위 곡선(왼쪽·가운데·오른쪽). 위치(장면 %)·나타나는 시각(초)·기울기
const STARS = [{ x: 22, y: 24, at: 0.55, rot: -16 }, { x: 50, y: 12, at: 0.7, rot: 0 }, { x: 78, y: 24, at: 0.85, rot: 16 }];

// 칭찬 도장(1.0.8, 사용자 명세 — 공개수배의 거울): 칭찬 총횟수가 3에 닿은 대상의 아바타를 가운데에, 별 셋을 머리 위 곡선에 띄우고
// 사용자 제공 도장(stamp.png)을 아바타 오른쪽 아래에 겹치게 쾅 찍는다. 이름은 그리지 않는다(아바타만). 클릭은 아래로 통과한다.
// 로비의 Cat Talk 사용자마다 같은 발동을 각자 화면에 한 번 띄운다(대상 본인 포함). 대상이 목록에 없으면 넘기고, 여러 건이면 차례대로
// (같은 대상은 useChatView가 10초 묶는다). 화면이 가려진 동안은 보류(1분) — 보류·재생 판정은 공개수배와 같다(hooks/useHeldPlayback).
// 공개수배 전단이 떠 있거나 기다리는 동안도 가려진 것처럼 미룬다(둘이 겹치지 않게 — 전단 먼저, 결정 2026-11-19).
// 플레이 > 칭찬이 꺼져 있으면 useChatView가 대기열을 비워 두므로 여기 올 것이 없다.
export default function PraiseStamp() {
  const { praised, wanted, byId, dismissPraised } = useChat();
  const { overlays } = useUi();
  const visible = usePageVisible();
  const hidden = overlays.collapsed || overlays.drawerOpen || overlays.modalOpen || !visible || !!wanted;
  const target = praised ? byId(praised.target) : undefined;
  const playing = useHeldPlayback(praised, !!target, hidden, dismissPraised, DURATION_MS);
  if (!praised || !target || hidden || playing !== praised.id) return null;
  return (
    <div key={praised.id} className={styles.stage} role="img" aria-label={`${target.name}님 칭찬 도장`}>
      <div className={styles.scene}>
        <div className={styles.avatar}><Cat src={target.avatar} framing="sprite" /></div>
        {STARS.map((s) => (
          <span key={s.at} className={styles.star}
            style={{ left: `${s.x}%`, top: `${s.y}%`, '--at': `${s.at}s`, '--rot': `${s.rot}deg` } as CSSProperties}>
            <PraiseStar className={styles.starIcon} />
          </span>
        ))}
        <span className={styles.impact} />
        <img className={styles.stamp} src={stampImage} alt="" draggable={false} />
      </div>
    </div>
  );
}
