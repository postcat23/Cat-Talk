import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = 5173;   // electron/main.js의 dev URL과 맞춘다

// dev는 Vite HMR(react-refresh 인라인 프리앰블, ws)을 허용하고, prod(file://)는 로컬 자원만 허용한다.
const CSP = {
  serve: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:${DEV_PORT}`,
  build: "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'",
};

function csp(): Plugin {
  let policy = CSP.build;
  return {
    name: 'cattalk-csp',
    configResolved(config) { policy = CSP[config.command]; },
    transformIndexHtml: (html) => html.replace('__CSP__', policy),
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./renderer', import.meta.url)),
  base: './',   // Electron prod가 file://로 dist를 로딩하므로 상대 경로
  plugins: [react(), csp()],
  server: { port: DEV_PORT, strictPort: true },
  // root 기준 → renderer/dist. 작은 에셋도 data: URI로 인라인하지 않는다(prod CSP default-src 'self'가 data: 이미지·마스크를 막음)
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
});
