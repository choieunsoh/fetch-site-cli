# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#   Build stage
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FROM node:20-alpine AS builder

WORKDIR /app

COPY ["package.json", "yarn.lock", "./"]

RUN yarn install --frozen-lockfile

COPY . .

RUN yarn run build

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#   Run stage
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FROM node:20-alpine AS production

WORKDIR /app

COPY ["package.json", "yarn.lock", "./"]

RUN yarn install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist

CMD ["node", "./dist/fetch.js"]
