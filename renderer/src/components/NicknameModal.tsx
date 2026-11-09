import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useUi } from '../state/UiContext';
import { useChat } from '../hooks/useChatView';
import styles from './NicknameModal.module.css';

// 사이드카 NICKNAME_MAX와 같은 값. 코드 포인트 기준이라 [...v]로 센다(이모지 1개 = 1자)
export const NICKNAME_MAX = 15;
const cap = (v: string) => [...v].slice(0, NICKNAME_MAX).join('');

// 참여자 닉네임 변경(D-032). 참여자 모달 위, 앱(패널) 가운데에 뜬다.
export default function NicknameModal() {
  const { overlays } = useUi();
  const id = overlays.nicknameFor;
  // 대상마다 새로 만들어 입력값을 그 참여자의 현재 닉네임으로 시작한다
  return id ? <NicknameDialog key={id} id={id} /> : null;
}

// 반영은 [저장] 한 곳에서만 한다. [초기화]는 입력란만 비우고(빈칸이면 placeholder로 기본 Steam 닉네임이 보인다),
// 빈 값으로 저장하면 사이드카가 그 항목을 지워 기본 닉네임으로 돌아간다.
function NicknameDialog({ id }: { id: string }) {
  const { dispatch } = useUi();
  const { byId, nicknames, setNickname } = useChat();
  const [value, setValue] = useState(() => nicknames[id] ?? '');
  const input = useRef<HTMLInputElement>(null);
  const downOnBackdrop = useRef(false);
  const close = () => dispatch({ type: 'closeNickname' });
  const save = () => { close(); void setNickname(id, value.trim()); };

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Esc는 포커스가 버튼에 있어도 취소. 한글 조합 중 Esc는 조합 취소라 모달을 닫지 않는다
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) dispatch({ type: 'closeNickname' }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
  };
  // 배경에서 누르고 배경에서 뗐을 때만 취소(입력란에서 드래그하다 밖에서 떼는 경우는 닫지 않는다)
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (downOnBackdrop.current && e.target === e.currentTarget) close();
  };

  return (
    <div className={styles.backdrop} onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }} onClick={onBackdropClick}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="nickname-title">
        <h2 id="nickname-title">닉네임 변경</h2>
        <input ref={input} value={value} placeholder={byId(id)?.base ?? ''} aria-label="닉네임" autoComplete="off" spellCheck={false}
          onChange={(e) => setValue(cap(e.target.value))} onKeyDown={onEnter} />
        <div className={styles.count}>{[...value].length}/{NICKNAME_MAX}</div>
        <div className={styles.actions}>
          <button type="button" onClick={() => { setValue(''); input.current?.focus(); }}>초기화</button>
          <span className={styles.spacer} />
          <button type="button" onClick={close}>취소</button>
          <button type="button" className={styles.save} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}
