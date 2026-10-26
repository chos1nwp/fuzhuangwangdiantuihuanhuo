# syntax=docker/dockerfile:1
#
# 服装网店退换货处理系统 · 应用镜像
# 构建：docker build -t clothes-after-sale:1.1.0 .
# 说明：数据库不打包进镜像，由 docker-compose.yml 单独起 MySQL 容器。

# ---------- 阶段一：安装生产依赖 ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci 严格按 lock 文件安装，保证每次构建结果一致
RUN npm ci --omit=dev && npm cache clean --force

# ---------- 阶段二：运行时镜像 ----------
FROM node:22-alpine AS runtime

# 业务时间戳由 Node 生成，容器内时区必须与使用方一致，否则时间线会差 8 小时
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=3000

RUN apk add --no-cache tzdata \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app

# 只带运行必需的代码；.env 由 .dockerignore 排除，密码不会被打进镜像
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js db.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node test ./test

# node 镜像自带非 root 用户，避免容器以 root 运行
USER node

EXPOSE 3000

# 容器编排平台据此判断服务是否真的可用（接口 200 才算健康）
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
