# Veritas 转发网关

一个 60 行的 Cloudflare Worker：把浏览器请求转发给模型服务商，并补上 CORS 响应头。

**为什么需要它**：OpenAI 官方 API 的 POST 响应不返回 `Access-Control-Allow-Origin`，浏览器读不到结果，页面会报 `TypeError: Failed to fetch`。这不是 Key 的问题，任何纯前端站点都一样。用自己的网关转发一次就通了，Key 仍然只存在你浏览器里，网关不落盘、不记录。

## 部署（约 2 分钟）

```bash
cd worker
npx wrangler login      # 浏览器里授权 Cloudflare 账号
npx wrangler deploy
```

部署成功后会输出一个地址，形如：

```
https://veritas-gateway.your-name.workers.dev
```

## 填到 Veritas 里

打开 Veritas 右上角「模型与检索」，把地址按服务商拼好后填进「接口地址」：

| 服务商 | 接口地址 |
| --- | --- |
| OpenAI | `https://veritas-gateway.your-name.workers.dev/openai/v1` |
| Google Gemini | `https://veritas-gateway.your-name.workers.dev/gemini/v1beta` |
| DeepSeek | `https://veritas-gateway.your-name.workers.dev/deepseek/v1` |
| OpenRouter | `https://veritas-gateway.your-name.workers.dev/openrouter/v1` |
| Perplexity | `https://veritas-gateway.your-name.workers.dev/perplexity` |

模型名和 API Key 保持原样。填完点「测试连接」，出现「连接正常」即可保存。

## 路由规则

| 前缀 | 转发到 |
| --- | --- |
| `/openai/*` | `https://api.openai.com/*` |
| `/gemini/*` | `https://generativelanguage.googleapis.com/*` |
| `/deepseek/*` | `https://api.deepseek.com/*` |
| `/openrouter/*` | `https://openrouter.ai/api/*` |
| `/perplexity/*` | `https://api.perplexity.ai/*` |

只转发到上面五个域名，其余路径返回 404，不是开放代理。

## 建议加固

- 在 Cloudflare 控制台给 Worker 绑自定义域名，并开启 WAF 速率限制，避免地址被他人当作免费中转。
- 若只想给自己用，可以在 Worker 里加一行校验：读取 `request.headers.get('x-veritas-token')` 与 `env.PROXY_TOKEN` 比对，然后 `npx wrangler secret put PROXY_TOKEN`。注意这样需要在请求里带上该头，当前前端没有这个字段，适合二次开发。
- 网关不存储请求体，但 Cloudflare 平台仍会记录基础访问日志；对日志敏感的场景请自建（Vercel Edge Function、Nginx 反代同理）。
