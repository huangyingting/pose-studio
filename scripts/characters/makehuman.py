"""The built-in Man, Woman and Child, made with MakeHuman (MPFB in Blender), all CC0.

    blender -b --python scripts/characters/makehuman.py -- <out dir> [man|woman|child ...]

Each is MakeHuman's base mesh shaped by its macro settings (East Asian, ideal proportions, a young
adult; a child of about eleven) and by face targets for a face found beautiful in East Asia (an
oval face with a slim V chin, bigger eyes with a fold over them, a small straight nose, full lips,
a long neck; the man's jaw and brows stronger), rigged with MakeHuman's Mixamo-named skeleton,
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
import numpy as np

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
WOMAN_FACE = [
    ('head/head-oval', 0.7), ('head/head-scale-horiz-decr', 0.15), ('chin/chin-width-decr', 0.5), ('chin/chin-triangle', 0.35),
    ('chin/chin-prominent-incr', 0.15), ('chin/chin-jaw-drop-decr', 0.2),
    *both('cheek/{s}-cheek-bones-decr', 0.3), *both('cheek/{s}-cheek-volume-decr', 0.2),
    *both('eyes/{s}-eye-scale-incr', 0.3), *both('eyes/{s}-eye-height2-incr', 0.35), *both('eyes/{s}-eye-eyefold-up', 0.4),
    *both('eyes/{s}-eye-corner2-up', 0.2), *both('eyes/{s}-eye-epicanthus-out', 0.3),
    ('nose/nose-scale-horiz-decr', 0.25), ('nose/nose-point-width-decr', 0.4), ('nose/nose-nostrils-width-decr', 0.3),
    ('nose/nose-hump-decr', 0.5), ('nose/nose-point-up', 0.2), ('nose/nose-scale-vert-incr', 0.1),
    ('mouth/mouth-scale-horiz-decr', 0.15), ('mouth/mouth-upperlip-volume-incr', 0.25), ('mouth/mouth-lowerlip-volume-incr', 0.3),
    ('mouth/mouth-cupidsbow-incr', 0.4), ('mouth/mouth-angles-up', 0.25),
    ('eyebrows/eyebrows-angle-up', 0.1), ('neck/neck-scale-vert-incr', 0.3), ('neck/measure-neck-circ-decr', 0.3),
]
MAN_FACE = [
    ('head/head-oval', 0.4), ('chin/chin-prominent-incr', 0.3), ('chin/chin-width-decr', 0.15), ('chin/chin-height-incr', 0.15),
    *both('cheek/{s}-cheek-volume-decr', 0.3),
    *both('eyes/{s}-eye-scale-incr', 0.15), *both('eyes/{s}-eye-eyefold-up', 0.3), *both('eyes/{s}-eye-corner2-up', 0.15),
    ('nose/nose-scale-vert-incr', 0.2), ('nose/nose-hump-decr', 0.4), ('nose/nose-point-width-decr', 0.3),
    ('nose/nose-nostrils-width-decr', 0.2),
    ('mouth/mouth-cupidsbow-incr', 0.2), ('mouth/mouth-angles-up', 0.15),
    ('eyebrows/eyebrows-angle-up', 0.35), ('eyebrows/eyebrows-trans-down', 0.1), ('neck/neck-scale-vert-incr', 0.15),
]
CHILD_FACE = [
    ('head/head-round', 0.3), ('chin/chin-width-decr', 0.2),
    *both('eyes/{s}-eye-scale-incr', 0.3), *both('eyes/{s}-eye-eyefold-up', 0.3),
    ('nose/nose-point-width-decr', 0.3), ('nose/nose-hump-decr', 0.4), ('mouth/mouth-angles-up', 0.3),
]

PEOPLE = {
    'woman': {
        'macro': {'gender': 0.0, 'age': 0.5, 'muscle': 0.5, 'weight': 0.42, 'proportions': 1.0, 'height': 0.55, 'cupsize': 0.62, 'firmness': 0.75},
        'face': WOMAN_FACE,
        'skin': (0.96, 0.84, 0.76), 'eyebrows': 'eyebrow008', 'eyelashes': 'eyelashes02', 'hair': ('ponytail01', (0.05, 0.04, 0.035)),
        'clothes': ['female_sportsuit01', 'shoes02'],
    },
    'man': {
        'macro': {'gender': 1.0, 'age': 0.5, 'muscle': 0.68, 'weight': 0.48, 'proportions': 1.0, 'height': 0.62, 'cupsize': 0.5, 'firmness': 0.5},
        'face': MAN_FACE,
        'skin': (0.92, 0.78, 0.66), 'eyebrows': 'eyebrow002', 'eyelashes': 'eyelashes01', 'hair': ('short02', (0.05, 0.045, 0.04)),
        'clothes': ['male_casualsuit04', 'shoes01'],
    },
    'child': {
        'macro': {'gender': 1.0, 'age': 0.1875, 'muscle': 0.5, 'weight': 0.45, 'proportions': 1.0, 'height': 0.5, 'cupsize': 0.5, 'firmness': 0.5},
        'face': CHILD_FACE,
        'skin': (0.97, 0.85, 0.76), 'eyebrows': 'eyebrow001', 'eyelashes': 'eyelashes01', 'hair': ('short01', (0.05, 0.045, 0.04)),
        'clothes': ['male_casualsuit01', 'shoes03'],
    },
}


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


def build(who, out):
    spec = PEOPLE[who]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable('mpfb', default_set=True)
    macro = {**TargetService.get_default_macro_info_dict(), **spec['macro'], 'race': {'asian': 1.0, 'caucasian': 0.0, 'african': 0.0}}
    body = HumanService.create_human(macro_detail_dict=macro)
    for name, w in spec['face']:
        TargetService.load_target(body, os.path.join(TARGETS, name + '.target.gz'), weight=w)
    rig = HumanService.add_builtin_rig(body, 'mixamo')
    parts = []
    eyes = HumanService.add_mhclo_asset(asset('eyes', 'high-poly'), body, asset_type='Eyes', subdiv_levels=0, material_type='MAKESKIN')
    plain(eyes, (1, 1, 1), os.path.join(DATA, 'eyes', 'materials', 'brown_eye.png'), alpha=True, clear=(0.72, 0.75, 1.0))
    parts.append(eyes)
    for kind, name in (('eyebrows', spec['eyebrows']), ('eyelashes', spec['eyelashes'])):
        o = HumanService.add_mhclo_asset(asset(kind, name), body, asset_type=kind.capitalize(), subdiv_levels=0, material_type='MAKESKIN')
        plain(o, (1, 1, 1), first_png(os.path.join(DATA, kind, name)), alpha=True, tint=(0.07, 0.055, 0.05))
        parts.append(o)
    hair, tint = spec['hair']
    o = HumanService.add_mhclo_asset(asset('hair', hair), body, asset_type='Hair', subdiv_levels=0, material_type='MAKESKIN')
    plain(o, (1, 1, 1), first_png(os.path.join(DATA, 'hair', hair)), alpha=True, tint=tint)
    parts.append(o)
    for name in spec['clothes']:
        o = HumanService.add_mhclo_asset(asset('clothes', name), body, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN')
        plain(o, (1, 1, 1), first_png(os.path.join(DATA, 'clothes', name)))
        parts.append(o)
    plain(body, spec['skin'])
    TargetService.bake_targets(body)
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
for who in args[1:] or ['woman', 'man', 'child']:
    build(who, out_dir)
