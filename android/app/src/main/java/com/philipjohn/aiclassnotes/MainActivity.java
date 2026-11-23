package com.philipjohn.aiclassnotes;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final int MAX_SHARED_BYTES = 12 * 1024 * 1024; // 12 MB safety cap
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initNativeTts();
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    @Override
    public void onDestroy() {
        try {
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

    private void initNativeTts() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(new AndroidTtsBridge(), "BaiNativeTts");
            }
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
                }
            });
        } catch (Exception ignored) {
            ttsReady = false;
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
            return tts != null;
        }

        @JavascriptInterface
        public void speak(final String text, final float rate, final float pitch, final String utteranceId) {
            mainHandler.post(() -> {
                if (tts == null || text == null || text.trim().isEmpty()) {
                    notifyTtsJs(utteranceId, "error");
                    return;
                }
                Runnable doSpeak = () -> {
                    try {
                        if (tts == null) return;
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
                if (ttsReady) {
                    doSpeak.run();
                } else {
                    // Wait briefly if TTS engine is still binding on cold start
                    mainHandler.postDelayed(doSpeak, 450);
                }
            });
        }

        @JavascriptInterface
        public void stop() {
            mainHandler.post(() -> {
                try {
                    if (tts != null) tts.stop();
                } catch (Exception ignored) {
                    // ignore
                }
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
