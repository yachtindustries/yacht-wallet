// Wires the in-process RPC bridge for the mobile build. On extension builds
// this module is never imported; main.tsx only awaits it when YACHT_PLATFORM
// is 'mobile' so Rollup can tree-shake it out of the .crx bundle.
//
// The shim's chrome.runtime.sendMessage forwards to globalThis.__yachtMobileRpc.
// Here we point that handle at the background's exported handle() so the
// popup, lib/, and components keep using rpc() unchanged.

import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { handle } from '../background/index';
import type { RpcEnvelope, RpcReply } from './messaging';

// Paint the status bar to match the wallet's navy background and let the
// WebView draw underneath it. Without overlay=true, env(safe-area-inset-top)
// reports 0 on Android and the layout double-pads the top of the screen.
void (async () => {
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setBackgroundColor({ color: '#002849' });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch { /* status bar plugin missing on web preview — ignore */ }
})();

const FAKE_SENDER = {
  id: chrome.runtime.id,
  url: chrome.runtime.getURL('index.html'),
} as unknown as chrome.runtime.MessageSender;

globalThis.__yachtMobileRpc = async (msg: unknown): Promise<RpcReply> => {
  const env = msg as RpcEnvelope | undefined;
  if (!env || env.rpc !== 'yacht') {
    return { ok: false, error: 'Invalid RPC envelope' };
  }
  try {
    const result = await handle(env.request, FAKE_SENDER);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

// Lock the vault as soon as the app goes to the background. On mobile a
// "back to home screen" should be treated like closing the wallet window —
// requiring the password to come back. This is stricter than the desktop
// auto-lock alarm, which is intentional for a phone-resident wallet.
App.addListener('appStateChange', (state) => {
  if (!state.isActive) {
    void handle({ type: 'vault.lock' }, FAKE_SENDER).catch(() => { /* best effort */ });
  }
});

export {};
