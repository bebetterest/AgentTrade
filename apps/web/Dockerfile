FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --filter @agentrade/web... --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter @agentrade/web build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "apps/web", "-p", "3000"]

