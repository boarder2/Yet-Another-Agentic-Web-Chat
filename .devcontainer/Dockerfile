FROM node:24-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    procps \
    python3 \
    pipx \
    make \
    g++ \
    sqlite3 \
    ssh \
    jq \
    zsh \
    unzip \
    libsecret-1-0 libsecret-1-dev libsecret-common gnome-keyring gnome-keyring-pkcs11 seahorse \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Enable Yarn via Corepack (ships with Node)
RUN corepack enable

# Playwright OS dependencies (Chromium). Browser binaries are installed in postCreateCommand.
RUN npm install -g playwright @playwright/cli@latest typescript-language-server typescript --no-fund --no-audit \
  && npx playwright install --with-deps \
  && npx playwright install chrome --with-deps \
  && apt-get clean && rm -rf /var/lib/apt/lists/* /root/.npm

# Create directories used by the app when DATA_DIR points here
RUN mkdir -p \
    /home/yaawc/data \
    /home/yaawc/uploads \
    /home/yaawc/storage/deep_research \
    /workspaces/YAAWC \
    /home/node/.omp/config \
  && chown -R node:node /home/yaawc /workspaces /home/node

WORKDIR /workspaces/YAAWC
USER node

RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
RUN curl -s https://raw.githubusercontent.com/boarder2/utils/refs/heads/main/config/omp/negligible-mine.omp.json -o /home/node/.omp/config/negligible-mine.omp.json
RUN curl -fsSL https://claude.ai/install.sh | bash && echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/node/.zshrc
RUN curl -s https://ohmyposh.dev/install.sh | bash -s && echo 'eval "$(oh-my-posh init zsh --config /home/node/.omp/config/negligible-mine.omp.json)"' >> /home/node/.zshrc
RUN curl -fsSL https://gh.io/copilot-install | bash

RUN mkdir -p /home/node/.persist/.claude /home/node/.persist/.copilot \
  && touch /home/node/.persist/.claude.json /home/node/.persist/.zsh_history \
  && if [ -d /home/node/.claude ] && [ ! -L /home/node/.claude ]; then cp -a /home/node/.claude/. /home/node/.persist/.claude/ && rm -rf /home/node/.claude; fi \
  && if [ -d /home/node/.copilot ] && [ ! -L /home/node/.copilot ]; then cp -a /home/node/.copilot/. /home/node/.persist/.copilot/ && rm -rf /home/node/.copilot; fi \
  && if [ -f /home/node/.claude.json ] && [ ! -L /home/node/.claude.json ]; then cp /home/node/.claude.json /home/node/.persist/.claude.json && rm -f /home/node/.claude.json; fi \
  && if [ -f /home/node/.zsh_history ] && [ ! -L /home/node/.zsh_history ]; then cp /home/node/.zsh_history /home/node/.persist/.zsh_history && rm -f /home/node/.zsh_history; fi \
  && ln -sfn /home/node/.persist/.claude /home/node/.claude \
  && ln -sfn /home/node/.persist/.copilot /home/node/.copilot \
  && ln -sfn /home/node/.persist/.claude.json /home/node/.claude.json \
  && ln -sfn /home/node/.persist/.zsh_history /home/node/.zsh_history
