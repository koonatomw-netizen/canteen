import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Pages load on demand. If a tablet was left open across a new deploy, its old
// page files no longer exist; reload once to pick up the new version.
const reloadKey = 'canteen.reloaded-after-deploy';
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (window.sessionStorage.getItem(reloadKey)) return;
    window.sessionStorage.setItem(reloadKey, '1');
  } catch { /* Without storage, still try one reload. */ }
  event.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => {
  window.setTimeout(() => { try { window.sessionStorage.removeItem(reloadKey); } catch { /* Storage is optional. */ } }, 10_000);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
