const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.ts');
let content = fs.readFileSync(file, 'utf8');

const target = `app.post('/api/admin/retroalimentar-desde-publicada', async (req, res) => {
  try {`;

const replacement = `app.post('/api/admin/retroalimentar-desde-publicada', async (req, res) => {
  // GUARDA FÍSICA INQUEBRANTABLE: Nunca permitir escrituras hacia Test si estamos en Producción.
  // isPublishedEnv se resolvió estáticamente al arrancar el proceso de Node.js mediante variables de entorno (Cloud Run),
  // por lo que no es vulnerable a ataques de suplantación de cabeceras HTTP (Origin/Host).
  if (isPublishedEnv) {
    console.error("[SEGURIDAD] Intento bloqueado de retroalimentar base de datos estando en entorno de Producción.");
    return res.status(403).json({
      success: false,
      message: 'Operación prohibida: El servidor actual está ejecutándose en modo PRODUCCIÓN. No se puede sobrescribir con la base de datos de test.'
    });
  }

  try {`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(file, content);
  console.log("Patched retroalimentar guard");
} else {
  console.log("Could not find target in server.ts");
}
