"""Mixamo's X Bot and Y Bot made the app's mannequin (lib/bots.ts), in Blender.

    blender -b --python scripts/mannequin/bots.py -- <Y Bot.fbx> <X Bot.fbx> lib/bots.ts

Each bot is made half as fine; its arms are lowered to hang at its sides (the mannequin's rest: its limbs along their
joints' −y) and made its rest pose; its two meshes (the surface and the joint bands) are joined,
keeping which is which; each vertex's weights are put on the mannequin's joints (its 22, #30: the upper chest, the
shoulders and the toes too; and its fingers' segments), the four largest kept; its joints' places are taken from its bones. All in the app's
axes (y up, facing +z), in metres, its feet on the floor. Written as one TypeScript module: its
numbers in a base64 string each (positions as 16-bit fractions of its bounds).
"""
import base64
import json
import struct
import sys

import bpy
from mathutils import Vector

FINGERS = {'Thumb': 'Thumb', 'Index': 'Index', 'Middle': 'Middle', 'Ring': 'Ring', 'Pinky': 'Little'}


def target(group):
    """The mannequin's part a Mixamo bone's weights go to (None: none)."""
    n = group.replace('mixamorig:', '')
    for side, ours in (('Left', 'left'), ('Right', 'right')):
        if not n.startswith(side):
            continue
        rest = n[len(side):]
        if rest in ('Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End'):
            return ours + {'Shoulder': 'Shoulder', 'Arm': 'UpperArm', 'ForeArm': 'LowerArm', 'Hand': 'Hand', 'UpLeg': 'UpperLeg', 'Leg': 'LowerLeg', 'Foot': 'Foot'}.get(rest, 'Toes')
        for theirs, finger in FINGERS.items():
            if rest.startswith('Hand' + theirs):
                return f'{ours}{finger}{min(2, int(rest[-1]) - 1)}'
    return {'Hips': 'hips', 'Spine': 'spine', 'Spine1': 'chest', 'Spine2': 'upperChest', 'Neck': 'neck', 'Head': 'head', 'HeadTop_End': 'head'}.get(n)


TARGETS = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head']
for s in ('left', 'right'):
    TARGETS += [f'{s}Shoulder', f'{s}UpperArm', f'{s}LowerArm', f'{s}Hand', f'{s}UpperLeg', f'{s}LowerLeg', f'{s}Foot', f'{s}Toes']
    TARGETS += [f'{s}{f}{i}' for f in FINGERS.values() for i in range(3)]

# The places the mannequin takes from the bones (theirs → ours).
PLACES = {'Hips': 'hips', 'Spine': 'spine', 'Spine1': 'chest', 'Spine2': 'upperChest', 'Neck': 'neck', 'Head': 'head', 'HeadTop_End': 'headTop'}
for side, ours in (('Left', 'left'), ('Right', 'right')):
    PLACES.update({f'{side}Shoulder': f'{ours}Shoulder', f'{side}Arm': f'{ours}UpperArm', f'{side}ForeArm': f'{ours}LowerArm', f'{side}Hand': f'{ours}Hand',
                   f'{side}UpLeg': f'{ours}UpperLeg', f'{side}Leg': f'{ours}LowerLeg', f'{side}Foot': f'{ours}Foot',
                   f'{side}ToeBase': f'{ours}Toes', f'{side}Toe_End': f'{ours}ToesEnd'})
    for theirs, finger in FINGERS.items():
        for i in range(4):
            PLACES[f'{side}Hand{theirs}{i + 1}'] = f'{ours}{finger}{i}'


def app(v):
    """Blender's axes (z up, facing −y) → the app's (y up, facing +z)."""
    return (v.x, v.z, -v.y)


def bot(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # In metres (the armature is scaled to a hundredth): applied to it and its meshes.
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # The arms lowered to the sides (turned the least way: the palms then face the body), made the rest.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for side in ('Left', 'Right'):
        pb = arm.pose.bones[f'mixamorig:{side}Arm']
        bpy.context.view_layer.update()
        q = (pb.tail - pb.head).normalized().rotation_difference(Vector((0, 0, -1)))
        m = pb.matrix.copy()
        head = m.translation.copy()
        turned = q.to_matrix().to_4x4() @ m
        turned.translation = head
        pb.matrix = turned
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        mod = next(m for m in o.modifiers if m.type == 'ARMATURE')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Half as many faces (as light as the mannequin was, and its file half the size).
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new('Fewer', 'DECIMATE')
        mod.ratio = 0.5
        bpy.ops.object.modifier_apply(modifier=mod.name)
    places = {PLACES[b.name.replace('mixamorig:', '')]: app(b.head_local) for b in arm.data.bones if b.name.replace('mixamorig:', '') in PLACES}
    positions, skins, rings, triangles = [], [], [], []
    for o in meshes:
        ring = 1 if 'Joints' in o.name else 0
        names = {g.index: target(g.name) for g in o.vertex_groups}
        base = len(positions)
        for v in o.data.vertices:
            positions.append(app(v.co))
            w = {}
            for g in v.groups:
                t = names.get(g.group)
                if t and g.weight > 0:
                    w[t] = w.get(t, 0) + g.weight
            top = sorted(w.items(), key=lambda kv: -kv[1])[:4] or [('hips', 1.0)]
            total = sum(x for _, x in top)
            q = [round(255 * x / total) for _, x in top]
            q[0] += 255 - sum(q)
            skins.append([(TARGETS.index(t), q[i]) for i, (t, _) in enumerate(top)])
            rings.append(ring)
        for p in o.data.polygons:
            vs = list(p.vertices)
            for i in range(1, len(vs) - 1):
                triangles.append((base + vs[0], base + vs[i], base + vs[i + 1]))
    lo = [min(p[i] for p in positions) for i in range(3)]
    size = [max(p[i] for p in positions) - lo[i] for i in range(3)]
    out = bytearray()
    for p in positions:
        out += struct.pack('<3H', *(round(65535 * (p[i] - lo[i]) / size[i]) for i in range(3)))
    for t in triangles:
        out += struct.pack('<3H', *t)
    for s in skins:
        s = s + [(0, 0)] * (4 - len(s))
        out += bytes(i for i, _ in s) + bytes(w for _, w in s)
    out += bytes(rings)
    # The hips' half-width just below the hips joint (where a hand on the hip rests).
    hy = places['hips'][1] - 0.02
    hips = TARGETS.index('hips')
    hip = max(abs(p[0]) for p, s in zip(positions, skins) if s[0][0] == hips and abs(p[1] - hy) < 0.015)
    return {
        'height': max(p[1] for p in positions), 'vertices': len(positions), 'triangles': len(triangles),
        'min': lo, 'size': size, 'hipHalfWidth': hip,
        'joints': {k: [round(x, 5) for x in v] for k, v in sorted(places.items())},
        'data': base64.b64encode(bytes(out)).decode(),
    }


def main():
    y_bot, x_bot, out = sys.argv[sys.argv.index('--') + 1:]
    bots = {'male': bot(y_bot), 'female': bot(x_bot)}
    with open(out, 'w') as f:
        f.write('// Generated by scripts/mannequin/bots.py from Adobe Mixamo\'s Y Bot (a man) and X Bot (a woman). Do not edit.\n')
        f.write(f'export const BOT_TARGETS = {json.dumps(TARGETS)} as const;\n\n')
        f.write('interface BotData {\n  height: number;\n  vertices: number;\n  triangles: number;\n  min: number[];\n  size: number[];\n  hipHalfWidth: number;\n  joints: Record<string, number[]>;\n  data: string;\n}\n\n')
        f.write('export const BOTS: Record<\'male\' | \'female\', BotData> = ' + json.dumps(bots, indent=1) + ';\n')
    for k, b in bots.items():
        print('BOT', k, b['vertices'], 'vertices', b['triangles'], 'triangles', round(b['height'], 3), 'm', len(b['data']) // 1024, 'KB')


main()
