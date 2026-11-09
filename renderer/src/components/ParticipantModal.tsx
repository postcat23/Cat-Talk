import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { OVERLAY_HEIGHT, useUi } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import Cat from './Cat';
import styles from './ParticipantModal.module.css';

const MENU_HEIGHT = 100;   // .menu 높이(3항목). 모달 아래로 잘리지 않게 위치를 올릴 때 쓴다
const stop = (e: PointerEvent) => e.stopPropagation();

export default function ParticipantModal() {
  const { settings, overlays, dispatch } = useUi();
  const { participants, me, openProfile, openTrade } = useChat();
  const modal = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);

  useEffect(() => { if (!overlays.modalOpen) setMenu(null); }, [overlays.modalOpen]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey); };
  }, [menu]);

  // 목록이 스크롤 영역이라 메뉴는 그 밖(모달 기준)에 띄운다. 버튼 오른쪽 끝에 맞춘다
  function toggleMenu(e: MouseEvent<HTMLButtonElement>, id: string) {
    if (menu?.id === id || !modal.current) { setMenu(null); return; }
    const box = modal.current.getBoundingClientRect(), button = e.currentTarget.getBoundingClientRect();
    setMenu({ id, right: box.right - button.right, top: Math.min(button.bottom + 4, box.bottom - MENU_HEIGHT - 6) - box.top });
  }

  // '나' 최상단 고정, 나머지는 한국어 로캘 정렬
  const sorted = [
    ...participants.filter((p) => p.id === me?.id),
    ...participants.filter((p) => p.id !== me?.id).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  ];
  return (
    <div className={[styles.modal, overlays.modalOpen && styles.show, OVERLAY_HEIGHT[settings.height] === '100%' && styles.full].filter(Boolean).join(' ')} aria-label="참여자" ref={modal}>
      <div className={styles.mhead}>
        <button className={styles.close} aria-label="닫기" onClick={() => dispatch({ type: 'closeOverlays' })}>×</button>
        <h2><span className={styles.sil} aria-hidden="true" />함께 있는 고양이</h2>
        <p>더보기에서 Steam 프로필 열기와 교환 요청을 할 수 있습니다.</p>
      </div>
      <div className={`${styles.mlist} thin-scroll`} onScroll={() => setMenu(null)}>
        {sorted.map((p) => (
          <div key={p.id} className={styles.prow}>
            <span className={styles.av} style={{ background: p.color }}><Cat src={p.avatar} framing="face" /></span>
            <span className={styles.nm}>{p.name}</span>
            {p.id === me?.id
              ? <span className={styles.meBadge}>나</span>
              : <button className={styles.dots} aria-label="더보기" aria-haspopup="menu" aria-expanded={menu?.id === p.id} onPointerDown={stop} onClick={(e) => toggleMenu(e, p.id)}>⋯</button>}
          </div>
        ))}
      </div>
      {menu && (
        <div className={styles.menu} role="menu" style={{ top: menu.top, right: menu.right }} onPointerDown={stop}>
          <button role="menuitem" onClick={() => { setMenu(null); void openProfile(menu.id); }}>프로필 열기</button>
          <button role="menuitem" onClick={() => { setMenu(null); void openTrade(menu.id); }}>교환 요청</button>
          <button role="menuitem" onClick={() => { setMenu(null); dispatch({ type: 'openNickname', id: menu.id }); }}>닉네임 변경</button>
        </div>
      )}
    </div>
  );
}
