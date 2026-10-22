# =============================================================================
# FLIX REVERSI — Production Multi-Stage Dockerfile
# Compatible with Koyeb, Render, and Ubuntu/Linux VPS
# =============================================================================
FROM node:18-alpine AS runner

WORKDIR /app

# Create non-root application user and durable data directory
RUN mkdir -p /app/data /app/dist /app/public && chown -R node:node /app

# Copy compiled server, engine modules, and static frontend bundle
COPY --chown=node:node dist/ ./dist/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node package.json ./package.json

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_DIR=/app/data
ENV STATIC_DIR=/app/public

VOLUME ["/app/data"]
EXPOSE 8080

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

STOPSIGNAL SIGTERM

CMD ["node", "dist/server/index.js"]
