FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv && python3 -m venv /opt/ytdlp && /opt/ytdlp/bin/pip install --no-cache-dir "yt-dlp[default]==2026.10.21" && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends curl tesseract-ocr-eng fonts-dejavu-core && curl -fsSL -o /tmp/audiveris.deb https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-ubuntu22.04-x86_64.deb && echo "ae714594f40e54b1a4951fc3f914f08ae38fe5d07b7f2283b1a904fdb6e0a318  /tmp/audiveris.deb" | sha256sum -c - && apt-get install -y --no-install-recommends /tmp/audiveris.deb && rm /tmp/audiveris.deb && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs youtube.mjs diagnostics.mjs owner-session.mjs score-reader.mjs resource-gate.mjs /app/
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8080 CONVERSION_DATA_DIR=/data YTDLP_PATH=/opt/ytdlp/bin/yt-dlp YOUTUBE_DOWNLOAD_ENABLED=true YOUTUBE_OWNER_ONLY=true YOUTUBE_COOKIE_FILE=/etc/secrets/youtube-cookies.txt
ENV AUDIVERIS_PATH=/opt/audiveris/bin/Audiveris TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 JAVA_TOOL_OPTIONS="-Xms32m -Xmx128m -XX:+UseSerialGC -XX:MaxMetaspaceSize=96m -XX:ReservedCodeCacheSize=32m -XX:MaxDirectMemorySize=32m -Djava.awt.headless=true"
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
