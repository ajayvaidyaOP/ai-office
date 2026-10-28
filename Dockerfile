# AI Digital Office — zero-dependency Node image
FROM node:22-alpine

WORKDIR /app

# No npm install needed: the app uses Node built-ins only.
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY docs ./docs
COPY n8n ./n8n

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
