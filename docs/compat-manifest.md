# 호환성 매니페스트(원격 호환성 데이터, 1.0.8)

봉고캣 업데이트로 연결 지문이 바뀌면, Cat Talk 업데이트 없이 서명된 매니페스트를 올려 채팅 송신(T1)·모자와 스킨 표시(T2)를 복구한다. 게임 패치(T3, 상자 자동 오픈·투명화) 규칙은 이 경로로 넓힐 수 없고, 막는 것만 된다.

## 무엇을 어디에 올리나

- 파일: 레포 main의 `compat/manifest.json`과 `compat/manifest.json.sig`(Ed25519 서명 64바이트, 매니페스트 바이트 그대로에 대한 서명).
- 앱이 받는 주소: `https://raw.githubusercontent.com/postcat23/Cat-Talk/main/compat/manifest.json`(+`.sig`). 릴리스 자산은 쓰지 않는다.
- `.gitattributes`가 두 파일의 줄끝을 바꾸지 않게 한다. 줄끝이 바뀌면 서명이 깨진다.

## 형식

```json
{
  "schema": 1,
  "sequence": 2,
  "issued": "2026-11-20",
  "note": "봉고캣 빌드 NNNN 지문 추가",
  "add": { "chat": ["<64 hex>"], "profiles": ["<64 hex>"] },
  "deny": { "chat": ["<64 hex>"] },
  "patch": { "deny_sha256": ["<순정 Assembly-CSharp.dll sha256>"] }
}
```

- `sequence`: 올릴 때마다 1 이상 올린다. 앱은 받은 적 있는 번호보다 낮은 매니페스트(롤백)와, 같은 번호에 내용만 다른 매니페스트를 거부한다.
- `add`·`deny`: 기능(`chat`·`reactions`·`profiles`·`lobby`·`privacy`)별 연결 지문. 앱의 유효 계약 = (번들 ∪ `add`) − `deny`.
  - 매니페스트는 매번 전체 목록이다(직전 매니페스트와 합치지 않는다). 지난번에 넣은 지문도 계속 넣는다.
- `patch.deny_sha256`: 이 순정 DLL에는 상자 패치 새 설치·재적용·켜기를 막는다(이미 설치된 패치와 끄기는 그대로). 번들 목록에 더하기만 한다.
- 상한: 매니페스트 16KB, 기능마다 지문 64개(번들 포함), 패치 차단 256개. 넘으면 앱이 그 매니페스트를 거부한다.
- 그 밖의 키(티어·게이트·FeatureProbe 대상·패치 허용 등)는 앱이 읽지 않는다. `verify`가 '무시되는 키'로 알려 준다.

## 앱 동작

- 받는 시점: 앱 시작, 6시간마다. 모르는 연결 지문이 있으면('지원 안 하는 빌드') 즉시 받고, 1·2·4·8·16·30분 뒤마다 다시 받는다(이후 30분마다). 앱을 다시 켜면 1분부터 다시 센다.
- 검증: 앱에 든 공개키(`electron/compat-manifest.js` `PUBLIC_KEY`)로 서명, `sequence`, 크기를 본다. 통과한 매니페스트만 데이터 폴더에 캐시한다(`%LOCALAPPDATA%\CatTalk\compat\`).
- 우선순위: 검증된 새 매니페스트 > 검증된 캐시(오프라인) > 번들 계약. 받지 못하거나 거부하면 지금 쓰는 계약을 그대로 둔다.
- 반영: 유효 계약(`%LOCALAPPDATA%\CatTalk\compat\contract.json`)을 다시 쓰고 worker만 다시 띄운다. 재설치·앱 재시작은 없다.
- raw.githubusercontent.com은 몇 분간 캐시하므로, push 뒤 반영까지 그만큼(+ 백오프 간격) 걸릴 수 있다.

## 서명 키(한 번)

```
node tools/compat/manifest-sign.js keygen
```

- 암호를 두 번 입력한다(화면에 표시되지 않는다). 개인키는 암호로 감싸 `%USERPROFILE%\.cattalk\compat-signing.key`에, 공개키는 `compat-signing.pub`에 저장한다.
- 개인키는 레포·CI에 넣지 않는다(도구가 레포 안 경로를 거부한다). 개인키와 암호를 따로 백업한다.
- 키를 잃거나 바꾸면 새 공개키를 넣은 앱 릴리스가 필요하다(옛 앱은 새 키 서명을 받지 않는다).

## 게임 업데이트 대응(지문 추가)

1. 새 빌드 지문을 잰다(읽기 전용):
   `artifacts\compatibility\FeatureProbe.exe "<봉고캣 폴더>\BongoCat_Data\Managed" sidecar\compat\contract.json`
   출력의 기능별 값이 지금 계약에 없으면 그 기능이 '모르는 지문'이다.
2. 프로토콜이 실제로 같은지 확인한다(채팅·프로필 경로 diff — 바뀌었으면 매니페스트가 아니라 앱 릴리스로 고친다).
3. `compat/manifest.json`의 `add`에 새 지문을 더하고, `sequence`를 올리고, `issued`·`note`를 고친다.
4. 서명·확인:
   ```
   node tools/compat/manifest-sign.js sign
   node tools/compat/manifest-sign.js verify
   ```
5. `compat/manifest.json`과 `compat/manifest.json.sig`를 함께 커밋해 main에 push한다.

- 잘못 넣은 지문을 거둘 때는 `deny`에 넣고 `sequence`를 올린다(지운다고 앱이 되돌리지 않는다 — 앱은 마지막으로 받은 매니페스트를 캐시해 둔다).
- 게임 패치를 막아야 하면 순정 DLL sha256을 `patch.deny_sha256`에 넣는다. 패치를 허용하거나 규칙을 바꾸는 일은 앱 릴리스로만 한다.

## 시험용 덮어쓰기

- `CATTALK_MANIFEST_URL`: 매니페스트 주소(https, 소스 실행은 `http://127.0.0.1`·`localhost`도). `.sig`는 같은 주소 + `.sig`. 서명 검사는 그대로다.
- `CATTALK_MANIFEST_PUBKEY`: 공개키(base64). 소스 실행에서만 받는다(설치본은 무시).
- `CATTALK_CONTRACT`: 번들 계약 대신 쓸 파일(저하 시험).

## 진단 로그(main.log)

- `compat_effective`(시작 때 유효 계약의 출처: `bundle` 또는 `remote:<sequence>`)
- `compat_remote`(trigger `start`·`regular`·`unsupported`·`backoff`, result `accepted`·`unchanged`·`rejected`·`fetch_failed`와 사유)
- `compat_cache`(캐시 무시·쓰기 실패), `compat_override`, `compat_disabled`
- sidecar.log의 `compat_reload`(worker 교체)
