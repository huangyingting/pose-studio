import { describeShot, describeSpan } from './prompt';
import { cameraById } from './cameras';
import { shotFrames, type StoryShot } from './board';

/*
 * OpenTimelineIO cut list: one clip per shot (of a scene, or of the whole story), pointing at the
 * exported video where the shot is in it, with the caption, the camera (its path) and the shot's
 * description as metadata. Opens in editors and pipelines that read .otio (DaVinci Resolve,
 * Premiere via plugins, OTIO tools).
 */

const time = (value: number, rate: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value });

export function buildOtio(shots: StoryShot[], name: string, mediaUrl: string, rate = 24) {
  // (In the whole frames each shot has in the video: its cuts where the video's are.)
  const total = shots.reduce((n, x) => n + shotFrames(x, rate), 0);
  let at = 0;
  const clips = shots.map((x) => {
    const start = at;
    at += shotFrames(x, rate);
    const camera = cameraById(x.scene, x.span?.shot.camera ?? x.scene.cameras[0].id);
    return {
      OTIO_SCHEMA: 'Clip.2',
      name: x.span ? x.span.shot.name : x.scene.name,
      source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: time(start, rate), duration: time(shotFrames(x, rate), rate) },
      media_references: {
        DEFAULT_MEDIA: {
          OTIO_SCHEMA: 'ExternalReference.1',
          target_url: mediaUrl,
          available_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: time(0, rate), duration: time(total, rate) },
        },
      },
      active_media_reference_key: 'DEFAULT_MEDIA',
      effects: [],
      markers: [],
      enabled: true,
      metadata: {
        pose_studio: {
          scene: x.scene.name,
          caption: x.caption,
          prompt: x.span ? describeSpan(x.scene, x.span) : describeShot(x.scene),
          ...(camera ? { camera } : {}),
        },
      },
    };
  });
  return {
    OTIO_SCHEMA: 'Timeline.1',
    name,
    global_start_time: time(0, rate),
    metadata: { pose_studio: { fps: rate, duration: total / rate } },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: [{ OTIO_SCHEMA: 'Track.1', name: 'Shots', kind: 'Video', children: clips, effects: [], markers: [], metadata: {} }],
      effects: [],
      markers: [],
      metadata: {},
    },
  };
}
