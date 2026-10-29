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
# The prepared drawings' width over their height.
ASPECT = 810 / 960
# How closely a front view's heights must match the side's for it to be level (of the trunk).
LEVEL = 0.12
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


def image(lm, aspect):
    """Image landmarks in units of the image's height (x across, y down) and their visibility."""
    return np.array([[p['x'] * aspect, p['y']] for p in lm]), np.array([p.get('visibility', 1.0) for p in lm])


def triangulate(front, side, depth_hint):
    """
    A pose from its front and side drawings (the gallery's side views are level and square on;
    its front views level too, but for a figure lying down, seen from above). Across from the
    front; height and depth from the side, where the side's figure is drawn, and where its far
    limbs are hidden, as their near counterparts are (people pose much as they mirror); the height
    the front's instead where the front is level (it sees both sides). The side's left and right
    as fit best; which way round its camera is as the front agrees. In MediaPipe's world frame
    (x right, y down, z away), metres (the trunk 0.5 m), hip-centred.
    """
    (f, fv), (s0, sv0) = front, side
    trunk = lambda p: np.linalg.norm((p[11] + p[12] - p[23] - p[24]) / 2) or 1e-6
    best = None
    for s, sv in ((s0, sv0), (s0[SWAP], sv0[SWAP])):
        w = np.minimum(fv, sv)
        w = np.where(w > 0.5, w, 0.02)
        # The side's height on the front's: ys = a yf + b.
        A = np.stack([f[:, 1], np.ones(33)], 1) * w[:, None]
        a, b = np.linalg.lstsq(A, s[:, 1] * w, rcond=None)[0]
        res = float(np.sqrt(((a * f[:, 1] + b - s[:, 1]) ** 2 * w).sum() / w.sum()))
        if best is None or res < best[0]:
            best = (res, s, sv, a, b)
    res, s, sv, a, b = best
    level = res < LEVEL * trunk(s) and a > 0.5
    # Both views in units of their trunk (the front's where it is level: the side matched to it).
    f = (f - (f[23] + f[24]) / 2) / trunk(f)
    s = (s - (s[23] + s[24]) / 2) / (trunk(f) * a if level else trunk(s))
    # The side's hidden limbs (its far side) as their near counterparts are.
    hidden = (sv < 0.5) & (sv[SWAP] >= 0.5)
    s = np.where(hidden[:, None], s[SWAP], s)
    x = f[:, 0]
    # (Each height from the view that sees it better: a kneeling figure's feet, hidden behind it
    # from the front, are guessed there as a standing one's.)
    y = np.where(fv >= np.maximum(sv, 0.5), f[:, 1], s[:, 1]) if level else s[:, 1]
    z = s[:, 0]
    # (Which way round the side camera is: as the front has it, MediaPipe's depth there where it is
    # level, the front's own up the body where it is seen from above.)
    hint = -depth_hint if level else -f[:, 1]
    if np.sum(hint * z * np.maximum(fv, 0.1)) < 0:
        z = -z
    pts = np.stack([x, y, -z], 1) * 0.5
    return pts, np.maximum(fv, sv), res


def pair(f, fv, g, gv, swap):
    """The second view's points, its left and right as fit best, its heights matched to the first's (scale, offset)."""
    best = None
    for s, sv in ((g, gv), (g[SWAP], gv[SWAP])) if swap else ((g, gv),):
        w = np.minimum(fv, sv)
        w = np.where(w > 0.5, w, 0.02)
        A = np.stack([f[:, 1], np.ones(33)], 1) * w[:, None]
        a, b = np.linalg.lstsq(A, s[:, 1] * w, rcond=None)[0]
        res = float(np.sqrt(((a * f[:, 1] + b - s[:, 1]) ** 2 * w).sum() / w.sum()))
        if best is None or res < best[0]:
            best = (res, s, sv, a)
    return best


def three_quarter(first, firstAngle, diag, hint):
    """
    A pose from a level square-on view (the front or the side) and the three-quarter one, both level,
    45° apart: what the square-on one cannot see (its depth) from where the three-quarter one sees
    each point across. Which side the three-quarter camera is on, as `hint` (the square-on view's
    depth as MediaPipe has it) agrees. As triangulate returns.
    """
    (f, fv), (g0, gv0) = first, diag
    res, g, gv, a = pair(f, fv, g0, gv0, True)
    trunk = lambda p: np.linalg.norm((p[11] + p[12] - p[23] - p[24]) / 2) or 1e-6
    f = (f - (f[23] + f[24]) / 2) / trunk(f)
    g = (g - (g[23] + g[24]) / 2) / (trunk(f) * a)
    c = np.cos(np.radians(45))
    # Across in the three-quarter view: u = c·across + c·depth, so depth = u / c - across.
    depth = g[:, 0] / c - f[:, 0]
    if np.sum(-hint * depth * np.maximum(fv, 0.1)) < 0:
        depth = (-g[:, 0]) / c - f[:, 0]
        if np.sum(-hint * depth * np.maximum(fv, 0.1)) < 0:
            depth = -depth
    y = np.where(fv >= np.maximum(gv, 0.5), f[:, 1], g[:, 1])
    across = f[:, 0]
    # (Seen from the side, what is across there is depth from the front, and what is depth there is across.)
    x, z = (across, depth) if firstAngle == 0 else (depth, across)
    pts = np.stack([x, y, -z], 1) * 0.5
    return pts, np.maximum(fv, gv), res


def main(src, out):
    data = json.load(open(src))
    poses = defaultdict(dict)
    drawn = defaultdict(dict)
    for name, v in data.items():
        if v:
            pose, view = name[:-4].rsplit('_', 1)
            poses[pose][view] = arr(v['world'])
            drawn[pose][view] = image(v['image'], ASPECT)
    result = {}
    for pose, views in sorted(poses.items()):
        if 'front' in drawn[pose] and 'side' in drawn[pose]:
            pts, vis, res = triangulate(drawn[pose]['front'], drawn[pose]['side'], views['front'][0][:, 2])
            result[pose] = {'world': [[*map(float, p), float(v)] for p, v in zip(pts, vis)], 'views': ['front', 'side'], 'rms': res}
            continue
        # (Without one of them: the three-quarter view instead.)
        for first, angle in (('front', 0), ('side', 90)):
            if first in drawn[pose] and 'diag' in drawn[pose]:
                pts, vis, res = three_quarter(drawn[pose][first], angle, drawn[pose]['diag'], views[first][0][:, 2])
                result[pose] = {'world': [[*map(float, p), float(v)] for p, v in zip(pts, vis)], 'views': [first, 'diag'], 'rms': res}
                break
        if pose in result:
            continue
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
