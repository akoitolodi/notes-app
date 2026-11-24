package com.philipjohn.aiclassnotes;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
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
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Locale;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final int MAX_SHARED_BYTES = 12 * 1024 * 1024; // 12 MB safety cap
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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        applySavedWindowBackground();
        super.onCreate(savedInstanceState);
        applySavedWindowBackground();
        if (getWindow() != null) {
            getWindow().getDecorView().post(this::enableHighRefreshRate);
        }
        initNativeTheme();
        initNativeTts();
        initNativeSpeech();
        handleShareIntent(getIntent());
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
                View decor = window.getDecorView();
                decor.setBackgroundColor(bgColor);
                window.setStatusBarColor(bgColor);
                window.setNavigationBarColor(bgColor);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    int flags = decor.getSystemUiVisibility();
                    if (dark) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    else flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    decor.setSystemUiVisibility(flags);
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
    }

    @Override
    public void onResume() {
        super.onResume();
        enableHighRefreshRate();
    }

    @SuppressWarnings("deprecation")
    private void enableHighRefreshRate() {
        try {
            Window window = getWindow();
            if (window == null) return;
            Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? getDisplay() : null;
            if (display == null && getWindowManager() != null) {
                display = getWindowManager().getDefaultDisplay();
            }
            if (display == null) return;

            Display.Mode current = display.getMode();
            Display.Mode[] modes = display.getSupportedModes();
            if (current == null || modes == null || modes.length == 0) return;

            Display.Mode best = current;
            for (Display.Mode m : modes) {
                if (m.getPhysicalWidth() == current.getPhysicalWidth()
                        && m.getPhysicalHeight() == current.getPhysicalHeight()
                        && m.getRefreshRate() > best.getRefreshRate()) {
                    best = m;
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
