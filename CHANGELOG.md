# Changelog

What changed in each release of Film Studio. Versions follow [semantic versioning](https://semver.org): a fix raises the patch number (0.1.1), a new feature the minor one (0.2.0); 1.0.0 is for when the project file format and the features are stable. Each release is a tag (`v0.1.0`) and a [GitHub release](https://github.com/vibewatch/filmstudio/releases).

## 0.2.0 (2026-11-06)

Sound, extras, faces and props for the motions, more motions and scenes, and a faster first play.

- **Sound** (#35): a scene can play dialogue or music to time it to (WAV, MP3, OGG, M4A). It is heard as the scene plays, moved and trimmed on its own timeline row, made quieter or muted, and drags snap to its beats. Videos carry it, the storyboard's and the AI video pack's too. An imported sound can be put on any scene, and deleted once no scene plays it.
- **Extras** (#57): people passing by behind the cast, to and fro across what the camera sees and round the set's walls and furniture. They are never filmed as a coverage's subject.
- **Faces** (#56): moods for the motions that show one (a hug, cheering, a fight's strikes, pain, asleep…), each person's own in a motion of two, and a feeling set by hand on an action.
- **Props for the motions that hold them** (#54): a pistol, a rifle, a sword, a shield, a bat, a golf club and a bag. A Library motion that holds one brings it to the hand, to the other hand when mirrored, and given to the upper body too.
- **Motions**: 142, 7 of them for two people (#48, #53). New: a walk backward upright, a kiss, a hug and a high five, walks drunk, limping, texting and hurt, kneeling, lying, and pistol and sword sets. A ladder and stairs are climbed for as long as the block lasts (#45).
- **Ready to shoot**: 14 scenes, now with romance, comedy and suspense (#47). Their tiles say what kind of scene each is (#55).
- **Timeline**: a long scene opens at its first 20 seconds, with its blocks' names readable (#46).
- **Faster**: the first play loads the physics engine only for a scene that throws something (#52); a frame is worked out in about two thirds of the time (#44); the mannequin's mesh is a binary file, not 935 KB of base64 in the main script (#43).
- **Accessibility** (#39): axe finds nothing in the studio, the Library, New scene and Export, in the light and dark themes; the faintest text reads at 4.5:1.
- **Server edition**: review notes are limited in size and rate, and the owner can delete them (#41). The AI assistant can add extras, put an imported sound on a scene and set a face.
- **Releases** publish themselves from this changelog when a version tag is pushed (#49).

Fixed, from the review of 2026-11-06 (#60) and before:

- A room's side walls stood mirrored front to back (the living room, the office, the café, the palace hall and the castle hall).
- Opening a project file left out its sounds.
- Extras walked through furniture; now their lanes go round it.
- A mirrored motion's gear stayed in the hand it was made for (a sword and a shield now change places).
- Sounds no longer pile up in the browser and on the server once deleted.
- In the AI video pack, two sounds of the same name were packed over each other.
- Node 22.13+ or 24+ is required (as the test and lint tools need); the README said 20.9+.

Development: TypeScript 6, ESLint 10, knip 6 and updates within range (Next 16.4.5, Vitest 5.1) (#42, #58); the slow tests and e2e run in shards balanced by time, and knip runs in CI (#40, #51).

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
