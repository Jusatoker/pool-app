FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p uploads/equipment uploads/jobs uploads/customers
EXPOSE 3002
CMD ["node", "server.js"]
