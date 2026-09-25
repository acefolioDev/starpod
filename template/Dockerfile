FROM oven/bun:1.4.0

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY src ./src

EXPOSE 3000
USER bun
CMD ["bun", "run", "start"]
