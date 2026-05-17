FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
ARG COREPACK_NPM_REGISTRY
ARG NPM_CONFIG_REGISTRY
ARG PRISMA_ENGINES_MIRROR
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY scripts/check-runtime.mjs scripts/check-runtime.mjs
COPY apps/server/package.json apps/server/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/types/package.json packages/types/package.json
COPY prisma/schema.prisma prisma/schema.prisma
RUN set -eu; \
    if [ -n "${COREPACK_NPM_REGISTRY:-}" ]; then export COREPACK_NPM_REGISTRY; fi; \
    if [ -n "${NPM_CONFIG_REGISTRY:-}" ]; then export NPM_CONFIG_REGISTRY; fi; \
    if [ -n "${PRISMA_ENGINES_MIRROR:-}" ]; then export PRISMA_ENGINES_MIRROR; fi; \
    pnpm install --filter @agentrade/server... --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @agentrade/config build
RUN pnpm --filter @agentrade/contracts build
RUN pnpm --filter @agentrade/types build
RUN pnpm --filter @agentrade/server prisma:generate
RUN pnpm --filter @agentrade/server build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/docker-entrypoint.sh ./apps/server/docker-entrypoint.sh
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
RUN node -e "const fs = require('node:fs'); for (const name of ['config', 'contracts', 'types']) { const path = '/app/packages/' + name + '/package.json'; const pkg = JSON.parse(fs.readFileSync(path, 'utf8')); pkg.main = 'dist/index.js'; pkg.types = 'dist/index.d.ts'; pkg.exports = './dist/index.js'; fs.writeFileSync(path, JSON.stringify(pkg, null, 2)); }"
EXPOSE 3000
CMD ["sh", "apps/server/docker-entrypoint.sh"]
