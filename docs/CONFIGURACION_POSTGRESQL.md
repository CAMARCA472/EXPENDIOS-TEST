# Guía de Configuración y Conexión a Cloud SQL (PostgreSQL) — CAMARCA S.A.S.

Esta guía detalla los pasos para conectar y desplegar la aplicación con el servidor de base de datos **Cloud SQL (PostgreSQL 15 / 18)** como capa primaria autoritativa.

---

## 1. Variables de Entorno Requeridas

Copia el archivo `.env.example` a `.env` en la raíz de tu proyecto y define las siguientes variables:

```env
# URL de Conexión Primaria PostgreSQL (Drizzle ORM & pg.Pool)
DATABASE_URL="postgresql://app_user:tu_password_seguro@127.0.0.1:5432/camarca_postgres?sslmode=disable"

# O Parámetros Individuales:
SQL_HOST="127.0.0.1"
SQL_PORT="5432"
SQL_USER="app_user"
SQL_PASSWORD="tu_password_seguro"
SQL_DB_NAME="camarca_postgres"
SQL_SSL="false"

# Optimización del Pool de Conexiones
SQL_POOL_MAX="20"
SQL_IDLE_TIMEOUT_MS="30000"
SQL_CONN_TIMEOUT_MS="5000"
```

---

## 2. Métodos de Conexión según el Entorno

### A. Entorno Local o Desarrollo (Con Cloud SQL Auth Proxy)
Si tu instancia de PostgreSQL está en Google Cloud Platform (Cloud SQL):

1. **Descarga e inicia Cloud SQL Auth Proxy:**
   ```bash
   ./cloud-sql-proxy TU_PROYECTO:us-west1:ai-studio-5a851b13 --port 5432
   ```
2. **Configura tu archivo `.env`:**
   ```env
   DATABASE_URL="postgresql://app_user:tu_password@127.0.0.1:5432/camarca_postgres?sslmode=disable"
   ```

### B. Despliegue en Google Cloud Run (Producción)
En Google Cloud Run, la conexión se realiza de forma nativa mediante Unix Sockets:

1. Agrega la conexión de Cloud SQL en la configuración del servicio:
   * **Instancia Cloud SQL:** `TU_PROYECTO:us-west1:ai-studio-5a851b13`
2. Define la variable `DATABASE_URL`:
   ```env
   DATABASE_URL="postgresql://app_user:tu_password@/camarca_postgres?host=/cloudsql/TU_PROYECTO:us-west1:ai-studio-5a851b13"
   ```

---

## 3. Esquema y Tablas Relacionales Creadas

El ORM **Drizzle** gestiona automáticamente las 8 tablas estructuradas:

1. **`expendios`:** 177 puntos de venta, encargados, cédulas, datos bancarios (Nequi/Bancolombia) y estado.
2. **`historial_cuentas`:** 510 registros de cuentas de cobro generadas, montos, deducciones y consecutivos.
3. **`relacion_pagos`:** 510 relaciones de pago intermensuales y liquidaciones.
4. **`trazabilidad`:** Registro inmutable de auditoría de cambios de encargados y cuentas.
5. **`cuentas_cargadas`:** Archivos y planillas Excel procesadas.
6. **`google_drive_photos`:** Enlaces y metadatos de las fotos organizadas en Drive por municipio.
7. **`system_config`:** Configuración global del sistema.
8. **`registros_acceso`:** Auditoría de accesos y pruebas de benchmark transaccional.

---

## 4. Verificación de Conectividad y Diagnóstico

Puedes verificar la conexión en cualquier momento:
1. Desde la interfaz web: Dirígete al **Panel Administrador > Pestaña 10: Cloud SQL PostgreSQL** y pulsa **«⚡ Diagnóstico Completo»**.
2. Mediante la API:
   ```bash
   curl -X POST http://localhost:3000/api/admin/cloudsql/diagnostic-ping
   ```
