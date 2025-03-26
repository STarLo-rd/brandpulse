FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Set default environment variables
ENV HOST_NETWORK_MODE=false
CMD ["node", "src/consumer.js"]