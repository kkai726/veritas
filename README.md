<div align="center">

# Veritas

**贴入一段文字，或者一个链接。逐段取证，给出可信度与来源。**

纯前端 · 自带模型 Key · 不经过任何中间服务器 · 输出整洁 Markdown

[在线体验](https://kkai726.github.io/veritas/) · [示例报告](https://kkai726.github.io/veritas/?demo=1) · [源码](https://github.com/kkai726/veritas)

[![License: MIT](https://img.shields.io/badge/License-MIT-1c4739.svg)](./LICENSE)
[![Vite](https://img.shields.io/badge/Vite-6-646cff.svg)](https://vite.dev)
[![React](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-1c4739.svg)](#参与贡献)

<img src="./docs/screenshot-home.png" alt="Veritas 首页" width="880" />

</div>

---

## 它解决什么问题

大多数「AI 事实核查」给出的是一句结论：真、假、或「需要更多信息」。但真实世界的文本是混合的——同一段话里，有的数字准确，有的因果被夸大，有的引述被张冠李戴。

Veritas 不做一句话判决，它做的事是：

1. **拆段** —— 把长文按自然段切开，逐段判断这段里有没有可核实的事实性主张；
2. **取证** —— 通过所选模型的联网能力检索公开来源（官方公告、论文、监管文件、主流媒体）；
3. **比对** —— 把每条主张和证据并排放，标出「支持 / 部分支持 / 缺乏证据 / 与证据矛盾 / 无法核实」；
4. **成文** —— 输出可信度百分比、逐段分析、可点击的来源清单，以及一份排版整洁的 Markdown 报告。

<div align="center">
<img src="./docs/screenshot-report.png" alt="核查报告" width="880" />
</div>

## 特性

- **逐段核查**：每段独立评分、独立结论，附原文引用，方便对照修改。
- **每条主张挂来源**：主张级别的引用编号，点击直达原文；没有来源时明确标注「无法核实」，而不是编一个链接。
- **可信度 0–100**：环形评分 + 五档判定，段落级进度条，一眼看出问题集中在哪。
- **链接读取**：粘贴 URL 自动抓正文（Jina Reader 优先，公共代理 + 浏览器解析兜底）。
- **Markdown 报告**：一键复制 / 下载 `.md`，含结论表、逐段分析、来源清单、核查局限，可直接贴进文档或 PR。
- **自带模型**：OpenAI、Gemini、Perplexity、OpenRouter、DeepSeek，以及任意 OpenAI 兼容网关。Key 存在你自己的浏览器里。
- **深度可调**：快速 / 标准 / 深度三档，控制拆段数量与检索强度，兼顾成本。
- **零后端**：静态站点即可运行，`npm run build` 产出纯静态文件，扔到任何地方都能用。

## 三种运行形态

同一个前端代码库，打包成三种东西，共用一个界面与一套 Key 缓存：

| 形态 | 产物 | 网络通道 | 能不能直连 OpenAI |
| :--- | :--- | :--- | :--- |
| 网页 | `dist/` 静态文件 | 浏览器 `fetch` | 不能（CORS） |
| Windows 桌面 | 安装包 `.exe` / 免安装 `.exe` | Electron 主进程 `net` | 能 |
| 安卓 | `.apk` | Capacitor 原生 HTTP | 能 |

模型的 Key 按服务商分别缓存在本机 `localStorage`，切换模型不丢，卸载才清除。

### Windows 桌面端

```bash
npm install
npm run app:win        # 产出 release/ 下的安装包与免安装版
```

开发时直接 `npm run electron`（先构建再起窗口）。

### 安卓端

```bash
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

正式签名版把 `assembleDebug` 换成 `assembleRelease`，并在 `android/app/build.gradle` 里配好 `signingConfigs`。

## 快速开始

```bash
git clone https://github.com/kkai726/veritas.git
cd veritas
npm install
npm run dev      # http://localhost:5173
```

打开页面右上角的「模型与检索」，选服务商、填模型名和 API Key，保存即可开始核查。
没有 Key 也可以先点「示例报告」看看输出长什么样。

构建与预览：

```bash
npm run build
npm run preview
```

## 支持的模型

界面上直接可选的六家，Key 按服务商分别缓存，换模型不用重填：

| 服务商 | 默认模型 | 浏览器直连 | 说明 |
| :--- | :--- | :--- | :--- |
| DeepSeek | `deepseek-chat` | 可用 | 中文与推理稳，价格低 |
| MiMo | `mimo-v2.6-pro` | 可用 | 小米开放平台，OpenAI 兼容 |
| GLM | `glm-4.6` | 可用 | 智谱开放平台，`/api/paas/v4` |
| Kimi | `kimi-k3-1-pro` | 可用 | 月之暗面，长文本 |
| OpenAI | `gpt-4.1` | **不可用（CORS）** | 唯一带官方 `web_search`，需桌面端/安卓端 |
| 自定义 | — | 取决于网关 | 中转站、vLLM、Ollama、企业网关，填 Base URL 即可 |

模型名在设置里可以直接改，不局限于下拉建议值。其余服务商（Gemini、Perplexity、OpenRouter 等）走「自定义」填地址与模型名。

只有 OpenAI 会真正联网检索（`web_search` 工具）；其余模型没有内置检索，核查只依据模型自身知识，报告里的 `limitations` 会标出来。

## 为什么 OpenAI 会报 `Failed to fetch`

选了 OpenAI 官方接口、点「开始核查」后只有一个 `网络请求失败：Failed to fetch`，那多半不是 Key 的问题：

```bash
$ curl -sD - -o /dev/null -X POST https://api.openai.com/v1/responses \
    -H 'Origin: https://kkai726.github.io' -H 'Authorization: Bearer sk-test' \
    -H 'Content-Type: application/json' -d '{"model":"gpt-4.1","input":"hi"}'

HTTP/2 401
access-control-expose-headers: CF-Ray
# ← 没有 access-control-allow-origin
```

浏览器只有在响应带 `Access-Control-Allow-Origin` 时，才允许页面读取响应体。OpenAI 的 POST 响应只给了 `Expose-Headers`，没给 `Allow-Origin`，请求在浏览器网络层就被丢弃，JS 侧只拿到一个 `TypeError`。同一条请求用 curl 或后端发都成功——所以表现为「Key 明明有效，页面永远失败」。

三条出路，按省事程度排：

| 方案 | 做法 | 代价 |
| :--- | :--- | :--- |
| 换 OpenRouter | 设置里选 OpenRouter，模型填 `openai/gpt-4.1`（开启联网自动补 `:online`） | 需要 OpenRouter 的 Key，按量计费 |
| 自建转发网关 | 部署仓库里的 [`worker/`](./worker)，把地址填进「模型设置 → 接口地址」 | 需 Cloudflare 账号，免费额度够用；Key 只经过你自己的 Worker |
| 换服务商 | Gemini / Perplexity / DeepSeek 的响应都带 CORS 头，可直连 | 换个模型 |

实测（真实浏览器环境，401 说明请求确实到达了服务商）：

| 服务商 | 浏览器直连 | 现象 |
| :--- | :--- | :--- |
| OpenAI | ✗ | POST 响应缺 `Access-Control-Allow-Origin` |
| Google Gemini | ✓ | 正常返回，支持搜索接地 |
| Perplexity | ✓ | 正常返回结构化引用 |
| OpenRouter | ✓ | 正常返回，`:online` 可联网 |
| DeepSeek | ✓ | 正常返回 |

「接口地址」对任意服务商都生效，留空即直连官方域名。

## 工作原理

```
输入文本 / URL
   │
   ├─ URL  →  Jina Reader → 失败则公共代理 + 正文抽取
   │
   ├─ 构造核查指令（核查纪律 + 段落深度 + JSON Schema）
   │
   ├─ 调用模型（带联网工具）→ 正文 + 真实检索到的来源列表
   │
   ├─ JSON 解析（容错：代码围栏 / 尾逗号 / 截断）→ 失败则请求模型自修复一次
   │
   └─ 归一化 → 去重来源、编号、段落↔来源映射 → 渲染 + 生成 Markdown
```

关键设计：**报告里的链接只来自服务商真实返回的检索结果，或模型明确给出的 URL**；模型输出的结构化结果负责「判断」，来源列表负责「证据」，两者在 `src/lib/report.ts` 里合并编号，避免模型自由发挥写出不存在的链接。

## 输出示例

```markdown
# 事实核查报告 · 「8 杯水」与咖啡因：三条流行健康说法的核查

> **综合可信度 46/100 — 可信度低**
> 三段说法中只有阿斯巴甜一段与官方文件一致……

| 项目 | 内容 |
| :--- | :--- |
| 段落 / 可核实陈述 | 3 段 / 6 条 |
| 判定分布 | 有据支持 2 · 部分支持 1 · 缺乏证据 1 · 与证据矛盾 2 |
| 引用来源 | 6 条 · 6 个站点 |

## 逐段核查

### 1. 可信度低 · 34/100

> 每天喝 8 杯水是医学界的共识，因为人体每天必须排出约 2 升水分。

**判定** — 「8 杯水」没有权威机构背书……

- **✕ 与证据矛盾** 「每天 8 杯水」是医学界共识 — 美国国家医学院、梅奥诊所均未给出该标准 [1]
- **◐ 部分支持** 人体每天必须排出约 2 升水分 — 实际区间为 2–3 升 [2]
```

## 隐私与安全

- **没有后端**。这个仓库不包含任何服务器、数据库或代理，部署后是一堆静态文件。
- **Key 只存在本地**。写入 `localStorage`，随请求发往你选择的服务商，不经过第三方。清除浏览器数据即彻底删除。
- **不做遥测**。没有埋点、没有统计脚本。
- 公开部署时请知悉：任何拿到你浏览器的人都能读到本地保存的 Key，公共电脑上用完记得「清除 Key」。

## 部署

静态构建，任意托管均可：

| 平台 | 做法 |
| :--- | :--- |
| GitHub Pages | 已启用：推送到 `main` 由 `.github/workflows/deploy.yml` 自动构建发布 |
| Vercel / Netlify | 直接导入仓库，构建命令 `npm run build`，输出目录 `dist` |
| 任意对象存储 / Nginx | 上传 `dist/` 目录 |

若要在浏览器里直连 OpenAI，额外部署 `worker/` 里的转发网关（`npx wrangler deploy`），把生成的地址填进设置里的「接口地址」。

## 目录结构

```
src/
├─ App.tsx                 首屏 / 运行态 / 报告态的状态机
├─ components/
│  ├─ Composer.tsx         输入区（文本 / 链接、深度、联网开关）
│  ├─ ReportView.tsx       报告渲染（段落卡、来源、Markdown 预览）
│  ├─ SettingsDialog.tsx   BYO-Key 设置与连接测试
│  ├─ Processing.tsx       阶段进度
│  └─ ScoreRing.tsx        可信度环
├─ lib/
│  ├─ providers.ts         六类服务商适配（含引用解析）
│  ├─ prompt.ts            核查纪律与 JSON Schema
│  ├─ pipeline.ts          编排：抓取 → 调用 → 解析 → 成文
│  ├─ report.ts            归一化、来源去重与编号
│  ├─ markdown.ts          Markdown 报告生成
│  ├─ extract.ts           链接正文抽取
│  └─ parse.ts             JSON 容错解析
└─ styles/global.css       设计系统（色板、字体、组件样式）

worker/
└─ index.js                Cloudflare Worker 转发网关（补 CORS 头）
```

## 已知限制

- **抓取**：部分站点有反爬或需要登录，抓取会失败；此时请直接粘贴正文。公共代理不稳定，生产使用建议自建 Reader 服务。
- **模型幻觉**：即使要求「不得编造 URL」，模型仍可能给出看似合理但错误的主张判断。报告是**辅助材料**，重要结论请回到原始来源复核。
- **时效性**：未联网模式下，模型知识存在截止日期，近期事件容易判错。
- **成本**：深度模式会显著增加检索与 token 消耗，建议先用「快速」试跑。

## 参与贡献

欢迎 Issue 与 PR。想加新的服务商，只需在 `src/lib/settings.ts` 里加一条 `ProviderPreset`，并在 `src/lib/providers.ts` 里实现一个 `runXxx` 适配器返回 `{ text, citations, searchUsed }`。

## License

[MIT](./LICENSE) © 2026 kkai726
