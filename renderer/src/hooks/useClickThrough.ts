import { useEffect } from 'react';

// 투명 창의 클릭 통과(forward 패턴). 메인은 기본으로 마우스를 무시하되 mousemove는 전달하므로,
// 커서가 패널(탭 포함) 위에 올 때만 클릭을 받고 투명한 거터·접힌 자리에서는 데스크톱으로 넘긴다.
export function useClickThrough() {
  useEffect(() => {
    const shell = window.catTalk;
    if (!shell) return;   // 브라우저 dev: 창이 없으므로 할 일 없음
    let interactive = false;
    const update = (next: boolean) => {
      if (next === interactive) return;
      interactive = next;
      shell.setInteractive(next);
    };
    const onMove = (e: MouseEvent) => update(e.target instanceof Element && e.target.closest('.panel') !== null);
    const onLeave = () => update(false);
    window.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, []);
}
