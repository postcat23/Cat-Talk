// 목업(.sw/cat-talk-mock.html) 샘플과 동일한 목데이터. 브리지 없는 브라우저 dev에서 mockBridge가 view 형식으로 돌려준다.
import type { ViewMessage, ViewProfile } from '../chat/model';

export const PROFILES: Record<string, ViewProfile> = {
  p1: { name: '미소미소된장국', color: '#f2c0a0', hat: '🎩' },
  p2: { name: 'RATOY', color: '#ffe08a', hat: '🧢' },
  p3: { name: 'FwanTaStic K', color: '#b7e0ff', hat: '👑' },
  p4: { name: '리버', color: '#ffc2d1', hat: '🎀' },
  p5: { name: '리네', color: '#d8c0ff', hat: '🍃' },
  p6: { name: 'Comedian', color: '#c8f0c8', hat: '🤡' },
  p7: { name: 'CUBE', color: '#cfd6ff', hat: '' },
  p8: { name: 'ConE', color: '#ffd27d', hat: '🧙' },
  p9: { name: '자깡', color: '#b7e0ff', hat: '🐟' },
  p10: { name: 'Borizaru', color: '#ffd0b0', hat: '' },
  p11: { name: '넙치', color: '#cfe', hat: '🧢' },
  p12: { name: '모리', color: '#fcd', hat: '' },
};

export const ME_ID = 'p8';

// 닉네임 덮어쓰기 시작값(D-032). 비어 있으면 모두 기본 이름. 목업에서 [저장]으로 바뀐 값은 메모리에만 둔다
export const INITIAL_NICKNAMES: Record<string, string> = {};

function today(hours: number, minutes: number) {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.getTime() / 1000;
}

const line = (seq: number, sender: string, body: string, minutes: number): ViewMessage => ({
  seq, id: 'i' + seq, sender, name: PROFILES[sender].name ?? '', body, received: today(9, minutes),
  own: sender === ME_ID ? 1 : 0, status: sender === ME_ID ? 'accepted' : 'received',
});

export const INITIAL_MESSAGES: ViewMessage[] = [
  { ...line(1, 'p4', '', 35), kind: 'member_joined' },
  line(2, 'p4', '다들 아직 있음?', 36),
  line(3, 'p8', '다른 모니터 절대 사수해야 함…', 37),
  line(4, 'p9', '리버님 붕고 없으니까 끝으로 가세요', 38),
  line(5, 'p9', 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋ', 38),
  line(6, 'p4', '뢱?', 38),
];
