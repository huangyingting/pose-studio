import dynamic from 'next/dynamic';
import type { ComponentType, ReactNode } from 'react';
import type { SaveStatus } from '@/lib/store';

/*
 * The server edition's extras, imported as '@edition/server'. Static builds resolve that name to
 * ./none.ts instead (next.config.ts), so none of this code ships to GitHub Pages.
 */

/** Session and library sync around the app. */
export const ServerRoot: ComponentType<{ children: ReactNode }> | null = dynamic(() => import('./Account'));
/** Sign in, or the account menu. */
export const Account: ComponentType | null = dynamic(() => import('./Account').then((m) => m.Account));
/** The save indicator, synced to the account when signed in. */
export const SaveState: ComponentType<{ status: SaveStatus }> | null = dynamic(() => import('./Account').then((m) => m.SyncedSaveIndicator));
/** The AI assistant (a section of the left side panel). */
export const Assistant: ComponentType | null = dynamic(() => import('./Assistant'));
