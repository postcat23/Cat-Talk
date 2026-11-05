import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { RestoredDraft } from '../hooks/useChatView';
import styles from './Composer.module.css';

const MAX_LEN = 50;
const MAX_HEIGHT = 120;

// 보내기 버튼 없이 Enter로만 전송한다(목업 v34)
// hidden이면 display:none으로만 가린다(언마운트하면 입력 중이던 글이 사라진다).
export default function Composer({ disabled, hidden = false, restored, onSend, onDraft }: {
  disabled: boolean;
  hidden?: boolean;
  restored: RestoredDraft | null;
  onSend: (text: string) => Promise<boolean>;
  onDraft: (text: string, now?: boolean) => void;
}) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const touched = useRef(false);
  const sending = useRef(false);
  const latest = useRef('');

  function show(text: string) {
    latest.current = text;
    setValue(text);
  }

  // 복원은 사용자 입력이 아니라서 다시 저장하지 않는다. 글이 있으면 첫 입력 때처럼 높이를 맞춘다.
  useEffect(() => {
    if (!restored) return;
    if (restored.text) touched.current = true;
    show(restored.text);
  }, [restored]);

  // 내용에 맞춰 자동 높이(최대 120px). 목업과 같이 첫 입력 전에는 기본 높이를 유지한다.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || !touched.current) return;
    el.style.height = 'auto';
    // box-sizing:border-box라 scrollHeight에 없는 테두리를 더한다(없으면 내용이 맞아도 스크롤바가 뜬다)
    el.style.height = Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, MAX_HEIGHT) + 'px';
  }, [value]);

  // 전송이 거부되면 글을 남겨 다시 보낼 수 있게 한다. 응답을 기다리는 동안 이어 쓴 글도 지우지 않는다.
  async function send() {
    const text = value.trim();
    if (!text || disabled || sending.current) return;
    sending.current = true;
    const ok = await onSend(text);
    sending.current = false;
    if (ok && latest.current === value) {
      show('');
      onDraft('', true);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 IME 조합 중 Enter는 조합 확정용이므로 전송하지 않는다
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className={styles.composer} hidden={hidden}>
      <div className={styles.inrow}>
        <textarea ref={input} rows={1} placeholder="메시지 입력" maxLength={MAX_LEN} disabled={disabled}
          value={value} onChange={(e) => { touched.current = true; show(e.target.value); onDraft(e.target.value); }} onKeyDown={onKeyDown} />
      </div>
      <div className={styles.help}><span>Enter 전송 · Shift+Enter 줄바꿈</span><span className={styles.c}>{value.length}/{MAX_LEN}</span></div>
    </div>
  );
}
