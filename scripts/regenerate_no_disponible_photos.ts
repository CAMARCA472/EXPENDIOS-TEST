import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { generateNoDisponibleSvg } from '../src/lib/noDisponibleSvg.ts';
import { processAndSavePhotoHybrid } from '../src/lib/hybridPhotoStorage.ts';
import { db } from '../src/db/index.ts';

interface TargetItem {
  cedula: string;
  slotKey: string;
  itemLabel: string;
  defaultMotivo: string;
}

const targets: TargetItem[] = [
  {
    cedula: '1052571411',
    slotKey: 'fotoBasculaUrl',
    itemLabel: 'BÁSCULA DIGITAL / PESO',
    defaultMotivo: 'Equipo no disponible en el punto de atención',
  },
  {
    cedula: '1094368076',
    slotKey: 'fotoMataselloUrl',
    itemLabel: 'MATASELLO FECHADOR',
    defaultMotivo: 'Dañado / Averiado',
  },
  {
    cedula: '1095910336',
    slotKey: 'fotoMataselloUrl',
    itemLabel: 'MATASELLO FECHADOR',
    defaultMotivo: 'Nunca entregado al punto',
  },
  {
    cedula: '26795233',
    slotKey: 'fotoAvisoUrl',
    itemLabel: 'LETRERO / AVISO EXTERIOR',
    defaultMotivo: 'Pendiente instalación de fachada comercial',
  },
  {
    cedula: '26795233',
    slotKey: 'fotoBasculaUrl',
    itemLabel: 'BÁSCULA DIGITAL / PESO',
    defaultMotivo: 'Equipo no disponible en el punto',
  },
  {
    cedula: '63349720',
    slotKey: 'fotoMataselloUrl',
    itemLabel: 'MATASELLO FECHADOR',
    defaultMotivo: 'Matasello no disponible / pendiente asignación',
  },
];

async function main() {
  console.log('--- REGENERANDO IMÁGENES NO DISPONIBLE (B&N SIN COBERTURA) ---');

  const dbJsonPath = path.join(process.cwd(), 'data', 'database.json');
  const pubJsonPath = path.join(process.cwd(), 'data', 'database.published.json');

  const dbData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
  const pubData = JSON.parse(fs.readFileSync(pubJsonPath, 'utf8'));

  for (const t of targets) {
    const expDb = dbData.expendios.find((e: any) => String(e.cedula).trim() === t.cedula);
    const expPub = pubData.expendios.find((e: any) => String(e.cedula).trim() === t.cedula);

    const municipio = expDb?.municipio || expPub?.municipio || expDb?.localidad || expPub?.localidad || 'EXPENDIO';
    const expendioId = expDb?.id || expPub?.id || `exp-${t.cedula}`;

    let motivo = t.defaultMotivo;
    if (t.slotKey === 'fotoMataselloUrl' && expDb?.motivoFaltaMatasello) {
      motivo = expDb.motivoFaltaMatasello;
    } else if (t.slotKey === 'fotoBasculaUrl' && expDb?.motivoFaltaBascula) {
      motivo = expDb.motivoFaltaBascula;
    } else if (t.slotKey === 'fotoAvisoUrl' && expDb?.motivoFaltaAviso) {
      motivo = expDb.motivoFaltaAviso;
    }

    console.log(`\nProcesando: ${t.cedula} (${municipio}) - ${t.slotKey}...`);

    const svg = generateNoDisponibleSvg({
      itemSlot: t.slotKey,
      itemLabel: t.itemLabel,
      municipio,
      cedula: t.cedula,
      motivo,
      fecha: '28/10/2026',
    });

    const jpgBuffer = await sharp(Buffer.from(svg))
      .jpeg({ quality: 92 })
      .toBuffer();

    // 1. Guardar con processAndSavePhotoHybrid (disco permanente + DB PostgreSQL)
    const hybridRes = await processAndSavePhotoHybrid({
      expendioId,
      cedula: t.cedula,
      slotKey: t.slotKey,
      inputBuffer: jpgBuffer,
      mimeType: 'image/jpeg',
      dbClient: db,
    });

    console.log(`  -> Guardado híbrido: local=${(hybridRes as any).savedLocally ?? true}, db=${(hybridRes as any).savedToDb ?? false}, bytes=${jpgBuffer.length}`);

    const photoUrl = `/api/photos/${encodeURIComponent(t.cedula)}/${t.slotKey}`;

    // 2. Actualizar database.json
    if (expDb) {
      if (t.slotKey === 'fotoAvisoUrl') {
        expDb.tieneAviso = 'NO';
        expDb.motivoFaltaAviso = motivo;
        expDb.fotoAvisoUrl = photoUrl;
        expDb.letreroUrl = photoUrl;
      } else if (t.slotKey === 'fotoBasculaUrl') {
        expDb.tieneBascula = 'NO';
        expDb.motivoFaltaBascula = motivo;
        expDb.fotoBasculaUrl = photoUrl;
        expDb.basculaUrl = photoUrl;
      } else if (t.slotKey === 'fotoMataselloUrl') {
        expDb.tieneMatasello = 'NO';
        expDb.motivoFaltaMatasello = motivo;
        expDb.fotoMataselloUrl = photoUrl;
        expDb.mataselloUrl = photoUrl;
      }
    }

    // 3. Actualizar database.published.json
    if (expPub) {
      if (t.slotKey === 'fotoAvisoUrl') {
        expPub.tieneAviso = 'NO';
        expPub.motivoFaltaAviso = motivo;
        expPub.fotoAvisoUrl = photoUrl;
        expPub.letreroUrl = photoUrl;
      } else if (t.slotKey === 'fotoBasculaUrl') {
        expPub.tieneBascula = 'NO';
        expPub.motivoFaltaBascula = motivo;
        expPub.fotoBasculaUrl = photoUrl;
        expPub.basculaUrl = photoUrl;
      } else if (t.slotKey === 'fotoMataselloUrl') {
        expPub.tieneMatasello = 'NO';
        expPub.motivoFaltaMatasello = motivo;
        expPub.fotoMataselloUrl = photoUrl;
        expPub.mataselloUrl = photoUrl;
      }
    }
  }

  // Guardar ambos archivos JSON
  fs.writeFileSync(dbJsonPath, JSON.stringify(dbData, null, 2), 'utf8');
  fs.writeFileSync(pubJsonPath, JSON.stringify(pubData, null, 2), 'utf8');
  console.log('\n[ÉXITO] Actualizados database.json y database.published.json.');

  process.exit(0);
}

main().catch((err) => {
  console.error('Error al migrar fotos:', err);
  process.exit(1);
});
