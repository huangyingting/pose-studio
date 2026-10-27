import type { ComponentType, ReactNode } from 'react';
import type { SaveStatus } from '@/lib/store';

/* The static edition (GitHub Pages): no accounts, sync or AI. See ./index.ts. */

export const ServerRoot: ComponentType<{ children: ReactNode }> | null = null;
export const Account: ComponentType | null = null;
export const SaveState: ComponentType<{ status: SaveStatus }> | null = null;
export const Assistant: ComponentType | null = null;
