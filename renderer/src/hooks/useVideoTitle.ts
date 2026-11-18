import { useEffect, useState } from 'react';
import { shortLink, VIDEO_ID } from '../chat/playlist';

// 플리(D-053) 영상 제목. main이 oEmbed → og:title로 찾고(electron/playlist.js), 여기서는 이번 실행 동안 메모리에만 둔다.
// 받는 쪽(추가 알림을 띄우는 클라이언트)이 각자 조회한다(사용자 명세). 모르거나 못 찾으면 짧은 링크(youtu.be/ID)를 보인다.
const titles = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function fetchTitle(id: string): Promise<string | null> {
  const known = titles.get(id);
  if (known !== undefined) return Promise.resolve(known);
  const running = pending.get(id);
  if (running) return running;
  const lookup = window.catTalk?.playlist?.title(id) ?? Promise.resolve(null);   // 브라우저 dev: main이 없어 링크로 둔다
  const request = lookup.catch(() => null).then((title) => {
    pending.delete(id);
    titles.set(id, title);
    return title;
  });
  pending.set(id, request);
  return request;
}

export function useVideoTitle(id: string): string {
  const [title, setTitle] = useState<string | null>(() => titles.get(id) ?? null);
  useEffect(() => {
    if (!VIDEO_ID.test(id)) return;
    let alive = true;
    setTitle(titles.get(id) ?? null);
    void fetchTitle(id).then((value) => { if (alive) setTitle(value); });
    return () => { alive = false; };
  }, [id]);
  return title ?? shortLink(id);
}
