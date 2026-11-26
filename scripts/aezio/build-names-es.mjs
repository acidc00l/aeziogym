#!/usr/bin/env node
// Genera frontend/src/aezio/names-es.json: los nombres en castellano de Aezio (id → nombre).
//
//   node scripts/aezio/build-names-es.mjs /ruta/a/exercises-data.js
//
// El archivo de entrada es el exercises-data.js de AezioGym 1.2.4 (campo `n` en castellano,
// ids de 4 dígitos). Solo se guardan los ids que existen en el catálogo actual
// (frontend/src/lib/exercises-data.js); los demás se cuentan y se descartan. Los nombres se
// guardan tal cual, con su mayúscula inicial: la interfaz no les aplica el título en
// mayúsculas (lib/i18n-core.js, aezioNameFor). Es reproducible: ordena por id.
// Se genera una vez; Marc ajusta los nombres en la web, no aquí.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const from = process.argv[2]
if (!from) { console.error('Uso: node scripts/aezio/build-names-es.mjs /ruta/a/exercises-data.js'); process.exit(1) }

const { EXDB: old } = await import(pathToFileURL(path.resolve(from)))
const { EXDB: now } = await import(pathToFileURL(path.join(ROOT, 'frontend/src/lib/exercises-data.js')))
const have = new Set(now.map(e => e.id))

const out = {}
let skipped = 0
for (const e of [...old].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  const n = typeof e.n === 'string' ? e.n.trim() : ''
  if (!n || !have.has(e.id)) { skipped++; continue }
  out[e.id] = n
}
const file = path.join(ROOT, 'frontend/src/aezio/names-es.json')
fs.writeFileSync(file, JSON.stringify(out, null, 0) + '\n')
console.log(`${Object.keys(out).length} nombres escritos en ${path.relative(ROOT, file)}; ${skipped} descartados`)
