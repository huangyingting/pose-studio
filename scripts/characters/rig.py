"""A static figure (no skeleton) rigged as one of the app's characters, in Blender.

    blender -b --python scripts/characters/rig.py -- <id> <model.glb> <out.glb>

For figures that come as a mesh only (Sketchfab's, CC BY; ones made with Meshy): what is not the person goes (a rifle
held); the pieces are joined and their seams welded; a skeleton with our bones' names is put where
the figure's joints are (found by eye from views of it, below, in Blender's axes: z up, the figure
facing -y); the mesh is weighted to it (Blender's automatic weights); arms held bent are
straightened at the elbow and raised level (a T-pose: a held pose's arms would turn the wrong way
round the bone as the app swings them); the mesh is reduced, its textures fitted within 1024 px
and only their colours kept (the app draws nothing else). The result is imported in the app as a
user would (scripts/characters/import.ts), which makes it a built-in.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

FIGURES = {
    # "S.W.A.T. Operator" by SpatialNeglect (jeandiz), CC BY 4.0: its rifle (Mesh_4, the g2–g5 parts) taken out.
    'swat-operator': {
        'drop': ['Mesh_4', 'Mesh_18', 'Mesh_19', 'Mesh_20', 'Mesh_21'],
        'faces': 60_000,
        'tpose': True,
        # What each piece follows (the rest: the torso's gear, the vest, its pouches and straps).
        'pieces': {
            'head': ['Mesh_9', 'Mesh_16', 'Mesh_17', 'Mesh_40', 'Mesh_41'],
            'leftHand': ['Mesh_14'], 'rightHand': ['Mesh_15'],
            'leftLeg': ['Mesh_35'], 'rightLeg': ['Mesh_22'], 'leftFoot': ['Mesh_6'], 'rightFoot': ['Mesh_5'],
            'body': ['Mesh_39'], 'rightUpperArm': ['Mesh_7'],
        },
        'joints': {
            'hips': (0.03, 0.0, 0.97), 'spine': (0.025, 0.0, 1.08), 'chest': (0.02, 0.0, 1.2), 'upperChest': (0.015, 0.0, 1.33),
            'neck': (0.02, -0.02, 1.55), 'head': (0.03, -0.04, 1.63), 'headEnd': (0.035, -0.05, 1.84),
            'leftShoulder': (0.06, 0.0, 1.5), 'leftUpperArm': (0.2, 0.0, 1.44), 'leftLowerArm': (0.31, -0.07, 1.2),
            'leftHand': (0.235, -0.215, 1.06), 'leftHandEnd': (0.19, -0.35, 1.02),
            'rightShoulder': (-0.01, 0.0, 1.5), 'rightUpperArm': (-0.2, 0.0, 1.44), 'rightLowerArm': (-0.31, -0.03, 1.22),
            'rightHand': (-0.215, -0.155, 1.17), 'rightHandEnd': (-0.04, -0.2, 1.12),
            'leftUpperLeg': (0.12, -0.02, 0.92), 'leftLowerLeg': (0.152, -0.135, 0.5), 'leftFoot': (0.163, -0.12, 0.1), 'leftToes': (0.23, -0.29, 0.03),
            'rightUpperLeg': (-0.065, 0.0, 0.92), 'rightLowerLeg': (-0.09, 0.0, 0.5), 'rightFoot': (-0.092, 0.1, 0.1), 'rightToes': (-0.22, 0.0, 0.03),
        },
    },
    # "Male body base mesh (highpoly)" by Mandrake (mandrake_3d), CC BY 4.0: one body cut in five
    # parts, 7.3 units tall (made 1.8 m), in an A-pose.
    'male-base': {
        'drop': [],
        'size': (0.24624, 5.469),
        'whole': True,
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
    # Made with Meshy (AI), at the repository owner's request: one mesh each, standing.
    'android': {
        'proxy': True, 'source': 'meshy-model-2026-10-29T06-47-56-144Z.glb', 'drop': [], 'size': (0.919, 0.952), 'whole': True, 'faces': 60_000,
        'joints': {
            'hips': (0.0, 0.02, 0.98), 'spine': (0.0, 0.03, 1.08), 'chest': (0.0, 0.03, 1.2), 'upperChest': (0.0, 0.03, 1.32),
            'neck': (0.0, 0.03, 1.47), 'head': (0.0, 0.02, 1.55), 'headEnd': (0.0, 0.0, 1.75),
            'leftShoulder': (0.05, 0.03, 1.44), 'leftUpperArm': (0.19, 0.03, 1.39), 'leftLowerArm': (0.245, 0.04, 1.08),
            'leftHand': (0.27, -0.02, 0.86), 'leftHandEnd': (0.28, -0.03, 0.74),
            'rightShoulder': (-0.05, 0.03, 1.44), 'rightUpperArm': (-0.19, 0.03, 1.39), 'rightLowerArm': (-0.245, 0.04, 1.08),
            'rightHand': (-0.27, -0.02, 0.86), 'rightHandEnd': (-0.28, -0.03, 0.74),
            'leftUpperLeg': (0.09, 0.02, 0.9), 'leftLowerLeg': (0.11, 0.01, 0.5), 'leftFoot': (0.11, 0.03, 0.08), 'leftToes': (0.11, -0.1, 0.02),
            'rightUpperLeg': (-0.09, 0.02, 0.9), 'rightLowerLeg': (-0.11, 0.01, 0.5), 'rightFoot': (-0.11, 0.03, 0.08), 'rightToes': (-0.11, -0.1, 0.02),
        },
    },
    'fashion-model': {
        'proxy': True, 'source': 'meshy-model-2026-10-29T06-48-26-810Z.glb', 'drop': [], 'size': (0.8828, 0.952), 'whole': True, 'faces': 60_000,
        'joints': {
            'hips': (0.0, -0.01, 0.9), 'spine': (0.0, -0.01, 1.0), 'chest': (0.0, -0.01, 1.12), 'upperChest': (0.0, -0.01, 1.24),
            'neck': (0.0, -0.02, 1.4), 'head': (0.0, -0.03, 1.48), 'headEnd': (0.0, -0.03, 1.68),
            'leftShoulder': (0.04, -0.02, 1.37), 'leftUpperArm': (0.16, -0.02, 1.36), 'leftLowerArm': (0.41, -0.02, 1.355),
            'leftHand': (0.64, -0.02, 1.34), 'leftHandEnd': (0.79, -0.02, 1.33),
            'rightShoulder': (-0.04, -0.02, 1.37), 'rightUpperArm': (-0.16, -0.02, 1.36), 'rightLowerArm': (-0.41, -0.02, 1.355),
            'rightHand': (-0.64, -0.02, 1.34), 'rightHandEnd': (-0.79, -0.02, 1.33),
            'leftUpperLeg': (0.08, -0.01, 0.82), 'leftLowerLeg': (0.07, -0.03, 0.46), 'leftFoot': (0.06, 0.0, 0.1), 'leftToes': (0.06, -0.13, 0.02),
            'rightUpperLeg': (-0.08, -0.01, 0.82), 'rightLowerLeg': (-0.07, -0.03, 0.46), 'rightFoot': (-0.06, 0.0, 0.1), 'rightToes': (-0.06, -0.13, 0.02),
        },
    },
    'athlete': {
        'proxy': True, 'source': 'meshy-model-2026-10-29T06-51-15-066Z.glb', 'drop': [], 'size': (0.85, 1.0), 'whole': True, 'faces': 60_000,
        'joints': {
            'hips': (0.0, 0.02, 0.98), 'spine': (0.0, 0.02, 1.08), 'chest': (0.0, 0.02, 1.2), 'upperChest': (0.0, 0.02, 1.32),
            'neck': (0.0, 0.02, 1.45), 'head': (0.0, 0.0, 1.53), 'headEnd': (0.0, 0.0, 1.7),
            'leftShoulder': (0.04, 0.02, 1.42), 'leftUpperArm': (0.16, 0.03, 1.38), 'leftLowerArm': (0.21, 0.03, 1.1),
            'leftHand': (0.24, 0.02, 0.87), 'leftHandEnd': (0.24, 0.0, 0.76),
            'rightShoulder': (-0.04, 0.02, 1.42), 'rightUpperArm': (-0.16, 0.03, 1.38), 'rightLowerArm': (-0.21, 0.03, 1.1),
            'rightHand': (-0.24, 0.02, 0.87), 'rightHandEnd': (-0.24, 0.0, 0.76),
            'leftUpperLeg': (0.09, 0.02, 0.9), 'leftLowerLeg': (0.13, 0.02, 0.5), 'leftFoot': (0.17, 0.05, 0.09), 'leftToes': (0.18, -0.12, 0.03),
            'rightUpperLeg': (-0.09, 0.02, 0.9), 'rightLowerLeg': (-0.13, 0.02, 0.5), 'rightFoot': (-0.17, 0.05, 0.09), 'rightToes': (-0.18, -0.12, 0.03),
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

TORSO = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'leftShoulder', 'rightShoulder']
# The bones each kind of piece may follow.
FOLLOWS = {
    'body': list(BONES),
    'torso': TORSO,
    'rightUpperArm': ['rightShoulder', 'rightUpperArm'],
    'head': ['head', 'neck'],
    'leftHand': ['leftHand', 'leftLowerArm'], 'rightHand': ['rightHand', 'rightLowerArm'],
    'leftLeg': ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot'], 'rightLeg': ['hips', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'],
    'leftFoot': ['leftLowerLeg', 'leftFoot'], 'rightFoot': ['rightLowerLeg', 'rightFoot'],
}


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


def allowed(o, arm, bones, joints, scale, arms_apart):
    """
    Keep a piece's weights on the bones it may follow (filled in from the nearest of them where it
    has none). On the body's own piece (sleeves and all), with hands held against the torso: the
    forearms and hands move only what is nearer them than the chest along the surface.
    """
    keep = set(bones)
    arm_side = sleeves(o, joints, scale) if arms_apart else None
    segs = [(b.name, b.head_local, b.tail_local) for b in arm.data.bones if b.name in keep]
    names = {g.index: g.name for g in o.vertex_groups}
    for name in keep:
        if not o.vertex_groups.get(name):
            o.vertex_groups.new(name=name)
    for v in o.data.vertices:
        ok = keep if arm_side is None or arm_side[v.index] else keep - {'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'}
        total = 0.0
        for g in v.groups:
            if names[g.group] not in ok:
                g.weight = 0
            total += g.weight
        if total > 1e-3:
            continue
        # None left: the two nearest bones it may follow, the nearer the more.
        near = sorted(((gap(v.co, a, b), n) for n, a, b in segs if n in ok))[:2]
        if len(near) == 1 or near[0][0] < 1e-6:
            o.vertex_groups[near[0][1]].add([v.index], 1.0, 'REPLACE')
            continue
        (d0, n0), (d1, n1) = near
        w0 = 1 / d0 ** 4 / (1 / d0 ** 4 + 1 / d1 ** 4)
        o.vertex_groups[n0].add([v.index], w0, 'REPLACE')
        o.vertex_groups[n1].add([v.index], 1 - w0, 'REPLACE')


def by_proxy(o, arm):
    """
    Weighted through a watertight copy (a generated figure's one surface is rarely closed, and the
    automatic weights fail on it): the copy weighted, its weights handed to the nearest of the figure's.
    """
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.duplicate()
    proxy = bpy.context.view_layer.objects.active
    proxy.data.remesh_voxel_size = 0.008 * ZOOM
    bpy.ops.object.voxel_remesh()
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for g in proxy.vertex_groups:
        if not o.vertex_groups.get(g.name):
            o.vertex_groups.new(name=g.name)
    move = o.modifiers.new('Weights', 'DATA_TRANSFER')
    move.object = proxy
    move.use_vert_data = True
    move.data_types_verts = {'VGROUP_WEIGHTS'}
    move.vert_mapping = 'POLYINTERP_NEAREST'
    move.layers_vgroup_select_src = 'ALL'
    move.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=move.name)
    bpy.data.objects.remove(proxy)


def gap(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (a + ab * t - p).length


def sleeves(o, joints, scale):
    """Which vertices are nearer an elbow than the chest, along the surface (a sleeve's, not the torso's they rest on)."""
    import heapq
    co = [v.co for v in o.data.vertices]
    nbr = [[] for _ in co]
    for e in o.data.edges:
        a, b = e.vertices
        d = (co[a] - co[b]).length
        nbr[a].append((b, d))
        nbr[b].append((a, d))

    def spread(seeds):
        dist = [math.inf] * len(co)
        heap = [(0.0, i) for i in seeds]
        for _d, i in heap:
            dist[i] = 0.0
        while heap:
            d, i = heapq.heappop(heap)
            if d > dist[i]:
                continue
            for j, w in nbr[i]:
                if d + w < dist[j]:
                    dist[j] = d + w
                    heapq.heappush(heap, (d + w, j))
        return dist

    def nearest(p, n=6):
        return sorted(range(len(co)), key=lambda i: (co[i] - p).length)[:n]
    elbows = spread(nearest(joints['leftLowerArm'] * scale) + nearest(joints['rightLowerArm'] * scale))
    chest = spread(nearest(joints['chest'] * scale) + nearest(joints['upperChest'] * scale))
    return [e < c for e, c in zip(elbows, chest)]


def main():
    figure_id, src, out = sys.argv[sys.argv.index('--') + 1:]
    spec = FIGURES[figure_id]
    joints = {k: Vector(v) for k, v in spec['joints'].items()}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o.name in spec['drop']:
            bpy.data.objects.remove(o)

    # Each piece apart, its transforms applied, its seams welded.
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [o for o in bpy.context.scene.objects if o.type == 'EMPTY']:
        bpy.data.objects.remove(o)
    if 'size' in spec:
        # (In metres, its feet on the floor.)
        k, lift = spec['size']
        for o in meshes:
            o.data.transform(Matrix.Scale(k, 4) @ Matrix.Translation((0, 0, lift)))
    if spec.get('whole'):
        # One body cut in parts (as it was drawn): put together first, and made lighter.
        bpy.ops.object.join()
        meshes = [bpy.context.view_layer.objects.active]
        weld(meshes[0])
        lighter(meshes[0], spec['faces'])
    for o in meshes:
        weld(o)

    # The skeleton, where its joints are; each piece weighted to it (Blender's automatic weights,
    # at ten times the size: they fail on small pieces), only to the bones it can follow.
    arm = skeleton(joints, ZOOM)
    for o in meshes:
        o.data.transform(Matrix.Scale(ZOOM, 4))
    kinds = {name: kind for kind, names in spec.get('pieces', {}).items() for name in names}
    for o in meshes:
        kind = kinds.get(o.name, 'torso' if spec.get('pieces') else 'body')
        if spec.get('proxy'):
            by_proxy(o, arm)
        else:
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            arm.select_set(True)
            bpy.context.view_layer.objects.active = arm
            bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        allowed(o, arm, FOLLOWS[kind], joints, ZOOM, kind == 'body' and bool(spec.get('pieces')))

    # One mesh, at its size again.
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
        o.data.transform(Matrix.Scale(1 / ZOOM, 4))
        for m in list(o.modifiers):
            o.modifiers.remove(m)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = 'Body'
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=1e-3)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.data.objects.remove(arm)
    arm = skeleton(joints, 1)
    body.parent = arm
    lighter(body, spec['faces'])
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    if spec.get('tpose'):
        tpose(arm, body)

    colours_only()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_skins=True,
                              export_animations=False, export_morph=False, export_image_format='JPEG')
    print('RIGGED', out, len(body.data.vertices), 'vertices', len(body.data.polygons), 'faces')


def tpose(arm, body):
    """Arms straightened at the elbow (about its hinge), then raised level: made the rest pose."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for s, x in (('left', 1), ('right', -1)):
        upper, lower = arm.pose.bones[f'{s}UpperArm'], arm.pose.bones[f'{s}LowerArm']
        bpy.context.view_layer.update()
        u = (upper.tail - upper.head).normalized()
        f = (lower.tail - lower.head).normalized()
        rotate(arm, lower, f.rotation_difference(u))
        bpy.context.view_layer.update()
        u = (upper.tail - upper.head).normalized()
        rotate(arm, upper, u.rotation_difference(Vector((x, 0, 0))))
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=body.modifiers[0].name)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm


def lighter(o, faces):
    """At most `faces` faces."""
    if len(o.data.polygons) > faces:
        mod = o.modifiers.new('Fewer', 'DECIMATE')
        mod.ratio = faces / len(o.data.polygons)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)


def rotate(arm, pose_bone, q):
    """Turn a posed bone by `q` in the world (about its head)."""
    m = arm.matrix_world.inverted().to_quaternion() @ q @ arm.matrix_world.to_quaternion()
    world = pose_bone.matrix.copy()
    rot = m.to_matrix().to_4x4()
    head = world.translation.copy()
    new = rot @ world
    new.translation = head
    pose_bone.matrix = new


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
