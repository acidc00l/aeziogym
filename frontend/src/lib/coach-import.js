// Plan de un coach enviado desde Aezio. Usa el formato de plan-share.js, pero con IDs fijos por día:
// volver a enviar el plan actualiza sus rutinas en vez de duplicarlas. Nunca toca entrenos ni otras rutinas.
import { parsePlan } from './plan-share.js'
import { isCardio } from './exercises.js'
import { DEFAULT_GLYPH } from './glyphs.js'
import { t } from './i18n.js'

const signature = ex => JSON.stringify(ex || [])

function toConfig(e) {
  const sets = Math.max(1, Math.min(20, Math.round(Number(e.sets)) || 3))
  if (isCardio(e.id)) return { id: e.id, sets, min: e.sec > 0 ? Math.max(1, Math.round(e.sec / 60)) : 20 }
  const weight = Number(e.weight) > 0 ? { weight: Number(e.weight) } : {}
  if (e.mode === 'time') return { id: e.id, sets, mode: 'time', sec: Math.max(1, Math.round(Number(e.sec)) || 45), ...weight }
  return { id: e.id, sets, reps: Math.max(1, Math.round(Number(e.reps)) || 10), ...weight }
}

/** Valida lo recibido de Aezio. Una rutina con un ID que no sea de ese plan no se acepta. */
export function parseCoachPlan(raw) {
  const planId = Number(raw && raw.plan_id)
  if (!Number.isInteger(planId) || planId < 1) throw new Error(t('this isn’t a plan file'))
  const bundle = parsePlan(raw)
  const routines = bundle.routines
    .filter(r => typeof r.id === 'string' && r.id.startsWith(`aezio-${planId}-`) && r.ex.length)
    .map(r => ({
      id: r.id,
      name: String(r.name || t('Routine')),
      ex: r.ex.map(toConfig),
      ranges: r.ex.map(e => String(e.plan || ''))
    }))
  return {
    planId,
    name: bundle.name,
    routines,
    skipped: (Array.isArray(raw.skipped) ? raw.skipped : []).map(String),
    dropped: bundle.dropped,
    exerciseCount: routines.reduce((n, r) => n + r.ex.length, 0)
  }
}

/** Qué pasará al confirmar. `changed`: la rutina ya no es la que se envió, y se sustituirá. */
export function coachPlanChanges(S, plan) {
  const mine = S.routines || []
  const incoming = new Set(plan.routines.map(r => r.id))
  const isChanged = r => !!r.src && r.src.sig !== signature(r.ex)
  return {
    routines: plan.routines.map(r => {
      const current = mine.find(x => x.id === r.id)
      return { id: r.id, isNew: !current, changed: !!current && isChanged(current) }
    }),
    removed: mine.filter(r => r.src && r.src.plan && !incoming.has(r.id)).map(r => r.name)
  }
}

/** Aplica el plan sobre el borrador `s` (dentro de store.update). */
export function applyCoachPlan(s, plan) {
  const incoming = new Set(plan.routines.map(r => r.id))
  // Un plan nuevo sustituye a los anteriores de Aezio: si se quedaran, el cliente vería los días repetidos.
  // Las rutinas propias (sin `src`) y los entrenos hechos no se tocan.
  const gone = s.routines.filter(r => r.src && r.src.plan && !incoming.has(r.id)).map(r => r.id)
  s.routines = s.routines.filter(r => !gone.includes(r.id))
  for (const slots of [s.week, s.dayPlan]) {
    Object.keys(slots || {}).forEach(k => { if (gone.includes(slots[k])) delete slots[k] })
  }
  plan.routines.forEach(r => {
    const ex = r.ex.map(e => ({ ...e }))
    const src = { plan: plan.planId, sig: signature(ex) }
    const current = s.routines.find(x => x.id === r.id)
    if (current) Object.assign(current, { name: r.name, ex, src })
    else s.routines.push({ id: r.id, name: r.name, emoji: DEFAULT_GLYPH, ex, src })
  })
}

/**
 * Tras terminar un entreno de un plan de Aezio: qué día toca ahora. Es el que lleva más tiempo
 * sin hacerse (los nunca hechos primero, en el orden del plan), igual que lo calcula la web.
 * Devuelve null si el entreno no era de un plan de Aezio.
 */
export function coachNextRoutine(S, workout) {
  const done = (S.routines || []).find(r => r.id === (workout && workout.routineId))
  if (!done || !done.src || !done.src.plan) return null
  const order = r => Number(String(r.id).split('-').pop()) || 0
  const days = S.routines.filter(r => r.src && r.src.plan === done.src.plan).sort((a, b) => order(a) - order(b))
  const last = {}
  for (const w of [...(S.workouts || []), workout]) {
    const at = w.end || w.start || 0
    if (w.routineId && at > (last[w.routineId] || 0)) last[w.routineId] = at
  }
  return days.reduce((best, r) => ((last[r.id] || 0) < (last[best.id] || 0) ? r : best), days[0])
}

/**
 * Ajuste de pautas enviado por el entrenador: cambia solo esos ejercicios en las rutinas del plan.
 * Lo que el cliente haya añadido o movido se queda como está. Devuelve cuántos ejercicios cambió.
 */
export function applyCoachPatch(s, patch) {
  let changed = 0
  for (const change of Array.isArray(patch && patch.changes) ? patch.changes : []) {
    const routine = (s.routines || []).find(r => r.id === change.routine && r.src)
    const ex = routine && routine.ex.find(e => e.id === change.id)
    if (!ex) continue
    const untouched = routine.src.sig === signature(routine.ex)
    const next = toConfig({ id: ex.id, sets: change.sets, reps: change.reps, sec: change.sec, mode: change.mode, weight: change.weight })
    for (const key of ['sets', 'reps', 'sec', 'min', 'mode', 'weight']) delete ex[key]
    Object.assign(ex, next)
    // Si la rutina seguía tal como la mandó el entrenador, sigue contando como «sin tocar por el cliente»
    if (untouched) routine.src.sig = signature(routine.ex)
    changed++
  }
  return changed
}

/**
 * El entrenador confirma (o rechaza) entrenos anotados después. Confirmado pasa al historial y cuenta
 * como cualquier otro (también el peso máximo de cada ejercicio); rechazado desaparece.
 */
export function applyCoachConfirm(s, item) {
  const out = { confirmed: 0, rejected: 0 }
  s.pendingWorkouts = Array.isArray(s.pendingWorkouts) ? s.pendingWorkouts : []
  for (const d of Array.isArray(item && item.decisions) ? item.decisions : []) {
    const i = s.pendingWorkouts.findIndex(w => w.id === d.id)
    if (i < 0) continue
    const [w] = s.pendingWorkouts.splice(i, 1)
    if (!d.ok) { out.rejected++; continue }
    delete w.pending
    w.confirmed = { by: String(item.coach || ''), at: Date.now() }
    for (const e of w.entries || []) {
      const mx = Math.max(0, ...e.sets.filter(x => x.done).map(x => x.w || 0), e.topW || 0)
      const cur = s.exWeights[e.id]
      if (mx > 0 && (!cur || mx > cur.w)) s.exWeights[e.id] = { w: mx, d: w.d }
    }
    if (!s.workouts.some(x => x.id === w.id)) s.workouts.push(w)
    s.workouts.sort((a, b) => a.start - b.start)
    out.confirmed++
  }
  return out
}

/**
 * Aplica lo que el entrenador dejó en espera (planes enteros o ajustes), en orden.
 * Devuelve qué se aplicó, para avisar al cliente con el mensaje que toca.
 */
export function applyCoachPending(s, items) {
  const result = { plans: 0, exercises: 0, confirmed: 0, rejected: 0 }
  for (const item of Array.isArray(items) ? items : []) {
    try {
      if (item.kind === 'plan') { applyCoachPlan(s, parseCoachPlan(item.bundle)); result.plans++ }
      else if (item.kind === 'patch') result.exercises += applyCoachPatch(s, item)
      else if (item.kind === 'confirm') { const c = applyCoachConfirm(s, item); result.confirmed += c.confirmed; result.rejected += c.rejected }
    } catch (e) { /* un envío ilegible no debe bloquear los demás */ }
  }
  return result
}
