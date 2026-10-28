'use client';

import { useEffect, useLayoutEffect, useState, type ComponentProps } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Line2, LineGeometry, LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three-stdlib';

type Point = THREE.Vector3 | [number, number, number];

/** A Line2 (or its segments) with a material kept for its life; its points and dashes changed in place. */
class Strip {
  readonly material = new LineMaterial();
  readonly line: Line2 | LineSegments2;
  private dashed: boolean | null = null;
  constructor(readonly segments: boolean) {
    this.line = segments ? new LineSegments2(new LineSegmentsGeometry(), this.material) : new Line2(new LineGeometry(), this.material);
  }
  setPoints(points: Point[]) {
    const g = this.segments ? new LineSegmentsGeometry() : new LineGeometry();
    g.setPositions(points.flatMap((p) => (p instanceof THREE.Vector3 ? [p.x, p.y, p.z] : p)));
    this.line.geometry.dispose();
    this.line.geometry = g;
    this.line.computeLineDistances();
  }
  // (Dashes are a define: the shader changes only when they are turned on or off.)
  setDashed(dashed: boolean) {
    if (dashed === this.dashed) return;
    this.dashed = dashed;
    if (dashed) this.material.defines.USE_DASH = '';
    else delete this.material.defines.USE_DASH;
    this.material.needsUpdate = true;
  }
  dispose() {
    this.line.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * A line of constant width on screen (three's Line2), as drei's Line, but its material is made once
 * and kept: drei's disposes it whenever the points change, so every edit that moved a route, a
 * camera path or a view cone compiled its shader again (a pause on each drag step).
 */
export function Line({ points, segments = false, color, lineWidth = 1, dashed = false, dashSize = 1, gapSize = 1, transparent = false, opacity = 1, depthTest = true, ...rest }: {
  points: Point[];
  segments?: boolean;
  color: THREE.ColorRepresentation;
  lineWidth?: number;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
  transparent?: boolean;
  opacity?: number;
  depthTest?: boolean;
} & Omit<ComponentProps<'primitive'>, 'object'>) {
  const size = useThree((s) => s.size);
  const [strip] = useState(() => new Strip(segments));
  useLayoutEffect(() => strip.setPoints(points), [strip, points]);
  useLayoutEffect(() => strip.setDashed(dashed), [strip, dashed]);
  useEffect(() => () => strip.dispose(), [strip]);
  return (
    <primitive object={strip.line} {...rest}>
      <primitive
        object={strip.material}
        attach="material"
        color={color}
        resolution={[size.width, size.height]}
        linewidth={lineWidth}
        dashSize={dashSize}
        gapSize={gapSize}
        transparent={transparent}
        opacity={opacity}
        depthTest={depthTest}
      />
    </primitive>
  );
}
