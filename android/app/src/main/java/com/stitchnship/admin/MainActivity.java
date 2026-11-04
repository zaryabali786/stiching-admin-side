package com.stitchnship.admin;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    private int lastTop = 0;
    private int lastRight = 0;
    private int lastBottom = 0;
    private int lastLeft = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaAccessPlugin.class);
        super.onCreate(savedInstanceState);

        setupEdgeToEdgeAndInsets();
    }

    private void setupEdgeToEdgeAndInsets() {
        // Draw edge-to-edge behind translucent/transparent status bar
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
        }
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        // Dark icons on status and navigation bars for light themes
        WindowInsetsControllerCompat insetsController =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (insetsController != null) {
            insetsController.setAppearanceLightStatusBars(true);
            insetsController.setAppearanceLightNavigationBars(true);
        }

        // Set clean white background on DecorView so navigation bar area matches app theme
        getWindow().getDecorView().setBackgroundColor(Color.WHITE);

        // Target the root content container (android.R.id.content) which hosts the WebView
        View contentView = findViewById(android.R.id.content);
        View targetView = contentView != null ? contentView : getWindow().getDecorView();

        // Listen for system bars (status bar, 3-button/gesture navigation bar, display cutouts, keyboard)
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets tappable = windowInsets.getInsets(WindowInsetsCompat.Type.tappableElement());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            boolean imeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());

            float density = getResources().getDisplayMetrics().density;
            if (density <= 0) density = 1.0f;

            int topPx = Math.round(systemBars.top / density);
            int rightPx = Math.round(systemBars.right / density);
            int leftPx = Math.round(systemBars.left / density);

            // Determine whether the device has a 3-button/2-button navigation bar (where physical touch buttons exist)
            // vs modern gesture navigation (where the screen is full edge-to-edge with swipe gestures).
            // On 3-button navigation, tappable.bottom > 0 (typically 48dp) or systemBars.bottom >= 40dp.
            // On gesture navigation, tappable.bottom is 0 and systemBars.bottom is small (<= 24dp).
            boolean has3ButtonNavBar = tappable.bottom > 0 || (systemBars.bottom >= Math.round(40 * density));

            int nativeBottomPad = 0;
            int cssBottomPx = 0;

            if (!imeVisible) {
                if (has3ButtonNavBar) {
                    // For 3-button navigation phones:
                    // Pad the native content container at the bottom so the WebView ends cleanly
                    // ABOVE the 3 buttons. This prevents the buttons from obscuring app tabs or blocking touches.
                    nativeBottomPad = systemBars.bottom;
                    cssBottomPx = 0;
                } else {
                    // For Gesture navigation (full edge-to-edge to the screen end):
                    // The WebView draws all the way to the bottom edge, and CSS safe-area-inset-bottom
                    // ensures icons and action buttons sit comfortably above the gesture bar.
                    nativeBottomPad = 0;
                    cssBottomPx = Math.round(systemBars.bottom / density);
                }
            }

            targetView.setPadding(0, 0, 0, nativeBottomPad);

            lastTop = topPx;
            lastRight = rightPx;
            lastBottom = cssBottomPx;
            lastLeft = leftPx;

            injectSafeAreaCSS(topPx, rightPx, cssBottomPx, leftPx);

            return windowInsets;
        });

        // Re-inject safe areas whenever WebView commits or finishes page navigation
        if (bridge != null) {
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    super.onPageCommitVisible(view, url);
                    injectSafeAreaCSS(lastTop, lastRight, lastBottom, lastLeft);
                }

                @Override
                public void onPageLoaded(WebView view) {
                    super.onPageLoaded(view);
                    injectSafeAreaCSS(lastTop, lastRight, lastBottom, lastLeft);
                }
            });
        }
    }

    private void injectSafeAreaCSS(int top, int right, int bottom, int left) {
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }

        String js = String.format(
            Locale.US,
            "(function() {" +
            "  try {" +
            "    var root = document.documentElement;" +
            "    if (!root) return;" +
            "    root.style.setProperty('--safe-area-inset-top', '%dpx');" +
            "    root.style.setProperty('--safe-area-inset-right', '%dpx');" +
            "    root.style.setProperty('--safe-area-inset-bottom', '%dpx');" +
            "    root.style.setProperty('--safe-area-inset-left', '%dpx');" +
            "    window.__NATIVE_SAFE_AREA__ = { top: %d, right: %d, bottom: %d, left: %d };" +
            "    try { localStorage.setItem('__safe_area_insets__', JSON.stringify(window.__NATIVE_SAFE_AREA__)); } catch(e){}" +
            "    window.dispatchEvent(new CustomEvent('safe-area-changed', { detail: window.__NATIVE_SAFE_AREA__ }));" +
            "  } catch (e) { console.error('Safe area injection error', e); }" +
            "})();",
            top, right, bottom, left, top, right, bottom, left
        );

        bridge.getWebView().post(() -> {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().evaluateJavascript(js, null);
            }
        });
    }
}
