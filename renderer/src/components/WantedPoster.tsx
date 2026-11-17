import { useEffect, type CSSProperties } from 'react';
import { useChat } from '../hooks/useChatView';
import posterImage from '../assets/wanted.png';
import Cat from './Cat';
import styles from './WantedPoster.module.css';

// WantedPoster.module.css 애니메이션 전체 길이(붙이기 → 조준 → 세 발 → 사라짐)와 같게
const DURATION_MS = 4600;
// 탄흔 위치(사진틀 안 %)·발사 시각(초)·탄흔 회전(같은 그림이 똑같아 보이지 않게). 발사 시각은 CSS 흔들림·조준선 반동 시각과 같다
// 위아래 배치: 아바타가 사진 바닥에 서 있어 아래 가운데는 얼굴에 맞는다 → 한 발은 위 가운데, 두 발은 아래 양옆
const SHOTS = [{ x: 29, y: 58, at: 1.0, rot: 0 }, { x: 79, y: 72, at: 1.16, rot: 131 }, { x: 52, y: 26, at: 1.32, rot: 247 }];

// 공개수배(D-052): 경고 총횟수가 3에 닿은 대상의 전단(사용자 제공 wanted.png, 가운데 투명 사진틀에 대상 아바타)과 간단한 총격 모션.
// 로비의 Cat Talk 사용자마다 같은 처형을 각자 화면에 한 번 띄운다(대상 본인 포함). 클릭은 아래로 통과한다.
// 대상이 목록에 없으면(나감·차단) 띄우지 않고 넘긴다. 여러 건이면 차례대로.
export default function WantedPoster() {
  const { wanted, byId, dismissWanted } = useChat();
  const target = wanted ? byId(wanted.target) : undefined;
  const present = !!target;
  // 대상 객체는 폴링마다 새로 만들어지므로 타이머는 처형 id·대상 유무에만 묶는다(애니메이션이 다시 시작되지 않게)
  useEffect(() => {
    if (!wanted) return;
    const timer = window.setTimeout(() => dismissWanted(wanted.id), present ? DURATION_MS : 0);
    return () => clearTimeout(timer);
  }, [wanted, present, dismissWanted]);
  if (!wanted || !target) return null;
  return (
    <div key={wanted.id} className={styles.stage} role="img" aria-label={`${target.name}님 공개수배`}>
      <div className={styles.poster}>
        <div className={styles.photo}>
          <Cat src={target.avatar} framing="sprite" />
          {SHOTS.map((s) => (
            <span key={s.at} className={styles.shot}
              style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.at}s`, '--rot': `${s.rot}deg` } as CSSProperties} />
          ))}
        </div>
        <img className={styles.paper} src={posterImage} alt="" draggable={false} />
        <span className={styles.crosshair} />
      </div>
    </div>
  );
}
