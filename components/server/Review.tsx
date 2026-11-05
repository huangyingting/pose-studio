'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { MessageSquare, Trash2, X } from 'lucide-react';
import { appendScenes } from '@/lib/actions';
import { parseScene } from '@/lib/doc';
import { withBase } from '@/lib/paths';
import type { Store } from '@/lib/store';
import type { Scene } from '@/lib/types';
import { uid } from '@/lib/uid';
import { App } from '../commands';
import { useStore, useStudio } from '../store-context';
import { IconButton } from '../ui';

/*
 * Reviews (server edition): a scene shared for review opens from its link (?review=<id>) with its
 * notes beside it, each at a moment of the scene (clicked, the playhead goes there); a new one is
 * said at the playhead. Shared from the account menu (shareForReview). Who shared it may delete
 * its notes and the review (asked first: it is on the server, not undone).
 */

interface Note {
  id: string;
  author: string;
  t: number;
  text: string;
}

const NAME_KEY = 'pose-studio-reviewer';
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Share the open scene for review: a copy on the server, its link copied to the clipboard. */
export async function shareForReview(store: Store) {
  try {
    const res = await fetch(withBase('/api/reviews'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: store.scene }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    const url = new URL(withBase('/'), location.origin);
    url.searchParams.set('review', body.id);
    await navigator.clipboard.writeText(url.toString()).then(() => App().notify('Review link copied: whoever opens it sees the scene and can leave notes on it'), () => prompt('Copy this link:', url.toString()));
  } catch (err) {
    App().notify(`Could not share for review: ${(err as Error).message}`, 'error');
  }
}

/** The notes of the review opened from the link, beside its scene while it is open. */
export default function Review() {
  const store = useStore();
  const open = useStudio((s) => s.library.scenes[s.sceneIndex]?.id);
  const { data } = useSession();
  const [review, setReview] = useState<{ id: string; name: string; scene: string; notes: Note[]; mine: boolean } | null>(null);
  const [text, setText] = useState('');
  const [name, setName] = useState(() => (typeof localStorage === 'undefined' ? '' : localStorage.getItem(NAME_KEY) ?? ''));
  const [shut, setShut] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('review');
    if (!id) return;
    // (Taken off the address first: a second run of this, or a reload, does not open it twice.)
    history.replaceState(null, '', location.pathname + location.hash);
    fetch(withBase(`/api/reviews/${encodeURIComponent(id)}`))
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        const scene: Scene = { ...parseScene(body.scene), id: uid('s') };
        appendScenes(store, [scene]);
        setReview({ id, name: body.name, scene: scene.id, notes: body.comments, mine: !!body.mine });
        App().notify(`Opened “${body.name}” for review`);
      })
      .catch((err) => App().notify(`Could not open the review: ${(err as Error).message}`, 'error'));
  }, [store]);

  if (!review || shut || open !== review.scene) return null;
  const signedIn = !!data?.user;
  const say = async () => {
    const words = text.trim();
    if (!words) return;
    if (!signedIn && name.trim()) localStorage.setItem(NAME_KEY, name.trim());
    try {
      const res = await fetch(withBase(`/api/reviews/${encodeURIComponent(review.id)}/comments`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: store.getState().time, text: words, author: name.trim() }),
      });
      const note = await res.json();
      if (!res.ok) throw new Error(note.error ?? res.statusText);
      setReview({ ...review, notes: [...review.notes, note].sort((p, q) => p.t - q.t) });
      setText('');
    } catch (err) {
      App().notify(`Could not leave the note: ${(err as Error).message}`, 'error');
    }
  };
  // (Who shared it: a note, or the review with all its notes, deleted on the server.)
  const remove = async (note: Note | null) => {
    if (!confirm(note ? `Delete ${note.author}'s note at ${clock(note.t)}? It cannot be undone.` : `Delete the review of “${review.name}” and its ${review.notes.length} notes? The link stops working. It cannot be undone.`)) return;
    const path = `/api/reviews/${encodeURIComponent(review.id)}${note ? `/comments/${encodeURIComponent(note.id)}` : ''}`;
    try {
      const res = await fetch(withBase(path), { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      if (note) setReview({ ...review, notes: review.notes.filter((n) => n.id !== note.id) });
      else {
        setShut(true);
        App().notify(`Deleted the review of “${review.name}”`);
      }
    } catch (err) {
      App().notify(`Could not delete it: ${(err as Error).message}`, 'error');
    }
  };
  return (
    <section className="review-card" aria-label="Review">
      <div className="qa-head">
        <strong><MessageSquare size={14} aria-hidden /> Review · {review.notes.length} {review.notes.length === 1 ? 'note' : 'notes'}</strong>
        {review.mine && <IconButton icon={Trash2} label="Delete the review" onClick={() => void remove(null)} size={15} />}
        <IconButton icon={X} label="Close the review" onClick={() => setShut(true)} size={15} />
      </div>
      <ul aria-label="Notes">
        {review.notes.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => store.setTime(n.t)}>
              <em>{clock(n.t)}</em> <strong>{n.author}</strong>
              <span>{n.text}</span>
            </button>
            {review.mine && <IconButton icon={Trash2} label={`Delete ${n.author}'s note`} onClick={() => void remove(n)} size={13} />}
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); void say(); }}>
        {!signedIn && <input type="text" aria-label="Your name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
        <input type="text" aria-label="A note at the playhead" placeholder="A note here, at the playhead" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn subtle" disabled={!text.trim()}>Leave the note</button>
      </form>
    </section>
  );
}
