import { useEffect, useState } from 'react';

// 플로팅 아바타(1.0.10, 사용자 명세 2026-11-23)의 창. Electron은 window.open 팝업(about:blank)을 열고 그 문서에 React 포털로 그린다 —
// 메인 렌더러 프로세스를 같이 써서 가볍다. 배치·항상 위·클릭 통과·드래그는 main(electron/floating.js)이 한다.
// 브라우저 dev(npm run dev)에는 창이 없어 같은 문서 위에 고정 상자로 띄운다(모양 확인용, 드래그 없음).
export const FLOATING_NAME = 'cattalk-floating';   // electron/floating.js NAME과 같게
export type Inward = 'left' | 'right';              // 라벨·광선이 나가는 쪽(화면 안쪽)

// 팝업 창 크기(electron/floating.js WIDTH·HEIGHT, 원형 64 + 좌우 188 + 위 28 + 아래 16). 브라우저 dev 상자도 같은 크기로 둔다
const WIDTH = 440, HEIGHT = 108, SIDE = 188, BOTTOM = 16, MARGIN = 24;

// 팝업 문서를 표준 모드로 새로 쓴다(초기 about:blank는 doctype이 없다)
function prepare(doc: Document) {
  doc.open();
  doc.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Cat Talk</title></head><body></body></html>');
  doc.close();
}

// 메인 문서의 스타일(빌드 CSS <link>, dev는 Vite가 넣는 <style>)을 팝업 문서에 복제한다(사용자 명세 '빌드 CSS 팝업에 복제').
// dev HMR처럼 head가 바뀌면 다시 복제한다. 테마·셸 속성(data-theme — 토큰, data-shell — 투명 배경)도 따라간다.
function mirror(doc: Document) {
  const sync = () => {
    doc.head.querySelectorAll('[data-cattalk-copy]').forEach((n) => n.remove());
    document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      const copy = node.cloneNode(true) as Element;
      if (node instanceof HTMLLinkElement) copy.setAttribute('href', node.href);   // 팝업 기준이 아니라 메인 문서 기준 절대 경로
      copy.setAttribute('data-cattalk-copy', '');
      doc.head.appendChild(copy);
    });
  };
  const attrs = () => {
    for (const name of ['data-theme', 'data-shell']) {
      const value = document.documentElement.getAttribute(name);
      if (value === null) doc.documentElement.removeAttribute(name);
      else doc.documentElement.setAttribute(name, value);
    }
  };
  sync();
  attrs();
  const head = new MutationObserver(sync);
  head.observe(document.head, { childList: true, subtree: true, characterData: true });
  const root = new MutationObserver(attrs);
  root.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-shell'] });
  return () => { head.disconnect(); root.disconnect(); };
}

// 켜져 있으면 창을 열고 그릴 자리(host)와 안쪽 방향을 준다. 꺼지거나 언마운트되면 닫는다.
// 메인 렌더러가 다시 로드되면 main이 이전 팝업을 닫고(electron/main.js did-start-navigation), 새 렌더러가 마운트되며 다시 연다.
export function useFloatingWindow(enabled: boolean, side: 'left' | 'right') {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [inward, setInward] = useState<Inward>(side === 'right' ? 'right' : 'left');
  const shell = window.catTalk;

  useEffect(() => {
    if (!enabled) return;
    if (!shell) {
      const el = document.createElement('div');
      document.body.appendChild(el);
      setHost(el);
      return () => { el.remove(); setHost(null); };
    }
    const popup = window.open('about:blank', FLOATING_NAME, 'popup');
    if (!popup) return;
    prepare(popup.document);
    const unmirror = mirror(popup.document);
    const el = popup.document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0';
    popup.document.body.appendChild(el);
    setHost(el);
    // 닫기 전에 이름을 지운다: 곧바로 다시 열 때(StrictMode·토글 연타) 닫히는 중인 창이 같은 이름으로 재사용되지 않게
    const close = () => { try { popup.name = ''; } catch { /* 이미 닫힘 */ } popup.close(); };
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      unmirror();
      setHost(null);
      close();
    };
  }, [enabled, shell]);

  // 안쪽 방향: main이 원형을 놓거나 옮길 때마다 알린다. 알림을 놓치지 않게 구독한 뒤 현재 값을 묻는다(useDisplays와 같은 방식).
  // 브라우저 dev는 메인 반대편 하단 고정이라 메인 위치로 정한다
  useEffect(() => {
    const floating = shell?.floating;
    if (!floating) { setInward(side === 'right' ? 'right' : 'left'); return; }
    let alive = true;
    const update = (layout: { inward: Inward }) => { if (alive) setInward(layout.inward); };
    const off = floating.onLayout(update);
    void floating.layout().then(update);
    return () => { alive = false; off(); };
  }, [shell, side]);

  // 브라우저 dev 상자: 메인 반대편 하단, 원형이 끝에서 MARGIN 안쪽(창의 좌우 여백 SIDE만큼 밖으로 민다)
  useEffect(() => {
    if (shell || !host) return;
    const s = host.style;
    s.cssText = `position:fixed;z-index:50;width:${WIDTH}px;height:${HEIGHT}px;bottom:${MARGIN - BOTTOM}px;pointer-events:none`;
    if (side === 'right') s.left = `${MARGIN - SIDE}px`; else s.right = `${MARGIN - SIDE}px`;
  }, [shell, host, side]);

  return { host, inward };
}
