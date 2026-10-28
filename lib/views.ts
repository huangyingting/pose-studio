/** Editor camera shortcuts (keys 1–6). */
export const VIEW_PRESETS: { label: string; yaw: number; pitch: number; key: string }[] = [
  { label: 'From the front', yaw: 0, pitch: 4, key: '1' },
  { label: 'From the back', yaw: 180, pitch: 4, key: '2' },
  { label: 'From the left', yaw: 90, pitch: 4, key: '3' },
  { label: 'From the right', yaw: -90, pitch: 4, key: '4' },
  { label: 'From above', yaw: 0, pitch: 85, key: '5' },
  { label: 'Three-quarter', yaw: 35, pitch: 15, key: '6' },
];

/** The world's axes X, Y, Z as drawn everywhere (the gizmo's red, green and blue; as --axis-x/y/z in the styles). */
export const AXIS_COLORS = ['#e5484d', '#30a46c', '#3d7bff'] as const;
