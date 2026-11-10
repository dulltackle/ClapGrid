import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { buildIdentity } from '../build-identity.js';

// 交付核对读取页面实际加载的身份，审阅界面无需显示指纹。
Object.defineProperty(window, '__clapgridBuildIdentity', { value: buildIdentity, configurable: true });

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
