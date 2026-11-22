package com.chefmargin.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int FILE_PICK = 10;
    private static final int FILE_SAVE = 11;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingBytes;
    private WebView web;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(11,20,32));
        getWindow().setNavigationBarColor(Color.rgb(11,20,32));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(11,20,32));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setDefaultTextEncodingName("UTF-8");
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), FILE_PICK); }
                catch (Exception ex) { fileCallback = null; callback.onReceiveValue(null); return false; }
                return true;
            }
        });
        web.addJavascriptInterface(new ExportBridge(), "ChefMarginAndroid");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    private class ExportBridge {
        @JavascriptInterface public void saveFile(final String name, final String base64) {
            try {
                pendingBytes = Base64.decode(base64, Base64.DEFAULT);
                runOnUiThread(() -> {
                    Intent pick = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    pick.addCategory(Intent.CATEGORY_OPENABLE);
                    pick.setType(name.endsWith(".json") ? "application/json" : "text/csv");
                    pick.putExtra(Intent.EXTRA_TITLE, name.replaceAll("[^a-zA-Z0-9_.-]", "_"));
                    startActivityForResult(pick, FILE_SAVE);
                });
            } catch (Exception ex) { pendingBytes = null; }
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICK) {
            if (fileCallback != null) {
                Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
        } else if (requestCode == FILE_SAVE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingBytes != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out != null) out.write(pendingBytes);
                } catch (Exception ignored) {}
            }
            pendingBytes = null;
        }
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (web != null) { web.removeJavascriptInterface("ChefMarginAndroid"); web.destroy(); }
        super.onDestroy();
    }
}
