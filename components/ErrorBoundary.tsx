'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

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
        <p className="muted">Your poses are saved in this browser. Reloading usually fixes this.</p>
        <div className="row">
          <button className="primary" onClick={() => location.reload()}>Reload</button>
          <button
            onClick={() => {
              if (!confirm('Delete all saved poses in this browser and start fresh?')) return;
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
