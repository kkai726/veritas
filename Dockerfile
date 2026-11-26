# 自托管用的静态镜像：Node 构建 → Nginx 托管
# 前端没有任何运行时服务端依赖，镜像里只有 HTML/CSS/JS。

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

RUN npm run build


FROM nginx:1.27-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf /etc/nginx/conf.d/veritas.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

LABEL org.opencontainers.image.title="Veritas" \
      org.opencontainers.image.description="AI 事实核查台 — 逐段取证，输出可信度评分与 Markdown 报告" \
      org.opencontainers.image.source="https://github.com/kkai726/veritas" \
      org.opencontainers.image.licenses="MIT"
