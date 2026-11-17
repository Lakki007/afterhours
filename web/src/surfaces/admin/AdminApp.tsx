/* Console surface (/admin). PIN gate, then the shell. */
import { useEffect } from 'react';
import { LiveProvider } from '../../core/live';
import { useStaffSession } from '../../core/queries';
import { DoodleDefs, ToastProvider } from '../../kit';
import { PinGate } from '../shared/PinGate';
import { AdminShell } from './AdminShell';

export default function AdminApp() {
  const session = useStaffSession('admin');
  useEffect(() => {
    document.body.removeAttribute('data-surface');
  }, []);
  return (
    <LiveProvider identity={session.data ? 'admin' : 'anon'}>
      <ToastProvider>
        <DoodleDefs />
        <PinGate role="admin">
          <AdminShell />
        </PinGate>
      </ToastProvider>
    </LiveProvider>
  );
}
