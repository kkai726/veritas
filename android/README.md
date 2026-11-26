# Veritas 安卓端

不依赖 Gradle 的原生壳：一个 `WebView` + 一个只监听 `127.0.0.1` 的静态服务器 + 一个 `@JavascriptInterface` 桥。

## 为什么要自己发请求

WebView 里的 `fetch` 一样受同源策略约束，OpenAI 的响应没有 `Access-Control-Allow-Origin`，页面读不到。所以页面不直接联网，而是调用注入的 `window.veritasAndroid.post(id, url, headers, body, timeout)`，由 Java 用 `HttpURLConnection` 发出去，再把结果回调给 `window.__veritasNativeResolve`。Key 只在本进程内存里过一遍，不落盘、不经过第三方。

## 为什么要有本地服务器

页面需要一个正常的 `http://` origin 才能用 `localStorage` 缓存各家的 Key，也能避免 `file://` 下的各种限制。资源来自 APK 里的 `assets/public`，端口由系统随机分配，进程退出即关闭。

## 构建

需要 JDK 17+ 与 Android SDK（build-tools + platform，无需 Gradle）：

```bash
export ANDROID_SDK=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk-17
npm run build          # 先在仓库根目录构建前端
cd android && ./build.sh
# 产物：android/build/apk/veritas.apk
```

首次构建会在 `android/build/` 下生成调试签名 `veritas-debug.keystore`（口令 `veritas`）。对外分发请换成自己的正式签名。

## 结构

```
android/
├─ app/src/main/AndroidManifest.xml
├─ app/src/main/java/com/kkai/veritas/MainActivity.java   壳 + 静态服务 + 网络桥
├─ app/src/main/res/                                       图标、主题、网络安全配置
├─ app/src/main/assets/public/                             前端产物（构建时拷贝）
└─ build.sh                                                aapt2 → javac → d8 → apksigner
```

## 已知边界

- 只支持 `https://` 的模型接口（`network_security_config.xml` 里仅对 `127.0.0.1` 放开明文）。
- 没有应用内更新，也没有后台任务；长文核查只在前台跑。
- 抓取网页正文走的仍是公共 Reader 服务，部分站点会失败，请在桌面端粘贴正文。
