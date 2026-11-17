/* Projector surface (/screen). PIN gate, then the scene host. Dark "after hours" variant. */
import { useEffect } from 'react';
import { LiveProvider } from '../../core/live';
import { useStaffSession } from '../../core/queries';
import { DoodleDefs, ToastProvider } from '../../kit';
import { PinGate } from '../shared/PinGate';
import { SceneHost } from './SceneHost';

export default function ScreenApp() {
  const session = useStaffSession('screen');
  useEffect(() => {
    document.body.dataset.surface = 'dusk';
    return () => document.body.removeAttribute('data-surface');
  }, []);
  return (
    <LiveProvider identity={session.data ? 'screen' : 'anon'}>
      <ToastProvider>
        <DoodleDefs />
        <PinGate role="screen">
          <SceneHost />
        </PinGate>
      </ToastProvider>
    </LiveProvider>
  );
}
