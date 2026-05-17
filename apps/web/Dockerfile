FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
ARG COREPACK_NPM_REGISTRY
ARG NPM_CONFIG_REGISTRY
ARG PRISMA_ENGINES_MIRROR
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY scripts/check-runtime.mjs scripts/check-runtime.mjs
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/types/package.json packages/types/package.json
RUN set -eu; \
    if [ -n "${COREPACK_NPM_REGISTRY:-}" ]; then export COREPACK_NPM_REGISTRY; fi; \
    if [ -n "${NPM_CONFIG_REGISTRY:-}" ]; then export NPM_CONFIG_REGISTRY; fi; \
    if [ -n "${PRISMA_ENGINES_MIRROR:-}" ]; then export PRISMA_ENGINES_MIRROR; fi; \
    pnpm install --filter @agentrade/web... --frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_AGENT_SKILLS_INSTALL_COMMAND
ARG INTERNAL_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_AGENT_SKILLS_INSTALL_COMMAND=${NEXT_PUBLIC_AGENT_SKILLS_INSTALL_COMMAND}
ENV INTERNAL_API_BASE_URL=${INTERNAL_API_BASE_URL}
COPY . .
RUN pnpm --filter @agentrade/web build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-p", "3000"]
