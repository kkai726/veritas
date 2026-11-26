<div align="center">

# Veritas · 事实核查台

**贴入一段文字，或者一个链接。逐段取证，给出可信度与来源。**

应用内检索 · 可暂停 · 多任务后台运行 · 自带模型 Key · 输出整洁 Markdown

[下载客户端](#下载) · [查看原理](#它是怎么核查的) · [速度](#速度实测) · [从源码构建](#从源码构建) · [Releases](https://github.com/kkai726/veritas/releases)

[![Release](https://img.shields.io/github/v/release/kkai726/veritas?label=release&color=1c4739)](https://github.com/kkai726/veritas/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-1c4739.svg)](./LICENSE)
[![Vite](https://img.shields.io/badge/Vite-6-646cff.svg)](https://vite.dev)
[![React](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev)
[![Electron](https://img.shields.io/badge/Electron-45-47848f.svg)](https://www.electronjs.org)

<img src="./docs/screenshot-report.png" alt="Veritas 核查报告" width="880" />

</div>

> **这个项目不提供在线核查服务。** 浏览器直连大模型会被 CORS 拦掉，也会让别人的 Key 暴露在第三方页面里，所以在线入口已下线。现在只提供 Windows / Android 客户端和可自托管的镜像，Key 始终留在你自己的机器上。`kkai726.github.io/veritas/` 是本项目的介绍页，不是应用。

---

## 它解决什么问题

大多数「AI 事实核查」只给一句判决：真、假、或者「需要更多信息」。但真实文本是混合的——同一段话里，数字可能准确，因果被夸大，引述被张冠李戴。

Veritas 不下一句话结论，它把一段话拆开看：

1. **拆段** — 按自然段切分，逐段判断是否存在可核实的事实性主张，纯观点、修辞、主观感受会被标为「无事实主张」跳过；
2. **取证** — 应用自己检索公开来源（360 搜索 / DuckDuckGo / 维基百科），只把命中的句子摘出来当证据，**不需要模型自己联网**；
3. **比对** — 每条主张与证据并排，标成「有据支持 / 部分支持 / 缺乏证据 / 与证据矛盾 / 无法核实」；
4. **成文** — 输出可信度百分比、逐段分析、编号来源清单，以及一份可直接粘贴的 Markdown 报告，并自动存档到本地历史。

## 下载

| 平台 | 文件 | 大小 | 说明 |
| :--- | :--- | :--- | :--- |
| Windows 10/11 x64 | [`Veritas-Setup-1.2.0-x64.exe`](https://github.com/kkai726/veritas/releases/download/v1.2.0/Veritas-Setup-1.2.0-x64.exe) | 115.98 MB | NSIS 安装版，可选安装目录、生成桌面快捷方式 |
| Windows 10/11 x64 | [`Veritas-Portable-1.2.0-x64.exe`](https://github.com/kkai726/veritas/releases/download/v1.2.0/Veritas-Portable-1.2.0-x64.exe) | 105.56 MB | 免安装单文件，双击即用，放进 U 盘也能跑 |
| Android 7.0+ (arm64) | [`Veritas-1.2.0-android.apk`](https://github.com/kkai726/veritas/releases/download/v1.2.0/Veritas-1.2.0-android.apk) | 206 KB | `minSdk 24` / `targetSdk 35`，原生 WebView 壳，不依赖 Capacitor |
| 任意 Linux / NAS | [`ghcr.io/kkai726/veritas:latest`](https://github.com/kkai726/veritas/pkgs/container/veritas) | 20 MB | Nginx 托管静态站，自托管网页版（见 [自托管](#自托管镜像)） |

安装前的两件事，都是系统层面的，不是程序问题：

- **Windows** 的这两个 exe **没有代码签名**。首次运行 SmartScreen 会拦一次，点「更多信息 → 仍要运行」；部分杀软会对未签名 Electron 包误报。
- **Android** 的 APK 用调试证书签名（`CN=Veritas, OU=Dev`），安装时需允许「未知来源」，且不能与后续正式签名的版本覆盖安装。

每个产物的 SHA-256 都写在 [发布说明](https://github.com/kkai726/veritas/releases) 里，下载后可以自行核对。

## 这一版做了什么（v1.2.0）

- **可暂停**。「暂停」之后不再发出任何新请求，也就不会继续产生费用。正在飞的那个请求会先跑完，所以界面区分「正在暂停」与「已暂停」——不会假装停住却还在后台烧额度。恢复后从停下的那一步接着走，不用重头再来。
- **收起后继续跑**。核查界面可以整块收起，任务转到底部任务卡里继续执行；点任务卡任意一条即可回到那一份进度或报告。切换页面、打开历史、再开一个新核查，都不会打断正在跑的任务。
- **多任务**。同时最多跑 2 个，其余的排队，前一个结束自动出队；任务卡里能逐条暂停、继续、取消、移除，也能一键清理已完成的。刷新页面会丢掉未完成的任务（它们只存在内存里），已完成的都在历史里。
- **更快**。查询分批并发、双引擎抢答、正文双通道抢跑、摘要够用就跳过整页下载、搜索与正文都做内存缓存，输出预算按档位收紧。同一组内容的检索耗时从 25.1s / 17.6s 降到 17.4s / 9.1s，同内容重跑时检索阶段约 6ms。详见 [速度实测](#速度实测)。
- **报告可重跑**。报告工具栏多了「重新核查」，历史记录也保留了原始输入，可以直接用同样的内容再跑一次（换了模型想对比时最有用）。
- **历史可筛选**。历史面板顶部加了搜索框，按标题、结论、模型、来源域名过滤；删除与清空仍然保留。
- **分阶段耗时**。报告元信息里会写清检索与模型各花了多久，慢在哪一步一眼能看到。
- **草稿与快捷键**。输入内容自动留在本机，刷新不丢；`⌘/Ctrl + Enter` 开始核查，`⌘/Ctrl + K` 打开历史，`⌘/Ctrl + ,` 打开设置，`Esc` 收起当前任务。

## 界面

<div align="center">
<img src="./docs/screenshot-home.png" alt="首页" width="880" />
<br />
<sub>首屏：粘贴文本或链接，选深度与模型，回车开始。后台有任务时，右下角会出现任务卡。</sub>
</div>

<br />

<div align="center">
<img src="./docs/screenshot-processing.png" alt="核查进行中" width="880" />
<br />
<sub>进行中：阶段进度、当前在做什么、已用时间；可暂停、可收起，收起后继续跑。</sub>
</div>

<br />

<div align="center">
<img src="./docs/screenshot-tasks.png" alt="后台任务卡" width="880" />
<br />
<sub>任务卡：多个核查并行时，逐条看状态、暂停或取消；同时最多跑 2 个，其余排队。</sub>
</div>

<br />

<div align="center">
<img src="./docs/screenshot-history.png" alt="核查历史" width="880" />
<br />
<sub>历史：按标题 / 结论 / 模型筛选，点开即回到那份报告，右侧可逐条删除。</sub>
</div>

<br />

<div align="center">
<img src="./docs/screenshot-models.png" alt="模型选择" width="880" />
<br />
<sub>模型下拉只列已经配好 Key 的服务商，其余收进「自定义」；已配置未验证的会标「待验证」。</sub>
</div>

## 暂停与多任务

```
开始核查
   │
   ├─ 第 1 个 → running ──暂停──→ pausing ──当前请求返回──→ paused
   │                ↑                                          │
   │                └──────────────── 继续 ────────────────────┘
   ├─ 第 2 个 → running
   └─ 第 3 个 → queued ──（前一个结束）──→ running
```

| 操作 | 位置 | 行为 |
| :--- | :--- | :--- |
| 暂停 | 核查卡片 / 任务卡 | 每个网络请求前に过一道闸门；已经发出的请求等它返回，之后不再发新请求 |
| 继续 | 同上 | 从暂停的那一步继续，不重跑已经完成的阶段 |
| 收起 | 核查卡片 | 回到首页，任务继续；右下角任务卡可随时打开 |
| 取消 | 卡片 / 任务卡 | 中断当前请求，任务标记为已取消，输入内容保留可重跑 |
| 移除 | 任务卡 | 把已完成 / 出错 / 已取消的任务从列表里去掉，不影响历史存档 |

暂停中不再有请求发出，这一点在代码里是硬约束：`src/lib/pipeline.ts` 与 `src/lib/research.ts` 的每个耗时步骤前都会 `await checkpoint()`，闸门由 `src/lib/task.ts` 控制。并发上限 2 也是在那里定的——再多，搜索引擎那边会开始限流，整体反而更慢。

## 速度实测

同一组四个段落（标准档），同一台机器、同一网络、相邻两次运行，只比较检索阶段：

| 运行 | v1.1 串行 | v1.2 并发 |
| :--- | ---: | ---: |
| 第 1 次 | 25.1 s | 17.4 s |
| 第 2 次 | 17.6 s | 9.1 s |
| 同内容重跑（缓存命中） | — | 检索 6 ms，整次 0.8 s（快速档，模型另计） |

搜索引擎本身的响应波动很大（同一查询可能 0.8s 也可能 6s），所以这组数字看趋势即可，不是基准测试。做了这些事：

1. **查询分批并发**：3 条一批，命中数量够了就跳过剩余批次；
2. **双引擎抢答**：360 与 DuckDuckGo 同时发，谁先给结果用谁；被限流的一方不用等它超时；
3. **正文双通道**：Jina Reader 与直抓同时发起、7 秒截止，谁先给出可用文本用谁（原来是一个失败再试另一个，最坏 32 秒）；
4. **摘要够用就不下载**：前 2 篇必抓，其余命中若搜索摘要已经覆盖查询词，直接用摘要；
5. **两级缓存**：搜索页缓存 10 分钟、正文缓存 1 小时，同一段文字再核查一次几乎瞬时；
6. **收紧输出预算**：快速 4000 / 标准 6000 / 深度 8000 token，证据摘录从 460 字压到 340 字，上下文更短，模型回得更快。

## 支持的模型

内置六项，Key 按服务商分别缓存（`localStorage` 键 `veritas.settings.v2`），切换不丢：

| 服务商 | 默认模型 | 检索方式 | 接口地址 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| DeepSeek | `deepseek-chat` | 应用内检索 | `api.deepseek.com/v1` | 中文稳、价格低，日常核查够用 |
| MiMo | `mimo-v2.6-pro` | 应用内检索 | `api.xiaomimimo.com/v1` | 小米开放平台，OpenAI 兼容 |
| GLM | `glm-4.6` | 应用内检索 | `open.bigmodel.cn/api/paas/v4` | 中文资料与工具调用 |
| Kimi | `kimi-k3-1-pro` | 应用内检索 | `api.moonshot.cn/v1` | 长文吃得住，适合整篇核查 |
| OpenAI | `gpt-4.1` | 应用内检索，空手时回退 `web_search` | `api.openai.com/v1` | 只有它能在本地检索无结果时改用官方检索 |
| 自定义 | 自填 | 应用内检索 | 自填 | 中转站、vLLM、Ollama、企业网关、Gemini/Perplexity/OpenRouter |

模型名不限于下拉里的建议值，可以直接改成任何该服务商支持的模型 ID。

**推理模型注意**：`deepseek-reasoner`、`glm-5.x`、`kimi-k3` 这类模型返回慢、且会把 token 花在思考上。Veritas 已经做了空结果重试，但日常核查仍建议先用 `deepseek-chat` / `glm-4.6` 这种非推理模型。

## 三种运行形态

同一份前端代码，三种外壳，共用一套界面与缓存：

| 形态 | 产物 | 网络通道 | 能否直连 OpenAI |
| :--- | :--- | :--- | :--- |
| Windows 桌面 | `electron-builder` → NSIS / portable | 渲染进程 → IPC → 主进程 `fetch`（POST 与 GET） | **能** |
| Android | `android/build.sh` → 签名 APK | WebView → `@JavascriptInterface` 桥 → `HttpURLConnection` | **能** |
| 静态网页 | `dist/` | 浏览器 `fetch` | 不能（CORS，见下文） |

桌面端不直接 `file://` 加载页面，而是注册了自定义 `app://` 协议托管 `dist`。原因是 `file://` 的 origin 是 `null`，`localStorage` 会被隔离甚至不可用，Key 与历史缓存就失效了；`app://` 给了页面一个稳定 origin。

安卓端没有走 Capacitor：Gradle 与远程依赖在这台机器上只有 ~150 KB/s，索性用 `aapt2 → javac → d8 → zipalign → apksigner` 手写了一条构建链。壳子只做三件事——起一个只监听 `127.0.0.1` 的静态服务、用 WebView 加载它、把 JS 的请求（POST 发模型、GET 抓搜索结果）转给 `HttpURLConnection` 再回调。所以 APK 只有 200 KB 左右。

## 它是怎么核查的

```
输入文本 / URL
   │
   ├─ URL  →  Jina Reader 取正文 → 失败则公共代理 + DOMParser 抽取
   │
   ├─ 拆段（本地）→ 每段构造 1–2 条查询词（数字、引号内容、最长分句）
   │
   ├─ 应用内检索（并发）：
   │     ├ 360 搜索 / DuckDuckGo 抢答（失败换 Wikipedia）
   │     ├ 命中按站点去重 → 取前 2–6 篇精读
   │     └ Jina Reader ∥ 直抓（7s 截止）→ 只留最相关的 2–3 句（≤340 字）
   │
   ├─ 组装证据块（[E1] 标题 / URL / 摘录）→ 交给模型判断，不让它联网
   │
   ├─ JSON 解析（容错围栏 / 尾逗号 / 截断）→ 空结果自动加额度重试 → 仍失败才报错
   │
   └─ 归一化：来源去重 → 统一编号 → 缺来源的 claim 用词面重叠兜底挂证据 → 渲染 + Markdown + 存档
```

关键约束在 `src/lib/report.ts`：**报告里的链接只能来自检索真实返回的结果，或模型明确给出的 URL**。模型负责「判断」，检索负责「证据」，两者在这里合并编号，避免模型自由发挥写出不存在的地址。

检索强度跟着「深度」档位走（精读篇数是上限，摘要够用时会更少）：

| 档位 | 查询数 | 精读上限 | 证据条数 | 输出预算 | 适用 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 快速 | 2 | 2 | ≤6 | 4000 | 先看个大概，成本最低 |
| 标准 | 4 | 4 | ≤10 | 6000 | 常规文章、公众号长文 |
| 深度 | 6 | 6 | ≤14 | 8000 | 需要逐句对账的稿件 |

## 输出长什么样

报告是结构化数据渲染出来的，同一份内容可以切到「Markdown」页直接复制或下载 `.md`：

```markdown
# 事实核查报告 · 「8 杯水」与咖啡因：三条流行健康说法的核查

> **综合可信度 46/100 — 可信度低**
> 三段说法中只有阿斯巴甜一段与官方文件一致……

| 项目 | 内容 |
| :--- | :--- |
| 段落 / 可核实陈述 | 3 段 / 6 条 |
| 判定分布 | 有据支持 2 · 部分支持 1 · 缺乏证据 1 · 与证据矛盾 2 |
| 引用来源 | 6 条 · 6 个站点 |
| 检索 | 4 次查询 · 命中 6 条 · 精读 3 篇 · 360 搜索 / Wikipedia |

## 逐段核查

### 1. 可信度低 · 34/100

> 每天喝 8 杯水是医学界的共识，因为人体每天必须排出约 2 升水分。

**判定** — 「8 杯水」没有权威机构背书……

- **✕ 与证据矛盾**「每天 8 杯水」是医学界共识 — 美国国家医学院、梅奥诊所均未给出该标准 [1]
- **◐ 部分支持** 人体每天必须排出约 2 升水分 — 实际区间为 2–3 升 [2]
```

报告的元信息里会显示分阶段耗时，例如 `检索 4.1s · 模型 18.6s`。

## 历史记录

- 位置：`localStorage` 的 `veritas.history.v1`，与 Key 一样只在本机。
- 内容：标题、评分、模型、字数、结论摘要、原始输入（截断保存），以及完整报告（不含模型原始输出）。
- 操作：顶栏「历史」打开列表 → 顶部搜索框按标题 / 结论 / 模型 / 域名筛选 → 点任意一条回到那份报告 → 「重新核查」用同样的输入再跑一次；右侧垃圾桶逐条删除（二次确认），底部可清空全部。
- 容量：最多 40 条，总字节压在 3 MB 内，超出时丢最旧的。

## 快捷键

| 按键 | 作用 |
| :--- | :--- |
| `⌘ / Ctrl` + `Enter` | 在输入框里开始核查 |
| `⌘ / Ctrl` + `K` | 打开核查历史 |
| `⌘ / Ctrl` + `,` | 打开模型设置 |
| `Esc` | 收起当前核查（任务继续在后台跑） |

## 从源码构建

需要 Node.js 20+。仓库不含任何服务端代码，也不需要配环境变量。

```bash
git clone https://github.com/kkai726/veritas.git
cd veritas
npm install
npm run dev          # http://localhost:5173
```

开发态下没有原生网络桥，走浏览器 `fetch`：模型请求只能选带 CORS 头的服务商（DeepSeek / MiMo / GLM / Kimi / 自定义网关），检索也只剩维基百科可用（360 与 DuckDuckGo 会被浏览器拦）。要完整体验，请构建桌面端。

### Windows 桌面端

```bash
npm run build            # tsc --noEmit && vite build
npm run app:win          # electron-builder --win → release/
```

产物是 `release/Veritas Setup 1.2.0.exe`（安装版）与 `release/Veritas 1.2.0.exe`（免安装）。开发时用 `npm run electron`（先构建再开窗口）。

打包时的两个环境坑，如果脚本跑不起来可以先看这里：

- 终端里若存在 `ELECTRON_RUN_AS_NODE=1`，`electron .` 会被当成 Node 进程执行并立刻退出，需要 `env -u ELECTRON_RUN_AS_NODE npm run electron`；
- `electron-builder` 默认输出 `release/`，若该目录被占用或删除受限，用 `-c.directories.output=release-win` 换个目录；electron 缓存目录被安全策略锁住时，用 `ELECTRON_CACHE` 指向一个空目录。

### Android

需要 JDK 17+、Android SDK 的 `build-tools;35.0.0` 与 `platforms;android-35`，不需要 Gradle：

```bash
npm run build
cd android
ANDROID_SDK=/path/to/android-sdk JAVA_HOME=/path/to/jdk-17 ./build.sh
# 产物：android/build/apk/veritas.apk（已签名，可直接 adb install）
```

脚本自己完成 `aapt2 compile/link → 写入前端资产 → javac → d8 → zipalign → apksigner`，首次运行会生成一个调试 keystore 到 `android/build/`。要出正式包，把 `build.sh` 里的 `KEYSTORE / KEYPASS` 换成你自己的 keystore 与口令。

### 自托管镜像

网页版不能直连 OpenAI、检索也只剩维基，但如果只是想在内网或 NAS 上放一份给同事用：

```bash
docker run -d --name veritas -p 8080:80 ghcr.io/kkai726/veritas:latest
# 打开 http://<你的机器>:8080
```

镜像由 `.github/workflows/package.yml` 在每次推 `main` 或打 `v*` 标签时构建：`node:20-alpine` 里 `npm ci && npm run build`，再把 `dist/` 拷进 `nginx:alpine`，附带一份禁用缓存探测、开启 gzip 的 `docker/nginx.conf`。标签有 `latest`、`main`、语义化版本与 `sha-<commit>`。

## 为什么 OpenAI 会报 `Failed to fetch`

选了 OpenAI 官方接口、点「开始核查」，页面只回一句 `网络请求失败：Failed to fetch`，那基本不是 Key 的问题。在网页版里 curl 一下就能看到：

```bash
$ curl -sD - -o /dev/null -X POST https://api.openai.com/v1/responses \
    -H 'Origin: https://example.com' -H 'Authorization: Bearer sk-test' \
    -H 'Content-Type: application/json' -d '{"model":"gpt-4.1","input":"hi"}'

HTTP/2 401
access-control-expose-headers: CF-Ray
# ← 没有 access-control-allow-origin
```

浏览器只有在响应带 `Access-Control-Allow-Origin` 时才允许页面读取响应体。OpenAI 的 POST 响应只给 `Expose-Headers`，不给 `Allow-Origin`，请求在浏览器网络层就被丢弃，JS 侧只拿到一个 `TypeError`。同一条请求用 curl 或后端发都成功——所以表现为「Key 明明有效，页面永远失败」。

实测（真实浏览器环境，401 说明请求确实到达了服务商）：

| 服务商 | 浏览器直连 | 现象 |
| :--- | :--- | :--- |
| OpenAI | ✗ | POST 响应缺 `Access-Control-Allow-Origin` |
| Google Gemini | ✓ | 正常返回，支持 search grounding |
| Perplexity | ✓ | 正常返回结构化 citations |
| OpenRouter | ✓ | 正常返回，`:online` 可联网 |
| DeepSeek | ✓ | 正常返回 |

正因如此，联网能力放在桌面端与安卓端：请求由主进程 / 原生层发出，不受同源策略约束。网页版若要接 OpenAI，得自己在中间架一层转发（仓库里的 [`worker/`](./worker) 就是给 Cloudflare Worker 用的白名单转发，补 CORS 头，Key 只经过你自己的 Worker）。

## 隐私与安全

- **没有后端**。仓库里没有服务器、数据库、统计脚本，也没有埋点。
- **Key 与历史只在本机**。Key 写在 `localStorage`（`veritas.settings.v2`），历史写在 `veritas.history.v1`，草稿写在 `veritas.draft.v1`，都不经过任何第三方服务器。
- **检索会出网，但只带查询词**。应用抓搜索结果与正文时，发出的是关键词和公开页面地址，不包含你的 API Key，也不会上传原文。原文只在你选择的模型接口里出现。
- **桌面端关闭 Node 集成**。`contextIsolation: true`、`nodeIntegration: false`，页面只能通过 preload 暴露的方法与主进程通信。

公开机器上使用的提醒：任何能打开这个应用的人都能读到本地保存的 Key 与历史，用完记得清除。

## 目录结构

```
src/
├─ App.tsx                 视图状态机（首页 / 任务 / 报告），快捷键
├─ components/
│  ├─ Composer.tsx         输入区（文本 / 链接、深度、模型）
│  ├─ ModelPicker.tsx      服务商下拉，标出已验证 / 待验证
│  ├─ Processing.tsx       进行中：阶段、进度、暂停 / 收起 / 取消
│  ├─ TaskDock.tsx         右下角任务卡：多任务、状态、暂停、移除
│  ├─ TaskError.tsx        失败 / 取消的收尾页，可重跑
│  ├─ HistoryPanel.tsx     历史列表：筛选、重开、删除、清空
│  ├─ ReportView.tsx       报告渲染（段落卡、来源、Markdown、重跑）
│  ├─ SettingsDialog.tsx   BYO-Key 配置，保存前自动验证
│  └─ ScoreRing.tsx        可信度环
├─ lib/
│  ├─ task.ts              任务调度：并发上限、排队、暂停闸门、耗时统计
│  ├─ research.ts          应用内检索：查询词、并发搜索、精读、证据块、缓存
│  ├─ history.ts           本地历史（容量控制、订阅通知）
│  ├─ settings.ts          服务商预设、Key 缓存、验证状态
│  ├─ providers.ts         请求适配、空结果重试、错误分类、引用解析
│  ├─ transport.ts         desktop / android / web 三条通道（POST + GET）
│  ├─ prompt.ts            核查纪律、证据约束与 JSON Schema
│  ├─ pipeline.ts          编排：抓取 → 检索 → 调用 → 解析 → 成文
│  ├─ report.ts            来源去重、编号、段落映射、证据兜底
│  ├─ markdown.ts          Markdown 报告生成
│  ├─ extract.ts           链接正文抽取
│  └─ parse.ts             JSON 容错解析
└─ styles/global.css       设计令牌与组件样式

electron/                  main.cjs（app:// 协议 + IPC 网络）+ preload.cjs
android/                   build.sh 构建链、MainActivity.java（WebView 壳 + POST/GET 桥）
worker/                    Cloudflare Worker 转发（浏览器直连 OpenAI 的补丁）
site/                      项目介绍页，发布到 GitHub Pages
docker/                    nginx.conf，供自托管镜像使用
```

## 已知限制

- **检索源会被限流**。360 搜索与 DuckDuckGo 都是 HTML 抓取，连续核查可能触发人机校验（表现为 202 或验证码页）。任一源失败会自动换下一个，并在报告的「核查局限」里写明；全部失败时本次核查只依据模型知识。同时跑多个核查更容易被限流，这也是并发上限设为 2 的原因。
- **暂停不会掐断已发出的请求**。暂停按下时若正有一个模型请求在飞，要等它返回才真正静止；界面会显示「正在暂停」而不是「已暂停」。
- **刷新丢任务**。未完成的任务只存在内存里，刷新或关闭窗口就没了；已完成的报告都在历史里。
- **网页端检索能力有限**。浏览器同源策略挡掉了搜索结果页，只剩维基百科可用，所以网页形态定位是内网自托管，正式使用请用客户端。
- **抓取**：部分站点有反爬、需要登录或纯前端渲染，抓取会失败，此时请直接粘贴正文。
- **模型幻觉**：即便提示词反复要求「不得编造 URL」，模型仍可能给出看似合理但错误的判断。报告是**辅助材料**，重要结论请回到 `[1]` `[2]` 指向的原文复核。
- **成本**：深度档会显著增加检索与 token 消耗，建议先用「快速」试跑一段。
- **平台覆盖**：Windows 只出了 x64，没有 arm64 与 macOS 包；APK 只做了 arm64 且使用调试签名；两者都未做代码签名与自动更新。

## 参与贡献

Issue 与 PR 都欢迎。加一家服务商的路子很短：在 `src/lib/settings.ts` 的 `PROVIDERS` 里加一条 `ProviderPreset`，再在 `src/lib/providers.ts` 里写一个适配器，返回 `{ text, citations, searchUsed, notes }` 即可。加一个检索源则在 `src/lib/research.ts` 的 `searchAny` 里追加一个返回 `Hit[]` 的函数。

## License

[MIT](./LICENSE) © 2026 kkai726
