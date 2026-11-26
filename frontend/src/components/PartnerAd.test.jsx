// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function mount(fetchImpl) {
  vi.resetModules()
  globalThis.fetch = fetchImpl
  const { default: PartnerAd } = await import('./PartnerAd.jsx')
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<PartnerAd />) })
  await act(async () => { await Promise.resolve() })
  return { host, root }
}

afterEach(() => { document.body.innerHTML = '' })

describe('PartnerAd', () => {
  it('muestra la marca del día con rel sponsored y sin enviar credenciales', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ partners: [{ slug: 'p', name: 'Marca', url: 'https://marca.example', image: 'https://aezio.website/x.png', isBanner: false }] }) }))
    const { host, root } = await mount(fetchImpl)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://aezio.website/api/partners/app')
    expect(fetchImpl.mock.calls[0][1]).toEqual({ credentials: 'omit' })
    const a = host.querySelector('a')
    expect(a.getAttribute('href')).toBe('https://marca.example')
    expect(a.getAttribute('rel')).toContain('sponsored')
    act(() => root.unmount())
  })

  it('sin marcas o sin conexión no muestra nada', async () => {
    const a = await mount(vi.fn(async () => ({ ok: true, json: async () => ({ partners: [] }) })))
    expect(a.host.innerHTML).toBe('')
    const b = await mount(vi.fn(async () => { throw new Error('offline') }))
    expect(b.host.innerHTML).toBe('')
  })
})
