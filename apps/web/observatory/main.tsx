import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './page.css';
import App from './App';

const host = document.getElementById('root');
if (!host) throw new Error('#root is missing from observatory/index.html');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>
);
