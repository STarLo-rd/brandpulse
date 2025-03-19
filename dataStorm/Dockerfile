FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Default to container networking mode (can be overridden at runtime)
ENV HOST_NETWORK_MODE=false

CMD ["node", "src/producer.js"]