# 前端镜像：Vite 构建为静态资源，用 nginx 托管（Web + 移动 PWA 共用同一份静态包）
# 构建上下文 = 仓库根（docker-compose 中指定 context: .）。
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/web-collab/package.json packages/web-collab/package.json
RUN npm ci
COPY packages ./packages
COPY tsconfig.base.json ./tsconfig.base.json
RUN npm run build -w packages/web-collab

FROM nginx:alpine
COPY --from=build /app/packages/web-collab/dist /usr/share/nginx/html
COPY packages/web-collab/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
