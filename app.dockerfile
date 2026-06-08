FROM node:24-slim AS builder

WORKDIR /home/yaawc

RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000
ENV NEXT_TELEMETRY_DISABLED=1

COPY tsconfig.json next.config.mjs postcss.config.js drizzle.config.ts tailwind.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY public ./public

RUN mkdir -p /home/yaawc/data
RUN yarn build

RUN yarn add --dev @vercel/ncc
RUN yarn ncc build ./src/lib/db/migrate.ts -o migrator

FROM node:24-slim

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /home/yaawc

COPY --from=builder /home/yaawc/public ./public
COPY --from=builder /home/yaawc/.next/static ./public/_next/static

COPY --from=builder /home/yaawc/.next/standalone ./
# Next.js standalone tracing copies playwright-core's JS but misses data files
# like browsers.json (loaded via a runtime path read, not require()), which
# crashes startup. Overlay the complete packages from the builder.
COPY --from=builder /home/yaawc/node_modules/playwright ./node_modules/playwright
COPY --from=builder /home/yaawc/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=builder /home/yaawc/data ./data
COPY drizzle ./drizzle
COPY --from=builder /home/yaawc/migrator/build ./build
COPY --from=builder /home/yaawc/migrator/index.js ./migrate.js

COPY entrypoint.sh ./entrypoint.sh

RUN chown -R node:node /home/yaawc && \
    chmod +x /home/yaawc/entrypoint.sh && \
    npm install playwright -g --no-fund --no-audit && \
    npx playwright install-deps chromium && \
    apt-get update && \
    apt-get install -y procps && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    rm -rf ~/.npm

# Configure the container to run in an unprivileged mode
USER node

COPY --from=builder /home/yaawc/node_modules/onnxruntime-node/bin /home/yaawc/node_modules/onnxruntime-node/bin

# Install Playwright and its dependencies
RUN npx -y playwright install chromium --only-shell && \
    rm -rf ~/.npm

CMD ["./entrypoint.sh"]
