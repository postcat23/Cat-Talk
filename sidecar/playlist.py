"""플레이리스트 공유(D-053, /플리): 로비 멤버 데이터 cattalk.pl에 싣는 내 곡 목록과 로비 목록 합치기(순수 함수, Steam·큐 없음).

각 Cat Talk 사용자는 자기 멤버 데이터에만 쓴다(경고와 같은 메커니즘 — warns.py). 로비를 떠나면 Steam이 그 사람 값을 지우고,
나중에 들어온 사람도 지금 값을 받는다.
- cattalk.pl = [["<유튜브 영상 ID 11자>", 추가한 Steam 서버 시각(초)], ...] — 최대 MAX_ENTRIES개. URL·제목은 넣지 않는다
  (사용자 결정: 등록순을 로비 전원이 같게 보려고 추가 시각을 함께 둔다)
- 로비 목록 = 보이는 멤버 전원의 cattalk.pl 합집합. 같은 영상은 가장 먼저 넣은 하나만, 추가 시각순(등록순)
- 남이 쓴 값은 유튜브 영상 ID 형식만 받는다. 여는 URL은 앱이 ID로 다시 만든다(남이 넣은 raw URL은 열지 않는다, 사용자 명세)
"""
import json
import re

KEY = "cattalk.pl"
MAX_ENTRIES = 10           # 사용자당 최대 곡 수(사용자 명세)
MAX_VALUE_BYTES = 8000     # 경고 데이터와 같은 상한(Steam 문서 k_cubChatMetadataMax 8192보다 조금 아래). 10곡은 약 270바이트
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
# '/플리'로 시작하는 입력은 채팅으로 보내지 않는다(렌더러 chat/playlist.ts가 가로채고, 놓쳐도 사이드카 send가 막는다)
COMMAND = re.compile(r"^\s*/플리(?:\s|$)")


def valid_id(value):
    return isinstance(value, str) and VIDEO_ID.fullmatch(value) is not None


def parse(raw):
    """다른 클라이언트가 쓴 값이라 형식이 틀린 항목은 버린다. [(영상 ID, 시각)] — 같은 ID는 처음 것만, 최대 MAX_ENTRIES개."""
    if not isinstance(raw, str) or not raw or len(raw.encode("utf-8")) > MAX_VALUE_BYTES:
        return []
    try:
        value = json.loads(raw)
    except ValueError:
        return []
    if not isinstance(value, list):
        return []
    entries, seen = [], set()
    for entry in value:
        if (isinstance(entry, list) and len(entry) == 2 and valid_id(entry[0]) and type(entry[1]) is int and entry[1] > 0
                and entry[0] not in seen):
            entries.append((entry[0], entry[1]))
            seen.add(entry[0])
            if len(entries) >= MAX_ENTRIES:
                break
    return entries


def dump(entries):
    return json.dumps([[video, t] for video, t in entries], separators=(",", ":"))


def apply_add(entries, video, now):
    """내 목록 끝에 하나 더. (새 목록, 상태) — ok / exists(이미 내 목록에 있음) / full(MAX_ENTRIES개)."""
    if any(v == video for v, _ in entries):
        return entries, "exists"
    if len(entries) >= MAX_ENTRIES:
        return entries, "full"
    return entries + [(video, max(int(now), 1))], "ok"


def apply_remove(entries, video):
    return [(v, t) for v, t in entries if v != video]


def merge(members):
    """{멤버: [(영상, 시각)]} → [{"id", "by", "t"}] 등록순. 같은 영상은 가장 먼저 넣은 것(시각 → 멤버 → 그 사람 목록 순서)."""
    first = {}
    for uid, entries in members.items():
        for index, (video, t) in enumerate(entries):
            order = (t, str(uid), index)
            if video not in first or order < first[video][0]:
                first[video] = (order, uid, t)
    rows = sorted(first.items(), key=lambda item: item[1][0])
    return [{"id": video, "by": uid, "t": t} for video, (_, uid, t) in rows]
