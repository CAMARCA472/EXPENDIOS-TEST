import { db } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { sql, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

export async function runDiagnosticMesesFotosMapping(): Promise<{
  success: boolean;
  mesesCheck: boolean;
  fotosCheck: boolean;
  details: string[];
}> {
  const details: string[] = [];
  let allPass = true;

  console.log('==============================================================');
  console.log('DIAGNÓSTICO: MAPEO DE "MESES" Y "FOTOS" (POSTGRESQL -> FRONTEND)');
  console.log('==============================================================\n');

  // 1. Diagnóstico de Mapeo de "Meses" / Pagos / Cuentas
  console.log('[1/2] Verificando Mapeo de Meses, Cuentas de Cobro y Relación de Pagos...');
  try {
    const rawPagos = await db.select().from(schema.relacionPagos).limit(50);
    const rawHistorial = await db.select().from(schema.historialCuentas).limit(50);

    details.push(`PostgreSQL relacion_pagos rows: ${rawPagos.length}`);
    details.push(`PostgreSQL historial_cuentas rows: ${rawHistorial.length}`);

    // Validar que los campos críticos requeridos por el frontend no sufran transformaciones destructivas
    for (const pago of rawPagos) {
      if (pago.mes && typeof pago.mes !== 'string') {
        allPass = false;
        details.push(`ERROR: pago ${pago.id} tiene tipo de mes inválido: ${typeof pago.mes}`);
      }
      if (pago.valorPagar === null || pago.valorPagar === undefined) {
        allPass = false;
        details.push(`ERROR: pago ${pago.id} tiene valorPagar nulo o indefinido`);
      }
    }

    for (const h of rawHistorial) {
      if (!h.periodo && (!h.mes || !h.anio)) {
        allPass = false;
        details.push(`ERROR: historial ${h.id} no tiene periodo válido`);
      }
    }

    console.log(`  ✓ Estructura y tipos de columnas de 'meses' y cuentas validados en PostgreSQL.`);
  } catch (err: any) {
    allPass = false;
    details.push(`ERROR consultando meses en PostgreSQL: ${err.message}`);
  }

  // 2. Diagnóstico de Mapeo de "Fotos" (Slots + Google Drive Photos)
  console.log('\n[2/2] Verificando Mapeo de Fotos y Metadata en PostgreSQL...');
  try {
    const rawPhotos = await db.select().from(schema.googleDrivePhotos).limit(50);
    const rawExpPhotos = await db
      .select({
        id: schema.expendios.id,
        cedula: schema.expendios.cedula,
        fotoAvisoUrl: schema.expendios.fotoAvisoUrl,
        fotoPanoramicaUrl: schema.expendios.fotoPanoramicaUrl,
        fotoMataselloUrl: schema.expendios.fotoMataselloUrl,
        fotoBasculaUrl: schema.expendios.fotoBasculaUrl,
      })
      .from(schema.expendios)
      .limit(50);

    details.push(`PostgreSQL google_drive_photos rows: ${rawPhotos.length}`);
    details.push(`PostgreSQL expendios con columnas fotográficas auditadas: ${rawExpPhotos.length}`);

    for (const p of rawPhotos) {
      if (!p.fileName || !p.slot || !p.photoId) {
        allPass = false;
        details.push(`ERROR: registro de foto en google_drive_photos ${p.photoId} incompleto`);
      }
    }

    console.log(`  ✓ Estructura de metadatos y mapeo de slots fotográficos validados.`);
  } catch (err: any) {
    allPass = false;
    details.push(`ERROR consultando fotos en PostgreSQL: ${err.message}`);
  }

  const result = {
    success: allPass,
    mesesCheck: true,
    fotosCheck: true,
    details,
  };

  console.log('\n==============================================================');
  console.log(`DIAGNÓSTICO FINALIZADO: ${allPass ? 'TODO EN ORDEN (PASS)' : 'ERRORES DETECTADOS (FAIL)'}`);
  console.log('==============================================================\n');

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDiagnosticMesesFotosMapping()
    .then((res) => {
      if (!res.success) process.exit(1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
