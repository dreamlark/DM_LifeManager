# 前端镜像：Vite 构建为静态资源，用 nginx 托管（Web + 移动 PWA 共用同一份静态包）
# 构建上下文 = 仓库根（docker-compose 中指定 context: .）。
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# 复制 web-collab 依赖的全部 workspace 包(package.json)，让 npm workspaces 在本地解析
# 内部包(@dm-life/engine/@dm-life/server/@dm-life/shared)，否则 npm ci 会去公共仓库找
# 这些私有包而 404。等 npm ci 完成后再 COPY 整个 packages 目录带来源码。
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web-collab/package.json packages/web-collab/package.json
RUN npm ci --include=dev
COPY packages ./packages
COPY tsconfig.base.json ./tsconfig.base.json
RUN npm run build -w packages/web-collab

FROM nginx:alpine
COPY --from=build /app/packages/web-collab/dist /usr/share/nginx/html
COPY packages/web-collab/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
