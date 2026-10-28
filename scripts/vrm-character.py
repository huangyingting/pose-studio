#!/usr/bin/env python3
"""A VRM avatar made one of the app's characters (public/characters/<id>.glb, #15).

    python3 scripts/vrm-character.py <avatar.vrm> <id>

What it makes is a GLB the app draws as it draws its other characters:
  - its bones are named as our skeleton's (the VRM humanoid's names: hips, leftUpperArm…), so the
    character's list (lib/characters.ts) maps them one to one;
  - its textures are fitted within 1024 px (the editor and exports never need more), re-encoded;
  - its MToon materials, its humanoid and who made it (VRMC_vrm) stay as they are: the Toon style
    reads them (lib/vrm.ts, lib/toon.ts); its spring bones go (not used yet).
Only for avatars whose licence lets a changed copy be shared (VRM `modification`:
allowModificationRedistribution), credited as they ask. Needs Pillow.
"""
import io
import json
import struct
import sys

from PIL import Image

MAX = 1024


def read_glb(path):
    data = open(path, 'rb').read()
    magic, _version, _length = struct.unpack('<4sII', data[:12])
    if magic != b'glTF':
        sys.exit('Not a GLB/VRM file')
    chunks, at = [], 12
    while at < len(data):
        size, kind = struct.unpack('<I4s', data[at:at + 8])
        chunks.append((kind, data[at + 8:at + 8 + size]))
        at += 8 + size
    gltf = json.loads(next(c for k, c in chunks if k == b'JSON'))
    binary = next((c for k, c in chunks if k == b'BIN\x00'), b'')
    return gltf, binary


def write_glb(path, gltf, binary):
    text = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    text += b' ' * (-len(text) % 4)
    binary += b'\x00' * (-len(binary) % 4)
    length = 12 + 8 + len(text) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, length))
        f.write(struct.pack('<I4s', len(text), b'JSON') + text)
        f.write(struct.pack('<I4s', len(binary), b'BIN\x00') + binary)


def fitted_image(raw):
    """An image within MAX px on its longer side, as a PNG (as it was, if that is no smaller): or None."""
    image = Image.open(io.BytesIO(raw))
    big = max(image.size) > MAX
    if big:
        scale = MAX / max(image.size)
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, 'PNG', optimize=True)
    return out.getvalue() if big or len(out.getvalue()) < len(raw) else None


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, ident = sys.argv[1], sys.argv[2]
    gltf, binary = read_glb(src)
    vrm = gltf.get('extensions', {}).get('VRMC_vrm')
    if not vrm:
        sys.exit('Not a VRM 1.0 avatar (VRMC_vrm)')
    if vrm.get('meta', {}).get('modification') != 'allowModificationRedistribution':
        sys.exit('Its licence does not let a changed copy be shared')

    # Bones named as our skeleton's.
    for bone, ref in vrm['humanoid']['humanBones'].items():
        gltf['nodes'][ref['node']]['name'] = bone

    # Spring bones: not used yet.
    gltf['extensions'].pop('VRMC_springBone', None)
    gltf['extensionsUsed'] = [e for e in gltf.get('extensionsUsed', []) if e != 'VRMC_springBone']
    for node in gltf['nodes']:
        node.get('extensions', {}).pop('VRMC_springBone', None)
        if 'extensions' in node and not node['extensions']:
            del node['extensions']

    # The buffer again, view by view, the images' fitted.
    images = {img['bufferView']: img for img in gltf.get('images', []) if 'bufferView' in img}
    out = bytearray()
    for i, view in enumerate(gltf['bufferViews']):
        start = view.get('byteOffset', 0)
        raw = binary[start:start + view['byteLength']]
        fitted = fitted_image(raw) if i in images else None
        if fitted is not None:
            raw = fitted
            images[i]['mimeType'] = 'image/png'
        out += b'\x00' * (-len(out) % 4)
        view['byteOffset'] = len(out)
        view['byteLength'] = len(raw)
        out += raw
    gltf['buffers'] = [{'byteLength': len(out)}]
    dest = f'public/characters/{ident}.glb'
    write_glb(dest, gltf, bytes(out))
    meta = vrm.get('meta', {})
    print(f"{dest}: {len(out) / 1e6:.1f} MB of data; {meta.get('name')} by {', '.join(meta.get('authors', []))}")


if __name__ == '__main__':
    main()
