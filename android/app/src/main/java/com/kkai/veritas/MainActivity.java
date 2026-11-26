package com.kkai.veritas;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * Veritas 安卓壳：内置一个只监听 127.0.0.1 的静态服务器托管前端，
 * 再通过 JavascriptInterface 把模型请求交给原生 HttpURLConnection 发出。
 *
 * 这样做的好处：页面有正常的 http origin（localStorage 可用），
 * 且请求不经过 WebView 的同源策略，OpenAI 那种没有 CORS 头的接口也能读。
 */
public class MainActivity extends Activity {

    private WebView web;
    private AssetServer server;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            server = new AssetServer(getApplicationContext());
            new Thread(server, "veritas-assets").start();
        } catch (IOException e) {
            Toast.makeText(this, "本地资源服务启动失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F7F5EF"));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "veritasAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                String host = uri.getHost() == null ? "" : uri.getHost();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    if ("127.0.0.1".equals(host) || "localhost".equals(host)) return false;
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                return false;
            }
        });

        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web.loadUrl("http://127.0.0.1:" + server.port() + "/index.html");
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** 暴露给页面的桥：window.veritasAndroid.post(...) / .get(...) */
    private class Bridge {

        @JavascriptInterface
        public void post(final String id, final String url, final String headerLines,
                         final String body, final int timeoutMs) {
            new Thread(() -> request(id, url, headerLines, body, timeoutMs, true), "veritas-http").start();
        }

        @JavascriptInterface
        public void get(final String id, final String url, final String headerLines, final int timeoutMs) {
            new Thread(() -> request(id, url, headerLines, null, timeoutMs, false), "veritas-http").start();
        }

        private void request(String id, String url, String headerLines, String body,
                             int timeoutMs, boolean isPost) {
            int status = 0;
            String text;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod(isPost ? "POST" : "GET");
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(timeoutMs > 0 ? timeoutMs : 240000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) "
                                + "Chrome/122.0 Mobile Safari/537.36");
                conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
                for (String line : headerLines.split("\n")) {
                    int i = line.indexOf(':');
                    if (i > 0) {
                        conn.setRequestProperty(line.substring(0, i).trim(), line.substring(i + 1).trim());
                    }
                }
                if (isPost) {
                    conn.setDoOutput(true);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write((body == null ? "" : body).getBytes(StandardCharsets.UTF_8));
                    }
                }
                status = conn.getResponseCode();
                InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                text = is == null ? "" : new String(readAll(is), StandardCharsets.UTF_8);
            } catch (Exception e) {
                status = 0;
                text = e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
            respond(id, status, text);
        }

        private void respond(String id, int status, String text) {
            final String js = "window.__veritasNativeResolve(" + JSONObject.quote(id) + ","
                    + status + "," + JSONObject.quote(text) + ");";
            if (web == null) return;
            web.post(() -> {
                if (web != null) web.evaluateJavascript(js, null);
            });
        }
    }

    /** 只监听 127.0.0.1 的极简静态文件服务，内容来自 APK 的 assets/public */
    private static class AssetServer implements Runnable {

        private final Context ctx;
        private final ServerSocket socket;
        private volatile boolean running = true;

        AssetServer(Context ctx) throws IOException {
            this.ctx = ctx;
            this.socket = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        }

        int port() {
            return socket.getLocalPort();
        }

        void stop() {
            running = false;
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }

        @Override
        public void run() {
            while (running) {
                try (Socket client = socket.accept()) {
                    handle(client);
                } catch (IOException e) {
                    if (running) continue;
                    return;
                }
            }
        }

        private void handle(Socket client) throws IOException {
            BufferedReader in = new BufferedReader(
                    new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
            String requestLine = in.readLine();
            if (requestLine == null) return;

            String path = "/";
            String[] parts = requestLine.split(" ");
            if (parts.length > 1) path = parts[1];

            String header;
            while ((header = in.readLine()) != null && !header.isEmpty()) {
                // 读完请求头即可，静态资源不需要请求体
            }

            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            if (path.isEmpty() || "/".equals(path)) path = "/index.html";
            path = URLDecoder.decode(path, "UTF-8");

            String assetPath = "public" + path;
            byte[] data;
            String type;
            try (InputStream is = ctx.getAssets().open(assetPath)) {
                data = readAll(is);
                type = mimeOf(assetPath);
            } catch (IOException missing) {
                try (InputStream is = ctx.getAssets().open("public/index.html")) {
                    data = readAll(is);
                    type = "text/html; charset=utf-8";
                } catch (IOException fatal) {
                    data = "Not Found".getBytes(StandardCharsets.UTF_8);
                    type = "text/plain; charset=utf-8";
                }
            }

            OutputStream out = client.getOutputStream();
            String head = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: " + type + "\r\n"
                    + "Content-Length: " + data.length + "\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.UTF_8));
            out.write(data);
            out.flush();
        }

        private static String mimeOf(String path) {
            String p = path.toLowerCase();
            if (p.endsWith(".html")) return "text/html; charset=utf-8";
            if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
            if (p.endsWith(".css")) return "text/css; charset=utf-8";
            if (p.endsWith(".json")) return "application/json; charset=utf-8";
            if (p.endsWith(".svg")) return "image/svg+xml";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
            if (p.endsWith(".webp")) return "image/webp";
            if (p.endsWith(".woff2")) return "font/woff2";
            if (p.endsWith(".ico")) return "image/x-icon";
            return "application/octet-stream";
        }
    }

    private static byte[] readAll(InputStream is) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }
}
