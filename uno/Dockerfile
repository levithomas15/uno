# Der Spielserver für Online-Partien.
#
#   docker build -t uno uno
#   docker run -p 8080:8080 uno
#
# Er liefert zugleich die Seite aus, dann läuft alles über eine Adresse.
FROM node:22-alpine

WORKDIR /app
COPY . .

ENV PORT=8080
EXPOSE 8080

# Keine Abhängigkeiten: der WebSocket steckt in server/websocket.js.
CMD ["node", "server/server.js"]
