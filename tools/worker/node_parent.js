// Electron 역할(test_worker_lifecycle.py): libuv uv_spawn으로 사이드카 모형을 파이프 stdio로 띄운다(분리하지 않음 — Electron main과
// 같은 방식). 이 프로세스를 강제 종료하면 libuv 잡이 사이드카를 즉시 끝낸다(2026-11-20 진단). 출력: {"node": pid} 한 줄 + 모형 출력.
const { spawn } = require('child_process');

const [exe, ...args] = process.argv.slice(2);
const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
child.stdout.on('data', (chunk) => process.stdout.write(chunk));
process.stdout.write(JSON.stringify({ node: process.pid }) + '\n');
setInterval(() => {}, 1000);
