import { describeSpan } from './prompt';
import { keysInShot, shotSpans, videoModel } from './shots';
import type { Scene } from './types';

/*
 * OpenTimelineIO cut list: one clip per shot, pointing at the exported video, with the
 * caption, camera keys and shot description as metadata. Opens in editors and pipelines
 * that read .otio (DaVinci Resolve, Premiere via plugins, OTIO tools).
 */

const time = (value: number, rate: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value });

export function buildOtio(scene: Scene, mediaUrl: string) {
  const a = scene.animation;
  if (!a) throw new Error('Only animations have a cut list');
  const rate = a.fps;
  const frames = (s: number) => Math.round(s * rate);
  const target = videoModel(a.target);
  const clips = shotSpans(a).map((span) => ({
    OTIO_SCHEMA: 'Clip.2',
    name: span.shot.name,
    source_range: {
      OTIO_SCHEMA: 'TimeRange.1',
      start_time: time(frames(span.start), rate),
      duration: time(frames(span.end) - frames(span.start), rate),
    },
    media_references: {
      DEFAULT_MEDIA: {
        OTIO_SCHEMA: 'ExternalReference.1',
        target_url: mediaUrl,
        available_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: time(0, rate), duration: time(frames(a.duration), rate) },
      },
    },
    active_media_reference_key: 'DEFAULT_MEDIA',
    effects: [],
    markers: [],
    enabled: true,
    metadata: {
      pose_studio: {
        caption: span.shot.caption ?? '',
        prompt: describeSpan(scene, span),
        camera: keysInShot(a, span),
        ...(target ? { cut_for: target.name, over_limit: span.end - span.start > target.max } : {}),
      },
    },
  }));
  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: scene.name,
    global_start_time: time(0, rate),
    metadata: { pose_studio: { fps: rate, duration: a.duration } },
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
