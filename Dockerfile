FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache git curl
COPY package*.json ./
RUN npm install --include=dev
COPY tsconfig.json .env.example ./
COPY src ./src
RUN npm run build
RUN mkdir -p /app/auth_info /app/data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
