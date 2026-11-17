import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { SEND_COOLDOWN_MS, type Cooldown, type RestoredDraft } from '../hooks/useChatView';
import type { Participant } from '../chat/model';
import { filterParticipants, mentionAt, parseWarnCommand, resolveTarget, type Mention } from '../chat/warns';
import Cat from './Cat';
import YellowCards from './YellowCards';
import styles from './Composer.module.css';

const MAX_LEN = 50;
const MAX_HEIGHT = 118;   // 글 입력 최대 높이. 입력 상자 테두리(위아래 1px)를 더하면 120px
const MAX_SUGGEST = 20;   // @ 자동완성 목록 최대 줄 수(로비 인원보다 넉넉하게. 화면에는 약 5줄, 나머지는 스크롤)

// Enter 또는 입력 상자 안 오른쪽 전송 버튼으로 보낸다. 전송 버튼은 전송 쿨다운(useChatView SEND_COOLDOWN_MS)을 보이려고 넣었다(사용자 결정,
// 2026-11-13 — 목업 v34는 버튼 없이 Enter만). 쿨다운 동안 Enter·버튼은 보내지 않고 글은 입력창에 그대로 두며,
// 버튼 테두리에 진행 링이 차오른다.
// hidden이면 display:none으로만 가린다(언마운트하면 입력 중이던 글이 사라진다).
// 경고(D-052): '@'를 치면 참여자 자동완성(입력한 글자가 든 사람을 입력 상자 위 목록으로, 사용자 명세). '@이름 경고!'는 채팅으로 보내지 않고
// onWarn으로 가로챈다(채팅 쿨다운과 무관). 목록에서 고른 사람은 id로 묶어 이름이 같은 사람이 있어도 정확히 지목한다.
// 직접 친 이름을 찾지 못하거나 여러 명이면 안내만 하고 글은 입력창에 남긴다.
export default function Composer({ disabled, hidden = false, restored, cooldown, participants, meId, onSend, onWarn, onNotify, onDraft }: {
  disabled: boolean;
  hidden?: boolean;
  restored: RestoredDraft | null;
  cooldown: Cooldown;
  participants: Participant[];
  meId?: string;
  onSend: (text: string) => Promise<boolean>;
  onWarn: (target: string) => Promise<boolean>;
  onNotify: (text: string) => void;
  onDraft: (text: string, now?: boolean) => void;
}) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const touched = useRef(false);
  const sending = useRef(false);
  const latest = useRef('');
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);   // Esc로 닫으면 다음 입력까지 열지 않는다
  const bound = useRef<Mention | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const candidates = useMemo(() => (mention ? filterParticipants(mention.query, participants).slice(0, MAX_SUGGEST) : []), [mention, participants]);
  const suggesting = !!mention && !dismissed && !disabled && candidates.length > 0;
  const command = parseWarnCommand(value) !== null;

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

  // 선택한 줄이 목록 밖이면 보이게 스크롤
  useEffect(() => { list.current?.children[index]?.scrollIntoView({ block: 'nearest' }); }, [index, suggesting]);

  function updateMention(text: string, caret: number) {
    setMention(mentionAt(text, caret));
    setIndex(0);
  }

  // '@조각'을 '@이름 '으로 바꾸고 그 사람을 묶어 둔다. 커서는 이름 뒤 공백 다음으로
  function pick(p: Participant) {
    const el = input.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? value.length;
    const text = value.slice(0, mention.start) + '@' + p.name + ' ' + value.slice(caret);
    const pos = mention.start + p.name.length + 2;
    touched.current = true;
    show(text);
    onDraft(text);
    bound.current = { id: p.id, name: p.name };
    setMention(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  }

  // '@이름 경고!': 채팅이 아니라 경고. 대상을 못 찾거나 여러 명이면 안내하고 글은 남긴다
  async function warn(name: string) {
    const target = resolveTarget(name, participants, bound.current);
    if (target === 'none') { onNotify(`'${name}'님을 로비에서 찾지 못했습니다. @를 입력해 목록에서 골라 주세요.`); return; }
    if (target === 'ambiguous') { onNotify(`'${name}' 이름이 여러 명입니다. @를 입력해 목록에서 골라 주세요.`); return; }
    sending.current = true;
    const ok = await onWarn(target);
    sending.current = false;
    if (ok && latest.current === value) {
      show('');
      onDraft('', true);
      bound.current = null;
    }
  }

  // 전송이 거부되면 글을 남겨 다시 보낼 수 있게 한다. 응답을 기다리는 동안 이어 쓴 글도 지우지 않는다.
  async function send() {
    const text = value.trim();
    if (!text || disabled || sending.current) return;
    const name = parseWarnCommand(text);
    if (name !== null) { await warn(name); return; }
    if (cooldown.active) return;
    sending.current = true;
    const ok = await onSend(text);
    sending.current = false;
    if (ok && latest.current === value) {
      show('');
      onDraft('', true);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 자동완성이 열려 있으면 ↑↓로 고르고 Enter·Tab으로 넣는다(Esc는 닫기). 한글 조합 중 Enter는 조합 확정용이라 건너뛴다
    if (suggesting && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setIndex((i) => (i + step + candidates.length) % candidates.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(candidates[Math.min(index, candidates.length - 1)]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); return; }
    }
    // 한글 IME 조합 중 Enter는 조합 확정용이므로 전송하지 않는다
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className={styles.composer} hidden={hidden}>
      {/* @ 자동완성: 입력 상자 바로 위 목록(사용자 예시 레이아웃). 마우스는 누르는 순간 넣는다(입력창 포커스 유지) */}
      {suggesting && (
        <div ref={list} className={`${styles.suggest} thin-scroll`} role="listbox" aria-label="참여자">
          {candidates.map((p, i) => (
            <div key={p.id} role="option" aria-selected={i === index} className={i === index ? `${styles.sitem} ${styles.on}` : styles.sitem}
              onMouseEnter={() => setIndex(i)} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              <span className={styles.sav} style={{ background: p.color }}><Cat src={p.avatar} framing="face" /></span>
              <span className={styles.stext}>
                <span className={styles.sname}>
                  <span className={styles.snm}>{p.name}</span>
                  {p.id === meId && <span className={styles.sme}>나</span>}
                  <YellowCards count={p.warns} />
                </span>
                {p.base !== p.name && <span className={styles.sbase}>{p.base}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.inrow}>
        <textarea ref={input} rows={1} placeholder="메시지 입력" maxLength={MAX_LEN} disabled={disabled}
          value={value} onKeyDown={onKeyDown}
          onChange={(e) => { touched.current = true; show(e.target.value); onDraft(e.target.value); setDismissed(false); updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onClick={(e) => updateMention(value, e.currentTarget.selectionStart ?? value.length)}
          onBlur={() => setMention(null)} />
        {/* 누른 뒤에도 입력창에서 이어 쓰게 포커스를 돌려준다 */}
        <button type="button" className={styles.sendbtn} aria-label="전송"
          disabled={disabled || !value.trim() || (cooldown.active && !command)} onClick={() => { void send(); input.current?.focus(); }}>
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
