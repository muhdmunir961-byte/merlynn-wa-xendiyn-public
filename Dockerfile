FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json .env.example ./
COPY src ./src
RUN npm run build
RUN mkdir -p /app/auth_info /app/data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
