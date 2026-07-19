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
EXPOSE 14570

# 经 npm workspaces 启动 tsx（tsx 在 devDependencies）
CMD ["npm", "start", "-w", "packages/engine"]
