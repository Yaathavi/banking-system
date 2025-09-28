FROM node:22-alpine
# → Use an official Node.js image (version 22) on Alpine Linux (small footprint)

WORKDIR /app
# → Set working directory in container to /app

COPY package*.json ./
# → Copy package.json and package-lock.json into container first

RUN npm install --production
# → Install only production dependencies (exclude devDependencies)

COPY . .
# → Copy all your application code into the container

EXPOSE 3000
# → Expose port 3000 (your Express app listens here)

CMD ["node", "server.js"]
# → Command to run when container starts
