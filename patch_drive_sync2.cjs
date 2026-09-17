const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'lib', 'driveSync.ts');
let content = fs.readFileSync(file, 'utf8');

const target = "mappedExpendio: targetExpendio ? targetExpendio.cedula : null, slotKey: slotKeyUrl";
const replace = "fileName: fileInfo.name";
content = content.replace(target, replace);
fs.writeFileSync(file, content);
console.log('patched');
