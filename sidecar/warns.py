"""경고·공개수배(D-052): 로비 멤버 데이터에 싣는 Cat Talk 전용 상태와 그 집계(순수 함수, Steam·큐 없음).

각 Cat Talk 사용자는 자기 멤버 데이터에만 쓴다(Steam SetLobbyMemberData는 본인 데이터만 쓸 수 있다).
- cattalk.warns  = {"<대상 SteamID64>": [내가 그 대상에게 준 경고 수, 마지막 경고의 Steam 서버 시각(초)]}
- cattalk.wanted = {"<대상 SteamID64>": 처형 시각} — 내가 기여했던 대상이 공개수배되면 남기는 표식
게임은 hat·skin 등 정해진 키만 읽어 바닐라 화면에는 나오지 않는다(바닐라는 멤버 데이터가 바뀌면 그 멤버 고양이 외형만 다시 적용).
칭찬(1.0.8, 사용자 명세 2026-11-19 — 경고의 거울)도 같은 모양·같은 집계를 쓴다:
- cattalk.praise  = {"<대상>": [내가 준 칭찬 수, 마지막 칭찬 시각]}, cattalk.praised = {"<대상>": 칭찬 도장 발동 시각}
아래 함수는 키와 무관하게 (누적 항목, 발동 표식) 쌍을 다룬다 — 경고·칭찬 모두 같은 함수로 센다.

집계(모든 Cat Talk 클라이언트가 같은 데이터로 같은 값을 얻는다):
- 처형 시각 cut(X) = 로비 전원의 wanted[X] 중 최댓값(없으면 0)
- 유효한 경고 = t > cut(X)인 항목. 경고 총횟수 S(X) = 유효한 항목 수의 합(총 누적 — 한 사람이 여러 번 준 것도 다 센다)
- S(X) >= THRESHOLD면 공개수배. 처형 시각 T = 유효한 항목의 t 중 최댓값(데이터만으로 정해져 클라이언트마다 같다)
- 처형되면 기여자는 자기 항목을 지우고 wanted[X] = T를 남긴다. 그 순간 Cat Talk을 꺼 둔 기여자의 항목은 t <= T라
  모두가 셈에서 빼고, 그 사람이 다시 켜면 자기 옛 항목을 정리한다(사용자 결정: 처형 시각 표식).
"""
import json
import re

WARNS_KEY = "cattalk.warns"
WANTED_KEY = "cattalk.wanted"
PRAISE_KEY = "cattalk.praise"
PRAISED_KEY = "cattalk.praised"
THRESHOLD = 3              # 총횟수가 여기에 닿으면 발동 — 경고는 공개수배, 칭찬은 칭찬 도장(사용자 명세)
MAX_VALUE_BYTES = 8000     # Steam 멤버 데이터 값 상한(k_cubChatMetadataMax 8192)보다 조금 아래
MAX_WANTED_MARKERS = 64    # 처형 표식은 최근 것만 둔다(로비를 떠난 대상의 오래된 표식이 쌓이지 않게)
STEAM_ID64 = re.compile(r"^[1-9][0-9]{16}$")
MAX_COUNT = 1_000_000


def _load(raw):
    if not isinstance(raw, str) or not raw or len(raw) > MAX_VALUE_BYTES:
        return {}
    try:
        value = json.loads(raw)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def parse_warns(raw):
    """다른 클라이언트가 쓴 값이라 형식이 틀린 항목은 버린다. {대상: (수, 시각)}"""
    result = {}
    for target, entry in _load(raw).items():
        if (STEAM_ID64.match(str(target)) and isinstance(entry, list) and len(entry) == 2
                and all(type(v) is int for v in entry) and 0 < entry[0] <= MAX_COUNT and entry[1] > 0):
            result[str(target)] = (entry[0], entry[1])
    return result


def parse_wanted(raw):
    return {str(t): v for t, v in _load(raw).items() if STEAM_ID64.match(str(t)) and type(v) is int and v > 0}


def dump_warns(warns):
    return json.dumps({t: [c, s] for t, (c, s) in sorted(warns.items())}, separators=(",", ":"))


def dump_wanted(wanted):
    newest = sorted(wanted.items(), key=lambda kv: kv[1], reverse=True)[:MAX_WANTED_MARKERS]
    return json.dumps(dict(sorted(newest)), separators=(",", ":"))


def cuts(members):
    """members: {uid: (warns, wanted)} → {대상: 처형 시각 최댓값}"""
    result = {}
    for _, wanted in members.values():
        for target, t in wanted.items():
            result[target] = max(result.get(target, 0), t)
    return result


def tally(members):
    """{대상: {"count": 총횟수, "last": 유효 항목의 최신 시각, "cut": 처형 시각}} — 총횟수가 0인 대상은 빠진다."""
    cut = cuts(members)
    result = {}
    for warns, _ in members.values():
        for target, (count, t) in warns.items():
            if t <= cut.get(target, 0):
                continue
            row = result.setdefault(target, {"count": 0, "last": 0, "cut": cut.get(target, 0)})
            row["count"] += count
            row["last"] = max(row["last"], t)
    return result


def apply_warn(warns, target, now, cut):
    """내 경고 하나 더. 처형 전(t <= cut)의 내 옛 항목은 이미 쓰인 것이라 새로 센다. 같은 초의 처형과 겹치지 않게 시각은 cut보다 크게."""
    count, t = warns.get(target, (0, 0))
    if t <= cut:
        count, t = 0, 0
    updated = dict(warns)
    updated[target] = (min(count + 1, MAX_COUNT), max(now, t, cut + 1))
    return updated


def apply_consume(warns, wanted, target, when):
    """처형 시각 when까지의 내 항목을 지우고 표식을 남긴다. 바뀐 것이 없으면 같은 값을 돌려준다."""
    updated_warns = dict(warns)
    entry = updated_warns.get(target)
    if entry and entry[1] <= when:
        del updated_warns[target]
    updated_wanted = dict(wanted)
    if updated_wanted.get(target, 0) < when:
        updated_wanted[target] = when
    return updated_warns, updated_wanted


def stale(warns, cut):
    """다른 사람의 처형 표식보다 오래된 내 항목(내가 꺼져 있던 동안 처형됨) → 지워야 할 대상과 그 처형 시각."""
    return {target: cut[target] for target, (_, t) in warns.items() if t <= cut.get(target, 0)}

# 채팅 입력의 경고 명령: '@이름 경고!'(이름에 공백이 있을 수 있다). 렌더러(chat/warns.ts)와 같은 규칙.
# 이 모양은 채팅(채널 3)으로 보내지 않는다 — 바닐라 말풍선에 나오지 않게(사이드카 send가 한 번 더 막는다).
COMMAND = re.compile(r"^\s*@(.+?)\s*경고!\s*$")
# 칭찬 명령 '@이름 칭찬!'(1.0.8). 렌더러(chat/warns.ts PRAISE_COMMAND)와 같은 규칙이고, 경고처럼 채팅으로 보내지 않는다
PRAISE_COMMAND = re.compile(r"^\s*@(.+?)\s*칭찬!\s*$")
