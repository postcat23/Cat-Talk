"""D-003 저장 분할 글루: 채팅 계열은 인메모리, settings만 디스크에 영속한다.

upstream src/bongo_chat/store.py는 수정하지 않는다. Store를 그대로 상속하고
- 부모 연결(self.db)을 ":memory:"로 열어 messages·drafts·sessions·receipts·presence_events·
  timeline을 프로세스 수명에만 두고(종료 시 소멸),
- setting()만 별도 디스크 연결로 돌리며,
- 차단 목록(blocked_users/set_blocked)은 그 settings에 계정별 키 'blocked:<account>'로 영속한다(D-033).
  업스트림 blocked_users 테이블은 인메모리라 쓰지 않는다.
"""
import json
from pathlib import Path
import sqlite3

from bongo_chat.store import Store

# Path(":memory:")는 os.fspath가 ":memory:" 문자열을 돌려줘 sqlite가 인메모리로 연다.
# Windows 실측: PRAGMA database_list의 main 파일명 '', journal_mode=memory, 디스크 파일 없음.
# 부모의 path.parent.mkdir()은 Path('.')라 무해하다.
MEMORY = Path(":memory:")


def blocked_key(account):
    return f"blocked:{account}"


class VolatileStore(Store):
    def __init__(self, settings_path: Path):
        # ChatService.__init__가 곧바로 setting()을 부르므로 영속 연결을 먼저 연다.
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_db = sqlite3.connect(settings_path, timeout=0.25)
        with self.settings_db:
            self.settings_db.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        try:
            super().__init__(MEMORY)
        except BaseException:
            self.settings_db.close()
            raise

    def setting(self, key, value=None, default=None):
        # Store.setting과 같은 직렬화(json)·시맨틱을 영속 연결에 적용한다.
        if value is not None:
            with self.settings_db:
                self.settings_db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, json.dumps(value)))
        row = self.settings_db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def blocked_users(self, account):
        # 업스트림 Store와 같은 반환: {steam_id: name}, steam_id 순. 깨진 저장값은 버린다
        value = self.setting(blocked_key(account), default={})
        if not isinstance(value, dict):
            return {}
        return {k: value[k] for k in sorted(value) if isinstance(k, str) and isinstance(value[k], str)}

    def set_blocked(self, account, steam_id, blocked, name=""):
        users = self.blocked_users(account)
        if blocked:
            users.setdefault(steam_id, name)   # 업스트림 INSERT OR IGNORE처럼 처음 저장한 이름을 유지
        else:
            users.pop(steam_id, None)
        self.setting(blocked_key(account), users)

    def close(self):
        try:
            super().close()
        finally:
            self.settings_db.close()
