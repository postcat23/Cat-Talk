import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { SEND_COOLDOWN_MS, type Cooldown, type RestoredDraft } from '../hooks/useChatView';
import styles from './Composer.module.css';

const MAX_LEN = 50;
const MAX_HEIGHT = 118;   // 글 입력 최대 높이. 입력 상자 테두리(위아래 1px)를 더하면 120px

// Enter 또는 입력 상자 안 오른쪽 전송 버튼으로 보낸다. 전송 버튼은 전송 쿨다운(useChatView SEND_COOLDOWN_MS)을 보이려고 넣었다(사용자 결정,
// 2026-11-13 — 목업 v34는 버튼 없이 Enter만). 쿨다운 동안 Enter·버튼은 보내지 않고 글은 입력창에 그대로 두며,
// 버튼 테두리에 진행 링이 차오른다.
// hidden이면 display:none으로만 가린다(언마운트하면 입력 중이던 글이 사라진다).
export default function Composer({ disabled, hidden = false, restored, cooldown, onSend, onDraft }: {
  disabled: boolean;
  hidden?: boolean;
  restored: RestoredDraft | null;
  cooldown: Cooldown;
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
    if (!text || disabled || sending.current || cooldown.active) return;
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
        {/* 누른 뒤에도 입력창에서 이어 쓰게 포커스를 돌려준다 */}
        <button type="button" className={styles.sendbtn} aria-label="전송"
          disabled={disabled || !value.trim() || cooldown.active} onClick={() => { void send(); input.current?.focus(); }}>
          {cooldown.active && (
            <svg key={cooldown.key} className={styles.ring} viewBox="0 0 40 40" aria-hidden="true"
              style={{ '--cooldown': `${SEND_COOLDOWN_MS}ms` } as CSSProperties}>
              <circle cx="20" cy="20" r="18" pathLength="100" />
            </svg>
          )}
          <svg className={styles.arrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
          </svg>
        </button>
      </div>
      <div className={styles.help}><span>Enter 전송 · Shift+Enter 줄바꿈</span><span className={styles.c}>{value.length}/{MAX_LEN}</span></div>
    </div>
  );
}
