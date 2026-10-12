FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY playground ./playground
COPY docs/hero.png ./docs/hero.png
USER node
ENV PLAYGROUND_CONTAINER=1 PORT=4173
EXPOSE 4173
CMD ["node", "playground/server.cjs"]
