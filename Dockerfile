FROM jacoblincool/playwright:chromium-light

COPY . .
RUN pnpm install
RUN pnpm -r build

CMD ["pnpm", "tsx", "packages/server/src/index.ts"]
