FROM node:22-bookworm-slim
WORKDIR /app
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev
COPY backend/src ./src
COPY backend/db ./db
COPY frontend ../frontend
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
