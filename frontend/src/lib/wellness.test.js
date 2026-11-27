import { describe, expect, it, vi } from 'vitest'
import { hasAezioPlan, isSnoozed, readLast, saveLast, LAST_KEY, snoozeToday, shouldAsk, loadToday, sendLog, toHooper, allAnswered, readResult, questions, SNOOZE_KEY } from './wellness.js'

const plan = { routines: [{ id: 'aezio-7-lunes' }] }
const memory = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v }, m } }
const reply = (status, body) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
const done = { answered: true, readiness_status: 'moderate_fatigue', label: 'Fatiga moderada', message: 'Baja un poco.', hooper_index: 14 }

describe('hasAezioPlan', () => {
  it('solo con alguna rutina cuyo id empieza por aezio-', () => {
    expect(hasAezioPlan(plan)).toBe(true)
    expect(hasAezioPlan({ routines: [{ id: 'push' }, { id: 'xaezio-1' }] })).toBe(false)
    expect(hasAezioPlan({ routines: [] })).toBe(false)
    expect(hasAezioPlan({})).toBe(false)
    expect(hasAezioPlan(null)).toBe(false)
  })
})

describe('«Ahora no»', () => {
  it('hoy pospuesta, mañana vuelve', () => {
    const st = memory()
    expect(isSnoozed(st, '2026-11-27')).toBe(false)
    snoozeToday(st, '2026-11-27')
    expect(st.m[SNOOZE_KEY]).toBe('2026-11-27')
    expect(isSnoozed(st, '2026-11-27')).toBe(true)
    expect(isSnoozed(st, '2026-11-28')).toBe(false)
  })
  it('un almacenamiento roto no rompe nada', () => {
    const bad = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }
    expect(isSnoozed(bad, 'd')).toBe(false)
    expect(() => snoozeToday(bad, 'd')).not.toThrow()
  })
})

describe('shouldAsk', () => {
  const base = { S: plan, storage: memory(), today: '2026-11-27', online: true }
  it('pregunta con plan, sin posponer y con conexión', () => expect(shouldAsk(base)).toBe(true))
  it('no con otro plan, sin conexión o pospuesta hoy', () => {
    expect(shouldAsk({ ...base, S: { routines: [{ id: 'a' }] } })).toBe(false)
    expect(shouldAsk({ ...base, online: false })).toBe(false)
    expect(shouldAsk({ ...base, storage: memory({ [SNOOZE_KEY]: '2026-11-27' }) })).toBe(false)
  })
  it('pospuesta ayer: vuelve a salir', () => expect(shouldAsk({ ...base, storage: memory({ [SNOOZE_KEY]: '2026-11-26' }) })).toBe(true))
})

describe('loadToday', () => {
  it('answered false: pregunta; pide con credenciales a la ruta de la web', async () => {
    const f = reply(200, { answered: false })
    expect(await loadToday(f)).toEqual({ kind: 'ask' })
    expect(f.mock.calls[0][0]).toBe('https://aezio.website/api/app/wellness/today')
    expect(f.mock.calls[0][1].credentials).toBe('include')
  })
  it('answered true: línea con etiqueta, mensaje y estado', async () => {
    expect(await loadToday(reply(200, done))).toEqual({ kind: 'done', result: { status: 'moderate_fatigue', label: 'Fatiga moderada', message: 'Baja un poco.' } })
  })
  it('401, 403, 5xx, red caída o cuerpo raro: nada', async () => {
    for (const s of [401, 403, 500, 503]) expect(await loadToday(reply(s, { error: 'x' }))).toEqual({ kind: 'hidden' })
    expect(await loadToday(vi.fn(async () => { throw new TypeError('offline') }))).toEqual({ kind: 'hidden' })
    expect(await loadToday(reply(200, { answered: true }))).toEqual({ kind: 'hidden' })
    expect(await loadToday(reply(200, null))).toEqual({ kind: 'hidden' })
  })
  it('un estado desconocido se lee como óptimo', () => expect(readResult({ ...done, readiness_status: 'raro' }).status).toBe('optimal'))
})

describe('envío', () => {
  const picks = { sleep: 7, stress: 1, fatigue: 4, soreness: 6 }
  it('la escala en pantalla (7 = mejor) se invierte al índice Hooper de la API (1 = mejor)', () => {
    expect(toHooper(picks)).toEqual({ sleep_quality: 1, stress_level: 7, fatigue_level: 4, muscle_soreness: 2 })
  })
  it('no envía hasta tener las cuatro', async () => {
    const f = reply(200, {})
    expect(allAnswered({ ...picks, soreness: null })).toBe(false)
    expect((await sendLog({ ...picks, soreness: null }, f)).kind).toBe('error')
    expect(f).not.toHaveBeenCalled()
  })
  it('200: POST JSON con credenciales y resultado', async () => {
    const f = reply(200, { success: true, ...done })
    const r = await sendLog(picks, f)
    expect(r).toEqual({ kind: 'ok', result: { status: 'moderate_fatigue', label: 'Fatiga moderada', message: 'Baja un poco.' } })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://aezio.website/api/app/wellness/log')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ sleep_quality: 1, stress_level: 7, fatigue_level: 4, muscle_soreness: 2 })
  })
  it('429 es límite; otros fallos, error', async () => {
    expect((await sendLog(picks, reply(429, {}))).kind).toBe('limit')
    expect((await sendLog(picks, reply(500, {}))).kind).toBe('error')
    expect((await sendLog(picks, reply(200, { success: false }))).kind).toBe('error')
    expect((await sendLog(picks, vi.fn(async () => { throw new Error('x') }))).kind).toBe('error')
  })
})

describe('preguntas', () => {
  it('son cuatro, con siete textos de ayuda cada una', () => {
    const qs = questions()
    expect(qs.map(q => q.key)).toEqual(['sleep', 'stress', 'fatigue', 'soreness'])
    for (const q of qs) expect(q.labels).toHaveLength(7)
  })
})

describe('último estado de hoy', () => {
  const state = { kind: 'done', result: { status: 'optimal', label: 'Óptimo', message: 'ok' } }
  it('se recupera el mismo día y no al siguiente', () => {
    const st = memory()
    saveLast(st, '2026-11-27', state)
    expect(readLast(st, '2026-11-27')).toEqual(state)
    expect(readLast(st, '2026-11-28')).toBeNull()
    saveLast(st, '2026-11-27', { kind: 'ask' })
    expect(readLast(st, '2026-11-27')).toEqual({ kind: 'ask' })
  })
  it('un estado oculto borra lo guardado; lo roto se ignora', () => {
    const st = { ...memory(), removeItem() { this.m[LAST_KEY] = null } }
    saveLast(st, '2026-11-27', { kind: 'ask' })
    saveLast(st, '2026-11-27', { kind: 'hidden' })
    expect(readLast(st, '2026-11-27')).toBeNull()
    expect(readLast(memory({ [LAST_KEY]: '{no es json' }), 'd')).toBeNull()
    expect(readLast(memory({ [LAST_KEY]: JSON.stringify({ day: 'd', state: { kind: 'done', result: {} } }) }), 'd')).toBeNull()
  })
})
