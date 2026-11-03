"""D-003 저장 분할 글루: 채팅 계열은 인메모리, settings만 디스크에 영속한다.

upstream src/bongo_chat/store.py는 수정하지 않는다. Store를 그대로 상속하고
- 부모 연결(self.db)을 ":memory:"로 열어 messages·drafts·sessions·receipts·presence_events·
  timeline을 프로세스 수명에만 두고(종료 시 소멸),
- setting()만 별도 디스크 연결로 돌리며,
- 차단 기능(blocked_users/set_blocked)은 무력화한다(차단 미구현 결정).
"""
import json
from pathlib import Path
import sqlite3

from bongo_chat.store import Store

# Path(":memory:")는 os.fspath가 ":memory:" 문자열을 돌려줘 sqlite가 인메모리로 연다.
# Windows 실측: PRAGMA database_list의 main 파일명 '', journal_mode=memory, 디스크 파일 없음.
# 부모의 path.parent.mkdir()은 Path('.')라 무해하다.
MEMORY = Path(":memory:")


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
        return {}

    def set_blocked(self, account, steam_id, blocked, name=""):
        pass

    def close(self):
        try:
            super().close()
        finally:
            self.settings_db.close()
