# 协作后端镜像：tRPC + PGlite(文件型) / 可选真实 Postgres(DATABASE_URL)
# 默认用 PGLITE_DIR 走文件持久化（无需外部数据库）；
# 也可设 DATABASE_URL=postgres://... 改用真实 Postgres（表由 migrations/ 管理）。
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=4100 \
    PGLITE_DIR=/data \
    CORS_ORIGIN=*

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

VOLUME ["/data"]
EXPOSE 4100

CMD ["npm", "start", "-w", "packages/server"]
