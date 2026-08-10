# ---- 构建阶段 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src

# ---- 运行阶段 ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
# procfs 读取 /proc/<pid>/fd 需要 root，故容器内以 root 运行
EXPOSE 8088
CMD ["node", "src/server.js"]
