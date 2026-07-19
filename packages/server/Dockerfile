# 协作后端镜像：tRPC + PGlite(文件型) / 可选真实 Postgres(DATABASE_URL)
# 默认用 PGLITE_DIR 走文件持久化（无需外部数据库）；
# 也可设 DATABASE_URL=postgres://... 改用真实 Postgres（表由 migrations/ 管理）。
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=4100 \
    PGLITE_DIR=/data \
    CORS_ORIGIN=*

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --include=dev

COPY packages ./packages
COPY tsconfig.base.json ./tsconfig.base.json

VOLUME ["/data"]
EXPOSE 4100

CMD ["npm", "start", "-w", "packages/server"]
