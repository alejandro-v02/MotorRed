# Servicio de Ventas y contabilidad (grupo Zaidy) de MotorRed.
# Build en dos etapas: la primera compila TypeScript, la segunda solo lleva lo necesario para correr.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# docs/ va en la imagen porque db/seed.js la lee para indexar el RAG (Actividad 4.4).
COPY docs ./docs
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
