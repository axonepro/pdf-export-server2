FROM ubuntu:20.04

# Install node and necessary dependencies
RUN apt-get update \
    && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_16.x | bash - \
    && apt-get install -y nodejs

# Install GLIBC 2.29
RUN apt-get update \
    && apt-get install -y \
    libc6=2.29-0ubuntu2

# Install other dependencies
RUN apt-get update \
    && apt-get install -y wget gnupg ca-certificates \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf --no-install-recommends \
    gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 \
    libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 \
    libnss3 lsb-release xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/log \
    && mkdir /home/pptruser/cert \
    && mkdir /home/pptruser/src \
    && openssl rand -out /root/.rnd 1024 \
    && openssl genrsa -out /home/pptruser/cert/server.key 2048 \
    && openssl req -new -x509 -key /home/pptruser/cert/server.key -out /home/pptruser/cert/server.crt -days 3650 -subj /CN=localhost \
    && chown -R pptruser:pptruser /home/pptruser

# Copy application files
COPY --chown=pptruser:pptruser ["src/", "/home/pptruser/src/"]
COPY --chown=pptruser:pptruser ["app.config.js", "package.json", "/home/pptruser/"]

WORKDIR /home/pptruser

# Install npm dependencies
RUN npm install

# Expose ports
EXPOSE 8080 8081

# Set the user and start the application
USER pptruser
ENTRYPOINT ["node", "./src/server.js", "-H", "8081"]
CMD ["bash"]
