import dynamic from 'next/dynamic';
import type { ComponentType, ReactNode } from 'react';

/*
 * The server edition's extras, imported as '@edition/server'. Static builds resolve that name to
 * ./none.ts instead (next.config.ts), so none of this code ships to GitHub Pages.
 */

/** Session and library sync around the app. */
export const ServerRoot: ComponentType<{ children: ReactNode }> | null = dynamic(() => import('./Account'));
/** Sign in, or the account menu. */
export const Account: ComponentType | null = dynamic(() => import('./Account').then((m) => m.Account));
/** The AI tab. */
export const Assistant: ComponentType | null = dynamic(() => import('./Assistant'));
