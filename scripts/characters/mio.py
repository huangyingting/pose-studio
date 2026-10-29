#!/usr/bin/env python3
"""Mio (public/characters/mio.glb, #15): Aoi made over after a design sheet drawn for her; and Mio
in a swimsuit (mio-swimsuit.glb), after another.

    python3 scripts/characters/mio.py

From aoi.glb (scripts/vrm-character.py made it):
  - silver-white hair and brows, grey-green eyes (their textures' light and dark mapped onto the
    new colours, their painting kept; her hair's glow off, Aoi's orange strands in it);
  - long hair, to her waist: sheets of strands of their own (their texture drawn here) hanging from
    under her hair, down her back and a lock either side of her face; with her head above her neck,
    with her chest below it;
  - a lavender-grey cardigan, her T-shirt white with its print teal, navy denim shorts, white
    sneakers trimmed in teal (Aoi's clothes, repainted);
  - or, in her swimsuit: her clothes and shoes off; the holes VRoid left in her body under them
    closed, her skin painted whole (VRoid leaves it black, see-through or painted with underwear and
    socks under clothes); a white halter bikini with teal trim and strings painted on her: each
    texel of her body's texture painted by where on her body it is (its shapes there, in metres:
    clean edges wherever her mesh's triangles fall).
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
# Her swimsuit (m, standing): white, its trim and strings teal. Its top: a triangle over each
# breast (x out from her middle, y up), from under it to its top (its trim EDGE wide); its strings
# from their tops up her front (HALTER) and round the back of her neck, and round her back under
# her bust. Its bottom: its top edge at her middle and at her hips (where it ties);
# its leg openings, from her crotch (as wide as `front`/`back`'s first) up to its ties at her hips
# (curving as their second: the back's lower, over her buttocks).
FABRIC = '#f5f6f8'
STRING = '#2f8f86'
CUP = [(0.006, 1.066), (0.115, 1.074), (0.048, 1.2)]
CUP_FRONT = 0.05
UNDERBAND = 1.069
HALTER = [(0.048, 1.2), (0.049, 1.24), (0.05, 1.272), (0.047, 1.292)]
NECK_BACK = 1.292
BOTTOM = {'top': (0.842, 0.872), 'hips': 0.135, 'crotch': 0.776, 'front': (0.026, 1.3), 'back': (0.045, 1.8)}
EDGE = 0.0042
# Her skin where VRoid did not paint it (and no skin is near).
SKIN = '#fae7da'

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


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def front_of(tris, pts):
    """How far forward (z) a surface (`tris`, facing forward) is at each point's x and y (−inf where
    it is not): by rays along z through its triangles."""
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    out = np.full(len(pts), -np.inf)
    for i, (x, y) in enumerate(pts[:, :2]):
        # (Barycentric coordinates of (x, y) in each triangle, seen from the front.)
        d = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
        ok = np.abs(d) > 1e-12
        l0 = np.where(ok, ((b[:, 1] - c[:, 1]) * (x - c[:, 0]) + (c[:, 0] - b[:, 0]) * (y - c[:, 1])) / np.where(ok, d, 1), -1)
        l1 = np.where(ok, ((c[:, 1] - a[:, 1]) * (x - c[:, 0]) + (a[:, 0] - c[:, 0]) * (y - c[:, 1])) / np.where(ok, d, 1), -1)
        l2 = 1 - l0 - l1
        hit = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        if hit.any():
            out[i] = (l0 * a[:, 2] + l1 * b[:, 2] + l2 * c[:, 2])[hit].max()
    return out


def vertex_normals(pos, tris):
    """Each vertex's normal: its triangles' (by their area)."""
    p = pos.astype(np.float64)
    face = np.cross(p[tris[:, 1]] - p[tris[:, 0]], p[tris[:, 2]] - p[tris[:, 0]])
    out = np.zeros_like(p)
    for k in range(3):
        np.add.at(out, tris[:, k], face)
    return out / np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-9)


def soft(a, r):
    """An image blurred across 2r + 1 pixels (a box; three of them about a Gaussian)."""
    for axis in (0, 1):
        c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(2)], mode='edge'), axis=axis)
        a = (np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis) - np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
    return a


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def to_segments(p, line):
    """Each point's distance to a polyline (3D)."""
    best = np.full(len(p), np.inf)
    for a, b in zip(line[:-1], line[1:]):
        a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
        t = np.clip(((p - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1)
        best = np.minimum(best, np.linalg.norm(p - (a + t[:, None] * (b - a)), axis=1))
    return best


def swimsuit(p):
    """Where her swimsuit is at points of her body (standing, m): 0 none, 1 fabric, 2 trim or string."""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    ax = np.abs(x)
    out = np.zeros(len(p), dtype=np.uint8)
    # Its top's cups: inside each triangle (by how far in from its nearest side), on her front.
    (x0, y0), (x1, y1), (x2, y2) = CUP
    inside = np.full(len(p), np.inf)
    for (ax0, ay0), (bx0, by0), (cx0, cy0) in [((x0, y0), (x1, y1), (x2, y2)), ((x1, y1), (x2, y2), (x0, y0)), ((x2, y2), (x0, y0), (x1, y1))]:
        n = np.array([by0 - ay0, ax0 - bx0])
        n /= np.linalg.norm(n)
        if (cx0 - ax0) * n[0] + (cy0 - ay0) * n[1] < 0:
            n = -n
        inside = np.minimum(inside, (ax - ax0) * n[0] + (y - ay0) * n[1])
    # (On her front: where her chest turns to her side, an edge too.)
    inside = np.minimum(inside, (z - CUP_FRONT) * 0.6)
    cup = inside > 0
    out[cup] = 1
    out[cup & (inside < EDGE)] = 2
    # Its strings: under her bust all round, and from each cup's top to behind her neck.
    out[(np.abs(y - UNDERBAND) < 0.0035) & ~cup & (ax < 0.16)] = 2
    out[(z > 0) & (to_segments(np.column_stack([ax, y, np.zeros_like(y)]), [(hx, hy, 0) for hx, hy in HALTER]) < 0.0032)] = 2
    out[(z <= 0) & (np.abs(y - NECK_BACK) < 0.0032) & (ax < HALTER[-1][0] + 0.004)] = 2
    out[(z < 0) & (((ax - 0.008) / 0.009) ** 2 + ((y - NECK_BACK) / 0.006) ** 2 < 1)] = 2
    # The bow at her back, under her bust.
    bow = (z < 0) & (((ax - 0.011) / 0.011) ** 2 + ((y - UNDERBAND) / 0.0075) ** 2 < 1)
    out[bow] = 2
    # Its bottom: its top edge rising from her middle to her hips, where it is tied.
    top = BOTTOM['top'][0] + (BOTTOM['top'][1] - BOTTOM['top'][0]) * (ax / BOTTOM['hips']) ** 2
    crotch, power = np.where(z > 0, BOTTOM['front'][0], BOTTOM['back'][0]), np.where(z > 0, BOTTOM['front'][1], BOTTOM['back'][1])
    across = np.clip((ax - crotch) / (BOTTOM['hips'] - crotch), 0, 1)
    leg = BOTTOM['crotch'] + (BOTTOM['top'][1] - 0.006 - BOTTOM['crotch']) * across ** power
    panel = (y < top) & (y > leg) & (ax < BOTTOM['hips'])
    out[panel] = 1
    out[panel & (np.minimum(top - y, y - leg) < EDGE)] = 2
    # Its ties at her hips: a string along its top edge out to them, a bow, its ends hanging.
    out[(np.abs(y - top) < 0.0035) & (ax >= BOTTOM['hips'] - 0.01) & (ax < BOTTOM['hips'] + 0.02)] = 2
    hip = (((ax - BOTTOM['hips']) / 0.012) ** 2 + ((y - BOTTOM['top'][1]) / 0.008) ** 2 < 1)
    ends = (np.abs(ax - BOTTOM['hips'] - 0.004) < 0.0028) & (y < BOTTOM['top'][1]) & (y > BOTTOM['top'][1] - 0.028)
    out[(hip | ends) & (y > 0.7) & (y < 0.95)] = 2
    return out


def skin_whole(raw, tone):
    """Her body's texture, her skin whole: where VRoid left it unpainted, see-through, or painted
    with underwear or socks, in her skin's `tone`."""
    px = load(raw)
    r, g, b, a = px[..., 0], px[..., 1], px[..., 2], px[..., 3]
    lum = px[..., :3].max(axis=-1)
    unpainted = (lum < 24) | (a <= 8)
    underwear = (r > g + 20) & (b > g + 10) & (np.abs(r - b) < 90) & (r < 200)
    socks = (lum > 150) & (lum - px[..., :3].min(axis=-1) < 14)
    px[unpainted | underwear | socks, :3] = tone
    px[..., 3] = 255
    return px


def paint(px, pos, uv, tris):
    """Her swimsuit painted on a texture (`pos`, `uv`, `tris`: the surface it is on), each texel by
    where on her body it is. Returns which texels are its fabric (1) and its trim and strings (2)."""
    h, w = px.shape[:2]
    colours = {1: hex_rgb(FABRIC), 2: hex_rgb(STRING)}
    kinds = np.zeros((h, w), dtype=np.uint8)
    for tri in tris:
        t = uv[tri] * [w, h]
        lo = np.floor(t.min(axis=0)).astype(int)
        hi = np.ceil(t.max(axis=0)).astype(int) + 1
        xs, ys = np.meshgrid(np.arange(max(0, lo[0]), min(w, hi[0])), np.arange(max(0, lo[1]), min(h, hi[1])))
        if not xs.size:
            continue
        q = np.column_stack([xs.ravel() + 0.5, ys.ravel() + 0.5])
        (ax_, ay_), (bx_, by_), (cx_, cy_) = t
        det = (by_ - cy_) * (ax_ - cx_) + (cx_ - bx_) * (ay_ - cy_)
        if abs(det) < 1e-9:
            continue
        l0 = ((by_ - cy_) * (q[:, 0] - cx_) + (cx_ - bx_) * (q[:, 1] - cy_)) / det
        l1 = ((cy_ - ay_) * (q[:, 0] - cx_) + (ax_ - cx_) * (q[:, 1] - cy_)) / det
        l2 = 1 - l0 - l1
        # (Its edges' texels too: no gaps between triangles.)
        ok = (l0 > -0.02) & (l1 > -0.02) & (l2 > -0.02)
        if not ok.any():
            continue
        where = swimsuit(np.column_stack([l0, l1, l2])[ok] @ pos[tri])
        for kind, colour in colours.items():
            sel = where == kind
            px[ys.ravel()[ok][sel], xs.ravel()[ok][sel], :3] = colour
            kinds[ys.ravel()[ok][sel], xs.ravel()[ok][sel]] = kind
    return kinds


def with_shade(px, kinds, shade):
    """A texture and its shade texture (`shade`: her skin's shade colour, linear): her skin in it,
    her swimsuit a cool grey and a darker teal (not her skin's pink)."""
    dark = px.copy()
    lin = srgb_to_linear(px[..., :3]) * np.asarray(shade)
    dark[..., :3] = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.maximum(lin, 0) ** (1 / 2.4) - 0.055) * 255
    dark[kinds == 1, :3] = hex_rgb(FABRIC) * np.array([0.8, 0.82, 0.88])
    dark[kinds == 2, :3] = hex_rgb(STRING) * 0.75
    return png(px), png(dark)


def make(swimsuit, dest):
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

    # Which images to repaint: the colour and shade textures of her hair, brows, eyes and clothes
    # (or, in her swimsuit, her body).
    todo = {}
    if swimsuit:
        named = lambda prim, *tokens: any(t in materials[prim['material']]['name'] for t in tokens)
        # (Her T-shirt's front: the shape of her bust, which VRoid left out of her body under it.)
        shirt_prim = next(p for m in gltf['meshes'] for p in m['primitives'] if named(p, 'Onepiece'))
        bust = accessor(gltf, binary, shirt_prim['attributes']['POSITION']).astype(np.float64)[accessor(gltf, binary, shirt_prim['indices']).reshape(-1, 3)]
        bust = bust[bust[:, :, 2].mean(axis=1) > 0]
        for mesh in gltf['meshes']:
            mesh['primitives'] = [p for p in mesh['primitives'] if not named(p, 'Tops', 'Bottoms', 'Onepiece', 'Shoes')]
        body_mesh = next(m for m in gltf['meshes'] if any(named(p, 'Body_00_SKIN') for p in m['primitives']))
        body_prim = next(p for p in body_mesh['primitives'] if named(p, 'Body_00_SKIN'))
        body_material = materials[body_prim['material']]
        body_material['alphaMode'] = 'OPAQUE'
        body_material.pop('alphaCutoff', None)
        attrs = body_prim['attributes']
        verts = {k: accessor(gltf, binary, i).copy() for k, i in attrs.items()}
        tris = accessor(gltf, binary, body_prim['indices']).reshape(-1, 3)
        # Her body's holes under her clothes closed: each torso loop (not her neck's, where her
        # head joins; not her wrists') fanned from a point in its middle, a mesh of its own (each
        # point moving as a vertex of its loop does), its texture round her like a cylinder's.
        mtoon = body_material['extensions']['VRMC_materials_mtoon']
        shade = mtoon['shadeColorFactor'][:3]
        ref = body_material['pbrMetallicRoughness']['baseColorTexture']
        source = gltf['textures'][ref['index']]['source']
        view = gltf['bufferViews'][gltf['images'][source]['bufferView']]
        raw = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        # (Her skin's tone: as painted on the fronts of her thighs, never under her clothes.)
        painted = load(raw)
        size = np.array(painted.shape[1::-1])
        p = verts['POSITION']
        thighs = verts['TEXCOORD_0'][(p[:, 1] > 0.55) & (p[:, 1] < 0.68) & (p[:, 2] > 0.02)]
        tone = np.median(painted[np.clip((thighs[:, 1] * size[1]).astype(int), 0, size[1] - 1), np.clip((thighs[:, 0] * size[0]).astype(int), 0, size[0] - 1), :3], axis=0)
        body_px = skin_whole(raw, tone)
        fill = {k: [] for k in verts}
        fans = []
        rings = 6
        for loop in holes(verts['POSITION'], tris):
            centre = verts['POSITION'][loop].mean(axis=0)
            if not (0.95 <= centre[1] <= 1.33 and abs(centre[0]) <= 0.3) or len(loop) > 120:
                continue
            n = len(loop)
            start = len(fill['POSITION'])
            edge = verts['POSITION'][loop].astype(np.float64)
            # Rings in from its edge to its middle; each point on her front as far forward as her
            # T-shirt was there (a little inside it), moving as the nearest vertex of its edge does.
            for r in range(rings):
                t = r / rings
                pts = edge + (centre - edge) * t
                if r:
                    pts[:, 2] = np.maximum(pts[:, 2], front_of(bust, pts) - 0.003)
                fill['POSITION'] += list(pts.astype(np.float32))
                for k in verts:
                    if k != 'POSITION':
                        fill[k] += list(verts[k][loop])
            mid = centre.astype(np.float64).copy()
            mid[2] = max(mid[2], front_of(bust, mid[None])[0] - 0.003)
            fill['POSITION'].append(mid.astype(np.float32))
            for k in verts:
                if k != 'POSITION':
                    fill[k].append(verts[k][loop[0]])
            for r in range(rings - 1):
                for i in range(n):
                    a, b = start + r * n + i, start + r * n + (i + 1) % n
                    fans += [(a, a + n, b), (b, a + n, b + n)]
            last = start + (rings - 1) * n
            fans += [(start + rings * n, last + (i + 1) % n, last + i) for i in range(n)]

        def textured(name, base, dark):
            """A texture and its shade texture added: their indices."""
            out = []
            for suffix, image in (('', base), ('Shade', dark)):
                gltf['images'].append({'bufferView': data(image), 'mimeType': 'image/png', 'name': name + suffix})
                gltf['textures'].append({**gltf['textures'][body_material['pbrMetallicRoughness']['baseColorTexture']['index']], 'source': len(gltf['images']) - 1})
                out.append(len(gltf['textures']) - 1)
            return out

        if fans:
            fill = {k: np.asarray(v, dtype=verts[k].dtype) for k, v in fill.items()}
            fans = np.array(fans, dtype=np.uint32)
            # (Each triangle facing out from her middle.)
            q = fill['POSITION'].astype(np.float64)[fans]
            out = q.mean(axis=1) * [1, 0, 1]
            inward = np.einsum('ij,ij->i', np.cross(q[:, 1] - q[:, 0], q[:, 2] - q[:, 0]), out) < 0
            fans[inward] = fans[inward][:, ::-1]
            fill['NORMAL'] = vertex_normals(fill['POSITION'], fans).astype(np.float32)
            p = fill['POSITION'].astype(np.float64)
            fill['TEXCOORD_0'] = np.column_stack([np.arctan2(p[:, 0], p[:, 2]) / (2 * np.pi) + 0.5, np.clip((1.4 - p[:, 1]) / 0.6, 0, 1)]).astype(np.float32)
            px = np.zeros((512, 512, 4), dtype=np.float32)
            px[..., :3], px[..., 3] = tone, 255
            base_tex, dark_tex = textured('Mio_SkinPatch', *with_shade(px, paint(px, p, fill['TEXCOORD_0'], fans), shade))
            materials.append({
                **{k: v for k, v in body_material.items() if k not in ('name', 'pbrMetallicRoughness', 'extensions')},
                'name': 'Mio_SkinPatch',
                'pbrMetallicRoughness': {**body_material['pbrMetallicRoughness'], 'baseColorTexture': {'index': base_tex}},
                'extensions': {**body_material['extensions'], 'VRMC_materials_mtoon': {**mtoon, 'shadeMultiplyTexture': {'index': dark_tex}, 'shadeColorFactor': [1, 1, 1], 'outlineWidthMode': 'none', 'outlineWidthFactor': 0}},
            })
            body_mesh['primitives'].append({
                'attributes': {k: add_accessor(v, {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[v.shape[1]], {np.dtype(np.float32): 5126, np.dtype(np.uint16): 5123, np.dtype(np.uint8): 5121}[v.dtype], 34962, minmax=k == 'POSITION') for k, v in fill.items()},
                'indices': add_accessor(fans.ravel(), 'SCALAR', 5125, 34963), 'material': len(materials) - 1, 'mode': 4,
            })
        # Her body's texture repainted, with a shade texture of its own (her swimsuit not shaded in
        # her skin's pink).
        base, dark = with_shade(body_px, paint(body_px, verts['POSITION'].astype(np.float64), verts['TEXCOORD_0'], tris), shade)
        todo[source] = lambda raw: base
        dark_tex = textured('Mio_BodyShade', dark, dark)[1]
        mtoon['shadeMultiplyTexture'] = {'index': dark_tex}
        mtoon['shadeColorFactor'] = [1, 1, 1]

    for m in materials:
        refs = [m.get('pbrMetallicRoughness', {}).get('baseColorTexture'), m.get('extensions', {}).get('VRMC_materials_mtoon', {}).get('shadeMultiplyTexture')]
        for ref in filter(None, refs):
            if ref['index'] == texture['index']:
                continue
            source = gltf['textures'][ref['index']]['source']
            for token, repaint in {'Tops': lambda raw: recolored(raw, *CARDIGAN), 'Onepiece': shirt, 'Bottoms': lambda raw: recolored(raw, *SHORTS), 'Shoes': shoes}.items():
                if token in m['name'] and not swimsuit:
                    todo[source] = repaint
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
    vrm_character.write_glb(dest, gltf, bytes(out))
    print(f'{dest}: {len(todo)} textures repainted, her long hair added ({len(pos)} points){", her swimsuit painted on" if swimsuit else ""}')


if __name__ == '__main__':
    make(False, 'public/characters/mio.glb')
    make(True, 'public/characters/mio-swimsuit.glb')
