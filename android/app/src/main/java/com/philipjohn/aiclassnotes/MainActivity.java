package com.philipjohn.aiclassnotes;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.view.Display;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Locale;
import java.util.TreeSet;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final int MAX_SHARED_BYTES = 12 * 1024 * 1024; // 12 MB safety cap
    private static final int MAX_EXTERNAL_BYTES = 25 * 1024 * 1024; // 25 MB temp export cap
    private static final int REQ_RECORD_AUDIO = 4201;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private volatile boolean ttsInitializing = false;
    private Runnable pendingTtsAction = null;
    private SpeechRecognizer speechRecognizer;
    private volatile boolean speechListening = false;
    private String speechLang = "";
    private int speechConsecutiveErrors = 0;
    private Runnable pendingSpeechRestart;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private static final String THEME_PREFS = "bai_theme_prefs";
    private static final String PREF_BG_COLOR = "bg_color";
    private static final String PREF_IS_DARK = "is_dark";
    private static final String PREF_HIDE_STATUS_BAR = "hide_status_bar";
    private static final String PREF_REFRESH_MODE = "refresh_rate_mode"; // "max" | "90" | "60"

    private volatile int lastSafeTopDp = 0;
    private volatile int lastSafeBottomDp = 0;
    private volatile int lastSafeLeftDp = 0;
    private volatile int lastSafeRightDp = 0;
    private WebViewListener safeInsetWebViewListener = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getWindow() != null) {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.layoutInDisplayCutoutMode =
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                        ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                        : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                getWindow().setAttributes(lp);
            }
        }
        applySavedWindowBackground();
        applySavedStatusBarVisibility();
        installCleanWindowInsets();
        if (getWindow() != null) {
            getWindow().getDecorView().post(this::enableHighRefreshRate);
        }
        initNativeTheme();
        initNativeDisplay();
        initNativeFiles();
        initNativeTts();
        initNativeSpeech();
        if (getBridge() != null) {
            safeInsetWebViewListener = new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    pushSafeInsetsToWeb();
                }

                @Override
                public void onPageLoaded(WebView webView) {
                    pushSafeInsetsToWeb();
                }
            };
            getBridge().addWebViewListener(safeInsetWebViewListener);
        }
        handleShareIntent(getIntent());
    }

    private void installCleanWindowInsets() {
        try {
            View content = findViewById(android.R.id.content);
            if (content == null) return;
            ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
                Insets sysBars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                Insets statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars());
                Insets navBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
                Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
                boolean hideStatusBar =
                    getSharedPreferences(THEME_PREFS, MODE_PRIVATE).getBoolean(PREF_HIDE_STATUS_BAR, false);

                // Keep top/left/right at 0 so WebView draws edge-to-edge behind status & nav bars;
                // pad bottom strictly when IME is visible for single-pass keyboard resize without any black gap.
                v.setPadding(0, 0, 0, imeVisible ? ime.bottom : 0);

                float density = Math.max(1f, getResources().getDisplayMetrics().density);
                lastSafeTopDp = hideStatusBar
                    ? Math.round(statusBars.top / density)
                    : Math.round(sysBars.top / density);
                lastSafeBottomDp = imeVisible ? 0 : Math.round(navBars.bottom / density);
                lastSafeLeftDp = Math.round(sysBars.left / density);
                lastSafeRightDp = Math.round(sysBars.right / density);
                pushSafeInsetsToWeb();

                return new WindowInsetsCompat.Builder(insets)
                    .setInsets(
                        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(),
                        Insets.NONE
                    )
                    .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                    .setVisible(WindowInsetsCompat.Type.ime(), false)
                    .build();
            });
            ViewCompat.requestApplyInsets(content);
        } catch (Exception ignored) {
            // fallback safely
        }
    }

    private void pushSafeInsetsToWeb() {
        final int top = lastSafeTopDp;
        final int bottom = lastSafeBottomDp;
        final int left = lastSafeLeftDp;
        final int right = lastSafeRightDp;
        final String js = String.format(
            Locale.US,
            "try{var s=document.documentElement.style;s.setProperty('--native-safe-top','%dpx');s.setProperty('--native-safe-bottom','%dpx');s.setProperty('--native-safe-left','%dpx');s.setProperty('--native-safe-right','%dpx');}catch(e){}",
            top,
            bottom,
            left,
            right
        );
        mainHandler.post(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception ignored) {
                // ignore if WebView not ready
            }
        });
    }

    private void applySavedStatusBarVisibility() {
        try {
            boolean hide =
                getSharedPreferences(THEME_PREFS, MODE_PRIVATE).getBoolean(PREF_HIDE_STATUS_BAR, false);
            applyHideStatusBar(hide);
        } catch (Exception ignored) {
            // fallback safely
        }
    }

    private void applyHideStatusBar(final boolean hide) {
        try {
            Window window = getWindow();
            if (window == null) return;
            View decor = window.getDecorView();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
            if (controller == null) return;
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            if (hide) {
                controller.hide(WindowInsetsCompat.Type.statusBars());
            } else {
                controller.show(WindowInsetsCompat.Type.statusBars());
            }
        } catch (Exception ignored) {
            // ignore on older OS
        }
    }

    private void applySavedWindowBackground() {
        try {
            SharedPreferences prefs = getSharedPreferences(THEME_PREFS, MODE_PRIVATE);
            int uiNight = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            boolean systemDark = uiNight == Configuration.UI_MODE_NIGHT_YES;
            boolean isDark = prefs.contains(PREF_IS_DARK) ? prefs.getBoolean(PREF_IS_DARK, systemDark) : systemDark;
            String hex = prefs.getString(PREF_BG_COLOR, systemDark ? "#090A0E" : "#F4F2EC");
            applyNativeWindowBg(hex, isDark);
        } catch (Exception ignored) {
            // fallback safely
        }
    }

    @SuppressWarnings("deprecation")
    private void applyNativeWindowBg(final String hex, final boolean dark) {
        try {
            if (hex == null || hex.isEmpty()) return;
            int bgColor = Color.parseColor(hex.startsWith("#") ? hex : "#" + hex);
            Window window = getWindow();
            if (window != null) {
                window.setBackgroundDrawable(new ColorDrawable(bgColor));
                View decor = window.getDecorView();
                decor.setBackgroundColor(bgColor);
                View content = findViewById(android.R.id.content);
                if (content != null) {
                    content.setBackgroundColor(bgColor);
                }
                window.setStatusBarColor(Color.TRANSPARENT);
                window.setNavigationBarColor(Color.TRANSPARENT);
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
                if (controller != null) {
                    controller.setAppearanceLightStatusBars(!dark);
                    controller.setAppearanceLightNavigationBars(!dark);
                }
            }
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setBackgroundColor(bgColor);
            }
        } catch (Exception ignored) {
            // ignore invalid hex colors
        }
    }

    private void initNativeTheme() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(new AndroidThemeBridge(), "BaiNativeTheme");
            }
        } catch (Exception ignored) {
            // ignore
        }
    }

    private final class AndroidThemeBridge {

        @JavascriptInterface
        public void setBgColor(final String hex, final boolean dark) {
            try {
                if (hex == null || hex.isEmpty()) return;
                getSharedPreferences(THEME_PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_BG_COLOR, hex)
                    .putBoolean(PREF_IS_DARK, dark)
                    .apply();
            } catch (Exception ignored) {
                // ignore
            }
            mainHandler.post(() -> applyNativeWindowBg(hex, dark));
        }

        @JavascriptInterface
        public void setHideStatusBar(final boolean hide) {
            try {
                getSharedPreferences(THEME_PREFS, MODE_PRIVATE)
                    .edit()
                    .putBoolean(PREF_HIDE_STATUS_BAR, hide)
                    .apply();
            } catch (Exception ignored) {
                // ignore
            }
            mainHandler.post(() -> {
                applyHideStatusBar(hide);
                View content = findViewById(android.R.id.content);
                if (content != null) ViewCompat.requestApplyInsets(content);
            });
        }

        @JavascriptInterface
        public String getSafeInsetsJson() {
            return String.format(
                Locale.US,
                "{\"top\":%d,\"bottom\":%d,\"left\":%d,\"right\":%d}",
                lastSafeTopDp,
                lastSafeBottomDp,
                lastSafeLeftDp,
                lastSafeRightDp
            );
        }
    }

    private void initNativeFiles() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(new AndroidFilesBridge(), "BaiNativeFiles");
            }
        } catch (Exception ignored) {
            // ignore
        }
    }

    private void cleanupSharedDocsDir(File dir) {
        try {
            File[] files = dir.listFiles();
            if (files == null) return;
            long cutoff = System.currentTimeMillis() - 30L * 60L * 1000L;
            for (File f : files) {
                if (f.lastModified() < cutoff) {
                    f.delete();
                }
            }
        } catch (Exception ignored) {
            // ignore cleanup errors
        }
    }

    private final class AndroidFilesBridge {

        @JavascriptInterface
        public boolean openFileExternal(final String fileName, final String mimeType, final String base64Data) {
            try {
                if (base64Data == null || base64Data.isEmpty()) return false;
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                if (bytes == null || bytes.length == 0 || bytes.length > MAX_EXTERNAL_BYTES) return false;

                String safeName = (fileName == null || fileName.trim().isEmpty())
                    ? "document.bin"
                    : fileName.trim().replaceAll("[^a-zA-Z0-9._-]", "_");
                if (safeName.startsWith(".")) safeName = "document" + safeName;

                File sharedDir = new File(getCacheDir(), "shared_docs");
                if (!sharedDir.exists()) sharedDir.mkdirs();
                cleanupSharedDocsDir(sharedDir);

                File outFile = new File(sharedDir, safeName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                }

                String safeMime = (mimeType == null || mimeType.trim().isEmpty())
                    ? "application/octet-stream"
                    : mimeType.trim();
                Uri uri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".fileprovider",
                    outFile
                );
                mainHandler.post(() -> {
                    try {
                        Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                        viewIntent.setDataAndType(uri, safeMime);
                        viewIntent.addFlags(
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK
                        );
                        startActivity(Intent.createChooser(viewIntent, "Open with"));
                    } catch (Exception ignored) {
                        // no handler or restricted
                    }
                });
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        applySavedWindowBackground();
        applySavedStatusBarVisibility();
        enableHighRefreshRate();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applySavedStatusBarVisibility();
            enableHighRefreshRate();
        }
    }

    private void initNativeDisplay() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(new AndroidDisplayBridge(), "BaiNativeDisplay");
            }
        } catch (Exception ignored) {
            // ignore
        }
    }

    @SuppressWarnings("deprecation")
    private Display getCurrentDisplay() {
        Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? getDisplay() : null;
        if (display == null && getWindowManager() != null) {
            display = getWindowManager().getDefaultDisplay();
        }
        return display;
    }

    private String getSavedRefreshMode() {
        try {
            String raw = getSharedPreferences(THEME_PREFS, MODE_PRIVATE).getString(PREF_REFRESH_MODE, "max");
            if ("90".equals(raw) || "60".equals(raw)) return raw;
        } catch (Exception ignored) {
            // fallback
        }
        return "max";
    }

    private final class AndroidDisplayBridge {

        @JavascriptInterface
        public String getDisplayInfoJson() {
            try {
                Display display = getCurrentDisplay();
                if (display == null) {
                    return "{\"activeHz\":60,\"maxHz\":60,\"supportedHz\":[60],\"mode\":\"" + getSavedRefreshMode() + "\"}";
                }
                Display.Mode current = display.getMode();
                Display.Mode[] modes = display.getSupportedModes();
                int activeHz = current != null ? Math.round(current.getRefreshRate()) : 60;
                int maxHz = activeHz;
                TreeSet<Integer> rates = new TreeSet<>();
                rates.add(activeHz);
                if (modes != null && current != null) {
                    for (Display.Mode m : modes) {
                        if (m.getPhysicalWidth() == current.getPhysicalWidth()
                                && m.getPhysicalHeight() == current.getPhysicalHeight()) {
                            int hz = Math.round(m.getRefreshRate());
                            rates.add(hz);
                            if (hz > maxHz) maxHz = hz;
                        }
                    }
                }
                JSONObject out = new JSONObject();
                out.put("activeHz", activeHz);
                out.put("maxHz", maxHz);
                out.put("mode", getSavedRefreshMode());
                JSONArray arr = new JSONArray();
                for (Integer r : rates) arr.put(r);
                out.put("supportedHz", arr);
                return out.toString();
            } catch (Exception ignored) {
                return "{\"activeHz\":60,\"maxHz\":60,\"supportedHz\":[60],\"mode\":\"max\"}";
            }
        }

        @JavascriptInterface
        public void setRefreshRateMode(final String mode) {
            final String clean = ("90".equals(mode) || "60".equals(mode)) ? mode : "max";
            try {
                getSharedPreferences(THEME_PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_REFRESH_MODE, clean)
                    .apply();
            } catch (Exception ignored) {
                // ignore
            }
            mainHandler.post(() -> enableHighRefreshRate());
        }
    }

    @SuppressWarnings("deprecation")
    private void enableHighRefreshRate() {
        try {
            Window window = getWindow();
            if (window == null) return;
            Display display = getCurrentDisplay();
            if (display == null) return;

            Display.Mode current = display.getMode();
            Display.Mode[] modes = display.getSupportedModes();
            if (current == null || modes == null || modes.length == 0) return;

            String modePref = getSavedRefreshMode();
            Display.Mode best = current;
            for (Display.Mode m : modes) {
                if (m.getPhysicalWidth() != current.getPhysicalWidth()
                        || m.getPhysicalHeight() != current.getPhysicalHeight()) {
                    continue;
                }
                float hz = m.getRefreshRate();
                float bestHz = best.getRefreshRate();
                if ("60".equals(modePref)) {
                    if (hz <= 62f && (bestHz > 62f || Math.abs(hz - 60f) < Math.abs(bestHz - 60f))) {
                        best = m;
                    }
                } else if ("90".equals(modePref)) {
                    if (hz <= 92f && (bestHz > 92f || hz > bestHz)) {
                        best = m;
                    }
                } else {
                    if (hz > bestHz) {
                        best = m;
                    }
                }
            }

            WindowManager.LayoutParams lp = window.getAttributes();
            if (lp != null
                    && (lp.preferredDisplayModeId != best.getModeId()
                            || lp.preferredRefreshRate != best.getRefreshRate())) {
                lp.preferredDisplayModeId = best.getModeId();
                lp.preferredRefreshRate = best.getRefreshRate();
                window.setAttributes(lp);
            }

            // Enable Android 14+ touch refresh-rate boost when not locked to 60 Hz battery mode
            try {
                Method boost = Window.class.getMethod("setFrameRateBoostOnTouchEnabled", boolean.class);
                boost.invoke(window, !"60".equals(modePref));
            } catch (Exception ignored) {
                // Method unavailable below Android 14 / API 34
            }
        } catch (Exception ignored) {
            // Safely ignore on OEMs or older Android builds without multi-mode switching
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RECORD_AUDIO) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                mainHandler.post(() -> startNativeRecognition(speechLang));
            } else {
                speechListening = false;
                notifySpeechJs("error", "not-allowed");
                notifySpeechJs("state", "idle");
            }
        }
    }

    @Override
    public void onDestroy() {
        try {
            if (pendingSpeechRestart != null) {
                mainHandler.removeCallbacks(pendingSpeechRestart);
                pendingSpeechRestart = null;
            }
            speechListening = false;
            if (speechRecognizer != null) {
                speechRecognizer.destroy();
                speechRecognizer = null;
            }
        } catch (Exception ignored) {
            // ignore speech shutdown error
        }
        try {
            pendingTtsAction = null;
            pendingTtsUtteranceId = null;
            ttsInitializing = false;
            ttsReady = false;
            if (tts != null) {
                tts.stop();
                tts.shutdown();
                tts = null;
            }
        } catch (Exception ignored) {
            // ignore shutdown error
        }
        super.onDestroy();
    }

    private String pendingTtsUtteranceId = null;

    private void initNativeTts() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(new AndroidTtsBridge(), "BaiNativeTts");
            }
        } catch (Exception ignored) {
            ttsReady = false;
        }
    }

    private void ensureTtsInitialized() {
        if (ttsReady && tts != null) {
            Runnable action = pendingTtsAction;
            pendingTtsAction = null;
            pendingTtsUtteranceId = null;
            if (action != null) mainHandler.post(action);
            return;
        }
        if (ttsInitializing) return;
        ttsInitializing = true;
        try {
            tts = new TextToSpeech(getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    int langRes = tts.setLanguage(Locale.US);
                    if (langRes == TextToSpeech.LANG_MISSING_DATA || langRes == TextToSpeech.LANG_NOT_SUPPORTED) {
                        tts.setLanguage(Locale.getDefault());
                    }
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {}

                        @Override
                        public void onDone(String utteranceId) {
                            notifyTtsJs(utteranceId, "done");
                        }

                        @Override
                        @Deprecated
                        public void onError(String utteranceId) {
                            notifyTtsJs(utteranceId, "error");
                        }

                        @Override
                        public void onError(String utteranceId, int errorCode) {
                            notifyTtsJs(utteranceId, "error");
                        }
                    });
                    ttsReady = true;
                    ttsInitializing = false;
                    Runnable action = pendingTtsAction;
                    pendingTtsAction = null;
                    pendingTtsUtteranceId = null;
                    if (action != null) mainHandler.post(action);
                } else {
                    ttsReady = false;
                    ttsInitializing = false;
                    tts = null;
                    String failedId = pendingTtsUtteranceId;
                    pendingTtsAction = null;
                    pendingTtsUtteranceId = null;
                    if (failedId != null) notifyTtsJs(failedId, "error");
                }
            });
        } catch (Exception ignored) {
            ttsReady = false;
            ttsInitializing = false;
            String failedId = pendingTtsUtteranceId;
            pendingTtsAction = null;
            pendingTtsUtteranceId = null;
            if (failedId != null) notifyTtsJs(failedId, "error");
        }
    }

    private void notifyTtsJs(final String utteranceId, final String eventType) {
        final String js =
            "try { if (window.__baiTtsCallback) window.__baiTtsCallback("
                + JSONObject.quote(utteranceId != null ? utteranceId : "")
                + ", "
                + JSONObject.quote(eventType)
                + "); } catch(e) {}";
        mainHandler.post(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception ignored) {
                // ignore
            }
        });
    }

    private final class AndroidTtsBridge {

        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public void speak(final String text, final float rate, final float pitch, final String utteranceId) {
            mainHandler.post(() -> {
                if (text == null || text.trim().isEmpty()) {
                    notifyTtsJs(utteranceId, "error");
                    return;
                }
                Runnable doSpeak = () -> {
                    try {
                        if (tts == null) {
                            notifyTtsJs(utteranceId, "error");
                            return;
                        }
                        tts.setSpeechRate(Math.max(0.5f, Math.min(2.0f, rate)));
                        tts.setPitch(Math.max(0.6f, Math.min(1.6f, pitch)));
                        Bundle params = new Bundle();
                        params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);
                        int res = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
                        if (res == TextToSpeech.ERROR) {
                            notifyTtsJs(utteranceId, "error");
                        }
                    } catch (Exception e) {
                        notifyTtsJs(utteranceId, "error");
                    }
                };
                if (tts != null && ttsReady) {
                    doSpeak.run();
                } else {
                    pendingTtsAction = doSpeak;
                    pendingTtsUtteranceId = utteranceId;
                    ensureTtsInitialized();
                }
            });
        }

        @JavascriptInterface
        public void stop() {
            mainHandler.post(() -> {
                pendingTtsAction = null;
                pendingTtsUtteranceId = null;
                try {
                    if (tts != null) tts.stop();
                } catch (Exception ignored) {
                    // ignore
                }
            });
        }
    }

    private void initNativeSpeech() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(new AndroidSpeechBridge(), "BaiNativeSpeech");
            }
        } catch (Exception ignored) {
            // ignore WebView bridge attach error
        }
    }

    private void notifySpeechJs(final String eventType, final String payload) {
        final String js =
            "try { if (window.__baiSpeechCallback) window.__baiSpeechCallback("
                + JSONObject.quote(eventType != null ? eventType : "")
                + ", "
                + JSONObject.quote(payload != null ? payload : "")
                + "); } catch(e) {}";
        mainHandler.post(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception ignored) {
                // ignore
            }
        });
    }

    private void scheduleSpeechRestart(long delayMs) {
        if (pendingSpeechRestart != null) {
            mainHandler.removeCallbacks(pendingSpeechRestart);
            pendingSpeechRestart = null;
        }
        if (!speechListening) return;
        pendingSpeechRestart = () -> {
            pendingSpeechRestart = null;
            if (speechListening) {
                startNativeRecognition(speechLang);
            }
        };
        mainHandler.postDelayed(pendingSpeechRestart, delayMs);
    }

    private void destroySpeechRecognizer() {
        try {
            if (speechRecognizer != null) {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
                speechRecognizer = null;
            }
        } catch (Exception ignored) {
            speechRecognizer = null;
        }
    }

    private void startNativeRecognition(final String lang) {
        destroySpeechRecognizer();
        try {
            if (!SpeechRecognizer.isRecognitionAvailable(getApplicationContext())) {
                speechListening = false;
                notifySpeechJs("error", "unsupported");
                notifySpeechJs("state", "idle");
                return;
            }

            speechListening = true;
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getApplicationContext());
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override
                public void onReadyForSpeech(Bundle params) {
                    speechConsecutiveErrors = 0;
                    notifySpeechJs("state", "listening");
                }

                @Override
                public void onBeginningOfSpeech() {}

                @Override
                public void onRmsChanged(float rmsdB) {}

                @Override
                public void onBufferReceived(byte[] buffer) {}

                @Override
                public void onEndOfSpeech() {}

                @Override
                public void onError(int error) {
                    if (!speechListening) return;
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        notifySpeechJs("interim", "");
                        scheduleSpeechRestart(260);
                        return;
                    }
                    if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                        scheduleSpeechRestart(450);
                        return;
                    }
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        speechListening = false;
                        notifySpeechJs("error", "not-allowed");
                        notifySpeechJs("state", "idle");
                        return;
                    }
                    if (error == SpeechRecognizer.ERROR_AUDIO) {
                        speechListening = false;
                        notifySpeechJs("error", "audio-capture");
                        notifySpeechJs("state", "idle");
                        return;
                    }
                    if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) {
                        speechListening = false;
                        notifySpeechJs("error", "network");
                        notifySpeechJs("state", "idle");
                        return;
                    }
                    // Language fallback if chosen locale isn't installed locally
                    if (error == 12 || error == 13) {
                        if (speechLang != null && !speechLang.isEmpty()) {
                            speechLang = "";
                            scheduleSpeechRestart(250);
                            return;
                        }
                    }
                    speechConsecutiveErrors += 1;
                    if (speechConsecutiveErrors >= 3) {
                        speechListening = false;
                        notifySpeechJs("error", "speech-error-" + error);
                        notifySpeechJs("state", "idle");
                    } else {
                        scheduleSpeechRestart(350);
                    }
                }

                @Override
                public void onResults(Bundle results) {
                    speechConsecutiveErrors = 0;
                    ArrayList<String> matches = results != null
                        ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        : null;
                    if (matches != null && !matches.isEmpty()) {
                        String text = matches.get(0);
                        if (text != null && !text.trim().isEmpty()) {
                            notifySpeechJs("final", text.trim());
                        }
                    }
                    notifySpeechJs("interim", "");
                    if (speechListening) {
                        scheduleSpeechRestart(240);
                    }
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                    ArrayList<String> matches = partialResults != null
                        ? partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        : null;
                    if (matches != null && !matches.isEmpty()) {
                        String text = matches.get(0);
                        if (text != null && !text.trim().isEmpty()) {
                            notifySpeechJs("interim", text.trim());
                        }
                    }
                }

                @Override
                public void onEvent(int eventType, Bundle params) {}
            });

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
            if (lang != null && !lang.trim().isEmpty()) {
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang.trim());
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang.trim());
            }
            speechRecognizer.startListening(intent);
        } catch (Exception e) {
            speechListening = false;
            notifySpeechJs("error", "audio-capture");
            notifySpeechJs("state", "idle");
        }
    }

    private final class AndroidSpeechBridge {

        @JavascriptInterface
        public boolean isAvailable() {
            return SpeechRecognizer.isRecognitionAvailable(getApplicationContext());
        }

        @JavascriptInterface
        public void start(final String lang) {
            speechLang = lang != null ? lang.trim() : "";
            speechConsecutiveErrors = 0;
            mainHandler.post(() -> {
                if (pendingSpeechRestart != null) {
                    mainHandler.removeCallbacks(pendingSpeechRestart);
                    pendingSpeechRestart = null;
                }
                boolean granted =
                    ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED;
                if (!granted) {
                    ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[] { Manifest.permission.RECORD_AUDIO },
                        REQ_RECORD_AUDIO
                    );
                    return;
                }
                startNativeRecognition(speechLang);
            });
        }

        @JavascriptInterface
        public void stop() {
            speechListening = false;
            mainHandler.post(() -> {
                if (pendingSpeechRestart != null) {
                    mainHandler.removeCallbacks(pendingSpeechRestart);
                    pendingSpeechRestart = null;
                }
                destroySpeechRecognizer();
                notifySpeechJs("interim", "");
                notifySpeechJs("state", "idle");
            });
        }
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String mimeType = intent.getType();
        boolean isSend = Intent.ACTION_SEND.equals(action);
        boolean isView = Intent.ACTION_VIEW.equals(action);
        if (!isSend && !isView) return;

        try {
            JSONObject payload = new JSONObject();
            String resolvedMime = mimeType != null ? mimeType : "application/octet-stream";
            payload.put("mimeType", resolvedMime);

            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            String sharedSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (sharedSubject != null) payload.put("title", sharedSubject);
            if (sharedText != null) payload.put("text", sharedText);

            Uri streamUri = isView ? intent.getData() : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (streamUri != null) {
                if ("content".equalsIgnoreCase(streamUri.getScheme())) {
                    String contentMime = getContentResolver().getType(streamUri);
                    if (contentMime != null) {
                        resolvedMime = contentMime;
                        payload.put("mimeType", resolvedMime);
                    }
                }
                String fileName = resolveFileName(streamUri, resolvedMime);
                byte[] bytes = readUriBytes(streamUri);
                if (bytes != null && bytes.length > 0) {
                    payload.put("fileName", fileName);
                    payload.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                }
            }

            if (payload.has("text") || payload.has("base64")) {
                dispatchToWeb(payload.toString());
            }
        } catch (Exception ignored) {
            // Never crash activity startup on malformed external intents
        }
    }

    private String resolveFileName(Uri uri, String mimeType) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
            // fallback below
        }
        if (mimeType.contains("pdf")) return "Shared_Material.pdf";
        if (mimeType.contains("presentation")) return "Shared_Slides.pptx";
        if (mimeType.contains("wordprocessing")) return "Shared_Document.docx";
        if (mimeType.startsWith("image/")) return "Shared_Image.png";
        return "Shared_File";
    }

    private byte[] readUriBytes(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int total = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > MAX_SHARED_BYTES) return null;
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        } catch (Exception ignored) {
            return null;
        }
    }

    private void dispatchToWeb(final String jsonPayload) {
        final String escaped = JSONObject.quote(jsonPayload);
        final String js =
            "try { var p = JSON.parse(" + escaped + "); window.__BAI_SHARED_PAYLOAD__ = p; window.dispatchEvent(new CustomEvent('bai-share', { detail: p })); } catch(e) {}";
        mainHandler.postDelayed(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    WebView webView = getBridge().getWebView();
                    webView.evaluateJavascript(js, null);
                }
            } catch (Exception ignored) {
                // ignore if WebView not yet ready
            }
        }, 700);
    }
}
