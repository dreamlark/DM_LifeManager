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
# 只复制目标包及其直接依赖的 workspace package.json（server 仅依赖 @dm-life/shared），
# 不复制其他 workspace（engine/web/web-collab/desktop），避免它们的内部 @dm-life/* 依赖
# 在无锁文件重装时被当作外部包去 npm 公共仓库拉取 → 404 构建失败。
# 关键②：package-lock.json 是在 Windows 上生成的，只记录 Windows 原生二进制
#（@rollup/rollup-win32-*、@esbuild/win32-*）。Docker 容器是 linux-x64——若带着
# 这个 lockfile 跑 `npm install`，npm 仍照 lockfile 还原、不会为 linux 重解析
# 可选原生二进制，触发著名 bug npm/cli#4828（tsx 依赖的 esbuild 原生二进制缺失 →
# 容器启动即崩）。npm 官方给的修复就是「删掉 lockfile 再重装」，故此处先 rm 再
# install，让 npm 按 linux 平台重新解析并装上正确的原生二进制。仓库里的 lockfile
# 仍保留给本地 Windows 开发用，不参与 Docker 构建。
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json

RUN rm -f package-lock.json && npm install --include=dev

# 源码
COPY packages ./packages
COPY apps ./apps

VOLUME ["/data"]
EXPOSE 4100

# N4：以非 root 的 node 用户运行，降低容器逃逸后的影响面（node:22-slim 已内置 node 用户）。
# 注意：/data 由 compose 挂载宿主机卷，运行时该目录归属由宿主机决定；请保证挂载目录对
# node 用户（uid 1000）可写，或在部署侧用 chown 修正，否则 PGlite 落盘会报权限错误。
RUN chown -R node:node /app && mkdir -p /data && chown -R node:node /data
USER node

CMD ["npm", "start", "-w", "packages/server"]
