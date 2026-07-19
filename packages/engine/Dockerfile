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

# 依赖清单先入层，利用缓存
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --include=dev

# 源码
COPY packages ./packages
COPY tsconfig.base.json ./tsconfig.base.json

VOLUME ["/data"]
EXPOSE 14570

# 经 npm workspaces 启动 tsx（tsx 在 devDependencies）
CMD ["npm", "start", "-w", "packages/engine"]
