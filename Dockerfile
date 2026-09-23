# syntax=docker/dockerfile:1.7
FROM node:24.21.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM node:24.21.0-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /workspace/apps/server/node_modules ./apps/server/node_modules
COPY --from=build --chown=node:node /workspace/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /workspace/packages ./packages
COPY --from=build --chown=node:node /workspace/db/migrations ./db/migrations
USER node
EXPOSE 3000
CMD ["sh", "-c", "node apps/server/dist/db/migrate.js && node apps/server/dist/db/seed.js && node apps/server/dist/index.js"]

FROM nginxinc/nginx-unprivileged:1.29.1-alpine AS web
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

