FROM node:24.14.0-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts/admin-create.mjs scripts/sync-pwa-version.mjs ./scripts/
RUN node scripts/sync-pwa-version.mjs && mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
