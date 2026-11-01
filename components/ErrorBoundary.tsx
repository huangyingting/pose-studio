'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Store } from '@/lib/store';

/** The project as this browser keeps it, as a file Open… reads (what crashed may be in it: kept, not lost). */
function downloadProject() {
  const json = localStorage.getItem(Store.LIBRARY_KEY);
  if (!json) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'pose-studio.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Last-resort error screen so a rendering bug never leaves the user with a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Pose Studio crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <p className="muted">Your project is saved in this browser. Reloading usually fixes this; if it does not, download the project (Open… brings it back) before starting fresh.</p>
        <div className="row">
          <button className="primary" onClick={() => location.reload()}>Reload</button>
          <button onClick={downloadProject}>Download the project</button>
          <button
            onClick={() => {
              if (!confirm('Delete the project saved in this browser and start fresh? Download it first to keep it.')) return;
              for (const k of Object.keys(localStorage)) if (k.startsWith('pose-studio')) localStorage.removeItem(k);
              location.reload();
            }}
          >
            Reset saved data
          </button>
        </div>
      </div>
    );
  }
}
