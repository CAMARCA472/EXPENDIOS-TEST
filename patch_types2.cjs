const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'types.ts');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/tieneAviso\?: 'SI' \| 'NO' \| '';/g, "tieneAviso?: 'SI' | 'NO' | '' | 'N/A';");
content = content.replace(/tieneBascula\?: 'SI' \| 'NO' \| '';/g, "tieneBascula?: 'SI' | 'NO' | '' | 'N/A';");
content = content.replace(/tieneMatasello\?: 'SI' \| 'NO' \| '';/g, "tieneMatasello?: 'SI' | 'NO' | '' | 'N/A';");
content = content.replace(/tieneImpresora\?: 'SI' \| 'NO' \| '';/g, "tieneImpresora?: 'SI' | 'NO' | '' | 'N/A';");

fs.writeFileSync(file, content);
console.log('Successfully patched src/types.ts again');
