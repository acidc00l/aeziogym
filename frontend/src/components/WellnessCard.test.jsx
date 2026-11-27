// @vitest-environment happy-dom
// «¿Cómo estás hoy?» en Inicio (lib/wellness.js): cuándo sale, «Ahora no», línea de resultado y cuestionario.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ S: { routines: [{ id: 'aezio-3-lunes' }] } }))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector({ S: mocks.S }) : { S: mocks.S })
  useStore.getState = () => ({ S: mocks.S })
  return { useStore }
})
vi.mock('../lib/format.js', async orig => ({ ...(await orig()), todayISO: () => '2026-11-27' }))
const { default: WellnessCard, WellnessForm, resetWellnessCache } = await import('./WellnessCard.jsx')
const { useUI } = await import('../store/useUI.js')

const done = { answered: true, readiness_status: 'optimal', label: 'Óptimo', message: 'Entrena como tenías previsto.' }
const reply = (status, body) => vi.fn(async () => ({ ok: status < 300, status, json: async () => body }))
let host, root
beforeEach(() => {
  localStorage.clear(); resetWellnessCache(); useUI.setState({ sheets: [] })
  mocks.S = { routines: [{ id: 'aezio-3-lunes' }] }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
const mount = async f => { globalThis.fetch = f; await act(async () => { root.render(<WellnessCard />) }); await act(async () => { await Promise.resolve() }) }
const click = label => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label)).click())

describe('WellnessCard', () => {
  it('sin plan de Aezio no pregunta ni pinta nada', async () => {
    mocks.S = { routines: [{ id: 'push' }] }
    const f = reply(200, { answered: false })
    await mount(f)
    expect(host.innerHTML).toBe('')
    expect(f).not.toHaveBeenCalled()
  })
  it('sin responder: tarjeta con el texto y el botón; «Ahora no» la oculta y guarda hoy', async () => {
    await mount(reply(200, { answered: false }))
    expect(host.textContent).toContain('Four quick questions about sleep, stress, energy and soreness')
    click('Not now')
    expect(host.innerHTML).toBe('')
    expect(localStorage.getItem('aezio.wellness.snooze')).toBe('2026-11-27')
  })
  it('pospuesta hoy: no consulta a la web; pospuesta ayer: sí sale', async () => {
    localStorage.setItem('aezio.wellness.snooze', '2026-11-27')
    const f = reply(200, { answered: false })
    await mount(f)
    expect(host.innerHTML).toBe('')
    expect(f).not.toHaveBeenCalled()
    act(() => root.unmount()); root = createRoot(host)
    localStorage.setItem('aezio.wellness.snooze', '2026-11-26')
    await mount(f)
    expect(host.textContent).toContain('Before training')
  })
  it('respondida: una línea con la etiqueta y el mensaje del servidor, con el color del estado', async () => {
    await mount(reply(200, done))
    expect(host.textContent).toContain('Today: Óptimo')
    expect(host.textContent).toContain('Entrena como tenías previsto.')
    expect(host.querySelector('.wl-line-t').style.color).toBe('var(--green-ink)')
    expect(host.querySelector('button')).toBeNull()
  })
  it('401, 5xx, sin red o sin conexión: nada', async () => {
    await mount(reply(401, { error: 'no_session' })); expect(host.innerHTML).toBe('')
    resetWellnessCache(); await mount(reply(503, {})); expect(host.innerHTML).toBe('')
    resetWellnessCache(); await mount(vi.fn(async () => { throw new TypeError('offline') })); expect(host.innerHTML).toBe('')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    resetWellnessCache()
    const f = reply(200, { answered: false })
    await mount(f)
    expect(host.innerHTML).toBe(''); expect(f).not.toHaveBeenCalled()
  })
  it('si hoy ya se supo el estado, la tarjeta sale en el primer pintado, sin esperar a la web', async () => {
    localStorage.setItem('aezio.wellness.last', JSON.stringify({ day: '2026-11-27', state: { kind: 'ask' } }))
    await mount(vi.fn(() => new Promise(() => {})))
    expect(host.textContent).toContain('Before training')
  })
  it('lo guardado de otro día no se pinta', async () => {
    localStorage.setItem('aezio.wellness.last', JSON.stringify({ day: '2026-11-26', state: { kind: 'ask' } }))
    await mount(vi.fn(() => new Promise(() => {})))
    expect(host.innerHTML).toBe('')
  })
  it('«Responder» abre el cuestionario en una hoja', async () => {
    await mount(reply(200, { answered: false }))
    click('Answer')
    expect(useUI.getState().sheets).toHaveLength(1)
  })
})

describe('WellnessForm', () => {
  const mountForm = (send, onSaved = vi.fn()) => { act(() => root.render(<WellnessForm onSaved={onSaved} onCancel={() => {}} send={send} />)); return onSaved }
  const submit = () => host.querySelector('button[type="submit"]')
  const pick = (q, n) => act(() => host.querySelector(`input[name="wl-${q}"][value="${n}"]`).click())
  const fillAll = () => { pick('sleep', 7); pick('stress', 1); pick('fatigue', 4); pick('soreness', 6) }

  it('28 radios reales con nombre, y enviar deshabilitado hasta responder las cuatro', () => {
    mountForm(vi.fn())
    const radios = host.querySelectorAll('input[type="radio"]')
    expect(radios).toHaveLength(28)
    expect(radios[0].getAttribute('aria-label')).toBe('1/7 - Terrible (insomnia)')
    expect(host.querySelectorAll('fieldset legend')).toHaveLength(4)
    expect(submit().disabled).toBe(true)
    pick('sleep', 7); pick('stress', 1); pick('fatigue', 4)
    expect(submit().disabled).toBe(true)
    pick('soreness', 6)
    expect(submit().disabled).toBe(false)
  })
  it('al guardar entrega el resultado', async () => {
    const result = { status: 'optimal', label: 'Óptimo', message: 'ok' }
    const send = vi.fn(async () => ({ kind: 'ok', result }))
    const onSaved = mountForm(send); fillAll()
    await act(async () => { submit().click() })
    expect(send).toHaveBeenCalledWith({ sleep: 7, stress: 1, fatigue: 4, soreness: 6 })
    expect(onSaved).toHaveBeenCalledWith(result)
  })
  it('con 429 avisa y no pierde lo marcado; con otro error, también', async () => {
    const toast = vi.fn(); useUI.setState({ toast })
    const onSaved = mountForm(vi.fn(async () => ({ kind: 'limit' }))); fillAll()
    await act(async () => { submit().click() })
    expect(toast).toHaveBeenLastCalledWith('You have already answered several times today.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(host.querySelector('input[name="wl-sleep"][value="7"]').checked).toBe(true)
    expect(submit().disabled).toBe(false)
    mountForm(vi.fn(async () => ({ kind: 'error' })))
    await act(async () => { submit().click() })
    expect(toast).toHaveBeenLastCalledWith('Could not save. Your answers are still here.')
  })
})
