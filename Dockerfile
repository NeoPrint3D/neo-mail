FROM oven/bun:1.4.4 AS bun

FROM node:24-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build && bun install --frozen-lockfile --production

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json LICENSE ./
USER node
EXPOSE 3000 2525
VOLUME ["/data"]
CMD ["node", "build/start.mjs"]
