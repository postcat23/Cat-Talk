// 입력 언어 기억(D-027): 어디를 갔다 와도 Cat Talk는 이전에 쓰던 한/영 상태로 돌아온다.
// 게임 등 IME가 꺼진 창에서 돌아오면 Windows가 영어로 되돌리는 경우가 있다. WM_IME_CONTROL로 값을 넣으면
// 곧바로 되돌아가서(실측) 사용자가 누르는 것과 같은 한/영 키를 보낸다. 판단은 sys를 주입받아 실제 IME 없이 검증한다.
const POLL_MS = 40;
const SETTLE_MS = 1500;   // 복귀 후 이 시간 동안은 기억한 언어로 맞추고, 지나면 현재 언어를 기억한다
const FIRST_TOGGLE_MS = 150;   // 복귀 직후 상태가 흔들리는 구간은 건너뛴다
const RETRY_MS = 300;
const MAX_TOGGLES = 3;
const WRONG_READS = 2;   // 잘못 읽은 값으로 언어를 뒤집지 않게 연속으로 달라야 누른다

function createImeMemory(sys, now = Date.now) {
  let desired = null, timer = null, settleUntil = 0, nextToggle = 0, toggles = 0, wrong = 0;

  // sys.read(): 한글이면 true, 영어면 false, 읽지 못하면 null
  function tick() {
    if (!sys.isForeground()) return;
    const hangul = sys.read();
    if (hangul === null) return;
    const t = now();
    if (t >= settleUntil) { desired = hangul; return; }
    if (desired === null) return;
    wrong = hangul === desired ? 0 : wrong + 1;
    if (wrong >= WRONG_READS && t >= nextToggle && toggles < MAX_TOGGLES) {
      sys.toggle();
      toggles++; wrong = 0; nextToggle = t + RETRY_MS;
    }
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  function start() {
    stop();
    const t = now();
    settleUntil = t + SETTLE_MS; nextToggle = t + FIRST_TOGGLE_MS; toggles = 0; wrong = 0;
    timer = setInterval(tick, POLL_MS);
  }

  return { start, stop, tick };
}

// HWND는 값으로만 다루므로 uintptr_t로 선언한다.
function win32Sys(win) {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll'), imm32 = koffi.load('imm32.dll');
  const getForeground = user32.func('uintptr_t __stdcall GetForegroundWindow()');
  const sendMessage = user32.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t hWnd, uint32_t Msg, uintptr_t wParam, intptr_t lParam, uint32_t fuFlags, uint32_t uTimeout, _Out_ uintptr_t *lpdwResult)');
  const keybdEvent = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)');
  const defaultImeWnd = imm32.func('uintptr_t __stdcall ImmGetDefaultIMEWnd(uintptr_t hWnd)');

  const WM_IME_CONTROL = 0x283, IMC_GETCONVERSIONMODE = 1, IMC_GETOPENSTATUS = 5;
  const SMTO_ABORTIFHUNG = 2, TIMEOUT_MS = 100;
  const VK_HANGUL = 0x15, KEYEVENTF_KEYUP = 2, IME_CMODE_NATIVE = 1;
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE();

  const query = (ime, command) => {
    const result = [0];
    return sendMessage(ime, WM_IME_CONTROL, command, 0, SMTO_ABORTIFHUNG, TIMEOUT_MS, result) ? Number(result[0]) : null;
  };

  return {
    isForeground: () => BigInt(getForeground()) === hwnd,
    read() {
      const ime = defaultImeWnd(hwnd);
      const open = query(ime, IMC_GETOPENSTATUS), mode = query(ime, IMC_GETCONVERSIONMODE);
      if (open === null || mode === null) return null;
      return open === 1 && (mode & IME_CMODE_NATIVE) === IME_CMODE_NATIVE;
    },
    toggle() {
      keybdEvent(VK_HANGUL, 0, 0, 0);
      keybdEvent(VK_HANGUL, 0, KEYEVENTF_KEYUP, 0);
    },
  };
}

// Windows 전용. 네이티브 모듈을 못 읽어도 언어 기억만 빠지고 앱은 그대로 돈다.
function attachImeMemory(win) {
  if (process.platform !== 'win32') return;
  let memory;
  try { memory = createImeMemory(win32Sys(win)); }
  catch (e) { console.error('[ime-memory] unavailable:', e.message); return; }
  win.on('focus', memory.start);
  win.on('blur', memory.stop);
  win.on('closed', memory.stop);
  if (win.isFocused()) memory.start();
}

module.exports = { attachImeMemory, createImeMemory, win32Sys, POLL_MS, SETTLE_MS, FIRST_TOGGLE_MS, RETRY_MS, MAX_TOGGLES };
