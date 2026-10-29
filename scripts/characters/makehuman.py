"""The built-in Man, Woman, Boy and Girl, made with MakeHuman (MPFB in Blender), all CC0.

    blender -b --python scripts/characters/makehuman.py -- <out dir> [man|woman|child|girl ...]

(The boy's file is child.glb: scenes know him by that.)

Each is MakeHuman's base mesh shaped by its macro settings (Chinese, a young adult with ideal
proportions; children of about eight) and by targets for a face and body found beautiful in
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
# Faces found beautiful in China (MakeHuman's face targets: folder/name, weight). The woman: an
# oval face narrowing to a small V chin (瓜子脸), big eyes with a double fold, a slim straight nose
# with a raised bridge, a small full mouth. The man: a clean jaw, straight brows (剑眉), a high
# straight nose. The children: round cheeks, big eyes, small noses.
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
CHILD_FACE = [
    ('head/head-round', 0.3), *both('cheek/{s}-cheek-volume-incr', 0.25),
    *both('eyes/{s}-eye-scale-incr', 0.45), *both('eyes/{s}-eye-eyefold-up', 0.4), *both('eyes/{s}-eye-epicanthus-out', 0.3),
    ('nose/nose-scale-horiz-decr', 0.3), ('nose/nose-point-width-decr', 0.35), ('nose/nose-hump-decr', 0.4),
    ('mouth/mouth-scale-horiz-decr', 0.2), ('mouth/mouth-angles-up', 0.35),
]
# Bodies: long and slender, the shoulders narrow and low (a long neck), long legs.
SLENDER = [
    ('torso/measure-shoulder-dist-decr', 0.6), ('torso/torso-vshape-decr', 0.3), ('torso/measure-waist-circ-decr', 0.45),
    ('torso/measure-hips-circ-incr', 0.1), ('legs/measure-upperleg-height-incr', 0.35), ('legs/lowerlegs-height-incr', 0.3),
    ('legs/measure-thigh-circ-decr', 0.25), *both('arms/{s}-upperarm-fat-decr', 0.3),
    ('neck/neck-scale-vert-incr', 0.5), ('neck/measure-neck-circ-decr', 0.4),
]
LEAN = [
    ('torso/measure-shoulder-dist-decr', 0.35), ('torso/measure-waist-circ-decr', 0.25),
    ('legs/measure-upperleg-height-incr', 0.3), ('legs/lowerlegs-height-incr', 0.25),
    ('neck/neck-scale-vert-incr', 0.35),
]
CHILD_BODY = [('torso/measure-shoulder-dist-decr', 0.3), ('neck/neck-scale-vert-incr', 0.2)]

ASIAN = {'asian': 0.85, 'caucasian': 0.15, 'african': 0.0}

PEOPLE = {
    'woman': {
        'macro': {'gender': 0.0, 'age': 0.45, 'muscle': 0.45, 'weight': 0.35, 'proportions': 1.0, 'height': 0.75, 'cupsize': 0.6, 'firmness': 0.75},
        'targets': WOMAN_FACE + SLENDER, 'height': 1.70,
        'skin': (0.97, 0.86, 0.79), 'eyebrows': 'eyebrow008', 'eyelashes': 'eyelashes02', 'hair': ('long01', (0.05, 0.04, 0.035)),
        'clothes': ['female_sportsuit01', 'shoes02'],
    },
    'man': {
        'macro': {'gender': 1.0, 'age': 0.45, 'muscle': 0.55, 'weight': 0.4, 'proportions': 1.0, 'height': 0.75, 'cupsize': 0.5, 'firmness': 0.5},
        'targets': MAN_FACE + LEAN, 'height': 1.80,
        'skin': (0.93, 0.8, 0.69), 'eyebrows': 'eyebrow002', 'eyelashes': 'eyelashes01', 'hair': ('short02', (0.05, 0.045, 0.04)),
        'clothes': ['male_casualsuit01', 'shoes01'],
    },
    # Children of about eight, a boy and a girl.
    'child': {
        'macro': {'gender': 1.0, 'age': 0.115, 'muscle': 0.5, 'weight': 0.45, 'proportions': 0.5, 'height': 0.5, 'cupsize': 0.5, 'firmness': 0.5},
        'targets': CHILD_FACE + CHILD_BODY, 'height': 1.28,
        'skin': (0.98, 0.87, 0.8), 'eyebrows': 'eyebrow001', 'eyelashes': 'eyelashes01', 'hair': ('short04', (0.05, 0.045, 0.04)),
        'clothes': ['male_casualsuit02', 'shoes03'],
    },
    'girl': {
        'macro': {'gender': 0.0, 'age': 0.11, 'muscle': 0.45, 'weight': 0.42, 'proportions': 0.5, 'height': 0.5, 'cupsize': 0.0, 'firmness': 0.5},
        'targets': CHILD_FACE + CHILD_BODY, 'height': 1.26,
        'skin': (0.98, 0.87, 0.8), 'eyebrows': 'eyebrow001', 'eyelashes': 'eyelashes02', 'hair': ('ponytail01', (0.05, 0.04, 0.035)),
        'clothes': ['female_casualsuit02', 'shoes02'],
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
    macro = {**TargetService.get_default_macro_info_dict(), **spec['macro'], 'race': ASIAN}
    body = HumanService.create_human(macro_detail_dict=macro)
    for name, w in spec['targets']:
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
    # Its height (soles to the top of the head: the body's own vertices, not the helpers') made the one it should have.
    group = body.vertex_groups['body'].index
    zs = [(body.matrix_world @ v.co).z for v in body.data.vertices if any(g.group == group and g.weight > 0.5 for g in v.groups)]
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
for who in args[1:] or ['woman', 'man', 'child', 'girl']:
    build(who, out_dir)
