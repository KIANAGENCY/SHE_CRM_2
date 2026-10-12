import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files=[];
for(const directory of ['src','api','server','scripts']) {
  for(const name of await readdir(directory)) if(/\.(mjs|js)$/.test(name)) files.push(`${directory}/${name}`);
}
for(const file of files) {
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});
  if(result.status!==0) { console.error(result.stderr); process.exit(result.status||1); }
}
console.log(`Sintaxis correcta: ${files.length} archivos.`);
