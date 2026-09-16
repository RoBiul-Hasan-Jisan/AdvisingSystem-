FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Firebase service account JSON is mounted at runtime, not baked into the
# image - see docker-compose.yml. Never bake real credentials into an image.
EXPOSE 5000
CMD ["node", "server.js"]
