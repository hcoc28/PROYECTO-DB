# ============================================================
# FEL SaaS GT — imagen de producción (multi-stage)
# Requiere next.config.ts con output: "standalone" para imagen mínima
# ============================================================

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY database/prisma ./database/prisma
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema database/prisma/schema.prisma && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/frontend/.next/standalone ./
COPY --from=builder --chown=app:app /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=app:app /app/frontend/public ./frontend/public
USER app
EXPOSE 3000
CMD ["node", "frontend/server.js"]
