package com.yacht.wallet;

import android.graphics.Color;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom Capacitor plugins BEFORE super.onCreate so the
        // bridge can find them as the WebView boots.
        registerPlugin(SecureStoragePlugin.class);

        // FLAG_SECURE blocks screenshots and Android's recent-apps thumbnail.
        // For a self-custody wallet this is the right default: a snapshot of
        // a balance, address, or the seed-phrase reveal screen could end up
        // in the user's gallery / cloud backup / app-switcher cache. Set it
        // before super.onCreate so the very first frame is already secured.
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
        super.onCreate(savedInstanceState);

        // Make the WebView itself transparent. The wallet's html/body still
        // paint navy so the app looks identical day-to-day, but during a QR
        // scan we toggle html/body transparent (CSS .barcode-scanner-active)
        // so the camera preview the ML Kit plugin inserts BEHIND the WebView
        // is visible. Without this line the WebView's opaque white default
        // covers the camera and the scanner shows a blank screen.
        bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);
    }
}
