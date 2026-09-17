const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.ts');
let content = fs.readFileSync(file, 'utf8');

const target1 = "databaseName: 'camarca_system',";
const replacement1 = "databaseName: isPublishedEnv ? 'camarca_system' : 'camarca_system_test',";

content = content.replace(target1, replacement1);
fs.writeFileSync(file, content);
console.log('Patched server.ts collection reporting part 2');
