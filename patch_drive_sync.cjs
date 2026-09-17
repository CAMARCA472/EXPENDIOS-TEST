const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'lib', 'driveSync.ts');
let content = fs.readFileSync(file, 'utf8');

const target = `                    // Optimistic update of local UI state
                    if (onProgress) {
                        const expendioIdMatch = localFilename.match(/^([A-Za-z0-9_-]+)_/);
                        if (expendioIdMatch) {
                            const foundExpendio = currentData.expendios.find(e => String(e.id) === expendioIdMatch[1]);
                            if (foundExpendio) {
                                foundExpendio[slotKeyUrl as keyof typeof targetExpendio] = apiData.url;
                            }
                        }
                    }`;

const replace = `                    // Optimistic update of local UI state
                    if (onProgress) {
                        const expendioIdMatch = localFilename.match(/^([A-Za-z0-9_-]+)_/);
                        if (expendioIdMatch) {
                            const foundExpendio = currentData.expendios.find((e: any) => String(e.id) === expendioIdMatch[1]);
                            if (foundExpendio) {
                                foundExpendio[slotKey] = apiData.url;
                            }
                        }
                    }`;

if(content.includes(target)) {
    content = content.replace(target, replace);
} else {
    // Try another target without types
    content = content.replace("foundExpendio[slotKeyUrl as keyof typeof targetExpendio]", "foundExpendio[slotKey]");
}
fs.writeFileSync(file, content);
console.log('Successfully patched driveSync.ts');
