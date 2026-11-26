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

## Medios de ejercicios

Los medios de Gym visual no están en el repositorio (`catalogue/media/*` se ignora salvo
`NOTICE.md`). Ver `NOTICE.md`.
