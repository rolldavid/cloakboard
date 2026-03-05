FROM node:22-bookworm

# bb.js native module requires GLIBCXX_3.4.32 (GCC 13+), bookworm only has GCC 12
RUN echo "deb http://deb.debian.org/debian trixie main" > /etc/apt/sources.list.d/trixie.list && \
    apt-get update && \
    apt-get install -y -t trixie libstdc++6 && \
    rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/trixie.list

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

COPY . .

EXPOSE 8080
CMD ["yarn", "start"]
