# Use an official Node.js runtime as a parent image
# Using a specific LTS version is a good practice (e.g., 20-alpine, 18-alpine)
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
# This step leverages Docker's layer caching. If these files don't change,
# Docker won't re-run npm install unless the files themselves change.
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Your app binds to port 8080, so expose it
EXPOSE 8080

# Define the command to run your app
CMD [ "npm", "start" ]