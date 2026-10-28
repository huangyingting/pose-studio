#!/usr/bin/env python3
"""Mio (public/characters/mio.glb, #15): Aoi made over after a reference sheet of the character.

    python3 scripts/characters/mio.py

From aoi.glb (scripts/vrm-character.py made it):
  - silver-white hair and brows, grey-green eyes (their textures' light and dark mapped onto the
    new colours, their painting kept; her hair's glow off, Aoi's orange strands in it);
  - a white bandeau: her T-shirt cut to a band round her chest, recoloured white, its shade a
    neutral grey; the rest of her T-shirt in her skin's colour, without outlines (her body has no
    skin where her clothes covered it: those patches fill it, a few millimetres over it);
  - a white bikini bottom: her body's painted underwear recoloured white; the skin her clothes
    covered (left unpainted, black) painted as the skin round it;
  - the holes in her body's mesh where her clothes covered it (round her chest, under her arms)
    closed, in her skin's colour;
  - her cardigan and shorts taken off; her body, its shape, her face and her shoes as they were.
The same licence as Aoi's (it lets a changed copy be shared), credited to Ueda. Needs Pillow and numpy.
"""
import io
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, 'scripts')
vrm_character = __import__('vrm-character')

# The band of her chest the bandeau keeps (m, standing: her height is 1.55 m), and how far either
# side of her middle (not her sleeves: her arms are out to the sides as she stands in the file).
BAND = (1.04, 1.25)
HALF_WIDTH = 0.19
# The hair, brows and eyes, darkest and lightest.
COLORS = {'_HAIR': ('#8e8a8e', '#f3f0ec'), 'FaceBrow': ('#7a7470', '#cbc6c1'), 'EyeIris': ('#27312e', '#aebfb4')}
BANDEAU = ('#d6d6dc', '#fbfbfc')
UNDERWEAR = ('#cfcfd6', '#fbfbfd')


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def load(raw):
    return np.asarray(Image.open(io.BytesIO(raw)).convert('RGBA')).astype(np.float32)


def png(px):
    out = io.BytesIO()
    Image.fromarray(px.clip(0, 255).round().astype(np.uint8), 'RGBA').save(out, 'PNG', optimize=True)
    return out.getvalue()


def luminance(px):
    return px[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def mapped(px, where, dark, light):
    """Pixels (`where`) with their light and dark, from their own range, mapped onto dark…light."""
    lum = luminance(px)
    lo, hi = np.percentile(lum[where], [2, 98]) if where.any() else (0.0, 255.0)
    k = np.clip((lum - lo) / max(1.0, hi - lo), 0, 1)[..., None]
    out = px.copy()
    out[..., :3] = np.where(where[..., None], hex_rgb(dark) + (hex_rgb(light) - hex_rgb(dark)) * k, px[..., :3])
    return out


def recolored(raw, dark, light):
    px = load(raw)
    return png(mapped(px, px[..., 3] > 8, dark, light))


def bandeau(raw):
    """Her T-shirt's texture white, plain and solid: what was cut out (round its armholes) white too."""
    px = load(raw)
    cut = px[..., 3] < 128
    px[cut, :3] = hex_rgb(BANDEAU[1])
    px[..., 3] = 255
    # (Its print blurred away: only the cloth's folds left.)
    soft = Image.fromarray(px.round().astype(np.uint8), 'RGBA').filter(ImageFilter.GaussianBlur(10))
    return png(mapped(np.asarray(soft).astype(np.float32), ~cut, *BANDEAU))


def body_painted(raw):
    """Her body's texture: the unpainted skin under her clothes as the skin round it, her underwear white."""
    px = load(raw)
    r, g, b, a = px[..., 0], px[..., 1], px[..., 2], px[..., 3]
    shown = a > 8
    black = shown & (px[..., :3].max(axis=-1) < 24)
    # (Underwear: a purple, its red and blue over its green.)
    underwear = shown & ~black & (r > g + 20) & (b > g + 10) & (np.abs(r - b) < 90) & (r < 200)
    skin = shown & ~black & ~underwear
    px[black, :3] = np.median(px[skin, :3], axis=0)
    return png(mapped(px, underwear, *UNDERWEAR))


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def skin_of(raw):
    """Her skin's colour: the middle of what her body's texture paints as skin (sRGB 0–255)."""
    px = load(raw)
    shown = (px[..., 3] > 8) & (px[..., :3].max(axis=-1) >= 24)
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    return np.median(px[shown & (r >= g) & (g >= b), :3], axis=0)


def accessor(gltf, binary, i):
    a = gltf['accessors'][i]
    v = gltf['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dtype = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
    data = np.frombuffer(binary, dtype=dtype, count=a['count'] * n, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))
    return data.reshape(a['count'], n) if n > 1 else data


def holes(pos, tris):
    """The open loops of a mesh's surface (its vertices joined where they stand together: split at
    seams), each as its vertices in order (one of each joined vertex), the way its edges run."""
    key = np.round(pos / 1e-5).astype(np.int64)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    weld = weld.ravel()
    first = {}
    for i, w in enumerate(weld):
        first.setdefault(int(w), i)
    edges = set()
    for a, b, c in weld[tris]:
        edges.update(((int(a), int(b)), (int(b), int(c)), (int(c), int(a))))
    after = {}
    for a, b in edges:
        if (b, a) not in edges:
            after.setdefault(a, []).append(b)
    loops, done = [], set()
    for start in list(after):
        if start in done:
            continue
        loop, cur = [], start
        while cur not in done and cur in after:
            done.add(cur)
            loop.append(cur)
            cur = after[cur][0]
        if cur == start and len(loop) >= 3:
            loops.append([first[w] for w in loop])
    return loops


def main():
    gltf, binary = vrm_character.read_glb('public/characters/aoi.glb')
    vrm = gltf['extensions']['VRMC_vrm']
    if vrm.get('meta', {}).get('modification') != 'allowModificationRedistribution':
        sys.exit('Its licence does not let a changed copy be shared')
    materials = gltf['materials']
    named = lambda prim, token: token in materials[prim['material']]['name']

    # Her skin's colour, from her body's texture.
    body = next(m for m in materials if 'Body_00_SKIN' in m['name'])
    image = gltf['images'][gltf['textures'][body['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]
    view = gltf['bufferViews'][image['bufferView']]
    skin = srgb_to_linear(skin_of(binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]))
    shade = skin * np.array(body['extensions']['VRMC_materials_mtoon']['shadeColorFactor'][:3])

    # The bandeau: her T-shirt's material, white, shaded grey. The skin patches: a material of her
    # skin's colour, no texture, no outline.
    shirt = next(m for m in materials if 'Onepiece' in m['name'])
    shirt['extensions']['VRMC_materials_mtoon']['shadeColorFactor'] = [0.82, 0.81, 0.84]
    # (Solid: the T-shirt's texture is cut out round its armholes, which the band would show through.)
    shirt['alphaMode'] = 'OPAQUE'
    shirt.pop('alphaCutoff', None)
    patch = {
        'name': 'Mio_SkinPatch', 'doubleSided': False, 'alphaMode': 'OPAQUE',
        'pbrMetallicRoughness': {'baseColorFactor': [*map(float, skin), 1.0]},
        'extensions': {'KHR_materials_unlit': {}, 'VRMC_materials_mtoon': {
            **{k: v for k, v in body['extensions']['VRMC_materials_mtoon'].items() if not k.endswith('Texture')},
            'shadeColorFactor': [*map(float, shade)], 'outlineWidthMode': 'none', 'outlineWidthFactor': 0,
        }},
    }
    materials.append(patch)

    # Her hair's glow off: Aoi's glow textures have orange strands in them.
    for m in materials:
        if '_HAIR' in m['name']:
            m['emissiveFactor'] = [0, 0, 0]
            m.pop('emissiveTexture', None)

    # Her cardigan and shorts off; her T-shirt cut: the band round her chest, the rest skin.
    extra = []

    def indices(tris):
        extra.append(tris.astype(np.uint32).ravel().tobytes())
        gltf['bufferViews'].append({'buffer': 0, 'byteLength': len(extra[-1]), 'target': 34963})
        gltf['accessors'].append({'bufferView': len(gltf['bufferViews']) - 1, 'componentType': 5125, 'count': int(tris.size), 'type': 'SCALAR'})
        return len(gltf['accessors']) - 1

    # Her body's holes closed: each torso loop (not her neck's, where her head joins; not her
    # wrists') fanned from a vertex in its middle, in the skin patches' material; the new vertices
    # added to her body mesh's (each moving as a vertex of its loop does).
    grown = {}
    for mesh in gltf['meshes']:
        skin_prim = next((p for p in mesh['primitives'] if named(p, 'Body_00_SKIN')), None)
        if not skin_prim:
            continue
        attrs = skin_prim['attributes']
        data = {k: accessor(gltf, binary, i).copy() for k, i in attrs.items()}
        pos = data['POSITION']
        fills = []
        for loop in holes(pos, accessor(gltf, binary, skin_prim['indices']).reshape(-1, 3)):
            centre = pos[loop].mean(axis=0)
            if not (1.0 <= centre[1] <= 1.33 and abs(centre[0]) <= 0.3) or len(loop) > 60:
                continue
            new = {k: (centre if k == 'POSITION' else data[k][loop].mean(axis=0) if k == 'NORMAL' else data[k][loop[0]]) for k in data}
            new['NORMAL'] = new['NORMAL'] / max(1e-6, np.linalg.norm(new['NORMAL']))
            index = len(data['POSITION'])
            for k in data:
                data[k] = np.vstack([data[k], np.asarray(new[k], dtype=data[k].dtype)[None]])
            pos = data['POSITION']
            fills += [(index, loop[(i + 1) % len(loop)], loop[i]) for i in range(len(loop))]
        if not fills:
            continue
        for k, i in attrs.items():
            a = gltf['accessors'][i]
            # (Its own view, from its start, not interleaved: its bytes are the view's.)
            assert not a.get('byteOffset') and 'byteStride' not in gltf['bufferViews'][a['bufferView']], k
            a['count'] = len(data[k])
            if k == 'POSITION':
                a['min'], a['max'] = data[k].min(axis=0).tolist(), data[k].max(axis=0).tolist()
            grown[a['bufferView']] = data[k].tobytes()
        mesh['primitives'].append({'attributes': dict(attrs), 'indices': indices(np.array(fills)), 'material': len(materials) - 1, 'mode': 4})

    for mesh in gltf['meshes']:
        kept = []
        for prim in mesh['primitives']:
            if named(prim, 'Tops') or named(prim, 'Bottoms'):
                continue
            if named(prim, 'Onepiece'):
                pos = accessor(gltf, binary, prim['attributes']['POSITION'])
                tris = accessor(gltf, binary, prim['indices']).reshape(-1, 3)
                centre = pos[tris].mean(axis=1)
                keep = (centre[:, 1] >= BAND[0]) & (centre[:, 1] <= BAND[1]) & (np.abs(centre[:, 0]) <= HALF_WIDTH)
                kept.append({**prim, 'indices': indices(tris[keep])})
                prim = {**prim, 'indices': indices(tris[~keep]), 'material': len(materials) - 1}
                prim.pop('targets', None) if not prim.get('targets') else None
            kept.append(prim)
        mesh['primitives'] = kept

    # Which images to repaint: the colour and shade textures of her hair, brows, eyes, T-shirt and body.
    todo = {}
    for m in materials:
        refs = [m.get('pbrMetallicRoughness', {}).get('baseColorTexture'), m.get('extensions', {}).get('VRMC_materials_mtoon', {}).get('shadeMultiplyTexture')]
        for ref in filter(None, refs):
            source = gltf['textures'][ref['index']]['source']
            if 'Body_00_SKIN' in m['name']:
                todo[source] = body_painted
            if 'Onepiece' in m['name']:
                todo[source] = bandeau
            for token, (dark, light) in COLORS.items():
                if token in m['name']:
                    todo[source] = lambda raw, d=dark, l=light: recolored(raw, d, l)

    # The buffer again: each view, the repainted images, the cut T-shirt's triangles after.
    views = {img['bufferView']: (i, img) for i, img in enumerate(gltf['images']) if 'bufferView' in img}
    out = bytearray()
    first_new = len(gltf['bufferViews']) - len(extra)
    for v, view in enumerate(gltf['bufferViews']):
        if v >= first_new:
            raw = extra[v - first_new]
        elif v in grown:
            raw = grown[v]
        else:
            start = view.get('byteOffset', 0)
            raw = binary[start:start + view['byteLength']]
            if v in views and views[v][0] in todo:
                raw = todo[views[v][0]](raw)
                views[v][1]['mimeType'] = 'image/png'
        out += b'\x00' * (-len(out) % 4)
        view['byteOffset'] = len(out)
        view['byteLength'] = len(raw)
        out += raw
    gltf['buffers'] = [{'byteLength': len(out)}]
    vrm['meta']['name'] = 'Mio'
    vrm_character.write_glb('public/characters/mio.glb', gltf, bytes(out))
    print(f'public/characters/mio.glb: {len(todo)} textures repainted, her T-shirt cut to {BAND[0]}–{BAND[1]} m, {len(grown) and "her body's holes closed"}')


if __name__ == '__main__':
    main()
