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
  fd-find \
  ripgrep \
  sudo \
  libsecret-1-0 libsecret-1-dev libsecret-common gnome-keyring gnome-keyring-pkcs11 seahorse \
  && apt-get clean && rm -rf /var/lib/apt/lists/* \
  && echo 'node ALL=(root) NOPASSWD:ALL' > /etc/sudoers.d/node \
  && chmod 0440 /etc/sudoers.d/node

# Enable Yarn via Corepack (ships with Node)
RUN corepack enable

# Chromium OS dependencies only; the binary is installed per-user in postCreateCommand.
RUN npm install -g playwright @playwright/cli@latest typescript-language-server typescript --no-fund --no-audit \
  && npx playwright install-deps chromium \
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
RUN curl -fsSL https://claude.ai/install.sh | bash \
  && echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/node/.zshrc \
  && cat >> /home/node/.zshrc << 'EOF'
claude-alt() {
(
while IFS='=' read -r key value; do
export "${key#CCALT_}=$value"
done < <(env | grep '^CCALT_')
claude "$@"
)
}
EOF
RUN curl -s https://ohmyposh.dev/install.sh | bash -s && echo 'eval "$(oh-my-posh init zsh --config /home/node/.omp/config/negligible-mine.omp.json)"' >> /home/node/.zshrc && \
  curl -fsSL https://opencode.ai/install | bash && \
  curl -fsSL https://herdr.dev/install.sh | sh && \
  curl -fsSL https://pi.dev/install.sh | sh

RUN mkdir -p /home/node/.persist/.claude /home/node/.persist/opencode-config /home/node/.persist/opencode-data /home/node/.persist/opencode-state /home/node/.persist/herdr /home/node/.config /home/node/.local/share /home/node/.local/state \
  && touch /home/node/.persist/.claude.json /home/node/.persist/.zsh_history \
  && if [ -d /home/node/.claude ] && [ ! -L /home/node/.claude ]; then cp -a /home/node/.claude/. /home/node/.persist/.claude/ && rm -rf /home/node/.claude; fi \
  && if [ -d /home/node/.config/opencode ] && [ ! -L /home/node/.config/opencode ]; then cp -a /home/node/.config/opencode/. /home/node/.persist/opencode-config/ && rm -rf /home/node/.config/opencode; fi \
  && if [ -d /home/node/.local/share/opencode ] && [ ! -L /home/node/.local/share/opencode ]; then cp -a /home/node/.local/share/opencode/. /home/node/.persist/opencode-data/ && rm -rf /home/node/.local/share/opencode; fi \
  && if [ -d /home/node/.local/state/opencode ] && [ ! -L /home/node/.local/state/opencode ]; then cp -a /home/node/.local/state/opencode/. /home/node/.persist/opencode-state/ && rm -rf /home/node/.local/state/opencode; fi \
  && if [ -d /home/node/.config/herdr ] && [ ! -L /home/node/.config/herdr ]; then cp -a /home/node/.config/herdr/. /home/node/.persist/herdr/ && rm -rf /home/node/.config/herdr; fi \
  && if [ -f /home/node/.claude.json ] && [ ! -L /home/node/.claude.json ]; then cp /home/node/.claude.json /home/node/.persist/.claude.json && rm -f /home/node/.claude.json; fi \
  && if [ -f /home/node/.zsh_history ] && [ ! -L /home/node/.zsh_history ]; then cp /home/node/.zsh_history /home/node/.persist/.zsh_history && rm -f /home/node/.zsh_history; fi \
  && ln -sfn /home/node/.persist/.claude /home/node/.claude \
  && ln -sfn /home/node/.persist/opencode-config /home/node/.config/opencode \
  && ln -sfn /home/node/.persist/opencode-data /home/node/.local/share/opencode \
  && ln -sfn /home/node/.persist/opencode-state /home/node/.local/state/opencode \
  && ln -sfn /home/node/.persist/herdr /home/node/.config/herdr \
  && ln -sfn /home/node/.persist/.claude.json /home/node/.claude.json \
  && ln -sfn /home/node/.persist/.zsh_history /home/node/.zsh_history
