import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'

// Publicidad de los colaboradores de Aezio: la misma para todos, sin usar datos del usuario.
// Sin marcas activas, o sin conexión, no se muestra nada.
const WEB = 'https://aezio.website'
let feed = null
const loadPartners = () => feed || (feed = fetch(WEB + '/api/partners/app', { credentials: 'omit' })
  .then(r => (r.ok ? r.json() : { partners: [] }))
  .then(d => d.partners || [])
  .catch(() => []))

export default function PartnerAd() {
  const [partner, setPartner] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    let active = true
    loadPartners().then(list => { if (active && list.length) setPartner(list[new Date().getDate() % list.length]) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!partner || !ref.current || !('IntersectionObserver' in window) || !navigator.sendBeacon) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      const body = new FormData()
      body.append('partner', partner.slug)
      body.append('placement', 'app')
      navigator.sendBeacon(WEB + '/api/partners/view', body)
    }, { threshold: 0.5 })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [partner])

  if (!partner) return null
  return <a ref={ref} className="card" href={partner.url} target="_blank" rel="sponsored nofollow noopener" style={{ display: 'block', textDecoration: 'none', textAlign: 'center' }}>
    <div className="dim" style={{ fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>{t('Advertisement')}</div>
    <img src={partner.image} alt={partner.name} loading="lazy" style={partner.isBanner ? { width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 10 } : { maxHeight: 56, maxWidth: 170 }} />
    {!partner.isBanner && <div className="small muted" style={{ marginTop: 6 }}>{partner.name}</div>}
  </a>
}
