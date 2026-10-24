# syntax=docker/dockerfile:1
FROM node:20-alpine AS runtime

WORKDIR /app

# Create non-root user for security
RUN addgroup -S flix && adduser -S flix -G flix

# Copy application source and pre-built frontend bundle
COPY package.json ./
COPY src ./src
COPY server ./server
COPY supabase ./supabase
COPY dist ./dist

# Ensure durable data directory is writable by non-root user
RUN mkdir -p /app/data && chown -R flix:flix /app

USER flix

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV ROOM_STORE_PATH=/app/data/rooms_snapshot.json

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server/index.mjs"]
