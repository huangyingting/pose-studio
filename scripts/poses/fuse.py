"""Fuse each pose's MediaPipe world landmarks from its views into one 3D skeleton.

    python3 -I scripts/poses/fuse.py <landmarks.json> <fused.json>

Each view's world landmarks are metric and hip-centred but in its camera's frame. Only the level
views (front, three-quarter, side) are used, their camera's down being the floor's: the best seen
is the reference, the others rotated onto it (Kabsch on the confident landmarks), one fitting
badly tried mirrored (left and right confused), one still fitting badly dropped; the rest averaged,
weighted by visibility. Output: {pose: {world: [[x, y, z, visibility]...], views: [...], rms}}.
"""
import json
import sys
from collections import defaultdict

import numpy as np

SWAP = list(range(33))
for a, b in [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16), (17, 18), (19, 20), (21, 22), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32)]:
    SWAP[a], SWAP[b] = b, a
BODY = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
PREFER = ['front', 'diag', 'side']
# How sure a view is of its depth, against its image plane.
DEPTH = 0.15


def arr(lm):
    return np.array([[p['x'], p['y'], p['z']] for p in lm]), np.array([p.get('visibility', 1.0) for p in lm])


def kabsch(src, dst, w):
    """Rotation r minimising sum w |r src - dst|^2 (both centred)."""
    h = (src * w[:, None]).T @ dst
    u, _, vt = np.linalg.svd(h)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    return vt.T @ np.diag([1, 1, d]) @ u.T


def fit(ref, rv, x, xv):
    w = np.minimum(rv, xv)[BODY]
    w = np.where(w > 0.5, w, 0.05)
    r = kabsch(x[BODY], ref[BODY], w)
    y = x @ r.T
    rms = float(np.sqrt((w[:, None] * (y[BODY] - ref[BODY]) ** 2).sum() / w.sum()))
    return (y, r), rms


def main(src, out):
    data = json.load(open(src))
    poses = defaultdict(dict)
    for name, v in data.items():
        if v:
            pose, view = name[:-4].rsplit('_', 1)
            poses[pose][view] = arr(v['world'])
    result = {}
    for pose, views in sorted(poses.items()):
        level = [k for k in views if k in ('front', 'diag', 'side')]
        if not level:
            continue
        order = sorted(level, key=lambda k: (-views[k][1][BODY].mean(), PREFER.index(k)))
        ref_name = order[0]
        ref, rv = views[ref_name]
        # (Each view sure of its image plane, much less of its depth: combined as such, a side
        # view gives the depth a front view cannot.)
        eye = np.diag([1.0, 1.0, DEPTH])
        info = [eye[None] * rv[:, None, None]]
        vals = [np.einsum('nij,nj->ni', info[0], ref)]
        wsum, used, worst = rv.copy(), [ref_name], 0.0
        for k in order[1:]:
            x, xv = views[k]
            (y, r), rms = fit(ref, rv, x, xv)
            (ym, rm), rmsm = fit(ref, rv, x[SWAP], xv[SWAP])
            if rmsm < rms:
                y, r, rms, xv = ym, rm, rmsm, xv[SWAP]
            if rms > 0.12:
                continue
            a = (r @ eye @ r.T)[None] * xv[:, None, None]
            info.append(a)
            vals.append(np.einsum('nij,nj->ni', a, y))
            wsum += xv
            used.append(k)
            worst = max(worst, rms)
        fused = np.linalg.solve(sum(info) + 1e-6 * np.eye(3)[None], sum(vals)[..., None])[..., 0]
        vis = np.minimum(1.0, wsum / len(used))
        result[pose] = {'world': [[*map(float, p), float(v)] for p, v in zip(fused, vis)], 'views': used, 'rms': worst}
    json.dump(result, open(out, 'w'))
    print(len(result), 'poses;', sum(len(r['views']) > 1 for r in result.values()), 'from several views')


main(*sys.argv[1:])
