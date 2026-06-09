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

# Plain-JS TTS worker (src/lib/tts/ttsWorker.js). It is forked at runtime via a
# path string, so Next's standalone tracing doesn't see it — copy it explicitly,
# preserving the cwd-relative path the parent resolves (src/lib/tts/ttsWorker.js).
COPY src/lib/tts/ttsWorker.js ./src/lib/tts/ttsWorker.js

RUN chown -R node:node /home/yaawc && \
    chmod +x /home/yaawc/entrypoint.sh && \
    npm install playwright -g --no-fund --no-audit && \
    npx playwright install-deps chromium && \
    apt-get update && \
    apt-get install -y procps util-linux && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    rm -rf ~/.npm

# Configure the container to run in an unprivileged mode
USER node

# Next.js standalone tracing copies onnxruntime-node's *_binding.node but not the
# libonnxruntime.so.1 it dlopens at runtime (loaded via path, not require()), so we
# overlay the full bin/ dir to co-locate the shared lib. kokoro-js bundles its own
# nested @huggingface/transformers -> onnxruntime-node (a different version/ABI than
# the top-level one used by embeddings), so its bin/ needs the same treatment.
COPY --from=builder /home/yaawc/node_modules/onnxruntime-node/bin /home/yaawc/node_modules/onnxruntime-node/bin
COPY --from=builder /home/yaawc/node_modules/kokoro-js/node_modules/onnxruntime-node/bin /home/yaawc/node_modules/kokoro-js/node_modules/onnxruntime-node/bin
# kokoro-js reads its voice packs from voices/*.bin via fs.readFile(path.resolve(
# __dirname, '../voices/...')) — a runtime path read, not a require() — so nft skips
# the voices/ data dir. Overlay it (the .bin files ship in the package, they are not
# downloaded server-side; only the ONNX model is fetched at runtime).
COPY --from=builder /home/yaawc/node_modules/kokoro-js/voices /home/yaawc/node_modules/kokoro-js/voices

# Install Playwright and its dependencies
RUN npx -y playwright install chromium --only-shell && \
    rm -rf ~/.npm

CMD ["./entrypoint.sh"]
