import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Reject JavaScript source files so future changes keep one TypeScript implementation.
const javascript: string[] = [];
let typescript = 0;
async function inspect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(file);
    else if (/\.(?:mjs|cjs|jsx|js)$/.test(entry.name)) javascript.push(file);
    else if (/\.tsx?$/.test(entry.name)) typescript++;
  }
}
for (const directory of ['src', 'api', 'server', 'scripts', 'tests', 'supabase']) {
  await inspect(directory);
}
for (const entry of await readdir('.')) {
  if (/\.(?:mjs|cjs|jsx|js)$/.test(entry)) javascript.push(entry);
}
if (javascript.length) {
  throw new Error(`El código fuente debe ser TypeScript. Convierte estos archivos:\n${javascript.join('\n')}`);
}
console.log(`Código fuente TypeScript: ${typescript} archivos. Sin fuentes JavaScript.`);
