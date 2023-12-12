FROM node:18-alpine

WORKDIR /app
COPY package.json .
RUN npm install
COPY . .

EXPOSE 3774

CMD ["node", "index.js"]