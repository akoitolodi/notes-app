package com.philipjohn.aiclassnotes;

import android.Manifest;
import android.app.Dialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.media.MediaRecorder;
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
import android.util.TypedValue;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
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
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final int MAX_SHARED_BYTES = 12 * 1024 * 1024; // 12 MB safety cap
    private static final int MAX_EXTERNAL_BYTES = 25 * 1024 * 1024; // 25 MB temp export cap
    private static final int MAX_RECORDER_BYTES = 24 * 1024 * 1024; // 24 MB Groq Whisper safety cap
    private static final int MAX_CANVAS_FILE_BYTES = 20 * 1024 * 1024; // 20 MB Canvas module file cap
    private static final int MAX_CANVAS_JSON_BYTES = 4 * 1024 * 1024; // 4 MB Canvas JSON cap
    private static final int REQ_RECORD_AUDIO = 4201;
    private static final int REQ_RECORDER_AUDIO = 4202;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private volatile boolean ttsInitializing = false;
    private Runnable pendingTtsAction = null;
    private SpeechRecognizer speechRecognizer;
    private volatile boolean speechListening = false;
    private String speechLang = "";
    private String speechLastPartial = "";
    private int speechConsecutiveErrors = 0;
    private Runnable pendingSpeechRestart;
    private final Object recorderLock = new Object();
    private MediaRecorder nativeRecorder = null;
    private File nativeRecorderFile = null;
    private volatile boolean nativeRecorderActive = false;
    private Dialog canvasLoginDialog = null;
    private WebView canvasLoginWebView = null;
    private final ConcurrentHashMap<String, String> canvasResultStore = new ConcurrentHashMap<>();
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
        initNativeRecorder();
        initNativeCanvas();
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
                mainHandler.post(() -> startNativeRecognition(speechLang, true));
            } else {
                speechListening = false;
                notifySpeechJs("error", "not-allowed");
                notifySpeechJs("state", "idle");
            }
        } else if (requestCode == REQ_RECORDER_AUDIO) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                mainHandler.post(this::startNativeAudioRecorder);
            } else {
                notifyRecorderJs("error", "Microphone permission denied");
            }
        }
    }

    @Override
    public void onDestroy() {
        cancelNativeAudioRecorder();
        dismissCanvasLoginDialog();
        canvasResultStore.clear();
        try {
            if (pendingSpeechRestart != null) {
                mainHandler.removeCallbacks(pendingSpeechRestart);
                pendingSpeechRestart = null;
            }
            speechListening = false;
            speechLastPartial = "";
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

    private void flushPendingSpeechPartial() {
        if (speechLastPartial != null && !speechLastPartial.isEmpty()) {
            final String leftover = speechLastPartial;
            speechLastPartial = "";
            notifySpeechJs("final", leftover);
        }
    }

    private void scheduleSpeechRestart(long delayMs, final boolean forceRecreate) {
        if (pendingSpeechRestart != null) {
            mainHandler.removeCallbacks(pendingSpeechRestart);
            pendingSpeechRestart = null;
        }
        if (!speechListening) return;
        pendingSpeechRestart = () -> {
            pendingSpeechRestart = null;
            if (speechListening) {
                startNativeRecognition(speechLang, forceRecreate);
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

    private void startNativeRecognition(final String lang, final boolean forceRecreate) {
        if (forceRecreate) {
            destroySpeechRecognizer();
        }
        try {
            if (!SpeechRecognizer.isRecognitionAvailable(getApplicationContext())) {
                speechListening = false;
                notifySpeechJs("error", "unsupported");
                notifySpeechJs("state", "idle");
                return;
            }

            speechListening = true;
            if (speechRecognizer == null) {
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
                        flushPendingSpeechPartial();
                        notifySpeechJs("interim", "");

                        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                            scheduleSpeechRestart(70, false);
                            return;
                        }
                        if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT) {
                            scheduleSpeechRestart(250, true);
                            return;
                        }
                        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                            speechListening = false;
                            notifySpeechJs("error", "not-allowed");
                            notifySpeechJs("state", "idle");
                            return;
                        }
                        // Language fallback if chosen locale isn't installed locally
                        if (error == 12 || error == 13) {
                            if (speechLang != null && !speechLang.isEmpty()) {
                                speechLang = "";
                                scheduleSpeechRestart(180, true);
                                return;
                            }
                        }
                        speechConsecutiveErrors += 1;
                        if (speechConsecutiveErrors >= 6) {
                            speechListening = false;
                            String code = (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT)
                                ? "network"
                                : (error == SpeechRecognizer.ERROR_AUDIO ? "audio-capture" : ("speech-error-" + error));
                            notifySpeechJs("error", code);
                            notifySpeechJs("state", "idle");
                        } else {
                            long backoff = 350L * Math.min(4, speechConsecutiveErrors);
                            scheduleSpeechRestart(backoff, true);
                        }
                    }

                    @Override
                    public void onResults(Bundle results) {
                        speechConsecutiveErrors = 0;
                        speechLastPartial = "";
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
                            scheduleSpeechRestart(60, false);
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
                                speechConsecutiveErrors = 0;
                                speechLastPartial = text.trim();
                                notifySpeechJs("interim", speechLastPartial);
                            }
                        }
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {}
                });
            }

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 3500L);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 8000L);
            if (lang != null && !lang.trim().isEmpty()) {
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang.trim());
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang.trim());
            }
            speechRecognizer.startListening(intent);
        } catch (Exception e) {
            speechConsecutiveErrors += 1;
            if (speechListening && speechConsecutiveErrors < 4) {
                scheduleSpeechRestart(400, true);
            } else {
                speechListening = false;
                notifySpeechJs("error", "audio-capture");
                notifySpeechJs("state", "idle");
            }
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
            speechLastPartial = "";
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
                startNativeRecognition(speechLang, true);
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
                flushPendingSpeechPartial();
                destroySpeechRecognizer();
                notifySpeechJs("interim", "");
                notifySpeechJs("state", "idle");
            });
        }
    }

    // Native Android MediaRecorder bridge for Groq Whisper (bypasses WebView getUserMedia permission blocks)
    private void initNativeRecorder() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(new AndroidRecorderBridge(), "BaiNativeRecorder");
            }
        } catch (Exception ignored) {
            // ignore bridge attach error
        }
    }

    private void notifyRecorderJs(final String eventType, final String payload) {
        final String js =
            "try { if (window.__baiRecorderCallback) window.__baiRecorderCallback("
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

    @SuppressWarnings("deprecation")
    private MediaRecorder createConfiguredRecorder(File outFile) throws Exception {
        MediaRecorder rec = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? new MediaRecorder(this)
            : new MediaRecorder();
        rec.setAudioSource(MediaRecorder.AudioSource.MIC);
        rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
        rec.setAudioSamplingRate(16000);
        rec.setAudioEncodingBitRate(32000);
        rec.setAudioChannels(1);
        rec.setOutputFile(outFile.getAbsolutePath());
        rec.prepare();
        rec.start();
        return rec;
    }

    private void cleanupStaleRecorderFiles() {
        try {
            File[] files = getCacheDir().listFiles();
            if (files == null) return;
            long cutoff = System.currentTimeMillis() - 60L * 60L * 1000L;
            for (File f : files) {
                if (f.getName().startsWith("bai_lecture_") && f.getName().endsWith(".m4a") && f.lastModified() < cutoff) {
                    f.delete();
                }
            }
        } catch (Exception ignored) {
            // ignore
        }
    }

    private String readAndDeleteAudioFileBase64(File file) {
        if (file == null || !file.exists()) return "";
        try (FileInputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int total = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > MAX_RECORDER_BYTES) break;
                out.write(buf, 0, n);
            }
            byte[] bytes = out.toByteArray();
            return bytes.length > 0 ? Base64.encodeToString(bytes, Base64.NO_WRAP) : "";
        } catch (Exception ignored) {
            return "";
        } finally {
            try {
                file.delete();
            } catch (Exception ignored) {
                // ignore
            }
        }
    }

    private void releaseRecorderOnly() {
        if (nativeRecorder != null) {
            try {
                nativeRecorder.stop();
            } catch (Exception ignored) {
                // stop can throw if recording was < 100ms
            }
            try {
                nativeRecorder.reset();
                nativeRecorder.release();
            } catch (Exception ignored) {
                // ignore
            }
            nativeRecorder = null;
        }
    }

    private void startNativeAudioRecorder() {
        synchronized (recorderLock) {
            releaseRecorderOnly();
            if (nativeRecorderFile != null) {
                try {
                    nativeRecorderFile.delete();
                } catch (Exception ignored) {
                    // ignore
                }
                nativeRecorderFile = null;
            }
            cleanupStaleRecorderFiles();
            try {
                File outFile = new File(getCacheDir(), "bai_lecture_" + System.currentTimeMillis() + ".m4a");
                nativeRecorder = createConfiguredRecorder(outFile);
                nativeRecorderFile = outFile;
                nativeRecorderActive = true;
                notifyRecorderJs("started", "");
            } catch (Exception e) {
                nativeRecorderActive = false;
                releaseRecorderOnly();
                notifyRecorderJs("error", "Could not start microphone: " + (e.getMessage() != null ? e.getMessage() : "busy"));
            }
        }
    }

    private void cancelNativeAudioRecorder() {
        synchronized (recorderLock) {
            nativeRecorderActive = false;
            releaseRecorderOnly();
            if (nativeRecorderFile != null) {
                try {
                    nativeRecorderFile.delete();
                } catch (Exception ignored) {
                    // ignore
                }
                nativeRecorderFile = null;
            }
        }
    }

    private final class AndroidRecorderBridge {

        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public void start() {
            mainHandler.post(() -> {
                boolean granted =
                    ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED;
                if (!granted) {
                    ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[] { Manifest.permission.RECORD_AUDIO },
                        REQ_RECORDER_AUDIO
                    );
                    return;
                }
                startNativeAudioRecorder();
            });
        }

        @JavascriptInterface
        public String flushChunk() {
            File completedFile;
            synchronized (recorderLock) {
                if (!nativeRecorderActive || nativeRecorder == null) return "";
                completedFile = nativeRecorderFile;
                releaseRecorderOnly();
                nativeRecorderFile = null;
                try {
                    File nextFile = new File(getCacheDir(), "bai_lecture_" + System.currentTimeMillis() + ".m4a");
                    nativeRecorder = createConfiguredRecorder(nextFile);
                    nativeRecorderFile = nextFile;
                } catch (Exception e) {
                    nativeRecorderActive = false;
                    releaseRecorderOnly();
                }
            }
            return readAndDeleteAudioFileBase64(completedFile);
        }

        @JavascriptInterface
        public String stop() {
            File completedFile;
            synchronized (recorderLock) {
                nativeRecorderActive = false;
                completedFile = nativeRecorderFile;
                releaseRecorderOnly();
                nativeRecorderFile = null;
            }
            return readAndDeleteAudioFileBase64(completedFile);
        }

        @JavascriptInterface
        public void cancel() {
            cancelNativeAudioRecorder();
        }
    }

    // Native Android Canvas WebView session & authenticated file bridge (works even when Tokens are disabled)
    private void initNativeCanvas() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(new AndroidCanvasBridge(), "BaiNativeCanvas");
            }
        } catch (Exception ignored) {
            // ignore bridge attach error
        }
    }

    private boolean isValidHttpsUrl(String raw) {
        if (raw == null || raw.trim().isEmpty()) return false;
        try {
            URL u = new URL(raw.trim());
            return "https".equalsIgnoreCase(u.getProtocol()) && u.getHost() != null && !u.getHost().isEmpty();
        } catch (Exception ignored) {
            return false;
        }
    }

    private String extractHost(String raw) {
        if (raw == null) return "";
        String candidate = raw.trim();
        if (!candidate.startsWith("http://") && !candidate.startsWith("https://")) {
            candidate = "https://" + candidate;
        }
        try {
            URL u = new URL(candidate);
            if (!"https".equalsIgnoreCase(u.getProtocol()) || u.getHost() == null) return "";
            return u.getHost().toLowerCase(Locale.US);
        } catch (Exception ignored) {
            return "";
        }
    }

    private boolean isSameOrSubHost(String candidateHost, String originHost) {
        if (candidateHost == null || originHost == null) return false;
        String c = candidateHost.toLowerCase(Locale.US);
        String o = originHost.toLowerCase(Locale.US);
        return c.equals(o) || c.endsWith("." + o);
    }

    private String parseFilenameFromDisposition(String header) {
        if (header == null || header.isEmpty()) return "";
        try {
            int starIdx = header.toLowerCase(Locale.US).indexOf("filename*=");
            if (starIdx >= 0) {
                String tail = header.substring(starIdx + 10).split(";")[0].trim();
                int quoteTick = tail.indexOf("''");
                if (quoteTick >= 0) tail = tail.substring(quoteTick + 2);
                tail = tail.replace("\"", "").trim();
                if (!tail.isEmpty()) return URLDecoder.decode(tail, "UTF-8");
            }
            int idx = header.toLowerCase(Locale.US).indexOf("filename=");
            if (idx >= 0) {
                String tail = header.substring(idx + 9).split(";")[0].trim().replace("\"", "").trim();
                if (!tail.isEmpty()) return tail;
            }
        } catch (Exception ignored) {
            // fallback to URL path
        }
        return "";
    }

    private JSONObject executeCanvasHttp(final String targetUrl, final boolean binary) {
        JSONObject out = new JSONObject();
        try {
            if (!isValidHttpsUrl(targetUrl)) {
                out.put("ok", false);
                out.put("status", 0);
                out.put("error", "Canvas URL must start with https://");
                return out;
            }

            URL current = new URL(targetUrl.trim());
            final String originHost = current.getHost() != null ? current.getHost().toLowerCase(Locale.US) : "";
            final int maxBytes = binary ? MAX_CANVAS_FILE_BYTES : MAX_CANVAS_JSON_BYTES;

            for (int hop = 0; hop < 6; hop++) {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) current.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(25000);
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("User-Agent", "NotesByBai-Android");
                    if (binary) {
                        conn.setRequestProperty("Accept", "*/*");
                    } else {
                        conn.setRequestProperty("Accept", "application/json");
                        conn.setRequestProperty("X-Requested-With", "XMLHttpRequest");
                    }

                    // Never forward Canvas session cookies to external S3 / CDN hosts on download redirects
                    String currentHost = current.getHost() != null ? current.getHost().toLowerCase(Locale.US) : "";
                    if (isSameOrSubHost(currentHost, originHost)) {
                        String cookie = CookieManager.getInstance().getCookie(current.toString());
                        if (cookie != null && !cookie.isEmpty()) {
                            conn.setRequestProperty("Cookie", cookie);
                        }
                    }

                    int status = conn.getResponseCode();
                    if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                        String loc = conn.getHeaderField("Location");
                        if (loc == null || loc.isEmpty()) {
                            out.put("ok", false);
                            out.put("status", status);
                            out.put("error", "Missing redirect location");
                            return out;
                        }
                        URL nextUrl = new URL(current, loc);
                        if (!"https".equalsIgnoreCase(nextUrl.getProtocol())) {
                            out.put("ok", false);
                            out.put("status", status);
                            out.put("error", "Blocked non-HTTPS redirect");
                            return out;
                        }
                        current = nextUrl;
                        continue;
                    }

                    InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    if (stream != null) {
                        byte[] chunk = new byte[16384];
                        int total = 0;
                        int n;
                        while ((n = stream.read(chunk)) != -1) {
                            total += n;
                            if (total > maxBytes) {
                                out.put("ok", false);
                                out.put("status", 413);
                                out.put("error", "File exceeds 20 MB in-app download cap");
                                return out;
                            }
                            buf.write(chunk, 0, n);
                        }
                        stream.close();
                    }

                    byte[] bytes = buf.toByteArray();
                    String contentType = conn.getContentType() != null ? conn.getContentType() : "";
                    String disposition = conn.getHeaderField("Content-Disposition");
                    String dispName = parseFilenameFromDisposition(disposition);

                    out.put("ok", status >= 200 && status < 300);
                    out.put("status", status);
                    out.put("contentType", contentType);
                    out.put("size", bytes.length);
                    if (!dispName.isEmpty()) out.put("fileName", dispName);

                    if (binary) {
                        if (status >= 200 && status < 300) {
                            out.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                        } else {
                            out.put("error", "Canvas returned HTTP " + status);
                        }
                    } else {
                        String text = new String(bytes, StandardCharsets.UTF_8);
                        if (text.startsWith("while(1);")) {
                            text = text.substring("while(1);".length());
                        }
                        out.put("body", text);
                        if (status < 200 || status >= 300) {
                            out.put("error", "Canvas returned HTTP " + status);
                        }
                    }
                    return out;
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }

            out.put("ok", false);
            out.put("status", 310);
            out.put("error", "Too many redirects");
            return out;
        } catch (Exception e) {
            try {
                out.put("ok", false);
                out.put("status", 0);
                out.put("error", e.getMessage() != null ? e.getMessage() : "Canvas network error");
            } catch (Exception ignored) {
                // ignore
            }
            return out;
        }
    }

    private JSONObject verifyCanvasSessionOnHost(final String host) {
        JSONObject result = new JSONObject();
        try {
            JSONObject res = executeCanvasHttp("https://" + host + "/api/v1/users/self", false);
            if (!res.optBoolean("ok", false)) {
                result.put("ok", false);
                return result;
            }
            String body = res.optString("body", "");
            JSONObject user = new JSONObject(body);
            if (!user.has("id")) {
                result.put("ok", false);
                return result;
            }
            result.put("ok", true);
            result.put("host", host);
            result.put("userName", user.optString("name", user.optString("short_name", "")));
            return result;
        } catch (Exception ignored) {
            try {
                result.put("ok", false);
            } catch (Exception ignored2) {
                // ignore
            }
            return result;
        }
    }

    private void notifyCanvasJs(final String eventType, final String payloadJson) {
        final String js =
            "try { if (window.__baiCanvasCallback) window.__baiCanvasCallback("
                + JSONObject.quote(eventType != null ? eventType : "")
                + ", "
                + JSONObject.quote(payloadJson != null ? payloadJson : "{}")
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

    private void notifyCanvasResultReady(final String reqId) {
        final String js =
            "try { if (window.__baiCanvasReady) window.__baiCanvasReady("
                + JSONObject.quote(reqId != null ? reqId : "")
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

    private void dismissCanvasLoginDialog() {
        Runnable closeTask = () -> {
            try {
                if (canvasLoginWebView != null) {
                    canvasLoginWebView.stopLoading();
                    canvasLoginWebView.destroy();
                    canvasLoginWebView = null;
                }
            } catch (Exception ignored) {
                canvasLoginWebView = null;
            }
            try {
                if (canvasLoginDialog != null) {
                    if (canvasLoginDialog.isShowing()) canvasLoginDialog.dismiss();
                    canvasLoginDialog = null;
                }
            } catch (Exception ignored) {
                canvasLoginDialog = null;
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            closeTask.run();
        } else {
            mainHandler.post(closeTask);
        }
    }

    private int dp(int val) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, val, getResources().getDisplayMetrics()
        ));
    }

    private void openCanvasLoginDialog(final String rawHost) {
        final String targetHost = extractHost(rawHost);
        if (targetHost.isEmpty()) {
            notifyCanvasJs("login", "{\"ok\":false,\"error\":\"Invalid school Canvas host.\"}");
            return;
        }
        dismissCanvasLoginDialog();

        SharedPreferences prefs = getSharedPreferences(THEME_PREFS, MODE_PRIVATE);
        int uiNight = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        boolean dark = prefs.getBoolean(PREF_IS_DARK, uiNight == Configuration.UI_MODE_NIGHT_YES);
        int headerBg = Color.parseColor(dark ? "#141A22" : "#F5F6F3");
        int headerText = Color.parseColor(dark ? "#EDF1F7" : "#11161C");
        int subText = Color.parseColor(dark ? "#9AA5B4" : "#5A6573");
        int accentColor = Color.parseColor(dark ? "#60A5FA" : "#1D4ED8");

        final boolean[] completed = new boolean[] { false };
        final Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(headerBg);

        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(12), dp(10), dp(12), dp(10));
        topBar.setBackgroundColor(headerBg);

        Button cancelBtn = new Button(this);
        cancelBtn.setText("Cancel");
        cancelBtn.setAllCaps(false);
        cancelBtn.setBackgroundColor(Color.TRANSPARENT);
        cancelBtn.setTextColor(subText);
        cancelBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        cancelBtn.setPadding(dp(6), dp(4), dp(10), dp(4));

        LinearLayout titleCol = new LinearLayout(this);
        titleCol.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams titleColLp = new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f
        );
        titleCol.setLayoutParams(titleColLp);

        TextView titleView = new TextView(this);
        titleView.setText("Sign in to Canvas");
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        titleView.setTextColor(headerText);

        TextView subView = new TextView(this);
        subView.setText(targetHost);
        subView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        subView.setTextColor(subText);

        titleCol.addView(titleView);
        titleCol.addView(subView);

        Button doneBtn = new Button(this);
        doneBtn.setText("Done");
        doneBtn.setAllCaps(false);
        doneBtn.setBackgroundColor(Color.TRANSPARENT);
        doneBtn.setTextColor(accentColor);
        doneBtn.setTypeface(Typeface.DEFAULT_BOLD);
        doneBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        doneBtn.setPadding(dp(10), dp(4), dp(6), dp(4));

        topBar.addView(cancelBtn);
        topBar.addView(titleCol);
        topBar.addView(doneBtn);

        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(3)
        ));

        WebView webView = new WebView(this);
        webView.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ));

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);

        Runnable checkAndComplete = () -> {
            subView.setText("Verifying Canvas session...");
            new Thread(() -> {
                JSONObject verified = verifyCanvasSessionOnHost(targetHost);
                if (verified.optBoolean("ok", false)) {
                    mainHandler.post(() -> {
                        if (completed[0]) return;
                        completed[0] = true;
                        dismissCanvasLoginDialog();
                        notifyCanvasJs("login", verified.toString());
                    });
                } else {
                    mainHandler.post(() -> subView.setText("Finish signing in on the page first"));
                }
            }).start();
        };

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request != null ? request.getUrl() : null;
                return u == null || !"https".equalsIgnoreCase(u.getScheme());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progress.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
                if (completed[0] || url == null) return;
                String pageHost = extractHost(url);
                String lower = url.toLowerCase(Locale.US);
                if (isSameOrSubHost(pageHost, targetHost)
                        && !lower.contains("/login")
                        && !lower.contains("/oauth")) {
                    new Thread(() -> {
                        JSONObject verified = verifyCanvasSessionOnHost(targetHost);
                        if (verified.optBoolean("ok", false)) {
                            mainHandler.post(() -> {
                                if (completed[0]) return;
                                completed[0] = true;
                                dismissCanvasLoginDialog();
                                notifyCanvasJs("login", verified.toString());
                            });
                        }
                    }).start();
                }
            }
        });

        cancelBtn.setOnClickListener(v -> {
            if (!completed[0]) {
                completed[0] = true;
                dismissCanvasLoginDialog();
                notifyCanvasJs("login", "{\"ok\":false,\"cancelled\":true}");
            }
        });

        doneBtn.setOnClickListener(v -> {
            CookieManager.getInstance().flush();
            checkAndComplete.run();
        });

        dialog.setOnCancelListener(d -> {
            if (!completed[0]) {
                completed[0] = true;
                dismissCanvasLoginDialog();
                notifyCanvasJs("login", "{\"ok\":false,\"cancelled\":true}");
            }
        });

        root.addView(topBar);
        root.addView(progress);
        root.addView(webView);
        dialog.setContentView(root);

        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            );
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }

        canvasLoginDialog = dialog;
        canvasLoginWebView = webView;
        dialog.show();
        webView.loadUrl("https://" + targetHost + "/login/canvas");
    }

    private final class AndroidCanvasBridge {

        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public boolean hasSession(final String rawHost) {
            String host = extractHost(rawHost);
            if (host.isEmpty()) return false;
            try {
                String cookie = CookieManager.getInstance().getCookie("https://" + host);
                if (cookie == null || cookie.isEmpty()) return false;
                return cookie.contains("canvas_session")
                    || cookie.contains("_normandy_session")
                    || cookie.contains("log_session_id");
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public void openLogin(final String rawHost) {
            mainHandler.post(() -> openCanvasLoginDialog(rawHost));
        }

        @JavascriptInterface
        public void clearSession(final String rawHost) {
            mainHandler.post(() -> {
                try {
                    CookieManager cm = CookieManager.getInstance();
                    cm.removeAllCookies(null);
                    cm.flush();
                } catch (Exception ignored) {
                    // ignore
                }
            });
        }

        @JavascriptInterface
        public void fetchJsonAsync(final String reqId, final String url) {
            new Thread(() -> {
                JSONObject res = executeCanvasHttp(url, false);
                canvasResultStore.put(reqId, res.toString());
                notifyCanvasResultReady(reqId);
            }).start();
        }

        @JavascriptInterface
        public void downloadFileAsync(final String reqId, final String url) {
            new Thread(() -> {
                JSONObject res = executeCanvasHttp(url, true);
                canvasResultStore.put(reqId, res.toString());
                notifyCanvasResultReady(reqId);
            }).start();
        }

        @JavascriptInterface
        public String takeResult(final String reqId) {
            if (reqId == null) return "";
            String v = canvasResultStore.remove(reqId);
            return v != null ? v : "";
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
