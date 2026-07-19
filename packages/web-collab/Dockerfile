# 前端镜像：Vite 构建为静态资源，用 nginx 托管（Web + 移动 PWA 共用同一份静态包）
# 构建上下文 = 仓库根（docker-compose 中指定 context: .）。
FROM node:22-slim AS build
WORKDIR /app

# 依赖清单先入层，利用缓存。
# 关键：根 package.json 的 workspaces 声明了 6 个包，npm ci 会校验整个 workspaces
# 图，必须把这 6 个包的 package.json 全部复制进来（shared/engine/server/web/
# web-collab/desktop）。若缺失任何一个，npm 找不到该 workspace 成员，会把内部
# @dm-life/* 依赖当成外部包去 npm 公共仓库拉取 → 404 导致构建失败。
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/web-collab/package.json packages/web-collab/package.json
COPY apps/desktop/package.json apps/desktop/package.json

RUN npm ci --include=dev

# 源码
COPY packages ./packages
COPY apps ./apps

RUN npm run build -w packages/web-collab

FROM nginx:alpine
COPY --from=build /app/packages/web-collab/dist /usr/share/nginx/html
COPY packages/web-collab/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
