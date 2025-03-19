FROM node:18-alpine

# Add metadata
LABEL maintainer="BrandPulse Team"
LABEL description="DataHandler service for BrandPulse - Processes Kafka messages and writes to InfluxDB"

# Set working directory
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .

# Set default environment variables
ENV NODE_ENV=production \
    HOST_NETWORK_MODE=false

# Run as non-root user for security
USER node

CMD ["node", "src/consumer.js"]