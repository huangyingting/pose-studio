'use client';

import { Assistant } from '@edition/server';

/** The AI assistant (server edition), beside the canvas and the inspector so you see what it does. */
export default function AssistantSection() {
  return Assistant ? <div className="side-section"><Assistant /></div> : null;
}
