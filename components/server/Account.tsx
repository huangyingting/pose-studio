'use client';

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SessionProvider, getProviders, signIn, signOut, useSession } from 'next-auth/react';
import { Cloud, CloudAlert, CloudOff, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { CloudSync } from '@/lib/cloud';
import { withBase } from '@/lib/paths';
import { useStore } from '../store-context';
import { Menu, type MenuItem } from '../ui';

/*
 * Server edition: accounts (NextAuth) and library sync around the studio. Loaded only in the
 * server edition (see components/Studio.tsx).
 */

const CloudContext = createContext<CloudSync | null>(null);

/** Session for the whole app, and library sync for whoever is signed in. */
export default function ServerRoot({ children }: { children: ReactNode }) {
  return (
    <SessionProvider basePath={withBase('/api/auth')} refetchOnWindowFocus={false}>
      <Sync>{children}</Sync>
    </SessionProvider>
  );
}

function Sync({ children }: { children: ReactNode }) {
  const store = useStore();
  const { data } = useSession();
  const user = data?.user?.id;
  const cloud = useMemo(() => (user ? new CloudSync(store, user) : null), [store, user]);
  useEffect(() => {
    if (!cloud) return;
    cloud.start();
    return () => cloud.stop();
  }, [cloud]);
  return <CloudContext.Provider value={cloud}>{children}</CloudContext.Provider>;
}

const noop = () => () => {};

function useCloudStatus() {
  const cloud = useContext(CloudContext);
  useSyncExternalStore(cloud?.subscribe ?? noop, () => `${cloud?.status}:${cloud?.lastSynced}`, () => '');
  return cloud;
}

const PROVIDER_LABELS: Record<string, string> = { google: 'Continue with Google', 'azure-ad': 'Continue with Microsoft' };

function useProviders() {
  const [providers, setProviders] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    getProviders().then((p) => { if (live) setProviders(Object.values(p ?? {})); }, () => { if (live) setProviders([]); });
    return () => { live = false; };
  }, []);
  return providers;
}

const signInWith = (id: string) => {
  if (id === 'test') void signIn('test', { name: 'Test user', redirect: false }).then(() => window.location.reload());
  else void signIn(id);
};

/** One button per sign-in provider the server has set up. */
export function SignInButtons() {
  const providers = useProviders();
  if (!providers) return null;
  if (!providers.length) return <p className="hint-text">Sign-in is not set up on this server.</p>;
  return (
    <div className="signin-buttons">
      {providers.map((p) => (
        <button key={p.id} type="button" className="btn subtle" onClick={() => signInWith(p.id)}>
          <LogIn size={15} aria-hidden /> {PROVIDER_LABELS[p.id] ?? `Continue with ${p.name}`}
        </button>
      ))}
    </div>
  );
}

function ago(t: number | null) {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Top bar: sign in, or the account with its sync status and sign out. */
export function Account() {
  const { data, status } = useSession();
  const providers = useProviders();
  const cloud = useCloudStatus();
  if (status === 'loading') return null;
  const user = data?.user;

  if (!user) {
    if (!providers?.length) return null;
    return (
      <Menu
        label="Sign in"
        align="end"
        className="btn ghost"
        tip="Sign in to sync your library and use the assistant"
        items={providers.map((p) => ({ label: PROVIDER_LABELS[p.id] ?? `Continue with ${p.name}`, icon: LogIn, onSelect: () => signInWith(p.id) }))}
      >
        <LogIn size={15} aria-hidden /> <span className="hide-sm">Sign in</span>
      </Menu>
    );
  }

  const s = cloud?.status ?? 'syncing';
  const SyncIcon = s === 'synced' ? Cloud : s === 'offline' ? CloudOff : s === 'error' ? CloudAlert : RefreshCw;
  const syncText = s === 'synced' ? `Library synced ${ago(cloud?.lastSynced ?? null)}` : s === 'offline' ? 'Offline: changes sync when you are back' : s === 'error' ? 'Sync failed: retrying on your next change' : 'Syncing library…';
  const items: MenuItem[] = [
    { group: user.email ?? user.name ?? 'Signed in' },
    { label: syncText, icon: SyncIcon, disabled: true, onSelect: () => {} },
    '-',
    { label: 'Sign out', icon: LogOut, onSelect: () => void signOut() },
  ];
  const initial = (user.name || user.email || '?').trim()[0]?.toUpperCase();
  return (
    <Menu label="Account" align="end" className={`avatar${s === 'error' || s === 'offline' ? ' warn' : ''}`} tip={syncText} items={items}>
      {user.image
        // Provider avatars come from their CDNs: next/image would need their hosts configured.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={user.image} alt="" referrerPolicy="no-referrer" />
        : <span aria-hidden>{initial}</span>}
    </Menu>
  );
}
