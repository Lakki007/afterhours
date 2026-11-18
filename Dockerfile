# syntax=docker/dockerfile:1
# After Hours: build web + server, run one slim Node process that serves both.

# ---- build: install everything, build web (Vite) and server (esbuild bundle)
FROM node:24-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build

# ---- deps: production dependencies of the server only (the bundle keeps npm deps external)
FROM node:24-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts -w server && npm cache clean --force

# ---- runtime
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/afterhours.db \
    WEB_DIST=/app/web/dist
WORKDIR /app
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/server/dist ./server/dist
COPY --from=build /src/web/dist ./web/dist
COPY server/package.json ./server/package.json
COPY package.json ./package.json
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
