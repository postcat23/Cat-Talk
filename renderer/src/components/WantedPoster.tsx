import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useChat } from '../hooks/useChatView';
import { useUi } from '../state/UiContext';
import posterImage from '../assets/wanted.png';
import Cat from './Cat';
import styles from './WantedPoster.module.css';

// WantedPoster.module.css 애니메이션 전체 길이(붙이기 → 조준 → 세 발 → 사라짐)와 같게
const DURATION_MS = 4600;
// 탄흔 위치(사진틀 안 %)·발사 시각(초)·탄흔 회전(같은 그림이 똑같아 보이지 않게). 발사 시각은 CSS 흔들림·조준선 반동 시각과 같다
// 위아래 배치: 아바타가 사진 바닥에 서 있어 아래 가운데는 얼굴에 맞는다 → 한 발은 위 가운데, 두 발은 아래 양옆
const SHOTS = [{ x: 29, y: 58, at: 1.0, rot: 0 }, { x: 79, y: 72, at: 1.16, rot: 131 }, { x: 52, y: 26, at: 1.32, rot: 247 }];
// 화면이 가려진 동안(채팅창 접힘·드로어·참여자 목록·창 최소화/트레이) 발동은 보류했다가 보이면 띄운다. 받은 뒤 이 시간이 지나면 버린다(사용자 결정 1분)
const HOLD_MS = 60_000;

// 창이 최소화되거나 트레이로 숨으면 document가 hidden이 된다
const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};
const pageVisible = () => document.visibilityState === 'visible';

// 공개수배(D-052): 경고 총횟수가 3에 닿은 대상의 전단(사용자 제공 wanted.png, 가운데 투명 사진틀에 대상 아바타)과 간단한 총격 모션.
// 로비의 Cat Talk 사용자마다 같은 처형을 각자 화면에 한 번 띄운다(대상 본인 포함). 클릭은 아래로 통과한다.
// 대상이 목록에 없으면(나감·차단) 띄우지 않고 넘긴다. 여러 건이면 차례대로(같은 대상은 useChatView가 하나로 묶는다).
// 재생 도중 화면이 가려지면 멈추고, 1분 안에 다시 보이면 처음부터 다시 띄운다.
// 플레이 > 경고가 꺼져 있으면 useChatView가 대기열을 비워 두므로 여기 올 것이 없다.
export default function WantedPoster() {
  const { wanted, byId, dismissWanted } = useChat();
  const { overlays } = useUi();
  const visible = useSyncExternalStore(subscribeVisibility, pageVisible);
  const hidden = overlays.collapsed || overlays.drawerOpen || overlays.modalOpen || !visible;
  const target = wanted ? byId(wanted.target) : undefined;
  const present = !!target;
  const id = wanted?.id;
  // 받은 시각(at)은 같은 대상이 묶이면 늦춰진다. 타이머는 이 ref로 읽어, 재생 중에 늦춰져도 재생을 다시 시작하지 않는다
  const receivedAt = useRef(wanted?.at);
  useEffect(() => { receivedAt.current = wanted?.at; });
  const [playing, setPlaying] = useState<string | null>(null);   // 재생 중인 전단 id — 보이게 된 순간 기한 안이었던 것만
  // 대상 객체는 폴링마다 새로 만들어지므로 타이머는 처형 id·대상 유무·가려짐에만 묶는다(애니메이션이 다시 시작되지 않게)
  useEffect(() => {
    if (!id) return;
    const left = () => HOLD_MS - (Date.now() - (receivedAt.current ?? Date.now()));
    let timer = 0;
    if (!present) {
      timer = window.setTimeout(() => dismissWanted(id, 'absent'), 0);
    } else if (hidden) {
      // 가려진 동안은 기한까지 기다린다(그 사이 보이면 취소). 기다리는 사이 같은 대상이 묶여 기한이 늘었으면 다시 기다린다
      setPlaying(null);
      const wait = () => {
        if (left() > 0) timer = window.setTimeout(wait, left());
        else dismissWanted(id, 'expired');
      };
      timer = window.setTimeout(wait, Math.max(0, left()));
    } else if (left() <= 0) {
      timer = window.setTimeout(() => dismissWanted(id, 'expired'), 0);
    } else {
      setPlaying(id);
      timer = window.setTimeout(() => dismissWanted(id, 'shown'), DURATION_MS);
    }
    return () => clearTimeout(timer);
  }, [id, present, hidden, dismissWanted]);
  if (!wanted || !target || hidden || playing !== wanted.id) return null;
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
