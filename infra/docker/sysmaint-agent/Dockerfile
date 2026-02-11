FROM node:24.13.0-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig*.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/signal-core/package.json packages/signal-core/package.json
COPY packages/sysmaint-protocol/package.json packages/sysmaint-protocol/package.json
COPY apps/sysmaint-agent/package.json apps/sysmaint-agent/package.json
COPY apps/diag-probe/package.json apps/diag-probe/package.json
COPY apps/sysmaint-web/package.json apps/sysmaint-web/package.json

RUN npm ci

COPY . .

# Build all packages using TypeScript project references
RUN npm run build

CMD ["npm", "run", "sysmaint:agent"]
