FROM node:22-slim AS build

WORKDIR /app

# Abhängigkeiten zuerst (Layer-Caching)
COPY package*.json ./
RUN npm install --omit=dev

# ---- Runtime stage ----
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY . .

# Daten-Volume-Verzeichnis anlegen (Permissions zur Laufzeit via entrypoint)
RUN mkdir -p /data /app/modules

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "--import", "dotenv/config", "server/index.js"]
