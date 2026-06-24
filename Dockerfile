# ---- Build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
# npm ci refuses here: an optional, wasm32-only transitive dep
# (@unrs/resolver-binding-wasm32-wasi, pulled in by an ESLint resolver)
# references @emnapi/core/@emnapi/runtime that npm never fully resolved
# into the lockfile, since that wasm32 package is never actually
# installed on any platform this project runs on. npm install tolerates it.
RUN npm install
COPY . .
RUN npm run build

# ---- Production ----
# Copies the full node_modules from the build stage (including the prisma
# CLI, a devDependency) instead of reinstalling with --omit=dev. That trades
# a larger image for not having to fight postinstall (prisma generate)
# running against a pruned, devDependency-less node_modules - simplicity
# over image size, which is the right tradeoff for this project's scope.
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package*.json ./
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
