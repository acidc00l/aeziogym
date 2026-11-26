#!/usr/bin/env node
// Cambia «openGym» por «AezioGym» en todo texto que ve el usuario, en todos los idiomas.
//
//   node scripts/aezio/rebrand-visible.mjs            # solo informa (no escribe nada)
//   node scripts/aezio/rebrand-visible.mjs --apply    # escribe los cambios
//   node scripts/aezio/rebrand-visible.mjs --list     # además lista cada cambio y cada exclusión
//
// Qué toca:
//   · frontend/src/locales/*.js: todas las cadenas (claves y valores; ahí solo hay texto visible).
//   · frontend/src y api (menos tests): cadenas, texto JSX y plantillas que el usuario lee, decididas
//     con el árbol del código (@babel/parser) y no con un buscar-y-reemplazar. Las claves de t() se
//     cambian igual que las de los idiomas, así que check-source-strings sigue en verde.
//   · frontend/index.html (errores de arranque).
// Qué NO toca (se cuenta y se explica en el informe):
//   1. Atribución legal: comentarios y cabeceras de copyright, LICENSE, NOTICE.md, Acerca de.
//      Los comentarios nunca se tocan; Acerca de se salva por la lista ATRIBUCION (frases).
//   2. Identificadores internos: claves de almacenamiento, nombres de caché y cookies, rutas de la
//      API, eventos, cabeceras, nombres de archivo y de variable, y cualquier cadena sin espacios en
//      posición de clave, comparación o argumento de una llamada de plataforma.
//   3. Direcciones y carpetas reales (opengym.ch, URLs, Documents/openGym) y el texto de otra app
//      (la pantalla de openNutrition donde se «vincula openGym»).
// Se puede ejecutar más de una vez: lo ya cambiado no vuelve a contar.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(ROOT, 'frontend/package.json'))
const { parse } = require('@babel/parser')

const APPLY = process.argv.includes('--apply')
const LIST = process.argv.includes('--list')
const BRAND = 'AezioGym'

// Trozos que se quedan como están, dentro de un texto que sí se cambia.
const PROTEGIDO = [
  /https?:\/\/\S+/g,                         // direcciones
  /\bopengym\.[a-z]{2,}\S*/gi,               // opengym.ch…
  /Documents\/openGym/g,                      // carpeta real de las copias en Android
  /Link openGym/g,                            // texto de la pantalla de openNutrition (otra app)
  /\/opengym[\w/.-]*/g,                       // rutas
]
// Frases de atribución legal que nunca se cambian (Acerca de, AGPL).
const ATRIBUCION = [/basad[ao]s? en openGym/i, /based on openGym/i, /openGym \(AGPL/i, /de openGym \(AGPL/i, /openGym project/i, /\bOpenGym\b.*AGPL/]
// Frases de Siri: tienen que coincidir letra por letra con las del código nativo de iOS
// (VoiceStrings, comprobado por voice-strings.test.js). AezioGym no tiene app nativa.
const SIRI = new Set(['“Start my workout in openGym”', '“Log my weight in openGym”', '“What’s my workout today in openGym”', '“How’s my streak in openGym”'])
const PALABRA = /(?<![\p{L}\p{N}_/.-])(openGym|OpenGym)/gu

/** El texto con la marca cambiada y cuántos cambios, respetando lo protegido. */
export function rebrand(text) {
  if (!/openGym|OpenGym/.test(text)) return { out: text, n: 0, kept: 0 }
  if (SIRI.has('“' + text.replace(/^[“"]|[”"]$/g, '') + '”')) return { out: text, n: 0, kept: 1 }
  if (ATRIBUCION.some(r => r.test(text))) return { out: text, n: 0, kept: (text.match(PALABRA) || []).length }
  const hold = []
  let s = text
  for (const re of PROTEGIDO) s = s.replace(re, m => { hold.push(m); return `\u0000${hold.length - 1}\u0000` })
  let n = 0
  s = s.replace(PALABRA, () => { n++; return BRAND })
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[+i])
  const kept = (text.match(/openGym|OpenGym/g) || []).length - n
  return { out: s, n, kept }
}

const stats = {}
const bump = (cat, key, k = 1) => { (stats[cat] ||= { cambiadas: 0, se_quedan: 0 })[key] += k }
const log = []

// ---------- idiomas ----------
const LIT = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g
function doLocale(file) {
  const src = fs.readFileSync(file, 'utf8')
  const out = src.split('\n').map(line => {
    if (/^\s*\/\//.test(line)) return line
    { const k = line.match(LIT)?.[0]; if (k && SIRI.has(k.slice(1, -1))) { bump('idiomas (locales/*.js)', 'se_quedan', 1); return line } }
    return line.replace(LIT, lit => {
      const { out: o, n, kept } = rebrand(lit)
      if (n) bump('idiomas (locales/*.js)', 'cambiadas', n)
      if (kept) { bump('idiomas (locales/*.js)', 'se_quedan', kept); if (LIST) log.push(`SE QUEDA ${path.basename(file)}: ${lit.slice(0, 140)}`) }
      return o
    })
  }).join('\n')
  if (APPLY && out !== src) fs.writeFileSync(file, out)
}

// ---------- código ----------
const PLATFORM_CALL = /(Storage|getItem|setItem|removeItem|\bopen|addEventListener|removeEventListener|dispatchEvent|Event|fetch|require|postMessage|\.has|\.get|\.set|\.delete|define|register|getAttribute|setAttribute|matches|querySelector|header|Header|cookie|Cookie|env|join|resolve|writeFile|readFile|existsSync|emit|on|once|log|warn|error|debug|ident|keyFor|channel|tag|prefix|withTag|sign|digest|createHash|createHmac|update|from|classList|includes|startsWith|endsWith|test|exec|match|replace|split)$/
const calleeName = c => !c ? '' : c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' ? (c.property.name || '') + '' : ''
const VISIBLE_FN = /^(t|tn|tnf|toast|alert|confirm|prompt|notify|showToast|setError|setMsg|setNote|setStatus|Error|aria|label|title)$/

function classify(node, parent, grand, key) {
  // devuelve 'visible' | 'interno' | 'dudoso'
  if (parent?.type === 'ImportDeclaration' || parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportAllDeclaration') return 'interno'
  if ((parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod') && key === 'key') return 'interno'
  if (parent?.type === 'BinaryExpression' || parent?.type === 'SwitchCase') return 'interno'
  const text = node.value
  if (typeof text !== 'string') return 'interno'
  if (parent?.type === 'CallExpression') {
    const name = calleeName(parent.callee)
    if (VISIBLE_FN.test(name)) return 'visible'
    if (PLATFORM_CALL.test(name) && !/\s/.test(text)) return 'interno'
  }
  if (parent?.type === 'JSXAttribute') {
    const a = parent.name.name
    return /^(aria-label|title|alt|placeholder|label|children|text|desc|hint|sub|message)$/.test(a) ? 'visible' : 'interno'
  }
  if (/^(https?:|\/|\.\/|mailto:)/.test(text.trim()) && !/\s/.test(text.trim())) return 'interno'
  if (/\s/.test(text) || /[^\x00-\x7f]/.test(text)) return 'visible'
  return 'dudoso'   // una sola palabra sin contexto claro: se lista y se decide a mano
}

function walk(node, visit, parent = null, key = null, grand = null) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parent, grand, key)
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach(c => walk(c, visit, node, k, parent))
    else if (v && typeof v.type === 'string') walk(v, visit, node, k, parent)
  }
}

function doCode(file, cat) {
  const src = fs.readFileSync(file, 'utf8')
  if (!/openGym|OpenGym/.test(src)) return
  let ast
  try { ast = parse(src, { sourceType: 'unambiguous', plugins: ['jsx'], errorRecovery: true, allowReturnOutsideFunction: true }) }
  catch (e) { console.error('No se pudo leer', file, e.message); return }
  const edits = []   // { start, end, text }
  const rel = path.relative(ROOT, file)
  const consider = (start, end, raw, kind, verdict) => {
    const { out, n, kept } = rebrand(raw)
    if (verdict === 'visible' && n) {
      edits.push({ start, end, text: out })
      bump(cat, 'cambiadas', n)
      if (LIST) log.push(`CAMBIA ${rel}:${src.slice(0, start).split('\n').length} ${raw.trim().slice(0, 150)}`)
    }
    if (kept || verdict !== 'visible') {
      const k = verdict === 'visible' ? kept : (raw.match(/openGym|OpenGym/g) || []).length
      if (k) { bump(cat, 'se_quedan', k); if (LIST) log.push(`SE QUEDA (${verdict === 'visible' ? 'atribución/protegido' : verdict}) ${rel}:${src.slice(0, start).split('\n').length} ${raw.trim().slice(0, 150)}`) }
    }
  }
  walk(ast.program, (node, parent, grand, key) => {
    if (node.type === 'StringLiteral' && /openGym|OpenGym/.test(node.value)) {
      const raw = src.slice(node.start + 1, node.end - 1)
      consider(node.start + 1, node.end - 1, raw, 'cadena', classify(node, parent, grand, key))
    } else if (node.type === 'TemplateElement' && /openGym|OpenGym/.test(node.value.raw)) {
      const raw = src.slice(node.start, node.end)
      consider(node.start, node.end, raw, 'plantilla', /\s/.test(raw) ? 'visible' : 'dudoso')
    } else if (node.type === 'JSXText' && /openGym|OpenGym/.test(node.value)) {
      consider(node.start, node.end, src.slice(node.start, node.end), 'jsx', 'visible')
    }
  })
  // los comentarios nunca se tocan; lo que quede en el archivo fuera de nodos se cuenta como «se queda»
  const inNodes = edits.length
  if (APPLY && inNodes) {
    let out = src
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
    fs.writeFileSync(file, out)
  }
}

const files = (dir, re, skip = /node_modules|\.test\.|\/test\/|dist/) => {
  const out = []
  const rec = d => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (skip.test(p)) continue; fs.statSync(p).isDirectory() ? rec(p) : re.test(n) && out.push(p) } }
  rec(dir); return out
}

for (const f of files(path.join(ROOT, 'frontend/src/locales'), /\.js$/)) doLocale(f)
for (const f of files(path.join(ROOT, 'frontend/src'), /\.(js|jsx)$/, /node_modules|\.test\.|locales|\/aezio\//)) doCode(f, 'código de la web (frontend/src)')
// api/coach (prompts del Coach de IA, apagado en AezioGym) y wrapped-copy.js (generado) se dejan.
for (const f of files(path.join(ROOT, 'api'), /\.(js|mjs)$/, /node_modules|\.test\.|\/test\/|\/scripts\/|\/coach\/|wrapped-copy\.js/)) doCode(f, 'servidor (api: push, errores, correos)')

// Cambios exactos que el recorrido del código no puede decidir (una palabra suelta, CSS, logotipo).
const EXACTOS = [
  ['frontend/src/views/Settings.jsx', "{ value: 'opengym', label: 'openGym' }", "{ value: 'opengym', label: 'AezioGym' }"],
  ['frontend/src/components/ShareWorkout.jsx', "w.name || 'openGym'", "w.name || 'AezioGym'"],
  ['frontend/src/lib/print-doc.js', '<span>open<span class="g">Gym</span></span>', '<span>Aezio<span class="g">Gym</span></span>'],
  ['frontend/src/lib/print-doc.js', 'content: "opengym.ch"', 'content: "aezio.website"'],
  ['frontend/src/lib/print-doc.js', "· opengym.ch${credit", "· aezio.website${credit"],
  ['frontend/src/lib/print-doc.js', "footer: { left: 'opengym.ch'", "footer: { left: 'aezio.website'"],
  ['frontend/src/lib/print-doc.js', "name || 'openGym', printOptions()", "name || 'AezioGym', printOptions()"],
  ['api/server.js', "process.env.RP_NAME || 'openGym'", "process.env.RP_NAME || 'AezioGym'"],
]
for (const [rel, from, to] of EXACTOS) {
  const f = path.join(ROOT, rel)
  const src = fs.readFileSync(f, 'utf8')
  if (!src.includes(from)) continue
  bump('cambios exactos (selector de iconos, PDF, nombre de passkeys)', 'cambiadas', 1)
  if (APPLY) fs.writeFileSync(f, src.replace(from, to))
}
// Tests: solo se ajusta el texto que comprueba un mensaje que ya se cambió arriba (cadena o expresión
// regular que, con AezioGym, cabe en alguna cadena visible de la web o de los idiomas). Los nombres de
// prueba, los datos de ejemplo (Apple Health, carpetas, cabeceras) y lo demás se quedan como están.
{
  const nuevas = new Set()
  const grab = f => { for (const m of fs.readFileSync(f, 'utf8').matchAll(LIT)) { const v = m[0].slice(1, -1); if (v.includes(BRAND)) nuevas.add(v.replace(/\\(.)/g, '$1')) } }
  for (const f of files(path.join(ROOT, 'frontend/src'), /\.(js|jsx)$/, /node_modules|\.test\.|\/aezio\//)) grab(f)
  for (const f of files(path.join(ROOT, 'api'), /\.(js|mjs)$/, /node_modules|\.test\.|\/test\/|\/scripts\//)) grab(f)
  const patrones = [...nuevas].map(n => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\d+\\\}/g, '.*'), 's'))
  const cabe = txt => [...nuevas].some(n => n.includes(txt)) || patrones.some(r => r.test(txt))
  const dest = 'pruebas (texto que comprueban)'
  const tfiles = [...files(path.join(ROOT, 'frontend/src'), /\.test\.(js|jsx)$/, /node_modules/), ...files(path.join(ROOT, 'api/test'), /\.test\.js$/, /node_modules/)]
  // Pruebas de textos que se quedan: prompts del Coach de IA (apagado) y mensaje de api/coach/core.
  const DEJAR = /(jobs|e2e-apikey|routine-library)\.test\.js$/
  for (const f of tfiles) {
    if (DEJAR.test(f)) continue
    const src = fs.readFileSync(f, 'utf8')
    if (!/openGym|OpenGym/.test(src)) continue
    let ast; try { ast = parse(src, { sourceType: 'unambiguous', plugins: ['jsx'], errorRecovery: true }) } catch { continue }
    const edits = []
    walk(ast.program, node => {
      let start, end, raw
      if (node.type === 'StringLiteral') { start = node.start + 1; end = node.end - 1 }
      else if (node.type === 'TemplateElement') { start = node.start; end = node.end }
      else if (node.type === 'RegExpLiteral') { start = node.start + 1; end = node.start + 1 + node.pattern.length }
      else if (node.type === 'JSXText') { start = node.start; end = node.end }
      else return
      raw = src.slice(start, end)
      if (!/openGym|OpenGym/.test(raw)) return
      const { out, n } = rebrand(raw)
      const plain = out.replace(/\\(.)/g, '$1')
      if (n && /sourceName=/.test(raw)) bump(dest, 'se_quedan', n)
      else if (n && /[\s]/.test(plain) && cabe(plain)) { edits.push({ start, end, text: out }); bump(dest, 'cambiadas', n) }
      else if (n === 0 && !/Documents|DOCUMENTS/.test(raw)) bump(dest, 'se_quedan', (raw.match(/openGym|OpenGym/g) || []).length)
      else if (n) bump(dest, 'se_quedan', n)
    })
    if (APPLY && edits.length) { let o = src; for (const e of edits.sort((a, b) => b.start - a.start)) o = o.slice(0, e.start) + e.text + o.slice(e.end); fs.writeFileSync(f, o) }
  }
}
// index.html: errores de arranque
{
  const f = path.join(ROOT, 'frontend/index.html')
  const src = fs.readFileSync(f, 'utf8')
  let n = 0
  const out = src.replace(/'(openGym [^']*)'/g, (m, s) => { n++; return `'${rebrand(s).out}'` })
  if (n) bump('index.html (errores de arranque)', 'cambiadas', n)
  if (APPLY && out !== src) fs.writeFileSync(f, out)
}

if (LIST) console.log(log.join('\n'))
console.log(APPLY ? '\n== APLICADO ==' : '\n== SIMULACIÓN (no se ha escrito nada) ==')
for (const [cat, s] of Object.entries(stats)) console.log(`${cat}: ${s.cambiadas} apariciones cambiadas, ${s.se_quedan} se quedan`)
