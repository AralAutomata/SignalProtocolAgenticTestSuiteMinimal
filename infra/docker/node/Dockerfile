FROM node:24.13.0-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig*.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/signal-core/package.json packages/signal-core/package.json
COPY packages/sysmaint-protocol/package.json packages/sysmaint-protocol/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/sysmaint-agent/package.json apps/sysmaint-agent/package.json
COPY apps/diag-probe/package.json apps/diag-probe/package.json
COPY apps/sysmaint-web/package.json apps/sysmaint-web/package.json

RUN npm ci

COPY . .

RUN npm run build
RUN npm prune --omit=dev

FROM node:24.13.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/cli/dist ./apps/cli/dist
COPY --from=build /app/apps/cli/package.json ./apps/cli/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/signal-core/dist ./packages/signal-core/dist
COPY --from=build /app/packages/signal-core/package.json ./packages/signal-core/package.json

RUN mkdir -p /home/node/.mega \
  && chown -R node:node /home/node /app

USER node

ENTRYPOINT ["node", "apps/cli/dist/index.js"]
CMD ["--help"]
