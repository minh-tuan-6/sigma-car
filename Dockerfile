# SIGMACAR backend API (server.js + backend/) — container image for any Node host with a persistent disk
# (Fly.io, Render, Railway, a VM with Docker, …). Cloudflare Pages forwards /api/v1/* to it through
# functions/api/v1/[[path]].js. See docs/CLOUDFLARE_DEPLOYMENT.md.
#
#   docker build -t sigmacar-api .
#   docker run -p 8080:8080 -v sigmacar-data:/data \
#     -e JWT_SECRET=... -e PROXY_SHARED_SECRET=... -e TRUST_PROXY=true sigmacar-api

FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    SIGMACAR_DATA_FILE=/data/sigmacar_store.json

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Only what the API needs at runtime (the static site is served by Cloudflare Pages).
COPY server.js ./
COPY backend ./backend
COPY js/data.js ./js/data.js
COPY data/ar-manifest.json ./data/ar-manifest.json
COPY assets/models/manifests ./assets/models/manifests
# Optional first-boot seed (copied to the volume only when SIGMACAR_SEED_FROM_REPO=true; see entrypoint).
COPY data/sigmacar_store.json ./seed/sigmacar_store.json
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data && chown -R node:node /data /app/data

USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/v1/health >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
