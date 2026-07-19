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
# 关键①：根 package.json 的 workspaces 声明了 6 个包，npm install 会校验整个
# workspaces 图，必须把这 6 个包的 package.json 全部复制进来（shared/engine/
# server/web/web-collab/desktop）。若缺失任何一个，npm 找不到该 workspace 成员，
# 会把内部 @dm-life/* 依赖当成外部包去 npm 公共仓库拉取 → 404 导致构建失败。
# 关键②：package-lock.json 是在 Windows 上生成的，只记录 Windows 原生二进制
#（@rollup/rollup-win32-*、@esbuild/win32-*）。Docker 容器是 linux-x64——若带着
# 这个 lockfile 跑 `npm install`，npm 仍照 lockfile 还原、不会为 linux 重解析
# 可选原生二进制，触发著名 bug npm/cli#4828（tsx 依赖的 esbuild 原生二进制缺失 →
# 容器启动即崩）。npm 官方给的修复就是「删掉 lockfile 再重装」，故此处先 rm 再
# install，让 npm 按 linux 平台重新解析并装上正确的原生二进制。仓库里的 lockfile
# 仍保留给本地 Windows 开发用，不参与 Docker 构建。
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/web-collab/package.json packages/web-collab/package.json
COPY apps/desktop/package.json apps/desktop/package.json

RUN rm -f package-lock.json && npm install --include=dev

# 源码
COPY packages ./packages
COPY apps ./apps

VOLUME ["/data"]
EXPOSE 4100

CMD ["npm", "start", "-w", "packages/server"]
