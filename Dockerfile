FROM node:alpine as builder

RUN npm i -g pnpm
WORKDIR /app
COPY . .
RUN npm pkg delete scripts.prepare
RUN pnpm i && pnpm rebuild && pnpm -r build && rm -rf node_modules && pnpm i --prod

FROM jacoblincool/playwright:chromium-light as server

COPY --from=builder /app /app
WORKDIR /app
ENTRYPOINT [ "node" ]
CMD [ "packages/server/dist/index.js" ]
