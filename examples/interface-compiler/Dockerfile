FROM node:24-bookworm

ARG WORTH_COMMIT=a09f241c615cc41c541ba91968efdecb1ad78e61

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      libssl-dev \
      pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN curl --fail --silent --show-error --location https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain 1.94.0

ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace

RUN git init --initial-branch=pinned-source .local/worth \
    && git -C .local/worth remote add origin https://github.com/recnepspencer/worth.git \
    && git -C .local/worth fetch --depth 1 origin "$WORTH_COMMIT" \
    && git -C .local/worth checkout --detach FETCH_HEAD \
    && test "$(git -C .local/worth rev-parse HEAD)" = "$WORTH_COMMIT" \
    && test -f .local/worth/workspaces/worth-query/crates/worth-query-host/Cargo.toml

COPY . .
RUN npm install \
    && npm install --prefix apps/dashboard

CMD ["npm", "test"]
