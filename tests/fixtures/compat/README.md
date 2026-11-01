# Compatibility fixtures (#30)

Made once, on main at 59f9883, **before** the five extra bones (`upperChest`, `leftShoulder`,
`rightShoulder`, `leftToes`, `rightToes`) became core joints, by the code of that time (not by the
code they check):

- `legacy-pose.json`: a sparse 17-joint pose (as saved), every bone's world turn from it, and the
  mannequin's joints where they stood in it, on a man of 1.8 m and a woman of 1.62 m.
- `library-clips.json`: six library clips (52-bone tracks; the five move in all of them), every
  bone's world turn and the root sampled at four times each.
- `legacy-scene.json`: a scene as saved with a 17-joint figure, and its bones as it parsed.

Since then the neck, shoulders and upper arms are stored from their parents in the body (the
upper chest, the shoulders) and the shipped motions were converted once (#30); a bone's turn in
the world is the same either way, which `tests/unit/compat.test.ts` checks: the converted motions
and today's code against what the old ones meant. Do not make them again with newer code.
