# Build context MUST be the monorepo root, not apps/worker — this needs the full pnpm
# workspace to resolve `workspace:*` deps (@pulse/shared, @pulse/graph, @pulse/gateway).
#
# Railway: set "Root Directory" to the repo root, and dockerfilePath to
# apps/worker/Dockerfile (see railway.json in this folder).
#
# Local build/run from repo root:
#   docker build -f apps/worker/Dockerfile -t pulse-worker .
#   docker run --env-file .env pulse-worker

FROM node:20-slim AS base
# Container-local time must match the timezone the agent reasons in
# (Australia/Sydney). Node 20 resolves TZ names via its bundled ICU tz database,
# so no tzdata package is needed. Without this the container runs UTC while
# `isDaytime` judges Sydney: the weekly-digest predicate (Monday 9-11am
# container-local AND daytime in Sydney) is satisfiable zero times, and every
# scheduler PLATFORM_WINDOWS slot lands 10-11 hours out (an "11am Instagram"
# post fires at 11:00 UTC = 9pm Sydney).
ENV TZ=Australia/Sydney
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
# apps/web isn't needed to run the worker, but pnpm needs its package.json present to
# resolve the workspace graph if it references shared deps; copy it if it exists.
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @pulse/worker...

FROM deps AS runner
ENV NODE_ENV=production
WORKDIR /app
CMD ["pnpm", "--filter", "@pulse/worker", "start"]
