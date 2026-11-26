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

## Producción

```
docker compose -f docker-compose.yml -f docker-compose.aezio.yml up -d --build
```

Imágenes locales, web solo en `127.0.0.1:${WEB_PORT:-8080}`, red externa `red_proxy_npm`, sin servicio
que descargue medios. Los secretos y `ORIGIN`/`RP_ID` van en el archivo de entorno del api, que no se
versiona.
