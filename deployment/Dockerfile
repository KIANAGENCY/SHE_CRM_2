FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BACKEND=n8n
ENV VITE_BACKEND=$VITE_BACKEND
RUN npm test && npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 VITE_BACKEND=n8n
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/api ./api
RUN mkdir .local && chown node:node .local
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/tsx", "server/start.ts"]
