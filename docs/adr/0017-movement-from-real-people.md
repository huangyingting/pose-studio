# 0017. Movement from real people: recorded bodies on paths the scene sets

- **Status**: Accepted
- **Date**: 2026-11-02

## Context

A figure walks, runs, turns and jumps to marks the user or the director sets: any distance, any
way round, round people and furniture, up onto a box, at the figure's own size, arriving facing
where it should. That used to be all generated (legs, feet and arms worked out by formula), and it
looked made: even, stiff, the same for everyone.

The Library has real people doing these things (Mixamo captures: walks, runs, a jog, a sprint,
backing up, side steps, a turn on the spot, a standing jump). Played as they are, they cannot do
the job: each is one recording, one distance, one speed, one height, one way round. Stretched to fit
(warped), the feet slide and a flight stops looking like a flight.

## Decision

Each fundamental movement is a **primitive**: a recorded body, split into its phases, played over a
path the scene sets.

- **The scene sets the path**: where the figure goes and when (the marks, the way round what is in
  the way, the timing), where each foot comes down (the plan's footfalls, at the figure's size, on
  what is under them), the body's arc in the air (under gravity, to the mark, as high as asked),
  which way it faces, any spins or flips. This part stays procedural: it is what makes a primitive
  reach its mark.
- **The recording sets the body**: the person's legs swinging, the back, the arms, the head, their
  crouch, swing and tuck. It is played in phase with the path: a walk's cycle at the phase its
  distance gives, its planted feet held where the plan has them (IK), its swinging legs its own; a
  jump's take-off, flight and landing each in the jump's own time. Stepping sideways is the one
  exception: the legs take the plan's short steps, which never cross (IK all through), the rest of
  the body the recorded side-step's. A recorded side-step steps out and closes far wider than those
  steps, so its own legs would be dragged to them.
- **Where the two meet**: setting off and arriving, the body eases out of the pose before and into
  the one after (the legs over a few frames, the arms and back over up to half a second); joints are
  kept within their ranges (a recording retargeted to our skeleton may read past one); keeping its
  facing (backing up, side-stepping) the head keeps looking where it did.

The primitives:

| Movement | Recording | The scene's part |
| --- | --- | --- |
| Walk, run (and backing up, side steps) | The chosen walk or run (Walk unless another is chosen) | Path, pace, footfalls, turns |
| Jump (to a spot, onto a box, with spins or flips) | Jump on the spot | Arc, height, landing spot, turns in the air |
| Turn on the spot | Turn 90° (mirrored to the right; twice round past 135°): which foot when, the body | Angle, where each foot lands |
| Setting off, stopping, pace | The walk's or run's own cycle, eased in and out as the pace ramps up and down (the Library has no recording of starting or stopping) | How long it takes (its pace follows: a walk made longer is slower, its strides and steps as the person's, scaled) |

Nothing is generated where a recording can carry it: no arm swing, lean, tuck or stepping pattern
of our own. The primitives' recordings are fetched as a project opens, before anyone moves; one not
at hand yet (still coming, or offline) plays as the path alone until it comes (the feet stepping
where the path has them, the body as keyed).

## Consequences

- Movement looks like people: a different walk is a different person's walk, not a parameter.
- One way to add a movement: a recording, its phases, and what the scene decides about it. Not a
  new generator.
- The procedural part does not go away: it is what puts feet on marks and bodies on boxes; it is
  smaller (no arms, back or legs in the air of its own).
- A recording's speed is kept: an arm thrown up in a jump moves as fast as the person's did (the
  motion check does not call it a pop).
- Each primitive's timing follows its recording (a jump crouches and lands about as long as the
  person did), so scenes built on the generated timings move a little.
