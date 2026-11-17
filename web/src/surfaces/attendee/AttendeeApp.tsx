/*
  Attendee surface (/). Gate order: sign in -> first-time profile -> the app.
  The live connection lives above the gate so the sticker you earn by signing
  in reaches you the moment the session exists.
*/
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LiveProvider, useLiveEvent } from '../../core/live';
import { qk, useMe } from '../../core/queries';
import { StickerCelebration } from '../../fun';
import { DoodleDefs, ErrorState, LoadingState, ToastProvider, useToast } from '../../kit';
import { Profile } from './Profile';
import { Shell } from './Shell';
import { SignIn } from './SignIn';

function LiveReactors() {
  const qc = useQueryClient();
  const toast = useToast();
  useLiveEvent('points.awarded', (d) => {
    void qc.invalidateQueries({ queryKey: qk.points });
    toast(d.label ?? d.source, { kind: 'points', title: `+${d.points} points` });
  });
  useLiveEvent('presence.changed', (d) => qc.setQueryData(qk.presence, d));
  useLiveEvent('session.revoked', () => {
    qc.setQueryData(qk.me, null);
    toast('The desk reset your kit. Sign in again to get back in.', { kind: 'info', title: 'signed out' });
  });
  return null;
}

export function AttendeeApp() {
  const me = useMe();
  useEffect(() => {
    document.body.removeAttribute('data-surface');
  }, []);
  const identity = me.data ? `a${me.data.attendee.id}` : 'anon';

  return (
    <LiveProvider identity={identity}>
      <ToastProvider>
        <DoodleDefs />
        {me.isPending ? (
          <LoadingState label="waking up..." />
        ) : me.isError ? (
          <ErrorState error={me.error} onRetry={() => void me.refetch()} />
        ) : !me.data ? (
          <SignIn />
        ) : (
          <>
            <LiveReactors />
            <StickerCelebration />
            {me.data.attendee.profileComplete ? <Shell me={me.data} /> : <Profile me={me.data} />}
          </>
        )}
      </ToastProvider>
    </LiveProvider>
  );
}
