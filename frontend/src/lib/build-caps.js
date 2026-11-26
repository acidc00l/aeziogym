// What this build of the app can do at all, as opposed to what a person switched on (Modules).
//
// openGym Offline (the Android flavour "offline", app/build.gradle) has no INTERNET permission:
// Android refuses every connection it would try. So the page does not offer what would need one:
// no server to connect or sync with (and so no sign-in, OIDC, trainer, API tokens or MCP, no
// community library, no webhooks, Strava or calendar feed), no Coach, no WebDAV backup, no
// "Watch on YouTube", no update check, no Hevy import, no gym search or map tiles. Everything that
// works on the phone alone stays: logging, plans, stats, backups to a file, Health Connect, the
// reminders, widgets, the gym reminder from where you stand.
//
// The flag is set once at start (lib/channel.js initBuildCaps, before the first render in
// main.jsx) and never changes while the app runs. Pure on purpose: no imports but modules.js, so
// any helper can ask without a cycle.
import { setUnavailableModules } from './modules.js'

// The modules that are nothing but network: off and out of Settings → Modules in this build.
export const OFFLINE_OFF_MODULES = ['coach', 'integrations', 'community']
// The Integrations cards (lib/integrations.js) that would need the network.
// opennutrition: the sister-app link (lib/sister-nutrition.js, gm-hooks) talks to another server.
export const OFFLINE_OFF_CARDS = ['hevy', 'strava', 'webdav', 'calendar', 'webhook', 'coach', 'mcp', 'opennutrition']

// AezioGym: lo que openGym ofrece y nosotros no (la app es solo web/PWA y sin servicios externos).
// Se activa al arrancar (main.jsx, setAezioBuild) salvo con VITE_OPENGYM_FULL=1 en la compilación,
// que devuelve la oferta completa de openGym. No borra nada: solo deja de ofrecerlo, y la
// elección del perfil se conserva.
//   módulos: Coach de IA, relojes, Apple Health / Health Connect, Comunidad, Integraciones
//   tarjetas: Hevy, Strava, WebDAV, calendario, webhooks, MCP, openNutrition, salud
export const AEZIO_OFF_MODULES = ['coach', 'watch', 'health', 'community', 'integrations']
export const AEZIO_OFF_CARDS = ['hevy', 'strava', 'webdav', 'calendar', 'webhook', 'coach', 'mcp', 'opennutrition', 'apple-health', 'health-connect']

let offline = false
let aezio = false
const subs = new Set()

/** Si esta compilación es AezioGym (sin las funciones externas de openGym). */
export const aezioBuild = () => aezio

const refreshModules = () => setUnavailableModules([
  ...(offline ? OFFLINE_OFF_MODULES : []),
  ...(aezio ? AEZIO_OFF_MODULES : []),
])

/** Whether this is openGym Offline, the build without the INTERNET permission. */
export const offlineBuild = () => offline

/** Whether something that needs the network may be offered in this build. */
export const networkBuilt = () => !offline

export function setOfflineBuild(v) {
  v = !!v
  if (v === offline) return
  offline = v
  refreshModules()
  subs.forEach(fn => { try { fn() } catch { /* a listener's own trouble */ } })
}

export function setAezioBuild(v) {
  v = !!v
  if (v === aezio) return
  aezio = v
  refreshModules()
  subs.forEach(fn => { try { fn() } catch { /* a listener's own trouble */ } })
}

export function subscribeBuildCaps(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}
