/* Console panel: pin a projector scene, or let it auto-rotate. */
import { ScreenStateSchema } from '@afterhours/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../core/api';
import { scenes } from '../../core/featureHost';
import { useLiveEvent } from '../../core/live';
import { qk } from '../../core/queries';
import { Button, Card, Scribble, useToast } from '../../kit';
import { JOIN_SCENE_ID } from '../screen/JoinScene';
import s from './admin.module.css';

export function ProjectorPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const state = useQuery({ queryKey: qk.screenState, queryFn: () => api.get('/api/screen/state', ScreenStateSchema) });
  useLiveEvent('screen.pinned', (d) => qc.setQueryData(qk.screenState, d));
  const pin = useMutation({
    mutationFn: (sceneId: string | null) => api.post('/api/admin/screen/pin', { sceneId }, ScreenStateSchema),
    onSuccess: (d) => qc.setQueryData(qk.screenState, d),
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });
  const pinned = state.data?.pinned ?? null;
  const all = [{ id: JOIN_SCENE_ID, label: 'join: the app QR' }, ...scenes.map((sc) => ({ id: sc.id, label: sc.label }))];
  return (
    <div className={s.panel}>
      <header className={s.panelHead}>
        <h1 className={s.panelTitle}>projector</h1>
        <Scribble color="var(--grape)" style={{ width: 160 }} />
      </header>
      <Card tone="paper" tilt={-0.3} tape tapeColor="lime">
        <h2 className={s.cardTitle}>{pinned ? 'pinned scene' : 'auto-rotating'}</h2>
        <p className={s.note}>Pin one to hold it on screen. Unpin to let live things (polls, check-in) take over again.</p>
        <div className={s.sceneGrid}>
          {all.map((sc) => (
            <Button key={sc.id} tone={pinned === sc.id ? 'lime' : 'paper'} onClick={() => pin.mutate(pinned === sc.id ? null : sc.id)} aria-pressed={pinned === sc.id}>
              {sc.label}
            </Button>
          ))}
        </div>
        <div className={s.row}>
          <Button tone="sun" size="sm" onClick={() => pin.mutate(null)} disabled={!pinned}>
            unpin, auto-rotate
          </Button>
          <Button tone="paper" size="sm" ghost onClick={() => window.open('/screen', '_blank')}>
            open projector page
          </Button>
        </div>
      </Card>
    </div>
  );
}
