// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import GateBanner, { GATE_URL } from './GateBanner.jsx'
import { api } from '../lib/api.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const answer = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('GateBanner', () => {
  it('avisa con un 401 aezio_gate, no cierra la sesión (sin status) y se quita con una respuesta buena', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<GateBanner />) })
    expect(host.querySelector('[role=alert]')).toBeNull()

    globalThis.fetch = answer(401, { error: 'aezio_gate' })
    let err
    await act(async () => { err = await api('/api/data').catch(e => e) })
    expect(err.gate).toBe(true)
    expect(err.status).toBeUndefined()
    const alert = host.querySelector('[role=alert]')
    expect(alert).not.toBeNull()
    expect(alert.querySelector('a').getAttribute('href')).toBe(GATE_URL)

    globalThis.fetch = answer(200, { ok: true })
    await act(async () => { await api('/api/health') })
    expect(host.querySelector('[role=alert]')).toBeNull()
    act(() => root.unmount())
  })

  it('un 401 normal de la app no activa el aviso', async () => {
    const seen = vi.fn()
    window.addEventListener('aezio-gate', seen)
    globalThis.fetch = answer(401, { error: 'Not signed in' })
    const err = await api('/api/data').catch(e => e)
    expect(err.status).toBe(401)
    expect(seen).not.toHaveBeenCalled()
    window.removeEventListener('aezio-gate', seen)
  })
})
