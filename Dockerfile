# Imagen oficial de Node.js 22 (Debian slim: máxima compatibilidad con sharp, pdf-lib y tesseract.js)
FROM node:22-slim

# Crear usuario no-root (UID 1000 requerido por Hugging Face Spaces)
RUN useradd -m -u 1000 user

WORKDIR /app

# Copiar manifiestos e instalar dependencias
COPY --chown=user package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Copiar el código fuente (respetando .dockerignore: sin data/, database/ ni secretos)
COPY --chown=user . .

# Compilar frontend (Vite) y servidor backend (esbuild -> dist/server.cjs)
RUN npm run build

# Crear directorios escribibles para caché temporal, fotos y snapshots locales
RUN mkdir -p /app/data/backups \
    /app/data/temp_imports \
    /app/data/archivos_permanentes \
    /app/data/photos_permanent \
    /app/data/photos_municipios \
    /app/database \
    /app/uploads/photos \
    /app/uploads/contracts \
    /app/uploads/scanned_cuentas \
    /app/uploads/docs_expendios \
    && chown -R user:user /app

USER user

ENV NODE_ENV=production
ENV APP_ENV=production
ENV PORT=7860

EXPOSE 7860

CMD ["npm", "start"]
