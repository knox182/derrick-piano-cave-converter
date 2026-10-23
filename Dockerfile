FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs /app/server.mjs
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8080 CONVERSION_DATA_DIR=/data
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
