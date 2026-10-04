FROM node:24-bookworm-slim
# The Node slim image includes a CA bundle. Pass it to Wrangler/Miniflare so
# local workerd can verify outbound HTTPS requests as well.
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["node", "scripts/start-container.mjs"]
