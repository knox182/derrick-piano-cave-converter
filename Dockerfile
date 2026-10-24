FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv && python3 -m venv /opt/ytdlp && /opt/ytdlp/bin/pip install --no-cache-dir "yt-dlp[default]==2026.10.21" && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs youtube.mjs diagnostics.mjs owner-session.mjs /app/
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8080 CONVERSION_DATA_DIR=/data YTDLP_PATH=/opt/ytdlp/bin/yt-dlp YOUTUBE_DOWNLOAD_ENABLED=true YOUTUBE_OWNER_ONLY=true YOUTUBE_COOKIE_FILE=/etc/secrets/youtube-cookies.txt
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
