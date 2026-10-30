FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv && python3 -m venv /opt/ytdlp && /opt/ytdlp/bin/pip install --no-cache-dir "yt-dlp[default]==2026.10.21" && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends curl tesseract-ocr-eng libgtk-3-0 fonts-dejavu-core libasound2 libbsd0 libmd0 libx11-6 libxau6 libxcb1 libxdmcp6 libxext6 libxi6 libxrender1 libxtst6 zlib1g libfontconfig1 libfreetype6 && curl -fsSL -o /tmp/audiveris.deb https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-ubuntu22.04-x86_64.deb && echo "ae714594f40e54b1a4951fc3f914f08ae38fe5d07b7f2283b1a904fdb6e0a318  /tmp/audiveris.deb" | sha256sum -c - && dpkg-deb --extract /tmp/audiveris.deb / && rm /tmp/audiveris.deb && rm -rf /var/lib/apt/lists/*
RUN sed -i 's/java-options=-Xms.*/java-options=-Xms32m/;s/java-options=-Xmx.*/java-options=-Xmx256m/' /opt/audiveris/lib/app/Audiveris.cfg
RUN ln -sf /usr/lib/x86_64-linux-gnu/libgtk-3.so.0 /usr/lib/x86_64-linux-gnu/libgtk-3.so && ln -sf /usr/lib/x86_64-linux-gnu/libgdk-3.so.0 /usr/lib/x86_64-linux-gnu/libgdk-3.so
WORKDIR /app
COPY server.mjs youtube.mjs diagnostics.mjs owner-session.mjs score-reader.mjs resource-gate.mjs /app/
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8080 CONVERSION_DATA_DIR=/data YTDLP_PATH=/opt/ytdlp/bin/yt-dlp YOUTUBE_DOWNLOAD_ENABLED=true YOUTUBE_OWNER_ONLY=true YOUTUBE_COOKIE_FILE=/etc/secrets/youtube-cookies.txt
ENV AUDIVERIS_PATH=/opt/audiveris/bin/Audiveris TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 JAVA_TOOL_OPTIONS="-Xms32m -Xmx256m -XX:+UseSerialGC -XX:MaxMetaspaceSize=128m -XX:ReservedCodeCacheSize=32m -XX:MaxDirectMemorySize=32m -Djava.awt.headless=true"
RUN /opt/audiveris/bin/Audiveris -batch -help > /tmp/reader-startup-check.log 2>&1 || (tail -40 /tmp/reader-startup-check.log && exit 1)
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
