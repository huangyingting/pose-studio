# Changelog

What changed in each release of Film Studio. Versions follow [semantic versioning](https://semver.org): a fix raises the patch number (0.1.1), a new feature the minor one (0.2.0); 1.0.0 is for when the project file format and the features are stable. Each release is a tag (`v0.1.0`) and a [GitHub release](https://github.com/vibewatch/filmstudio/releases).

## 0.1.0 (2026-11-05)

The first tagged release: a small studio for blocking and filming scenes with posable 3D people, and a posable mannequin for drawing reference.

- **Posing**: drag hands, feet and hips; Pose, Move and Rotate tools on the canvas; joint limits, pins, mirrored copies; figures from a photo.
- **Library**: 119 recorded motions (4 for two people), 159 poses and 20 of people together, 18 characters (and VRM, glTF/GLB or FBX imported), 29 textured sets, 9 lighting schemes.
- **Scenes and templates**: 11 ready-to-shoot scenes, each clean in the app's motion check.
- **Animation**: walks, runs, jumps and turns in recorded people's steps; a timeline with keys, trimming, splitting, markers, repeats and corrections; lines of dialogue.
- **Cameras**: fixed, following or along a path; shot sizes, moves and the director's coverage; a storyboard of every shot.
- **Looks**: Line art, Pencil, Ink wash, Watercolour, Anime, Pixel, 3D, Clay and Minimal.
- **Export**: images, video, storyboards, packs for AI video tools with OpenTimelineIO cut lists, and `.glb`.
- **Two editions** from one codebase: static (GitHub Pages) and server (sign-in, a library synced across devices, review links, the AI assistant).

Before tagging, the whole app was reviewed:

- Code review fixes: timeline edits (split, retime, ripple, keys), syncing between tabs and devices, exports, Escape handling, the assistant's tools.
- Library motions checked one by one against their names, and those that did not match replaced or renamed (among them Walk down stairs, Turn 90°, Run sideways, Jump forward, Point at someone, Scared, Cheer).
- New scene and the Library's Lighting open at once: the built-in templates' and lighting schemes' thumbnails ship with the app (`npm run thumbs`), and a thumbnail drawn in the app is kept only once everything it shows has come.
