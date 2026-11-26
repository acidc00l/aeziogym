# AezioGym: qué se ofrece y qué no

AezioGym está basada en openGym 1.4.5 (AGPL-3.0). Es una app solo web/PWA. Estas funciones de
openGym están apagadas, y se apagan dos veces: en el servidor (variables del servicio api de
docker-compose.yml) y en la web (interfaz). Nada se borra del código.

| Función | Servidor | Interfaz |
|---|---|---|
| Coach de IA | `COACH_DISABLED=1` | módulo `coach` no disponible (`lib/build-caps.js`) |
| Comunidad | `LIBRARY=off`, `SHARING=off` | módulo `community` no disponible |
| Webhooks, Strava | `INTEGRATIONS=` (vacío) | módulo `integrations` y sus tarjetas no disponibles |
| Tokens de API, MCP, calendario | `API_TOKENS=off`; el perfil `mcp` de compose no se activa | módulo `integrations` no disponible |
| OIDC | `OIDC_ISSUER=` (vacío) | sin botón de inicio de sesión |
| Relojes | n/a | módulo `watch` no disponible |
| Apple Health / Health Connect | n/a | módulo `health` no disponible |
| Importar de Hevy, copia WebDAV, enlace openNutrition | n/a | filas y tarjetas ocultas |
| Mapas de gimnasios (Photon, Nominatim, teselas OSM) | n/a | sin búsqueda ni mapa |
| Comprobar actualizaciones | n/a | consulta `acidc00l/aeziogym`; sin releases no muestra nada |

Entrenadores y gimnasios (`TRAINERS`) no se ha tocado: sigue apagado como viene.

## Recuperar la oferta completa de openGym

Compilar la web con `VITE_OPENGYM_FULL=1` y quitar las variables de arriba del entorno del api.

## Medios de ejercicios y clips WebP

Los medios de Gym visual no están en el repositorio (`catalogue/media/*` se ignora salvo
`NOTICE.md`) ni en la imagen web, que ya no copia `catalogue/media`. Se montan desde fuera:

- Carpeta con `still/` y `clip/` (o la estructura que use el catálogo) en `MEDIA_DIR`
  (por defecto `./media`), montada como `/usr/share/nginx/html/exercise-media:ro`
  (ver `docker-compose.aezio.yml`). nginx ya sirve esa ruta con caché y cabeceras propias.
- Los clips son WebP animado de 360 px: se compila con `VITE_CLIP_EXT=webp`
  (`ARG VITE_CLIP_EXT` en `web/Dockerfile`; vacío = `.mp4`, como upstream).
  `lib/exercises.js` cambia la extensión de los clips y las fotos fijas ya son `.webp`.
- El service worker (`frontend/public/sw.js`) guarda para uso sin conexión todo lo que cuelga de
  `/exercise-media/`, sea cual sea la extensión, así que los `.webp` ya quedan cubiertos.

## Ejercicios visibles y nombres de Aezio

- Solo se ofrecen los ejercicios que Aezio publica en `https://aezio.website/api/app/exercises`
  (`{"ids":[...]}`): biblioteca, buscador, selectores y sugerencias (`allExercises`). El historial, los
  entrenos y los planes guardados siguen mostrando cualquier ejercicio por su id, y los propios del
  usuario se ven siempre. Sin lista (null, error, sin red) se usa la última guardada
  (`localStorage aezio_visible_ex`) y, si no hay ninguna, el catálogo entero. Con `VITE_OPENGYM_FULL=1`
  no se filtra. `VITE_VISIBLE_URL` cambia el origen de la lista en la compilación.
- Nombres en castellano de Aezio: `frontend/src/aezio/names-es.json` (id → nombre), generado con
  `node scripts/aezio/build-names-es.mjs /ruta/al/exercises-data.js` (el de AezioGym 1.2.4). Mandan sobre
  los del catálogo en el idioma es; el resto de ejercicios conserva el nombre de la 1.4.5. En es no se
  muestran las descripciones en inglés de esos ejercicios.

## Contrato Aezio ↔ AezioGym

La web de Aezio (`core/Services/OpenGymService.php`, `PlanAppController.php`, `WorkoutConfirm.php`)
habla con la app. Este contrato es el de AezioGym 1.2.4 y no se cambia: la web no se toca para el
cambio de versión.

### Llamadas de la web a la app (internas, firmadas)

- **Dirección**: `http://opengym-web/api/internal/<acción>` por la red interna de docker (nombre del
  contenedor web, puerto 80), no por la URL pública. Pasa por el nginx de `web`, que reenvía `/api/` a la app.
- **Método y cuerpo**: `POST`, `Content-Type: application/json`, sin cabeceras de firma. Todo va en el cuerpo:
  `{"id": "<id del perfil>", "ts": "<milisegundos Unix, como texto>", "sig": "<hex>", ...extra}`.
- **Firma**: `sig = HMAC-SHA256(clave, "<acción>:<id>:<ts>")` en hexadecimal minúscula. No firma el cuerpo
  extra: lo que protege es la acción, el perfil y el momento.
- **Ventana**: la app rechaza si `|ahora − ts| > 60 s` (los relojes de la web y de la app deben coincidir).
- **Clave**: el archivo `data/secret` de la app (la misma con la que ella firma las sesiones). La web lo
  lee de la carpeta de datos compartida (`/home/r0ot/docker/opengym/data/`, permisos 640 `root:www-data`).
  Si no lo puede leer, la web no firma y avisa por Telegram.
- **Éxito**: HTTP 200. Cualquier otro código (o sin respuesta) cuenta como fallo: la web lo registra, avisa
  como mucho una vez por hora y reintenta a diario los borrados.
- **Rechazo**: firma mala, fuera de ventana o `id` vacío → `403 {"error":"forbidden"}`.

| Acción | Cuerpo extra | Respuestas |
|---|---|---|
| `delete-profile` | — | 200 `{ok:true,result:"deleted"}` o `"missing"`; 403 `forbidden` (firma); 403 `admin profiles cannot be deleted here` (perfil admin) |
| `restore-profile` | `user`, `creds[]`, `subs[]`, `state` (lo que devolvió `profileBackup`) | 200 `{ok:true}`; 400 `bad profile` (`user.id` ≠ `id`); 409 `already exists`; 403 `forbidden` |
| `coach-pending` | `item`: `{kind:"plan",plan_id,bundle}` · `{kind:"patch",plan_id,coach,changes[]}` · `{kind:"confirm",coach,decisions[{id,ok}]}` · `{kind:"measure",entries[]}` (ver abajo) | 200 `{ok:true,pending:n}`; 404 `no such profile`; 400 `bad item`; 403 `forbidden` |
| `workout-media` | `hash` (sha256 hex de 64). Cabecera opcional `Range: bytes=a-b` | 200 o 206 con el archivo (Content-Type guardado, `Accept-Ranges`, `Content-Range`, cabecera `X-Media-At` con la fecha `at` del medio en ms); 404 si ese hash no está en un `workouts[].media[]` (ni es su póster) del perfil; 400 `bad hash`; 416 rango imposible; 403 `forbidden` |
| `workout-media-list` | — | 200 `{ok:true,items:[{workoutId,d,hash,kind,mime,size,dur,at,poster}],usedBytes,quotaBytes}`; 404 `no such profile`; 403 `forbidden` |

`measure` (revisión de la Bitácora, un solo elemento para todo el historial): `{"kind":"measure","entries":[{"d":"AAAA-MM-DD", ...}]}`
con 1 a 400 entradas. Claves permitidas de cada entrada (cualquier otra, o un valor fuera de rango, es 400 `bad item`
para todo el elemento): `weight` (kg, 1–400), `chest`, `abdomen`, `hips`, `upperArmLeft`, `upperArmRight`, `thighLeft`,
`thighRight`, `calfLeft`, `calfRight` (cm, 1–300), `bodyFat` (%, 0–100) y `custom`: `{"aezio-muscle-kg":1–400,
"aezio-water-pct":0–100,"aezio-visceral":0–60,"aezio-fat-kg":1–400}`. La app (`applyCoachMeasure`) escribe el peso
del día en `S.bodyweight` (en kg o lb según el perfil; la lectura de Aezio sustituye a las que hubiera ese día) y las
medidas en `S.measurements` de esa fecha (en cm; las claves de Aezio ganan, el resto del día se conserva, nota
«Revisión Aezio» si no había). Crea si faltan las medidas personalizadas `aezio-muscle-kg` «Masa muscular» (kg),
`aezio-water-pct` «Agua» (%), `aezio-visceral` «Grasa visceral» (sin unidad) y `aezio-fat-kg` «Masa grasa» (kg), y
enciende en la libreta las medidas opcionales que lleguen (abdomen, % graso). Aplicarlo dos veces deja el mismo estado.
Un plan nuevo no descarta los `measure` en espera.

`workout-media`: se pide por `POST` (cuerpo JSON como las demás, el `hash` dentro) y la firma es `workout-media:<id>:<ts>`;
la de la lista, `workout-media-list:<id>:<ts>`. Solo se sirven archivos de los entrenos del perfil (`workouts[].media` y su
póster), no los de ejercicios, series, sonidos ni avatar. El filtrado por consentimiento (`at` ≥ fecha de aceptación) lo
hace la web con `X-Media-At` / `at`.

`coach-pending`: un plan nuevo descarta los planes y ajustes anteriores en espera pero **no** las
confirmaciones (`confirm`); la cola guarda como máximo 20 elementos.

### Archivos de la carpeta de datos que la web lee directamente

La web lee estos archivos sin pasar por la app, así que su nombre y formato también son contrato:

- la clave de firma, `db.json` (`users`, `creds`, `subs` con `userId`) y `state-<id>.json` (el estado del
  cliente: `workouts`, `pendingWorkouts`, `exWeights`…).
- `pending-<id>.json`: lista de `{...item, key, at}` en espera para ese perfil.
- Por eso AezioGym arranca con `SHARED_DATA=1` (`docker-compose.yml`): no cierra a 0600 la clave ni
  `db.json` (la 1.4.5 lo hace al arrancar y dejaría a la web sin poder leerlos) y escribe `db.json` con 0644.
  El permiso de la clave (640 `root:www-data`) lo pone el propietario en el anfitrión y la app no lo toca.

### Llamadas de la app a Aezio

- `GET https://aezio.website/api/app-routines?token=<token>` (sin cookies): «Añadir a mi app». La web
  abre la app en `https://gym.aezio.website/#/import/<token>`; el token vale una vez (410 si caducó).
- `GET https://aezio.website/api/app/exercises` → `{"ids":[...]}`, los ejercicios visibles.

### Llamadas de la app a su propio servidor (sesión del cliente)

- `GET /api/coach-pending` → `{items:[...]}`; `POST /api/coach-pending/ack` con `{keys:[...]}` → `{ok,pending}`.
- El borrado de cuenta del cliente usa `POST /api/account/delete` de la 1.4.5 (pide escribir el nombre y
  una prueba de propiedad). `POST /api/me/delete` de la 1.2.4 no se porta: la web no la usa.

### Qué hace la app con lo que llega de Aezio

- **Cola del entrenador** (`store/useStore.js`, `pullCoachPending`): al abrir y con cada comprobación de
  sincronización (cada 30 s con la app abierta) lee `GET /api/coach-pending`, lo aplica como un cambio
  normal (`lib/coach-import.js`; las rutinas `aezio-<plan>-<día>` sincronizan entre dispositivos como
  cualquier otra, con `src` para saber de qué plan vienen), lo sube al servidor y solo entonces hace
  `POST /api/coach-pending/ack`. Si no pudo subirlo, no hay ack y se reintenta sin volver a aplicar el
  plan sobre lo que el cliente haya editado (`gym_coach_applied`).
- **«Añadir a mi app»** (`views/CoachImport.jsx`, ruta `/#/import/:token`): vista previa y confirmación.
- **Entreno anotado después** (la función «Registrar este entreno» de la 1.4.5): con rutinas de Aezio
  no cuenta hasta que el entrenador lo confirma; espera en `pendingWorkouts` (que la web lee) y la
  decisión llega por la cola (`kind: confirm`).
- **Entreno sin terminar**: lo cubre la función propia de la 1.4.5 («entrenos olvidados»: pregunta, lo
  termina solo y se puede reabrir 24 h). No se porta `checkUnfinishedWorkout` de la 1.2.4.
- **Notificaciones push**: `syncPushSubscription` de la 1.4.5 hace lo que hacía `refreshPush`.

### Seguridad del acceso interno

La web llama por el nombre de contenedor `opengym-web`, así que `/api/internal/` solo se ofrece cuando
la petición llega con `Host: opengym-web` (variable `INTERNAL_HOST` del servicio web); por la URL pública
(otro `Host`) devuelve 404. La firma sigue siendo lo que protege la ruta.

## Producción

```
docker compose -f docker-compose.yml -f docker-compose.aezio.yml up -d --build
```

Imágenes locales, web solo en `127.0.0.1:${WEB_PORT:-8080}`, red externa `red_proxy_npm`, sin servicio
que descargue medios. Los secretos y `ORIGIN`/`RP_ID` van en el archivo de entorno del api, que no se
versiona.
