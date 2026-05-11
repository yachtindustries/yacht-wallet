// Mobile shim must come first so chrome.storage / chrome.runtime.getURL are
// polyfilled before any module that touches them at import time
// (Dashboard.tsx, Welcome.tsx, etc. read chrome.runtime.getURL at top level).
// On extension builds the shim's installer is a no-op.
import '../lib/mobile-shim';

// Pull the background's RPC handler in-process on mobile so rpc() can invoke
// it without a service worker. Top-level await blocks the SPA boot until the
// handler is registered — about a single tick. Import is gated on the build
// flag so Rollup tree-shakes the background module out of the extension build.
if ((import.meta as any).env?.YACHT_PLATFORM === 'mobile') {
  await import('../lib/mobile-rpc');
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Manifest's side_panel.default_path includes "?sidepanel=1" so we can tell
// popup vs side-panel apart at boot. CSS in index.css branches on this class.
if (new URLSearchParams(window.location.search).get('sidepanel') === '1') {
  document.documentElement.classList.add('mode-sidepanel');
}
// Capacitor build: tag the document so index.css can switch the wallet from
// the fixed 380×600 popup canvas to a full-screen layout with safe-area
// padding for the status bar / home indicator / camera notch.
if ((import.meta as any).env?.YACHT_PLATFORM === 'mobile') {
  document.documentElement.classList.add('mode-mobile');
}

// Surface async failures that React's ErrorBoundary can't catch. We log them
// loudly so a user reporting a bug has something to copy, and we prevent the
// default "[object Event]" silent swallow behaviour.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Yacht] unhandled promise rejection:', e.reason);
});
window.addEventListener('error', (e) => {
  console.error('[Yacht] uncaught error:', e.error ?? e.message);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
