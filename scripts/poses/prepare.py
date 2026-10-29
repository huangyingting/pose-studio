"""Pose drawings made photo-like for MediaPipe (which finds no person in line art).

    python3 -I scripts/poses/prepare.py <drawings dir> <out dir>

Each full-body drawing (full_*.png): its lines thickened, the background filled blue-grey from the
corners, the figure inside skin-coloured, its lines brown, softened a little, with room round it.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


BACKGROUND = (90, 110, 140)
# How much room round each drawing (of its longer side), on every side.
PAD = 0.3


def main(src, out):
    os.makedirs(out, exist_ok=True)
    for f in sorted(os.listdir(src)):
        if not f.startswith('full_') or os.path.exists(os.path.join(out, f)):
            continue
        im = Image.open(os.path.join(src, f)).convert('RGB')
        g = im.convert('L').point(lambda v: 0 if v < 200 else 255).filter(ImageFilter.MinFilter(3))
        rgb = Image.merge('RGB', (g, g, g))
        for c in [(2, 2), (rgb.width - 3, 2), (2, rgb.height - 3), (rgb.width - 3, rgb.height - 3)]:
            if rgb.getpixel(c) == (255, 255, 255):
                ImageDraw.floodfill(rgb, c, BACKGROUND, thresh=10)
        a = np.array(rgb)
        a[(a[:, :, 0] > 200) & (a[:, :, 1] > 200) & (a[:, :, 2] > 200)] = (222, 170, 140)
        a[a[:, :, 0] < 60] = (150, 100, 80)
        im = Image.fromarray(a).filter(ImageFilter.GaussianBlur(1.2))
        # (Room round the figure, as a photo has: MediaPipe misses many drawn to the edge.)
        w, h = im.size
        pad = int(PAD * max(w, h))
        framed = Image.new('RGB', (w + 2 * pad, h + 2 * pad), BACKGROUND)
        framed.paste(im, (pad, pad))
        framed.resize((framed.width // 2, framed.height // 2)).save(os.path.join(out, f))


main(*sys.argv[1:])
