package com.philipjohn.aiclassnotes;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final int MAX_SHARED_BYTES = 12 * 1024 * 1024; // 12 MB safety cap

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String mimeType = intent.getType();
        if (!Intent.ACTION_SEND.equals(action) || mimeType == null) return;

        try {
            JSONObject payload = new JSONObject();
            payload.put("mimeType", mimeType);

            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            String sharedSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (sharedSubject != null) payload.put("title", sharedSubject);
            if (sharedText != null) payload.put("text", sharedText);

            Uri streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (streamUri != null) {
                String fileName = resolveFileName(streamUri, mimeType);
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
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
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
