/* Caducidad de las fotos y vídeos de entrenos (AezioGym, docs/AEZIOGYM.md).
   MEDIA_RETENTION_DAYS (15 por defecto, 0 = apagada): lo que cuelga de un entreno con `at` más
   antiguo se quita del estado del perfil, sellado como un cambio más (writeStateAs en server.js)
   para que los dispositivos lo acepten al sincronizar. Los archivos quedan sin referencia y el
   sweep de media.js los borra pasada su gracia (MEDIA_GC_GRACE_DAYS).
   Solo se tocan workouts[].media y workouts[].entries[].sets[].media. Fotos de progreso por día,
   ejercicios propios (propios o integrados), avatar y sonidos no caducan nunca. */
import { stampEntry } from './sync-stamps.js';

const DAY = 86400000;
// Cuántos hashes caducados recuerda un entreno (`mediaGone`): el cliente (sync-merge.js
// mergeWorkoutMedia) los usa para no resucitar una foto que otro dispositivo aún lista.
export const GONE_MAX = 100;

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);
const expired = (m, cutoff) => isObj(m) && typeof m.at === 'number' && Number.isFinite(m.at) && m.at > 0 && m.at < cutoff;

/** Días de retención del entorno: sin definir o inválido → 15; 0 → 0 (apagada). */
export function retentionDays(env = process.env) {
  const raw = env.MEDIA_RETENTION_DAYS;
  if (raw == null || String(raw).trim() === '') return 15;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

/** `at` de la fecha de caducidad de un medio (ms), o null con retención 0. */
export const expiresAt = (at, days) => (days > 0 ? Math.round(at) + Math.round(days * DAY) : null);

/** ¿Hay algo caducado en el estado? Lectura rápida, sin copiar nada. */
export function hasExpired(S, { now = Date.now(), days }) {
  if (!(days > 0) || !isObj(S)) return false;
  const cutoff = now - days * DAY;
  for (const w of list(S.workouts)) {
    if (!isObj(w)) continue;
    if (list(w.media).some(m => expired(m, cutoff))) return true;
    for (const e of list(w.entries)) for (const st of list(isObj(e) ? e.sets : null)) {
      if (isObj(st) && list(st.media).some(m => expired(m, cutoff))) return true;
    }
  }
  return false;
}

/**
 * Quita de `S` (se muta; es la copia que da writeStateAs) las referencias caducadas y sella cada
 * entreno tocado en `t` como una edición suya (stampEntry: `_ts` y `_f` por campo).
 * → { removed, workouts }: referencias quitadas y entrenos tocados.
 */
export function expireMedia(S, { now = Date.now(), days, t }) {
  const res = { removed: 0, workouts: 0 };
  if (!(days > 0) || !isObj(S)) return res;
  const cutoff = now - days * DAY;
  for (const w of list(S.workouts)) {
    if (!isObj(w)) continue;
    const old = JSON.parse(JSON.stringify(w));
    let n = 0;
    const gone = [];
    if (Array.isArray(w.media)) {
      w.media = w.media.filter(m => {
        if (!expired(m, cutoff)) return true;
        if (typeof m.hash === 'string') gone.push(m.hash);
        n++;
        return false;
      });
    }
    for (const e of list(w.entries)) for (const st of list(isObj(e) ? e.sets : null)) {
      if (!isObj(st) || !Array.isArray(st.media)) continue;
      const keep = st.media.filter(m => !expired(m, cutoff));
      n += st.media.length - keep.length;
      if (keep.length) st.media = keep; else delete st.media;
    }
    if (!n) continue;
    if (gone.length) w.mediaGone = [...new Set([...list(w.mediaGone).filter(h => typeof h === 'string'), ...gone])].slice(-GONE_MAX);
    stampEntry(old, w, t);
    res.removed += n;
    res.workouts++;
  }
  return res;
}
