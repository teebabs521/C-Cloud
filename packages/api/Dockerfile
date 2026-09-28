FROM node:20-bookworm-slim

# The API drives migrations by shelling out to ssh/rsync/scp against the
# destination host, and to the AWS CLI equivalents via SDK (no CLI needed
# for that part) — but ssh/rsync/scp themselves must be present locally.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client rsync ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/migration-engine/package.json packages/migration-engine/package.json
COPY packages/api/package.json packages/api/package.json
RUN npm install --workspace packages/migration-engine --workspace packages/api

COPY packages/migration-engine packages/migration-engine
COPY packages/api packages/api

RUN npm run build --workspace packages/migration-engine \
  && npm run build --workspace packages/api

ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 4000

CMD ["node", "packages/api/dist/server.js"]
