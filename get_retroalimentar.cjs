const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');
const startIndex = content.indexOf("app.post('/api/admin/retroalimentar-desde-publicada'");
if (startIndex !== -1) {
  const endIndex = content.indexOf("});", startIndex);
  console.log(content.substring(startIndex, endIndex + 3));
}
