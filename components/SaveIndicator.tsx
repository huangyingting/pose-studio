import { Cloud, CloudAlert, CloudCheck, CloudOff, RefreshCw } from 'lucide-react';
import type { CloudStatus } from '@/lib/cloud';
import type { SaveStatus } from '@/lib/store';

/**
 * The one save indicator by the scene name: saved on this device, then (signed in, server
 * edition) synced to the account.
 */
export default function SaveIndicator({ status, cloud }: { status: SaveStatus; cloud?: { status: CloudStatus; when: string } }) {
  const [text, tip, Icon] = status === 'error' ? ['Not saved', 'Browser storage is full or blocked. Use Save in the main menu.', CloudOff]
    : status === 'pending' ? ['Saving…', 'Saving in this browser', Cloud]
    : !cloud ? ['Saved', 'Saved in this browser automatically', CloudCheck]
    : cloud.status === 'synced' ? ['Synced', `Saved in this browser and synced to your account${cloud.when ? ` ${cloud.when}` : ''}`, CloudCheck]
    : cloud.status === 'offline' ? ['Offline', 'Saved in this browser; it syncs to your account when you are back online', CloudOff]
    : cloud.status === 'error' ? ['Sync failed', 'Saved in this browser; syncing to your account failed and is tried again on your next change', CloudAlert]
    : ['Syncing…', 'Saved in this browser; syncing to your account', RefreshCw];
  return (
    <span className={`save-status ${status === 'saved' && cloud && cloud.status !== 'synced' ? cloud.status : status}`} title={tip}>
      <Icon size={14} aria-hidden />
      <span className="hide-sm">{text}</span>
    </span>
  );
}
