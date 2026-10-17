FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3001
CMD ["npm", "start"]
