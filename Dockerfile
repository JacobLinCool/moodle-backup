FROM node:alpine as builder

RUN npm i -g pnpm
WORKDIR /app
COPY . .
RUN npm pkg delete scripts.prepare
RUN pnpm i && pnpm rebuild && pnpm -r build && rm -rf node_modules && pnpm i --prod

# chromium-light, playwright 1.41.1
FROM jacoblincool/playwright@sha256:d233e1525ae4de01638d660f162955bd02d7a7a1acf5b01d655fe3cd1b0084cc as server

COPY --from=builder /app /app
WORKDIR /app
ENTRYPOINT [ "node" ]
CMD [ "packages/server/dist/index.js" ]
