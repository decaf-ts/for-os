ARG NODE_VERSION=24

FROM node:${NODE_VERSION:-24}-alpine as builder

RUN apk update && apk upgrade

ENV WORKDIR="for-os"

COPY ./src/ $WORKDIR/src/
COPY ./tests/ $WORKDIR/tests/
COPY ./native/ $WORKDIR/native/
COPY ./scripts/ $WORKDIR/scripts/
COPY ./workdocs/reports $WORKDIR/workdocs/reports
COPY ./package*.json $WORKDIR/
COPY ./tsconfig.json $WORKDIR/
COPY ./.npmrc $WORKDIR/

# Install the dependencies from package-lock.json
RUN --mount=type=secret,id=TOKEN TOKEN=$(cat /run/secrets/TOKEN) npm ci --include=dev --ignore-scripts && npm cache clean --force && chown -R node:node .

RUN npm run build:prod && chown -R node:node $WORKDIR/lib $WORKDIR/dist

FROM node:${NODE_VERSION:-24}-alpine AS production

RUN apk update && apk upgrade
RUN apk --no-cache add htop less grep && apk add --no-cache --upgrade bash # optional but useful

ENV WORKDIR="for-os"

ENV NODE_ENV="production"

COPY --from=builder --chown=node:node $WORKDIR/lib $WORKDIR/lib/
COPY --from=builder --chown=node:node $WORKDIR/native $WORKDIR/native/
COPY --from=builder --chown=node:node $WORKDIR/scripts $WORKDIR/scripts/
COPY --from=builder --chown=node:node $WORKDIR/package*.json $WORKDIR/

USER node

WORKDIR $WORKDIR

# Install the runtime dependencies. The native addon is built by postinstall
# when a Rust toolchain and the platform GUI libraries are available; without
# them the bridges report unavailable at runtime.
RUN --mount=type=secret,id=TOKEN TOKEN=$(cat /run/secrets/TOKEN) npm ci --omit=dev && npm cache clean --force && chown -R node:node .

ENTRYPOINT ["node", "-e", "console.log(\"@decaf-ts/for-os \" + require('./lib/cjs/index.cjs').VERSION)"]

LABEL name="for-os" description="Native operating-system bridges for Decaf.ts (system tray and desktop notifications)"
