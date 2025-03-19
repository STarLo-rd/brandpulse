FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Set default environment variables
ENV NODE_ENV=production \
    HOST_NETWORK_MODE=false \
    PORT=3000
EXPOSE 3000
CMD ["npm", "start"]   