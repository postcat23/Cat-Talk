import { useEffect, useState } from 'react';

// 드로어 '디스플레이 선택'(사용자 명세, 2026-11-18). count = 디스플레이 수, current = 지금 창이 있는 디스플레이 번호(1부터).
// 번호는 main(electron/displays.js)이 왼쪽부터 센 순번이고 [식별] 오버레이 번호와 같다.
export interface DisplayInfo { count: number; current: number }

// main이 도크할 때마다(선택·창 이동·디스플레이 추가/제거) 알린다. 알림을 놓치지 않게 구독한 뒤 현재 값을 묻는다.
// 브라우저 dev에는 창이 없어 null이다.
export function useDisplays(): DisplayInfo | null {
  const [info, setInfo] = useState<DisplayInfo | null>(null);
  useEffect(() => {
    const display = window.catTalk?.display;
    if (!display) return;
    let alive = true;
    const update = (next: DisplayInfo) => { if (alive) setInfo(next); };
    const off = display.onChange(update);
    void display.info().then(update);
    return () => { alive = false; off(); };
  }, []);
  return info;
}
