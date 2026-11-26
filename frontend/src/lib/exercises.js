import { EXDB } from './exercises-data.js'
import { t } from './i18n.js'

export { EXDB }
export const EXIDX = {}
// Búsqueda sin distinguir acentos ni mayúsculas: el PDF dice «FLEXIÓN» y el móvil escribe «flexion»
export const fold = s => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
EXDB.forEach(e => { EXIDX[e.id] = e })
export const BODYPARTS = [...new Set(EXDB.map(e => e.bp))].sort()

// Aezio: solo se enseñan los ejercicios de «Mis ejercicios» en aezio.website (las animaciones tienen
// licencia solo para esos). Los demás siguen en EXIDX, así que el historial y los planes antiguos se
// siguen viendo; solo desaparecen de la biblioteca y del selector. La lista se guarda en el
// dispositivo para funcionar sin conexión; sin lista todavía, se enseña el catálogo entero.
const VISIBLE_KEY = 'aezio_visible_ex'
let visible = null
const setVisible = ids => { visible = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null }
try { setVisible(JSON.parse(localStorage.getItem(VISIBLE_KEY) || 'null')) } catch (e) { /* sin almacenamiento */ }
export const visibleExercises = () => (visible ? EXDB.filter(e => visible.has(e.id)) : EXDB)
export const bodyParts = () => [...new Set(visibleExercises().map(e => e.bp))].sort()

export function loadVisibleExercises() {
  if (typeof window === 'undefined' || !/(^|\.)aezio\.website$/.test(location.hostname)) return Promise.resolve()
  return fetch('https://aezio.website/api/app/exercises', { credentials: 'omit' })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d || !Array.isArray(d.ids) || !d.ids.length) return
      setVisible(d.ids)
      try { localStorage.setItem(VISIBLE_KEY, JSON.stringify(d.ids)) } catch (e) { /* sin almacenamiento */ }
      window.dispatchEvent(new Event('aezio-exercises'))
    })
    .catch(() => { /* sin conexión: se queda la lista guardada */ })
}

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => delete EXIDX[id])
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}
// Full searchable catalogue — customs first so your own exercises are easy to find.
export const allExercises = st => [...(st.customEx || []), ...visibleExercises()]

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo build pulls them off a CDN instead of
// shipping ~140 MB of images into the deployment.
const IMG_BASE = import.meta.env.VITE_IMG_BASE || 'img/'
const GIF_BASE = import.meta.env.VITE_GIF_BASE || 'gif/'
const WEBP_BASE = import.meta.env.VITE_WEBP_BASE || 'webp/'
export const imgSrc = ex => IMG_BASE + ex.img
export const gifSrc = ex => GIF_BASE + ex.gif
// WebP animado de 360 px: mismo nombre base que el GIF. Solo existe para los ejercicios visibles;
// si falta, Media.jsx cae al GIF.
export const webpSrc = ex => WEBP_BASE + ex.gif.replace(/\.gif$/i, '') + '.webp'

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Exercises the dataset already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
export const isBodyweightEq = idOrEx =>
  (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq === 'body weight'

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }
