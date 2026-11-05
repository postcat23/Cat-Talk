import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';

// Electron 창이면 배경을 투명으로(base.css). 브라우저 dev는 목업처럼 데스크톱 배경을 흉내 낸다.
if (window.catTalk) document.documentElement.dataset.shell = 'electron';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
