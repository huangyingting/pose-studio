"""Fabric textures for the dresses (scripts/characters/makehuman.py), made with an image model.

    python3 -I scripts/characters/fabric.py [name ...]

Each is asked for as a seamless, tileable, flat texture and kept in ~/materials/generated/<name>.png
(not in the repository: the dresses' GLBs carry them, fitted within 512 px). The image model's
endpoint and key are read from .image (Endpoint: …, Key: …), which is never committed.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

FLAT = 'Seamless tileable fabric texture, flat top-down view, evenly lit, no folds or shadows: '
FABRICS = {
    'qipao-brocade': FLAT + 'navy blue silk brocade for a traditional Chinese qipao, small scattered plum blossoms in soft pink and ivory with thin gold outlines, fine woven sheen',
    'pink-tweed': FLAT + 'soft blush pink boucle tweed with fine woven texture and subtle cream threads, Chanel style',
    'black-lace': FLAT + 'black satin with a delicate black floral lace overlay, subtle sheen, elegant evening wear fabric',
    'blue-satin': FLAT + 'pale sky blue silk satin with a soft subtle sheen and very fine weave',
}
OUT = os.path.expanduser('~/materials/generated')


def ask(prompt):
    lines = open(os.path.join(os.path.dirname(__file__), '..', '..', '.image')).read().splitlines()
    get = lambda k: next(line.split(':', 1)[1].strip() for line in lines if line.startswith(k))  # noqa: E731
    body = json.dumps({'prompt': prompt, 'size': '1024x1024', 'n': 1}).encode()
    request = urllib.request.Request(get('Endpoint'), data=body, headers={'api-key': get('Key'), 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=300) as r:
                image = json.load(r)['data'][0]
            return base64.b64decode(image['b64_json']) if 'b64_json' in image else urllib.request.urlopen(image['url']).read()
        except urllib.error.HTTPError as e:
            # (Too many asked for at once: wait and ask again.)
            if e.code != 429 or attempt == 3:
                raise
            time.sleep(40)
    return b''


os.makedirs(OUT, exist_ok=True)
for name in sys.argv[1:] or FABRICS:
    path = os.path.join(OUT, name + '.png')
    open(path, 'wb').write(ask(FABRICS[name]))
    print('wrote', path)
