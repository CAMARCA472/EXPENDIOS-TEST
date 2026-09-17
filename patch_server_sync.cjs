const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.ts');
let content = fs.readFileSync(file, 'utf8');

const target = "collection: 'camarca_system',";
const replacement = "collection: isPublishedEnv ? 'camarca_system' : 'camarca_system_test',";

content = content.replace(target, replacement);
fs.writeFileSync(file, content);
console.log('Patched server.ts collection reporting');
