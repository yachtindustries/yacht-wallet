import { jsx as _jsx } from "react/jsx-runtime";
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
// Surface async failures that React's ErrorBoundary can't catch. We log them
// loudly so a user reporting a bug has something to copy, and we prevent the
// default "[object Event]" silent swallow behaviour.
window.addEventListener('unhandledrejection', (e) => {
    console.error('[Yacht] unhandled promise rejection:', e.reason);
});
window.addEventListener('error', (e) => {
    console.error('[Yacht] uncaught error:', e.error ?? e.message);
});
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(ErrorBoundary, { children: _jsx(HashRouter, { children: _jsx(App, {}) }) }) }));
