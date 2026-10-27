'use client';

import { useState } from 'react';
import { Bone as BoneIcon } from 'lucide-react';
import { NEEDED, type BoneMap } from '@/lib/model';
import type { Bone } from '@/lib/types';
import { Modal, Select } from './ui';

/** The skeleton's bones, as people call them. */
const LABEL = (b: Bone) => b.replace(/^(left|right)/, (s) => `${s === 'left' ? 'Left' : 'Right'} `).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ (\w)/g, (_, c: string) => ` ${c.toLowerCase()}`);

/**
 * Which of a file's bones is each of the skeleton's, picked by hand: shown when an import cannot
 * find them all by their names. What it did find is filled in.
 */
export default function BoneMapDialog({ file, names, found, onDone, onClose }: {
  file: string;
  names: string[];
  found: BoneMap;
  onDone(map: BoneMap): void;
  onClose(): void;
}) {
  const [map, setMap] = useState<BoneMap>(found);
  const bones: Bone[] = [...NEEDED, 'spine', 'chest'];
  const missing = NEEDED.filter((b) => !map[b]);
  const options = [{ value: '', label: '— none —' }, ...[...new Set(names)].map((n) => ({ value: n, label: n }))];
  return (
    <Modal
      title={`Match the bones of ${file}`}
      icon={BoneIcon}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={missing.length > 0} onClick={() => onDone(map)}>Import</button>
        </>
      )}
    >
      <p className="muted small">Not all of its bones have names this app knows. Pick which of its bones is each part of the body{missing.length ? ` (${missing.length} to go)` : ''}.</p>
      <div className="bone-map">
        {bones.map((b) => (
          <div className="field" key={b}>
            <span>{LABEL(b)}{NEEDED.includes(b as (typeof NEEDED)[number]) ? '' : ' (if it has one)'}</span>
            <Select<string>
              label={LABEL(b)}
              value={map[b] ?? ''}
              onChange={(v) => setMap((m) => {
                const next = { ...m };
                if (v) next[b] = v;
                else delete next[b];
                return next;
              })}
              options={options}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
