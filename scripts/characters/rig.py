"""A static figure (no skeleton) rigged as one of the app's characters, in Blender.

    blender -b --python scripts/characters/rig.py -- <id> <model.glb> <out.glb>

For figures that come as one mesh only (Sketchfab's, CC BY): its parts joined and welded and made
lighter; a skeleton with our bones' names put where the figure's joints are (found by eye from
views of it, below, in Blender's axes: z up, the figure facing -y); the mesh weighted to it
(Blender's automatic weights); its textures fitted within 1024 px, only their colours kept (the
app draws nothing else). The result is imported in the app as a user would
(scripts/characters/import.ts), which makes it a built-in.
"""
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

FIGURES = {
    # "Male body base mesh (highpoly)" by Mandrake (mandrake_3d), CC BY 4.0: one body cut in five
    # parts, 7.3 units tall (made 1.8 m), in an A-pose.
    'male-base': {
        'size': (0.24624, 5.469),
        'faces': 40_000,
        'joints': {
            'hips': (0.0, -0.08, 0.98), 'spine': (0.0, -0.07, 1.1), 'chest': (0.0, -0.07, 1.22), 'upperChest': (0.0, -0.07, 1.34),
            'neck': (0.0, -0.06, 1.52), 'head': (0.0, -0.07, 1.6), 'headEnd': (0.0, -0.08, 1.8),
            'leftShoulder': (0.04, -0.06, 1.47), 'leftUpperArm': (0.18, -0.07, 1.43), 'leftLowerArm': (0.33, -0.11, 1.12),
            'leftHand': (0.47, -0.17, 0.95), 'leftHandEnd': (0.5, -0.2, 0.8),
            'rightShoulder': (-0.04, -0.06, 1.47), 'rightUpperArm': (-0.18, -0.07, 1.43), 'rightLowerArm': (-0.33, -0.11, 1.12),
            'rightHand': (-0.47, -0.17, 0.95), 'rightHandEnd': (-0.5, -0.2, 0.8),
            'leftUpperLeg': (0.09, -0.08, 0.92), 'leftLowerLeg': (0.13, -0.07, 0.5), 'leftFoot': (0.17, -0.03, 0.08), 'leftToes': (0.2, -0.2, 0.02),
            'rightUpperLeg': (-0.09, -0.08, 0.92), 'rightLowerLeg': (-0.13, -0.07, 0.5), 'rightFoot': (-0.17, -0.03, 0.08), 'rightToes': (-0.2, -0.2, 0.02),
        },
    },
}

# Each bone: (its parent, the joint its tail is at).
BONES = {
    'hips': (None, 'spine'), 'spine': ('hips', 'chest'), 'chest': ('spine', 'upperChest'), 'upperChest': ('chest', 'neck'),
    'neck': ('upperChest', 'head'), 'head': ('neck', 'headEnd'),
}
for s in ('left', 'right'):
    BONES.update({
        f'{s}Shoulder': ('upperChest', f'{s}UpperArm'), f'{s}UpperArm': (f'{s}Shoulder', f'{s}LowerArm'),
        f'{s}LowerArm': (f'{s}UpperArm', f'{s}Hand'), f'{s}Hand': (f'{s}LowerArm', f'{s}HandEnd'),
        f'{s}UpperLeg': ('hips', f'{s}LowerLeg'), f'{s}LowerLeg': (f'{s}UpperLeg', f'{s}Foot'), f'{s}Foot': (f'{s}LowerLeg', f'{s}Toes'),
    })

MAX = 1024

ZOOM = 10

def weld(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data)
    bm.free()


def skeleton(joints, scale):
    arm = bpy.data.objects.new('Armature', bpy.data.armatures.new('Armature'))
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (_parent, tail) in BONES.items():
        b = arm.data.edit_bones.new(name)
        b.head, b.tail = joints[name] * scale, joints[tail] * scale
    for name, (parent, _tail) in BONES.items():
        if parent:
            arm.data.edit_bones[name].parent = arm.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def filled(o, arm):
    """Vertices the automatic weights missed: on the two nearest bones, the nearer the more."""
    segs = [(b.name, b.head_local, b.tail_local) for b in arm.data.bones]
    for name, _a, _b in segs:
        if not o.vertex_groups.get(name):
            o.vertex_groups.new(name=name)
    for v in o.data.vertices:
        if sum(g.weight for g in v.groups) > 1e-3:
            continue
        (d0, n0), (d1, n1) = sorted((gap(v.co, a, b), n) for n, a, b in segs)[:2]
        w0 = 1.0 if d0 < 1e-6 else 1 / d0 ** 4 / (1 / d0 ** 4 + 1 / d1 ** 4)
        o.vertex_groups[n0].add([v.index], w0, 'REPLACE')
        o.vertex_groups[n1].add([v.index], 1 - w0, 'REPLACE')


def gap(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (a + ab * t - p).length


def main():
    figure_id, src, out = sys.argv[sys.argv.index('--') + 1:]
    spec = FIGURES[figure_id]
    joints = {k: Vector(v) for k, v in spec['joints'].items()}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    # Its parts as one mesh, in metres, its feet on the floor, welded, lighter.
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [o for o in bpy.context.scene.objects if o.type == 'EMPTY']:
        bpy.data.objects.remove(o)
    k, lift = spec['size']
    for o in meshes:
        o.data.transform(Matrix.Scale(k, 4) @ Matrix.Translation((0, 0, lift)))
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = 'Body'
    weld(body)
    lighter(body, spec['faces'])

    # Weighted to the skeleton where its joints are (Blender's automatic weights, at ten times the
    # size: they fail on small ones).
    arm = skeleton(joints, ZOOM)
    body.data.transform(Matrix.Scale(ZOOM, 4))
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    filled(body, arm)
    body.data.transform(Matrix.Scale(1 / ZOOM, 4))
    for m in list(body.modifiers):
        body.modifiers.remove(m)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=1e-3)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.data.objects.remove(arm)
    arm = skeleton(joints, 1)
    body.parent = arm
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm

    colours_only()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_skins=True,
                              export_animations=False, export_morph=False, export_image_format='JPEG')
    print('RIGGED', out, len(body.data.vertices), 'vertices', len(body.data.polygons), 'faces')


def lighter(o, faces):
    """At most `faces` faces."""
    if len(o.data.polygons) > faces:
        mod = o.modifiers.new('Fewer', 'DECIMATE')
        mod.ratio = faces / len(o.data.polygons)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)


def colours_only():
    """Each material's colour texture (fitted within MAX px) and its glow; no normal or roughness maps."""
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nodes, links = m.node_tree.nodes, m.node_tree.links
        bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        for name in ('Normal', 'Metallic', 'Roughness'):
            for link in list(bsdf.inputs[name].links):
                links.remove(link)
        bsdf.inputs['Metallic'].default_value = 0
        bsdf.inputs['Roughness'].default_value = 0.8
    for img in bpy.data.images:
        if max(img.size) > MAX:
            k = MAX / max(img.size)
            img.scale(max(1, round(img.size[0] * k)), max(1, round(img.size[1] * k)))


main()
