#!/usr/bin/env python3
"""
AezioGym: deja en media/gif, media/img y media/webp solo los ejercicios visibles de Aezio («Mis ejercicios»).

Los demás se mueven a media/ocultos/{gif,img,webp}, que nginx no sirve. Solo mueve, nunca borra:
al marcar un ejercicio en Aezio, la siguiente pasada lo devuelve a su sitio.

La lista sale de Aezio por la red interna de Docker (GET /api/app/exercises). Si no llega o
viene vacía no se toca nada (nunca se oculta todo: el servicio «media» volvería a descargarlo).

Uso:  python3 -I scripts/sync_media_visibles.py      (desde ~/docker/opengym; pensado para cron)
"""
import json
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(BASE, 'media')
KINDS = ('gif', 'img', 'webp')


def visible_ids():
    out = subprocess.run(
        ['docker', 'exec', 'npm', 'curl', '-s', '-m', '20',
         '-H', 'Host: aezio.website', '-H', 'X-Forwarded-Proto: https',
         'http://webserver/api/app/exercises'],
        capture_output=True, text=True, timeout=40)
    data = json.loads(out.stdout or 'null')
    ids = data.get('ids') if isinstance(data, dict) else None
    if not isinstance(ids, list) or not ids:
        raise RuntimeError('lista de visibles vacía o ilegible')
    return {str(i) for i in ids}


def main():
    try:
        visible = visible_ids()
    except Exception as e:  # sin lista no se mueve nada
        print(f'sin cambios: {e}', file=sys.stderr)
        return 1

    moved = {'ocultados': 0, 'recuperados': 0}
    for kind in KINDS:
        shown = os.path.join(MEDIA, kind)
        hidden = os.path.join(MEDIA, 'ocultos', kind)
        os.makedirs(hidden, exist_ok=True)
        for name in sorted(os.listdir(shown)):
            if name[:4] not in visible and not os.path.exists(os.path.join(hidden, name)):
                os.rename(os.path.join(shown, name), os.path.join(hidden, name))
                moved['ocultados'] += 1
        for name in sorted(os.listdir(hidden)):
            if name[:4] in visible and not os.path.exists(os.path.join(shown, name)):
                os.rename(os.path.join(hidden, name), os.path.join(shown, name))
                moved['recuperados'] += 1

    print(json.dumps({'visibles': len(visible), **moved}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
