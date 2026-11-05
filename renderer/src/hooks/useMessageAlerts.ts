import { useEffect, useRef, useState } from 'react';

// 안 읽은 수: 안 보는 동안(포커스 없음·접힘) 받은 타인 메시지 수. 다시 보면 0. 표시는 main이 맡는다.
// incoming은 사이드카가 세는 타인 메시지 누적 수라 검색·목록 길이와 무관하게 증가분만 보면 된다.
export function useMessageAlerts(incoming: number | undefined, collapsed: boolean, toast: boolean, taskbar: boolean) {
  const shell = window.catTalk;
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [unread, setUnread] = useState(0);
  const last = useRef<number | undefined>(undefined);
  const watching = focused && !collapsed;

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => { if (watching) setUnread(0); }, [watching]);

  useEffect(() => {
    if (incoming === undefined) return;
    // 첫 값은 기준선. 사이드카가 다시 켜지면 0부터 세므로 줄어든 값도 기준선으로 삼는다
    const added = last.current === undefined ? 0 : incoming - last.current;
    last.current = incoming;
    if (added > 0 && !watching) setUnread((count) => count + added);
  }, [incoming, watching]);

  useEffect(() => { shell?.setUnread({ count: unread, toast, taskbar }); }, [shell, unread, toast, taskbar]);
}
