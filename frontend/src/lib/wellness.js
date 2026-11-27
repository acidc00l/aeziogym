// «¿Cómo estás hoy?» antes de entrenar: el mismo cuestionario Hooper (4 preguntas, 1-7) que la web de Aezio.
// Aquí solo viven las decisiones y la red; la tarjeta y el cuestionario están en components/WellnessCard.jsx.
// Contrato con la web: GET /api/app/wellness/today y POST /api/app/wellness/log (cookie del pase, de .aezio.website).
import { t } from './i18n.js'

export const WELLNESS_WEB = 'https://aezio.website'
export const SNOOZE_KEY = 'aezio.wellness.snooze'
// Lo último que dijo la web hoy: al abrir la app la tarjeta sale ya en el primer pintado, sin empujar el resto de Inicio.
export const LAST_KEY = 'aezio.wellness.last'
const TIMEOUT_MS = 8000

// Solo con un plan de Aezio en la app: alguna rutina con id `aezio-…` (lib/coach-import.js).
export const hasAezioPlan = S => Array.isArray(S?.routines) && S.routines.some(r => typeof r?.id === 'string' && r.id.startsWith('aezio-'))

// «Ahora no» guarda la fecha local de hoy; mañana la tarjeta vuelve. Un storage roto cuenta como no pospuesta.
export function isSnoozed(storage, today) {
  try { return storage?.getItem(SNOOZE_KEY) === today } catch { return false }
}
export function snoozeToday(storage, today) {
  try { storage?.setItem(SNOOZE_KEY, today) } catch { /* sin almacenamiento: la tarjeta volverá al reabrir */ }
}

// El último estado conocido de HOY ({ kind: 'ask' } o { kind: 'done', result }), o null si es de otro día o no hay.
export function readLast(storage, today) {
  try {
    const v = JSON.parse(storage?.getItem(LAST_KEY))
    if (v?.day !== today) return null
    return v.state?.kind === 'ask' ? { kind: 'ask' } : v.state?.kind === 'done' && readResult({ ...v.state.result, answered: true }) ? v.state : null
  } catch { return null }
}
// Un estado oculto (fallo de red, sin sesión…) borra lo guardado: no se enseña lo que ya no es cierto.
export function saveLast(storage, today, state) {
  try {
    if (state?.kind === 'ask' || state?.kind === 'done') storage?.setItem(LAST_KEY, JSON.stringify({ day: today, state }))
    else storage?.removeItem(LAST_KEY)
  } catch { /* sin almacenamiento: solo se pierde el ahorro del salto */ }
}

// ¿Merece la pena preguntar a la web? Sin plan, pospuesta hoy o sin conexión, ni se intenta.
export const shouldAsk = ({ S, storage, today, online }) => hasAezioPlan(S) && !isSnoozed(storage, today) && online !== false

// Estados que devuelve el servidor y su color (variables de la app, con su tinta legible en tema claro).
export const STATUS_COLOR = {
  optimal: 'var(--green-ink)',
  moderate_fatigue: 'var(--orange-ink)',
  high_stress_deload: 'var(--red-ink)'
}

// Lo que se enseña de una respuesta: sin etiqueta o sin mensaje no hay línea que mostrar.
export function readResult(d) {
  if (!d || d.answered !== true || typeof d.label !== 'string' || !d.label.trim() || typeof d.message !== 'string') return null
  return { status: STATUS_COLOR[d.readiness_status] ? d.readiness_status : 'optimal', label: d.label, message: d.message }
}

async function call(path, init, fetchImpl) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null
  try { return await fetchImpl(WELLNESS_WEB + path, { credentials: 'include', ...init, signal: ctl?.signal }) } finally { clearTimeout(timer) }
}

/**
 * Estado de hoy: { kind: 'ask' } (sin responder), { kind: 'done', result } (respondido) o
 * { kind: 'hidden' } ante cualquier fallo (red, 401, 403, 5xx, respuesta rara): nunca se enseña un error.
 */
export async function loadToday(fetchImpl = globalThis.fetch) {
  try {
    const r = await call('/api/app/wellness/today', { method: 'GET' }, fetchImpl)
    if (!r.ok) return { kind: 'hidden' }
    const d = await r.json()
    if (d && d.answered === false) return { kind: 'ask' }
    const result = readResult(d)
    return result ? { kind: 'done', result } : { kind: 'hidden' }
  } catch { return { kind: 'hidden' } }
}

// En pantalla 1 = peor (rojo) y 7 = mejor (verde); el índice Hooper de la API va al revés (1 = mejor, 7 = peor).
export const toHooper = picks => ({
  sleep_quality: 8 - picks.sleep,
  stress_level: 8 - picks.stress,
  fatigue_level: 8 - picks.fatigue,
  muscle_soreness: 8 - picks.soreness
})
export const allAnswered = picks => ['sleep', 'stress', 'fatigue', 'soreness'].every(k => Number.isInteger(picks?.[k]) && picks[k] >= 1 && picks[k] <= 7)

/** Envía las respuestas: { kind: 'ok', result } | { kind: 'limit' } (429) | { kind: 'error' }. */
export async function sendLog(picks, fetchImpl = globalThis.fetch) {
  if (!allAnswered(picks)) return { kind: 'error' }
  try {
    const r = await call('/api/app/wellness/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toHooper(picks))
    }, fetchImpl)
    if (r.status === 429) return { kind: 'limit' }
    if (!r.ok) return { kind: 'error' }
    const d = await r.json()
    const result = d && d.success === true ? readResult(d) : null
    return result ? { kind: 'ok', result } : { kind: 'error' }
  } catch { return { kind: 'error' } }
}

// Las cuatro preguntas, copiadas de la web (views/components/wellness_checkin.php). `labels[n - 1]` es el
// texto de ayuda del valor n; 1 = muy mal y 7 = muy bien, igual que allí.
export const questions = () => [
  { key: 'sleep', icon: 'moon', title: t('Sleep quality'), labels: [
    t('Terrible (insomnia)'), t('Very broken'), t('Poor / little rest'), t('Fair'), t('Acceptable'), t('Good'), t('Restorative and deep')] },
  { key: 'stress', icon: 'cloud', title: t('Calm level / Anti-stress'), labels: [
    t('Extreme stress / overwhelmed'), t('Very stressed'), t('High stress'), t('Moderate'), t('Calm'), t('Relaxed'), t('Zero stress / focused')] },
  { key: 'fatigue', icon: 'bolt', title: t('Energy and vitality'), labels: [
    t('Total exhaustion'), t('Very tired'), t('Fatigued'), t('Neutral'), t('Active'), t('Energetic'), t('Maxed out / full energy')] },
  { key: 'soreness', icon: 'figureStrength', title: t('Muscle state (no soreness)'), labels: [
    t('Severe pain / borderline soreness'), t('Very strong soreness'), t('Noticeable discomfort'), t('Moderate load'), t('Slight sensations'), t('Good recovery'), t('Fresh muscles / no discomfort')] }
]
