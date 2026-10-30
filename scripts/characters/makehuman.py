"""The built-in Man, Woman and women in dresses, made with MakeHuman (MPFB in Blender), all CC0.

    blender -b --python scripts/characters/makehuman.py -- <out dir> [man|woman|qipao|satin-dress|party-dress|office ...]

Each is MakeHuman's base mesh shaped by its macro settings (Chinese, a young adult with ideal
proportions) and by targets for a face and body found beautiful in
China (below), made its height (the woman 1.70 m, the man 1.80 m), rigged with MakeHuman's Mixamo-named skeleton,
with eyes, brows, lashes, hair and fitted clothes from MakeHuman's system assets (CC0: copied into
MPFB's user data, ~/.config/blender/4.0/mpfb/data). Its materials made plain for glTF: the skin
one colour, the rest their colour textures (fitted within 512 px), cut out where they show
through. The GLBs are then imported in the app as a user would (scripts/characters/import.ts),
which makes them built-ins.
"""
import os
import sys

import addon_utils
import bpy
import math

import bmesh
import numpy as np
from mathutils import Vector, kdtree

addon_utils.enable('mpfb', default_set=True)
from mpfb.services.humanservice import HumanService  # noqa: E402
from mpfb.services.locationservice import LocationService  # noqa: E402
from mpfb.services.targetservice import TargetService  # noqa: E402

DATA = LocationService.get_user_data()
TARGETS = LocationService.get_mpfb_data('targets')


def both(name, w):
    """A target on both sides (l- and r-)."""
    return [(name.replace('{s}', 'l'), w), (name.replace('{s}', 'r'), w)]


# Faces: what makes them so, by MakeHuman's face targets (folder/name, weight).
# Faces found beautiful in China (MakeHuman's face targets: folder/name, weight). The woman: an
# oval face narrowing to a small V chin (瓜子脸), big eyes with a double fold, a slim straight nose
# with a raised bridge, a small full mouth. The man: a clean jaw, straight brows (剑眉), a high
# straight nose.
WOMAN_FACE = [
    ('head/head-oval', 0.8), ('head/head-scale-horiz-decr', 0.25), ('chin/chin-triangle', 0.5), ('chin/chin-width-decr', 0.5),
    ('chin/chin-prominent-incr', 0.2), ('chin/chin-jaw-drop-decr', 0.2),
    *both('cheek/{s}-cheek-bones-decr', 0.4), *both('cheek/{s}-cheek-volume-decr', 0.3),
    *both('eyes/{s}-eye-scale-incr', 0.35), *both('eyes/{s}-eye-height2-incr', 0.4), *both('eyes/{s}-eye-eyefold-up', 0.5),
    *both('eyes/{s}-eye-epicanthus-out', 0.4), *both('eyes/{s}-eye-corner2-up', 0.15),
    ('nose/nose-scale-horiz-decr', 0.35), ('nose/nose-point-width-decr', 0.45), ('nose/nose-nostrils-width-decr', 0.4),
    ('nose/nose-hump-decr', 0.4), ('nose/nose-scale-depth-incr', 0.3), ('nose/nose-point-up', 0.15),
    ('mouth/mouth-scale-horiz-decr', 0.25), ('mouth/mouth-upperlip-volume-incr', 0.2), ('mouth/mouth-lowerlip-volume-incr', 0.3),
    ('mouth/mouth-cupidsbow-incr', 0.4), ('mouth/mouth-angles-up', 0.3), ('eyebrows/eyebrows-angle-up', 0.1),
]
MAN_FACE = [
    ('head/head-oval', 0.5), ('chin/chin-prominent-incr', 0.35), ('chin/chin-width-decr', 0.25), ('chin/chin-height-incr', 0.2),
    *both('cheek/{s}-cheek-volume-decr', 0.4),
    *both('eyes/{s}-eye-scale-incr', 0.2), *both('eyes/{s}-eye-eyefold-up', 0.4), *both('eyes/{s}-eye-epicanthus-out', 0.3),
    ('nose/nose-scale-vert-incr', 0.25), ('nose/nose-scale-depth-incr', 0.35), ('nose/nose-hump-decr', 0.4),
    ('nose/nose-point-width-decr', 0.35), ('nose/nose-nostrils-width-decr', 0.3),
    ('mouth/mouth-cupidsbow-incr', 0.2), ('mouth/mouth-angles-up', 0.15), ('eyebrows/eyebrows-angle-up', 0.4),
]
# Bodies: long and slender, the shoulders narrow and low (a long neck), long legs.
SLENDER = [
    ('torso/measure-shoulder-dist-decr', 0.6), ('torso/torso-vshape-decr', 0.3), ('torso/measure-waist-circ-decr', 0.45),
    ('torso/measure-hips-circ-incr', 0.1), ('legs/measure-upperleg-height-incr', 0.35), ('legs/lowerlegs-height-incr', 0.3),
    ('legs/measure-thigh-circ-decr', 0.25), *both('arms/{s}-upperarm-fat-decr', 0.3),
    ('neck/neck-scale-vert-incr', 0.5), ('neck/measure-neck-circ-decr', 0.4),
]
# (Shoulders low and sloping, not squared and high: a long neck, small trapezius and deltoids.)
LEAN = [
    ('torso/measure-shoulder-dist-decr', 0.8), ('torso/torso-vshape-decr', 0.35), ('torso/torso-muscle-dorsi-decr', 0.5),
    ('torso/measure-waist-circ-decr', 0.25), ('legs/measure-upperleg-height-incr', 0.3), ('legs/lowerlegs-height-incr', 0.25),
    ('neck/neck-scale-vert-incr', 0.8), ('neck/measure-neck-circ-decr', 0.35), *both('arms/{s}-upperarm-shoulder-muscle-decr', 0.8),
]

ASIAN = {'asian': 0.85, 'caucasian': 0.15, 'african': 0.0}

PEOPLE = {
    'woman': {
        'macro': {'gender': 0.0, 'age': 0.45, 'muscle': 0.45, 'weight': 0.35, 'proportions': 1.0, 'height': 0.75, 'cupsize': 0.6, 'firmness': 0.75},
        'targets': WOMAN_FACE + SLENDER, 'height': 1.70,
        'skin': (0.97, 0.86, 0.79), 'eyebrows': 'eyebrow008', 'eyelashes': 'eyelashes02', 'hair': ('long01', (0.05, 0.04, 0.035)),
        'clothes': ['female_sportsuit01', 'shoes02'],
    },
    'man': {
        'macro': {'gender': 1.0, 'age': 0.45, 'muscle': 0.5, 'weight': 0.38, 'proportions': 1.0, 'height': 0.75, 'cupsize': 0.5, 'firmness': 0.5},
        'targets': MAN_FACE + LEAN, 'height': 1.80,
        'skin': (0.93, 0.8, 0.69), 'eyebrows': 'eyebrow002', 'eyelashes': 'eyelashes01', 'hair': ('short02', (0.05, 0.045, 0.04)),
        'clothes': ['male_casualsuit06', 'shoes01'],
    },
}



# Women in dresses (after the costume gallery's looks): the woman's face and a fuller figure.
GLAM = {'gender': 0.0, 'age': 0.45, 'muscle': 0.45, 'weight': 0.36, 'proportions': 1.0, 'height': 0.75, 'cupsize': 0.72, 'firmness': 0.8}
CURVES = [('torso/measure-hips-circ-incr', 0.25), ('torso/measure-waist-circ-decr', 0.6)]
SHEER_BLACK = (0.16, 0.14, 0.15)
SKIN_TONE = (0.97, 0.86, 0.79)


# Fabrics: textures made for these (scripts/characters/fabrics: gpt-image, tileable), wrapped round the body.
GEN = os.path.expanduser('~/materials/generated')


def fabric(name):
    path = os.path.join(GEN, name + '.png')
    return path if os.path.exists(path) else None


def stockings(color, to=0.47):
    return {'kind': 'top', 'name': 'Stockings', 'from': 0.045, 'to': to, 'color': color, 'offset': 0.003, 'smooth': 6}


def pumps(color):
    """Closed shoes over the feet (their toes smoothed into a toe box), opening a little below the ankle."""
    return {'kind': 'top', 'name': 'Shoes', 'from': -0.01, 'to': 0.036, 'color': color, 'offset': 0.008, 'smooth': 12, 'thick': 0.004}


PEOPLE.update({
    # A navy satin mini qipao with gold-hearted flowers, a high collar and cap sleeves; black stockings.
    'qipao': {
        'macro': GLAM, 'targets': WOMAN_FACE + SLENDER + CURVES, 'height': 1.70,
        'skin': SKIN_TONE, 'eyebrows': 'eyebrow008', 'eyelashes': 'eyelashes02', 'hair': ('long01', (0.05, 0.04, 0.035)), 'clothes': [],
        'outfit': [
            {'kind': 'top', 'name': 'Qipao', 'from': 0.5, 'to': 0.875, 'sleeves': 0.3, 'color': (0.1, 0.13, 0.32), 'texture': fabric('qipao-brocade')},
            {'kind': 'skirt', 'name': 'Qipao skirt', 'top': 0.56, 'hem': 0.45, 'flare': 1.02, 'color': (0.1, 0.13, 0.32), 'texture': fabric('qipao-brocade')},
            stockings(SHEER_BLACK, 0.47), pumps((0.06, 0.05, 0.05)),
        ],
    },
    # A pale blue satin slip dress to the knee (strapless here), bare legs, silver shoes.
    'satin-dress': {
        'macro': GLAM, 'targets': WOMAN_FACE + SLENDER + CURVES, 'height': 1.70,
        'skin': SKIN_TONE, 'eyebrows': 'eyebrow008', 'eyelashes': 'eyelashes02', 'hair': ('long01', (0.05, 0.04, 0.035)), 'clothes': [],
        'outfit': [
            {'kind': 'top', 'name': 'Dress', 'from': 0.55, 'to': 0.735, 'color': (0.56, 0.7, 0.86), 'texture': fabric('blue-satin')},
            {'kind': 'skirt', 'name': 'Dress skirt', 'top': 0.58, 'hem': 0.31, 'flare': 1.08, 'color': (0.56, 0.7, 0.86), 'texture': fabric('blue-satin')},
            pumps((0.78, 0.78, 0.8)),
        ],
    },
    # A black corset with a flared tulle mini skirt, sheer black stockings.
    'party-dress': {
        'macro': GLAM, 'targets': WOMAN_FACE + SLENDER + CURVES, 'height': 1.70,
        'skin': SKIN_TONE, 'eyebrows': 'eyebrow008', 'eyelashes': 'eyelashes02', 'hair': ('ponytail01', (0.05, 0.04, 0.035)), 'clothes': [],
        'outfit': [
            {'kind': 'top', 'name': 'Corset', 'from': 0.56, 'to': 0.74, 'color': (0.07, 0.06, 0.07), 'texture': fabric('black-lace')},
            {'kind': 'skirt', 'name': 'Tulle skirt', 'top': 0.58, 'hem': 0.44, 'flare': 1.5, 'color': (0.1, 0.09, 0.1)},
            stockings(SHEER_BLACK, 0.47), pumps((0.06, 0.05, 0.05)),
        ],
    },
    # A blush pink satin pencil dress with cap sleeves, to the knee; nude stockings.
    'office': {
        'macro': GLAM, 'targets': WOMAN_FACE + SLENDER + CURVES, 'height': 1.70,
        'skin': SKIN_TONE, 'eyebrows': 'eyebrow008', 'eyelashes': 'eyelashes02', 'hair': ('long01', (0.05, 0.04, 0.035)), 'clothes': [],
        'outfit': [
            {'kind': 'top', 'name': 'Dress', 'from': 0.55, 'to': 0.83, 'sleeves': 0.35, 'color': (0.89, 0.66, 0.7), 'texture': fabric('pink-tweed'), 'tile': 0.2},
            {'kind': 'skirt', 'name': 'Dress skirt', 'top': 0.58, 'hem': 0.32, 'flare': 0.97, 'color': (0.89, 0.66, 0.7), 'texture': fabric('pink-tweed'), 'tile': 0.2},
            stockings((0.9, 0.76, 0.68), 0.5), pumps((0.82, 0.62, 0.55)),
        ],
    },
})


def asset(kind, name):
    return os.path.join(DATA, kind, name, name + '.mhclo')


def plain(obj, color, image=None, alpha=False, tint=None, clear=None):
    """The object's material made glTF's own: a colour, or a colour texture (fitted within 512 px), cut out where clear."""
    mat = bpy.data.materials.new(obj.name + '.plain')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.8
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    if image:
        img = bpy.data.images.load(image)
        if max(img.size) > 512:
            s = 512 / max(img.size)
            img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))
        if tint or clear:
            px = np.array(img.pixels[:]).reshape(-1, 4)
            if tint:
                # (Its colour made this one, its light and shade kept: black hair from a fair one's texture.)
                lum = px[:, :3] @ np.array([0.299, 0.587, 0.114])
                px[:, :3] = np.array(tint)[None, :] + lum[:, None] * 0.22
            if clear:
                # (What is see-through in MakeHuman, drawn in one colour: an eye's cornea.)
                px[np.abs(px[:, :3] - np.array(clear)[None, :]).max(axis=1) < 0.08, 3] = 0
            img.pixels[:] = px.clip(0, 1).ravel()
            # (Saved as changed: packing would keep the file as it was.)
            img.filepath_raw = os.path.join(bpy.app.tempdir, obj.name + '.png')
            img.file_format = 'PNG'
            img.save()
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = img
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha:
            links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            mat.blend_method = 'CLIP'
            mat.alpha_threshold = 0.5
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def first_png(folder, prefer=('_diffuse.png', '.png')):
    for suffix in prefer:
        for f in sorted(os.listdir(folder)):
            if f.endswith(suffix) and not f.endswith(('_normal.png', '_ao.png', '_specular.png', '_bump.png')):
                return os.path.join(folder, f)
    return None



# ---------- dresses: made on the body ----------
#
# MakeHuman's clothes are a few casual suits; the women in dresses are dressed here instead: a
# garment's top (and stockings, shoes) a shell of the body's own surface over a part of it, a
# little out from the skin; a skirt a tube round both legs from the hips down (cut from the body's
# own width at each height), its hem as wide as a dress's. Both move with the body (the shell with
# its own weights, the tube with those of the body under it). Outfits after the gallery's (the
# looks only: its pictures are not used).

ARM = ('Arm', 'Hand', 'Shoulder')


def baked(obj):
    """Its vertices where its baked shape key has them (the mesh's own are the base mesh's, unshaped)."""
    keys = obj.data.shape_keys
    return [k.co.copy() for k in keys.key_blocks[-1].data] if keys else [v.co.copy() for v in obj.data.vertices]


def body_verts(body):
    """The body's own vertices (not the helpers'), with where each is and the bone it goes with most."""
    names = {g.index: g.name for g in body.vertex_groups}
    co = baked(body)
    out = []
    for v in body.data.vertices:
        gs = {names[g.group]: g.weight for g in v.groups}
        if gs.get('body', 0) < 0.5:
            continue
        bones = {n: w for n, w in gs.items() if n.startswith('mixamorig')}
        top = max(bones, key=bones.get) if bones else ''
        out.append((v.index, (body.matrix_world @ co[v.index]).copy(), top, bones))
    return out


def shell(body, keep, name, offset, planes=(), smooth=12, thick=0.003):
    """
    A copy of the body's surface over the vertices kept (their indices), cut clean by `planes`
    (point, normal: what lies beyond each goes), smoothed (cloth over the body, not its every
    bump), `offset` out from the skin and `thick` thick, so its edges are straight and have a body.
    """
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = name
    body.users_collection[0].objects.link(obj)
    co = baked(body)
    if obj.data.shape_keys:
        obj.shape_key_clear()
    for v, c in zip(obj.data.vertices, co):
        v.co = c
    for m in list(obj.modifiers):
        if m.type != 'ARMATURE':
            obj.modifiers.remove(m)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context='VERTS')
    for point, normal, near in planes:
        # (A cut across an arm cuts only round that arm: within `near` of its line.)
        def close(f):
            if not near:
                return True
            c = f.calc_center_median()
            o, d, r = near
            t = (c - o).dot(d)
            return (c - (o + d * t)).length < r and t > -0.12
        faces = [f for f in bm.faces if close(f)]
        geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=point, plane_no=normal, clear_outer=True)
    # (Bits the cuts left apart from the rest: gone.)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if len(f.verts) < 3], context='FACES')
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset
    bm.to_mesh(obj.data)
    bm.free()
    if thick:
        sol = obj.modifiers.new('Thickness', 'SOLIDIFY')
        sol.thickness = thick
        sol.offset = 1.0
    return obj


def hull(points):
    """The convex hull of 2D points, anticlockwise (Andrew's monotone chain)."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])  # noqa: E731
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def reach(poly, c, d):
    """How far from c a ray towards d leaves the polygon (0 if it misses)."""
    best = 0.0
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        ex, ey = x2 - x1, y2 - y1
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-12:
            continue
        t = ((x1 - c[0]) * ey - (y1 - c[1]) * ex) / den
        u = ((x1 - c[0]) * d[1] - (y1 - c[1]) * d[0]) / den
        if t > 0 and 0 <= u <= 1:
            best = max(best, t)
    return best


def skirt(body, rig, verts, top, hem, flare, name, sides=48, rows=16):
    """
    A tube round both legs from `top` down to `hem` (heights, m), `flare` times wider at the hem: at
    each height round the body's outline there (its convex hull, a centimetre out), never narrower
    than above it (it hangs from the hips), about one middle.
    """
    pts = [(p, bones) for _, p, b, bones in verts if not any(a in b for a in ARM)]
    near_top = [p for p, _ in pts if abs(p.z - top) < 0.015]
    c = (sum(p.x for p in near_top) / len(near_top), sum(p.y for p in near_top) / len(near_top))
    rings, weights = [], []
    last = [0.0] * sides
    for i in range(rows + 1):
        t = i / rows
        z = top + (hem - top) * t
        level = [(p, bones) for p, bones in pts if abs(p.z - z) < 0.015]
        poly = hull([(round(p.x, 4), round(p.y, 4)) for p, _ in level])
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            d = (math.cos(a), math.sin(a))
            r = max(reach(poly, c, d) + 0.012, last[k] if flare >= 1 else last[k] * 0.985)
            last[k] = r
            r *= 1 + (flare - 1) * t ** 1.5
            ring.append(Vector((c[0] + d[0] * r, c[1] + d[1] * r, z)))
            # Weighted as the body nearest it at that height.
            near = sorted(level, key=lambda q: (q[0].x - ring[-1].x) ** 2 + (q[0].y - ring[-1].y) ** 2)[:4]
            w = {}
            for _, bones in near:
                for n, x in bones.items():
                    w[n] = w.get(n, 0) + x / len(near)
            weights.append(w)
        rings.append(ring)
    me = bpy.data.meshes.new(name)
    coords = [c for ring in rings for c in ring]
    # (Facing out: round anticlockwise as seen from above, then down.)
    faces = [(i * sides + k, (i + 1) * sides + k, (i + 1) * sides + (k + 1) % sides, i * sides + (k + 1) % sides) for i in range(rows) for k in range(sides)]
    me.from_pydata([tuple(c) for c in coords], [], faces)
    uv = me.uv_layers.new()
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            k, i = vi % sides, vi // sides
            uv.data[li].uv = (k / sides, 1 - i / rows)
    me.update()
    obj = bpy.data.objects.new(name, me)
    body.users_collection[0].objects.link(obj)
    for n in {n for w in weights for n in w}:
        g = obj.vertex_groups.new(name=n)
        for vi, w in enumerate(weights):
            if n in w:
                g.add([vi], w[n], 'REPLACE')
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    return obj


def arm_axes(body, rig):
    """Each arm's shoulder joint and the way down it to the elbow (the body's space), and the upper arm's length."""
    out = []
    to_body = body.matrix_world.inverted() @ rig.matrix_world
    for side in ('Left', 'Right'):
        bone = lambda n: next(b for b in rig.data.bones if b.name.endswith(side + n))  # noqa: E731
        shoulder, elbow = to_body @ bone('Arm').head_local, to_body @ bone('ForeArm').head_local
        out.append((shoulder, (elbow - shoulder).normalized(), (elbow - shoulder).length))
    return out


def dress(body, rig, outfit):
    """The outfit's pieces made on the body (its heights are shares of the body's height)."""
    verts = body_verts(body)
    hidden = set()
    zs = [p.z for _, p, _, _ in verts]
    lo, h = min(zs), max(zs) - min(zs)
    at = lambda f: lo + f * h  # noqa: E731
    arms = arm_axes(body, rig)
    up, down = Vector((0, 0, 1)), Vector((0, 0, -1))
    made = []
    for piece in outfit:
        kind, color = piece['kind'], piece['color']
        image = piece.get('texture')
        if kind == 'skirt':
            o = skirt(body, rig, verts, at(piece['top']), at(piece['hem']), piece.get('flare', 1.0), piece['name'])
            sol = o.modifiers.new('Thickness', 'SOLIDIFY')
            sol.thickness, sol.offset = 0.003, 1.0
        else:
            a, b = at(piece['from']), at(piece['to'])
            # Sleeves: how far down the upper arm (0: cut at the shoulder; none: no arm at all, an armhole).
            sleeve = piece.get('sleeves', -0.12)
            cuts = [(Vector((0, 0, a)), down, None), (Vector((0, 0, b)), up, None)]
            # (Round the arms only for what reaches up to the shoulders: a strapless top's neckline
            # is straight all round, under the arms too.)
            if b > at(0.78):
                cuts += [(s + d * (sleeve * n), d, (s, d, 0.11)) for s, d, n in arms]

            def beyond(p, m):
                for c, n, near in cuts:
                    if near:
                        o, d, r = near
                        t = (p - o).dot(d)
                        if (p - (o + d * t)).length > r or t < -0.12:
                            continue
                    if (p - c).dot(n) > -m:
                        return True
                return False
            # (The arms' skin only for sleeves: a top without them leaves no flap under the arm.)
            keep = {i for i, p, bone, _ in verts if a - 0.03 <= p.z <= b + 0.03 and 'Hand' not in bone and 'ForeArm' not in bone and (sleeve > 0 or 'Arm' not in bone)}
            o = shell(body, keep, piece['name'], piece.get('offset', 0.01), cuts, piece.get('smooth', 12), piece.get('thick', 0.003))
            # (The skin well in from the cut, under the cloth, hidden: a face goes with any of its
            # corners, so a few centimetres keep the body whole wherever the cloth could leave a gap.)
            # (Never an arm's: no top covers the arm round the armpit.)
            hidden |= {i for i, p, bone, _ in verts if i in keep and 'Arm' not in bone and not beyond(p, 0.04)}
        plain(o, color, image)
        if image:
            wrap(o, piece.get('tile', 0.3))
        made.append(o)
    # The skin under the shells taken away (a mask), so that none shows through as the body bends.
    if hidden:
        under = body.vertex_groups.new(name='under-dress')
        under.add(list(hidden), 1.0, 'REPLACE')
        mask = body.modifiers.new('Under the dress', 'MASK')
        mask.vertex_group = 'under-dress'
        mask.invert_vertex_group = True
    return made


def wrap(obj, tile):
    """Its texture wrapped round the body (round it and up it), `tile` metres a repeat, its seam at the back."""
    me = obj.data
    uv = me.uv_layers.active or me.uv_layers.new()
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            p = me.vertices[vi].co
            a = math.atan2(p.x, -p.y)
            uv.data[li].uv = (a * 0.14 / tile, p.z / tile)


def scalp(body, hair, eyes, color):
    """
    The skin the hair grows from coloured as the hair (a second material on the body's faces right
    under it, none past its edge): MakeHuman's hair cards leave the scalp showing, a pale band.
    """
    tree = kdtree.KDTree(len(hair.data.vertices))
    for i, v in enumerate(hair.data.vertices):
        tree.insert(hair.matrix_world @ v.co, i)
    tree.balance()
    brow = max((eyes.matrix_world @ v.co).z for v in eyes.data.vertices)
    head = {i for i, p, bone, _ in body_verts(body) if 'Head' in bone and p.z > brow + 0.03 and tree.find(p)[2] < 0.01}
    mat = bpy.data.materials.new(body.name + '.scalp')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1.0)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    body.data.materials.append(mat)
    for poly in body.data.polygons:
        if all(v in head for v in poly.vertices):
            poly.material_index = len(body.data.materials) - 1



def build(who, out):
    spec = PEOPLE[who]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable('mpfb', default_set=True)
    macro = {**TargetService.get_default_macro_info_dict(), **spec['macro'], 'race': ASIAN}
    body = HumanService.create_human(macro_detail_dict=macro)
    for name, w in spec['targets']:
        TargetService.load_target(body, os.path.join(TARGETS, name + '.target.gz'), weight=w)
    rig = HumanService.add_builtin_rig(body, 'mixamo')
    parts = []
    eyes = HumanService.add_mhclo_asset(asset('eyes', 'high-poly'), body, asset_type='Eyes', subdiv_levels=0, material_type='MAKESKIN')
    plain(eyes, (1, 1, 1), os.path.join(DATA, 'eyes', 'materials', 'brown_eye.png'), alpha=True, clear=(0.72, 0.75, 1.0))
    # (Named for what they are: the app inks the eyes, brows and lashes, and draws the hair in one colour.)
    eyes.name = 'Human.eyes'
    parts.append(eyes)
    for kind, name in (('eyebrows', spec['eyebrows']), ('eyelashes', spec['eyelashes'])):
        o = HumanService.add_mhclo_asset(asset(kind, name), body, asset_type=kind.capitalize(), subdiv_levels=0, material_type='MAKESKIN')
        plain(o, (1, 1, 1), first_png(os.path.join(DATA, kind, name)), alpha=True, tint=(0.07, 0.055, 0.05))
        parts.append(o)
    hair, tint = spec['hair']
    o = HumanService.add_mhclo_asset(asset('hair', hair), body, asset_type='Hair', subdiv_levels=0, material_type='MAKESKIN')
    plain(o, (1, 1, 1), first_png(os.path.join(DATA, 'hair', hair)), alpha=True, tint=tint)
    o.name = 'Human.hair'
    parts.append(o)
    hair_mesh = o
    for name in spec['clothes']:
        o = HumanService.add_mhclo_asset(asset('clothes', name), body, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN')
        plain(o, (1, 1, 1), first_png(os.path.join(DATA, 'clothes', name)))
        parts.append(o)
    plain(body, spec['skin'])
    TargetService.bake_targets(body)
    scalp(body, hair_mesh, eyes, tuple(c + 0.02 for c in tint))
    parts += dress(body, rig, spec.get('outfit', []))
    # Its height (soles to the top of the head: the body's own vertices, not the helpers') made the one it should have.
    group = body.vertex_groups['body'].index
    co = baked(body)
    zs = [(body.matrix_world @ co[v.index]).z for v in body.data.vertices if any(g.group == group and g.weight > 0.5 for g in v.groups)]
    k = spec['height'] / (max(zs) - min(zs))
    rig.scale = (rig.scale[0] * k, rig.scale[1] * k, rig.scale[2] * k)
    bpy.context.view_layer.update()
    print(who, 'scaled', round(k, 3), 'to', spec['height'])
    # Only what is drawn: the helpers and what the clothes hide masked away, as exported.
    bpy.ops.object.select_all(action='DESELECT')
    for o in [rig, body, *parts]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(out, who + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_animations=False,
        export_morph=False, export_skins=True, export_image_format='AUTO',
    )
    print('wrote', path, os.path.getsize(path))


args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out_dir = args[0] if args else '/tmp'
for who in args[1:] or ['woman', 'man', 'qipao', 'satin-dress', 'party-dress', 'office']:
    build(who, out_dir)
