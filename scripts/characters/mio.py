#!/usr/bin/env python3
"""Mio (public/characters/mio.glb, #15): Aoi made over after a design sheet drawn for her.

    python3 scripts/characters/mio.py

From aoi.glb (scripts/vrm-character.py made it):
  - silver-white hair and brows, grey-green eyes (their textures' light and dark mapped onto the
    new colours, their painting kept; her hair's glow off, Aoi's orange strands in it);
  - long hair, to her waist: sheets of strands of their own (their texture drawn here) hanging from
    under her hair, down her back and a lock either side of her face; with her head above her neck,
    with her chest below it;
  - a lavender-grey cardigan, her T-shirt white with its print teal, navy denim shorts, white
    sneakers trimmed in teal (Aoi's clothes, repainted).
The same licence as Aoi's (it lets a changed copy be shared), credited to Ueda. Needs Pillow and numpy.
"""
import io
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, 'scripts')
vrm_character = __import__('vrm-character')

# The hair, brows and eyes, darkest and lightest.
COLORS = {'_HAIR': ('#8e8a8e', '#f3f0ec'), 'FaceBrow': ('#7a7470', '#cbc6c1'), 'EyeIris': ('#27312e', '#aebfb4')}
CARDIGAN = ('#8a87a6', '#d8d6ea')
SHIRT = ('#d9d9df', '#fdfdfe')
PRINT = '#2f8f86'
SHORTS = ('#121a33', '#45588c')
SHOES = ('#9a9ea3', '#ffffff')
TRIM = ('#2a756f', '#6cc2b8')

# Her long hair (m, standing: her height is 1.55 m). Down her back, from under her hair at the
# back of her head to her waist: how far behind her middle at each height (her hair's back, then
# her back's), how wide, how much it wraps round her (its sides further forward).
BACK_HAIR = {
    'y': [1.52, 1.45, 1.38, 1.32, 1.24, 1.12, 1.0, 0.93],
    'x': [0] * 8,
    'z': [-0.118, -0.128, -0.125, -0.128, -0.126, -0.124, -0.118, -0.122],
    'half_width': [0.075, 0.092, 0.095, 0.108, 0.124, 0.128, 0.125, 0.118],
    'wrap': [0.06, 0.06, 0.055, 0.045, 0.032, 0.028, 0.025, 0.025],
}
# A lock either side of her face, from under her hair to her chest, over its front (its sides a
# little back). Its left one; the right one is its mirror.
SIDE_LOCK = {
    'y': [1.43, 1.36, 1.3, 1.26, 1.22, 1.17, 1.12],
    'x': [0.084, 0.088, 0.094, 0.1, 0.106, 0.11, 0.112],
    'z': [0.028, 0.03, 0.038, 0.062, 0.095, 0.125, 0.137],
    'half_width': [0.018, 0.022, 0.024, 0.024, 0.023, 0.021, 0.018],
    'wrap': [-0.008] * 7,
}
# Where it moves with her head, where with her chest (between: both).
NECK = (1.36, 1.27)


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


def shirt(raw):
    """Her T-shirt white, its print (dark letters) teal."""
    px = load(raw)
    shown = px[..., 3] > 8
    ink = shown & (luminance(px) < 150)
    out = mapped(px, shown & ~ink, *SHIRT)
    out[ink, :3] = hex_rgb(PRINT)
    return png(out)


def shoes(raw):
    """Her sneakers white, their red trim teal."""
    px = load(raw)
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    shown = px[..., 3] > 8
    trim = shown & (r > g + 40) & (r > b + 40)
    # (Its edge, half red: teal too.)
    trim = np.asarray(Image.fromarray((trim * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
    return png(mapped(mapped(px, shown & ~trim, *SHOES), trim, *TRIM))


def smooth_noise(n, scale, rng):
    """Values about 0…1 along n points, varying over about `scale` of them."""
    knots = rng.random(int(n / scale) + 3)
    x = np.arange(n) / scale
    i = np.floor(x).astype(int)
    t = x - i
    t = t * t * (3 - 2 * t)
    return knots[i] * (1 - t) + knots[i + 1] * t


def hair_texture(dark, light, width=256, height=1024, seed=7):
    """Strands, top to bottom: a little darker at the roots, lighter towards the tips; their tips
    uneven, in clumps (cut out: its alpha), and its sides too."""
    rng = np.random.default_rng(seed)
    u = np.arange(width)
    strands = 0.55 * smooth_noise(width, 3, rng) + 0.3 * smooth_noise(width, 9, rng) + 0.15 * smooth_noise(width, 30, rng)
    v = np.linspace(0, 1, height)[:, None]
    # (Strands drift a little as they fall.)
    drift = (smooth_noise(height, 200, rng)[:, None] - 0.5) * 6
    shade = np.interp(u[None, :] + drift, u, strands)
    lum = np.clip(0.25 + 0.7 * shade + 0.12 * v - 0.18 * np.exp(-v / 0.06), 0, 1)
    rgb = hex_rgb(dark) + (hex_rgb(light) - hex_rgb(dark)) * lum[..., None]
    # Tips: each clump ends at its own length; the sides thin out the same way.
    ends = 0.9 + 0.08 * (0.6 * smooth_noise(width, 6, rng) + 0.4 * smooth_noise(width, 2, rng))
    side = np.minimum(u, width - 1 - u) / width
    edge = 0.035 + 0.03 * smooth_noise(height, 40, rng)
    alpha = (v < ends[None, :]) & (side[None, :] > edge[:, None] * (0.6 + 0.8 * v))
    return png(np.dstack([rgb, alpha * 255.0]))


def accessor(gltf, binary, i):
    a = gltf['accessors'][i]
    v = gltf['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dtype = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
    data = np.frombuffer(binary, dtype=dtype, count=a['count'] * n, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))
    return data.reshape(a['count'], n) if n > 1 else data


def sheet(shape, facing, columns, rows, mirror=False):
    """A sheet of hair (`shape`: its middle, width and wrap by height; `facing`: +1 to the front,
    -1 behind): positions, normals, texture coordinates, triangles, and how much each vertex moves
    with her head (the rest with her chest)."""
    ys = np.linspace(shape['y'][0], shape['y'][-1], rows)
    at = lambda name: np.interp(ys, shape['y'][::-1], shape[name][::-1])
    x, z, half, wrap = at('x') * (-1 if mirror else 1), at('z'), at('half_width'), at('wrap')
    s = np.linspace(-1, 1, columns)
    pos = np.zeros((rows, columns, 3), dtype=np.float32)
    pos[..., 0] = x[:, None] + half[:, None] * s[None, :]
    pos[..., 1] = ys[:, None]
    pos[..., 2] = z[:, None] + wrap[:, None] * s[None, :] ** 2
    nrm = np.cross(np.gradient(pos, axis=0), np.gradient(pos, axis=1))
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    if np.sign(nrm[rows // 2, columns // 2, 2]) != facing:
        nrm = -nrm
    uv = np.zeros((rows, columns, 2), dtype=np.float32)
    uv[..., 0] = (s[None, :] + 1) / 2
    uv[..., 1] = np.linspace(0, 1, rows)[:, None]
    tris = []
    for r in range(rows - 1):
        for c in range(columns - 1):
            a, b, d, e = r * columns + c, r * columns + c + 1, (r + 1) * columns + c, (r + 1) * columns + c + 1
            tris += [(a, d, b), (b, d, e)]
    tris = np.array(tris, dtype=np.uint32)
    # (Its triangles facing the way its normals do.)
    flat = pos.reshape(-1, 3)
    a, b, c = flat[tris[0]]
    if np.dot(np.cross(b - a, c - a), nrm.reshape(-1, 3)[tris[0][0]]) < 0:
        tris = tris[:, ::-1].copy()
    head = np.repeat(np.clip((ys - NECK[1]) / (NECK[0] - NECK[1]), 0, 1), columns)
    return flat, nrm.reshape(-1, 3).astype(np.float32), uv.reshape(-1, 2), tris, head


def long_hair():
    """Her long hair: down her back, and a lock either side of her face (one mesh)."""
    parts = [sheet(BACK_HAIR, -1, 24, 64), sheet(SIDE_LOCK, 1, 6, 32), sheet(SIDE_LOCK, 1, 6, 32, mirror=True)]
    offsets = np.cumsum([0] + [len(p[0]) for p in parts[:-1]])
    return (
        *(np.concatenate([p[i] for p in parts]) for i in range(3)),
        np.concatenate([p[3] + o for p, o in zip(parts, offsets)]).astype(np.uint32),
        np.concatenate([p[4] for p in parts]),
    )


def main():
    gltf, binary = vrm_character.read_glb('public/characters/aoi.glb')
    vrm = gltf['extensions']['VRMC_vrm']
    if vrm.get('meta', {}).get('modification') != 'allowModificationRedistribution':
        sys.exit('Its licence does not let a changed copy be shared')
    materials = gltf['materials']
    extra = []

    def data(raw, target=None):
        extra.append(raw)
        view = {'buffer': 0, 'byteLength': len(raw)}
        if target:
            view['target'] = target
        gltf['bufferViews'].append(view)
        return len(gltf['bufferViews']) - 1

    def add_accessor(array, kind, component, target, minmax=False):
        a = {'bufferView': data(array.tobytes(), target), 'componentType': component, 'count': len(array), 'type': kind}
        if minmax:
            a['min'], a['max'] = array.min(axis=0).tolist(), array.max(axis=0).tolist()
        gltf['accessors'].append(a)
        return len(gltf['accessors']) - 1

    # Her hair's glow off: Aoi's glow textures have orange strands in them.
    for m in materials:
        if '_HAIR' in m['name']:
            m['emissiveFactor'] = [0, 0, 0]
            m.pop('emissiveTexture', None)

    # Her long hair: its own material (her hair's MToon settings), texture and mesh.
    hair = next(m for m in materials if '_HAIR_01' in m['name'])
    gltf['images'].append({'bufferView': data(hair_texture(*COLORS['_HAIR'])), 'mimeType': 'image/png', 'name': 'Mio_LongHair'})
    sampler = gltf['textures'][hair['pbrMetallicRoughness']['baseColorTexture']['index']].get('sampler')
    gltf['textures'].append({'source': len(gltf['images']) - 1, **({'sampler': sampler} if sampler is not None else {})})
    texture = {'index': len(gltf['textures']) - 1}
    # (No outline: a sheet seen from behind would be all outline.)
    mtoon = {k: v for k, v in hair['extensions']['VRMC_materials_mtoon'].items() if not k.endswith('Texture')}
    mtoon.update(outlineWidthMode='none', outlineWidthFactor=0)
    materials.append({
        'name': 'Mio_LongHair', 'alphaMode': 'MASK', 'alphaCutoff': 0.5, 'doubleSided': True,
        'pbrMetallicRoughness': {'baseColorTexture': texture, 'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.9},
        'extensions': {**{k: v for k, v in hair['extensions'].items() if k != 'VRMC_materials_mtoon'}, 'VRMC_materials_mtoon': {**mtoon, 'shadeMultiplyTexture': dict(texture)}},
    })
    skin = gltf['nodes'][next(i for i, n in enumerate(gltf['nodes']) if n.get('name') == 'Hair')]['skin']
    joint = {gltf['nodes'][j].get('name'): i for i, j in enumerate(gltf['skins'][skin]['joints'])}
    pos, nrm, uv, tris, head = long_hair()
    joints = np.zeros((len(pos), 4), dtype=np.uint16)
    joints[:, 0], joints[:, 1] = joint['head'], joint['upperChest']
    weights = np.zeros((len(pos), 4), dtype=np.float32)
    weights[:, 0], weights[:, 1] = head, 1 - head
    gltf['meshes'].append({'name': 'Mio_LongHair', 'primitives': [{
        'attributes': {
            'POSITION': add_accessor(pos, 'VEC3', 5126, 34962, minmax=True), 'NORMAL': add_accessor(nrm, 'VEC3', 5126, 34962),
            'TEXCOORD_0': add_accessor(uv, 'VEC2', 5126, 34962), 'JOINTS_0': add_accessor(joints, 'VEC4', 5123, 34962),
            'WEIGHTS_0': add_accessor(weights, 'VEC4', 5126, 34962),
        },
        'indices': add_accessor(tris.ravel(), 'SCALAR', 5125, 34963), 'material': len(materials) - 1, 'mode': 4,
    }]})
    gltf['nodes'].append({'name': 'Mio_LongHair', 'mesh': len(gltf['meshes']) - 1, 'skin': skin})
    gltf['scenes'][gltf.get('scene', 0)]['nodes'].append(len(gltf['nodes']) - 1)

    # Which images to repaint: the colour and shade textures of her hair, brows, eyes and clothes.
    todo = {}
    for m in materials:
        refs = [m.get('pbrMetallicRoughness', {}).get('baseColorTexture'), m.get('extensions', {}).get('VRMC_materials_mtoon', {}).get('shadeMultiplyTexture')]
        for ref in filter(None, refs):
            if ref['index'] == texture['index']:
                continue
            source = gltf['textures'][ref['index']]['source']
            for token, paint in {'Tops': lambda raw: recolored(raw, *CARDIGAN), 'Onepiece': shirt, 'Bottoms': lambda raw: recolored(raw, *SHORTS), 'Shoes': shoes}.items():
                if token in m['name']:
                    todo[source] = paint
            for token, (dark, light) in COLORS.items():
                if token in m['name']:
                    todo[source] = lambda raw, d=dark, l=light: recolored(raw, d, l)

    # The buffer again: each view, the repainted images, what was added after.
    views = {img['bufferView']: (i, img) for i, img in enumerate(gltf['images']) if 'bufferView' in img}
    out = bytearray()
    first_new = len(gltf['bufferViews']) - len(extra)
    for v, view in enumerate(gltf['bufferViews']):
        if v >= first_new:
            raw = extra[v - first_new]
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
    print(f'public/characters/mio.glb: {len(todo)} textures repainted, her long hair added ({len(pos)} points)')


if __name__ == '__main__':
    main()
