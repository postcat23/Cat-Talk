import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import styles from './Composer.module.css';

const MAX_LEN = 50;
const MAX_HEIGHT = 120;

// 보내기 버튼 없이 Enter로만 전송한다(목업 v34)
export default function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const touched = useRef(false);

  // 내용에 맞춰 자동 높이(최대 120px). 목업과 같이 첫 입력 전에는 기본 높이를 유지한다.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || !touched.current) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  }, [value]);

  function send() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 IME 조합 중 Enter는 조합 확정용이므로 전송하지 않는다
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className={styles.composer}>
      <div className={styles.inrow}>
        <textarea ref={input} rows={1} placeholder="메시지 입력" maxLength={MAX_LEN} disabled={disabled}
          value={value} onChange={(e) => { touched.current = true; setValue(e.target.value); }} onKeyDown={onKeyDown} />
      </div>
      <div className={styles.help}><span>Enter 전송 · Shift+Enter 줄바꿈</span><span className={styles.c}>{value.length}/{MAX_LEN}</span></div>
    </div>
  );
}
