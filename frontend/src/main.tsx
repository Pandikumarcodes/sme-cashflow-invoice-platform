import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/tokens.css';
import './styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');
createRoot(root, {
  onCaughtError: () => {
    // The boundary displays a safe fallback; render exceptions may contain private state.
  },
  onRecoverableError: () => {
    // Do not send raw render state to the browser console.
  },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
