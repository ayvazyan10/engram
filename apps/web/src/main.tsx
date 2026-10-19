import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';
import { initTheme } from './shell/theme.js';
import App from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// Before the first render: the old views read the bridged template on mount.
initTheme();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
