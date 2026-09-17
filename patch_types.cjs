const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'types.ts');
let content = fs.readFileSync(file, 'utf8');

const targetExpendio = `  tipoCuenta?: string;`;
const replaceExpendio = `  tipoCuenta?: string;
  tieneComputador?: "" | "SI" | "NO" | "N/A";
  motivoFaltaComputador?: string;`;

if (content.includes(targetExpendio)) {
    content = content.replace(targetExpendio, replaceExpendio);
} else {
    console.log("Could not patch ExpendioData");
}

const targetConfig = `export interface SystemConfig {`;
const replaceConfig = `export interface SystemConfig {
  isEphemeralSeed?: boolean;`;

if (content.includes(targetConfig)) {
    content = content.replace(targetConfig, replaceConfig);
} else {
    console.log("Could not patch SystemConfig");
}

fs.writeFileSync(file, content);
console.log('Successfully patched src/types.ts');
