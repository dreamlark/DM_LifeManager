# 本地引擎镜像：tRPC + Drizzle + sql.js(WASM SQLite)
# 直接经 tsx 运行 TS 源码（与本地开发一致）；依赖由 npm workspaces 安装。
# 数据持久化：挂载卷到 DM_LIFE_DATA_DIR（/data），sql.js 落盘到该目录。
# 构建上下文 = 仓库根（docker-compose 中指定 context: .），故以下 COPY 均为根相对路径。
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=14570 \
    HOST=0.0.0.0 \
    DM_LIFE_DATA_DIR=/data

WORKDIR /app

# 依赖清单先入层，利用缓存。
# 只复制目标包及其直接依赖的 workspace package.json（engine 仅依赖 @dm-life/shared），
# 不复制其他 workspace（server/web/web-collab/desktop），避免它们的内部 @dm-life/* 依赖
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
COPY packages/engine/package.json packages/engine/package.json

RUN rm -f package-lock.json && npm install --include=dev

# 源码
COPY packages ./packages
COPY apps ./apps

VOLUME ["/data"]
EXPOSE 14570

# N4：以非 root 的 node 用户运行，降低容器逃逸后的影响面（node:22-slim 已内置 node 用户）。
# 注意：/data 由 compose 挂载宿主机卷，运行时该目录归属由宿主机决定；请保证挂载目录对
# node 用户（uid 1000）可写，或在部署侧用 chown 修正，否则引擎落盘会报权限错误。
RUN chown -R node:node /app && mkdir -p /data && chown -R node:node /data
USER node

# 经 npm workspaces 启动 tsx（tsx 在 devDependencies）
CMD ["npm", "start", "-w", "packages/engine"]
