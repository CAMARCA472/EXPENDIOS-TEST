const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server', 'firestoreDatabase.ts');
let content = fs.readFileSync(file, 'utf8');

const newHeader = `
const appUrlEnv = process.env.APP_URL || '';
const isPublishedEnv = appUrlEnv.includes('ais-pre') || (process.env.NODE_ENV === 'production' && !appUrlEnv.includes('ais-dev'));
export const FIRESTORE_COLLECTION = isPublishedEnv ? 'camarca_system' : 'camarca_system_test';
`;

content = content.replace("export interface CloudSyncStatus {", newHeader + "\nexport interface CloudSyncStatus {");
content = content.replace(/'camarca_system'/g, "FIRESTORE_COLLECTION");

fs.writeFileSync(file, content);
console.log('Patched firestore collection');
