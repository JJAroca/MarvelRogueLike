# Imagen del servidor de Marvel RogueLike (sin dependencias npm: solo Node).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json ./
COPY server ./server
COPY client ./client
COPY public ./public
COPY data ./data
EXPOSE 8080
CMD ["node", "server/server.js"]
