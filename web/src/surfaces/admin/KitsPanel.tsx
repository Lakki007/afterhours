/*
  Kits panel (spec 4 + 5.2): generate kits (blank or from a pasted CSV), print
  the cut-out card sheet, download the CSV, reset a kit, and see who has signed in.
*/
import {
  GenerateKitsResponseSchema,
  type GenerateKitsRequest,
  KitListResponseSchema,
  type KitRow,
  ResetKitResponseSchema,
  formatPassword,
} from '@afterhours/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../core/api';
import { qk, useAppConfig } from '../../core/queries';
import { celebrate } from '../../fun';
import { Button, Card, Doodle, EmptyState, ErrorState, LoadingState, NumberTicker, Scribble, Sheet, Tabs, TextArea, TextField, useToast } from '../../kit';
import s from './admin.module.css';
import { clearBatch, downloadText, setBatch, toCsv, useBatch } from './kitsStore';
import { KitSheet } from './KitSheet';

type Mode = 'blank' | 'csv';
type Filter = 'all' | 'in' | 'waiting';

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function Generate() {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('blank');
  const [count, setCount] = useState('20');
  const [csv, setCsv] = useState('');
  const gen = useMutation({
    mutationFn: (body: GenerateKitsRequest) => api.post('/api/admin/kits', body, GenerateKitsResponseSchema),
    onSuccess: (r) => {
      setBatch(r.kits);
      void qc.invalidateQueries({ queryKey: qk.kits });
      if (r.kits.length) {
        celebrate({ y: 0.5, sound: false });
        toast(`${r.kits.length} kits ready. print them before you leave this page.`, { kind: 'good', title: 'cards made' });
      }
      if (r.skipped.length) toast(`${r.skipped.length} rows skipped (line ${r.skipped[0]?.line}: ${r.skipped[0]?.reason})`, { kind: 'info', title: 'check your csv' });
    },
    onError: (e) => toast(e.message, { kind: 'bad', title: 'could not make kits' }),
  });
  const n = Number(count);
  const valid = mode === 'blank' ? Number.isInteger(n) && n >= 1 && n <= 500 : csv.trim().length > 0;
  return (
    <Card tone="paper" tape tapeColor="sky" tilt={-0.4}>
      <h2 className={s.cardTitle}>make kits</h2>
      <Tabs
        label="how to make kits"
        value={mode}
        onChange={setMode}
        items={[
          { id: 'blank', label: 'blank cards', icon: 'plus' },
          { id: 'csv', label: 'from a list', icon: 'list' },
        ]}
      />
      <form
        className={s.stack}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          gen.mutate(mode === 'blank' ? { mode: 'blank', count: n } : { mode: 'csv', csv });
        }}
      >
        {mode === 'blank' ? (
          <TextField label="how many?" type="number" inputMode="numeric" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} hint="1 to 500. People fill in their own name." />
        ) : (
          <TextArea label="paste name,roll (one per line)" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Aarav Reddy,23BD1A0501\nDiya Sharma,23BD1A0502'} rows={6} hint="they get prefilled on first sign-in. a header row is fine." />
        )}
        <Button type="submit" tone="lime" icon="ticket" loading={gen.isPending} disabled={!valid}>
          make them
        </Button>
      </form>
    </Card>
  );
}

function BatchBanner({ appUrl, eventDate }: { appUrl: string; eventDate: string }) {
  const batch = useBatch();
  const [sheet, setSheet] = useState(false);
  if (!batch || batch.kits.length === 0) return null;
  return (
    <Card tone="sun" tilt={0.5} lift halftone tape="left" tapeColor="pink">
      <div className={s.batch}>
        <div>
          <h2 className={s.cardTitle}>
            <NumberTicker value={batch.kits.length} /> fresh kits, passwords inside
          </h2>
          <p className={s.note}>The passwords live only in this tab and are gone on reload. Print or download now.</p>
        </div>
        <div className={s.row}>
          <Button tone="lime" icon="print" onClick={() => setSheet(true)}>
            card sheet
          </Button>
          <Button tone="paper" icon="download" onClick={() => downloadText(`afterhours-kits-${batch.kits[0]?.kitId}-${batch.kits.at(-1)?.kitId}.csv`, toCsv([['kit_id', 'password', 'name', 'roll'], ...batch.kits.map((k) => [k.kitId, formatPassword(k.password), k.name, k.roll])]))}>
            download csv
          </Button>
          <Button tone="paper" ghost size="sm" onClick={clearBatch}>
            done, forget them
          </Button>
        </div>
      </div>
      {sheet && <KitSheet kits={batch.kits} appUrl={appUrl} eventDate={eventDate} onClose={() => setSheet(false)} />}
    </Card>
  );
}

function ResetSheet({ kit, onClose, appUrl, eventDate }: { kit: KitRow | null; onClose: () => void; appUrl: string; eventDate: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [result, setResult] = useState<{ kitId: string; password: string } | null>(null);
  const [print, setPrint] = useState(false);
  const reset = useMutation({
    mutationFn: ({ kitId, newPassword }: { kitId: string; newPassword: boolean }) => api.post(`/api/admin/kits/${kitId}/reset`, { newPassword }, ResetKitResponseSchema),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.kits });
      if (r.password) setResult({ kitId: r.kitId, password: r.password });
      else {
        toast(`${r.kitId} is free to sign in on a new phone.`, { kind: 'good', title: 'kit reset' });
        onClose();
      }
    },
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });
  const close = () => {
    setResult(null);
    onClose();
  };
  return (
    <>
      <Sheet open={kit !== null} onClose={close} placement="center" title={result ? 'new password' : `reset ${kit?.kitId ?? ''}?`}>
        {result ? (
          <div className={s.stack}>
            <p className={s.note}>Shown once. Write it on the card or print a fresh one.</p>
            <p className={s.bigPw}>{formatPassword(result.password)}</p>
            <div className={s.row}>
              <Button tone="lime" icon="print" onClick={() => setPrint(true)}>
                print this card
              </Button>
              <Button tone="paper" onClick={close}>
                done
              </Button>
            </div>
          </div>
        ) : (
          kit && (
            <div className={s.stack}>
              <p>
                {kit.attendee?.nickname ?? kit.presetName ?? 'This kit'} gets signed out right away. Their points and stickers stay.
              </p>
              <Button tone="sun" loading={reset.isPending} onClick={() => reset.mutate({ kitId: kit.kitId, newPassword: false })}>
                reset, same password
              </Button>
              <Button tone="pink" loading={reset.isPending} onClick={() => reset.mutate({ kitId: kit.kitId, newPassword: true })}>
                reset with a new password
              </Button>
            </div>
          )
        )}
      </Sheet>
      {print && result && (
        <KitSheet kits={[{ kitId: result.kitId, password: result.password, name: kit?.presetName ?? null, roll: kit?.presetRoll ?? null }]} appUrl={appUrl} eventDate={eventDate} onClose={() => setPrint(false)} />
      )}
    </>
  );
}

function KitTable({ appUrl, eventDate }: { appUrl: string; eventDate: string }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [resetting, setResetting] = useState<KitRow | null>(null);
  const list = useQuery({
    queryKey: qk.kits,
    queryFn: () => api.get('/api/admin/kits', KitListResponseSchema),
    refetchInterval: 5000,
  });
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data?.kits ?? []).filter((k) => {
      if (filter === 'in' && !k.attendee) return false;
      if (filter === 'waiting' && k.attendee) return false;
      if (!needle) return true;
      return [k.kitId, k.presetName, k.presetRoll, k.attendee?.name, k.attendee?.roll, k.attendee?.nickname].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [list.data, q, filter]);

  if (list.isPending) return <LoadingState label="counting kits..." />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  const { stats } = list.data;

  const exportIn = () =>
    downloadText(
      'afterhours-attendance.csv',
      toCsv([
        ['kit_id', 'name', 'roll', 'nickname', 'first_signin_iso'],
        ...list.data.kits.filter((k) => k.attendee).map((k) => [k.kitId, k.attendee?.name ?? null, k.attendee?.roll ?? null, k.attendee?.nickname ?? null, new Date(k.attendee?.firstSignInAt ?? 0).toISOString()]),
      ]),
    );

  return (
    <section className={s.stack} aria-label="all kits">
      <div className={s.stats}>
        <Card tone="tangerine" tilt={-1.2} halftone>
          <p className={s.statLabel}>kits made</p>
          <NumberTicker value={stats.total} className={s.statNum} />
        </Card>
        <Card tone="lime" tilt={1} halftone>
          <p className={s.statLabel}>signed in</p>
          <NumberTicker value={stats.signedIn} className={s.statNum} />
        </Card>
        <Card tone="pink" tilt={-0.6} halftone>
          <p className={s.statLabel}>profiles done</p>
          <NumberTicker value={stats.profiles} className={s.statNum} />
        </Card>
      </div>

      <Card tone="paper" tilt={0.2} className={s.tableCard}>
        <div className={s.tableHead}>
          <h2 className={s.cardTitle}>who is in</h2>
          <TextField label="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, roll, kit id" className={s.search} />
          <Tabs
            label="filter kits"
            value={filter}
            onChange={setFilter}
            items={[
              { id: 'all', label: `all ${stats.total}` },
              { id: 'in', label: `in ${stats.signedIn}` },
              { id: 'waiting', label: `waiting ${stats.total - stats.signedIn}` },
            ]}
          />
          <Button tone="paper" size="sm" icon="download" onClick={exportIn} disabled={stats.signedIn === 0}>
            attendance csv
          </Button>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={stats.total === 0 ? 'no kits yet' : 'nobody matches'} hint={stats.total === 0 ? 'make some above and print the cards.' : 'try a different search.'} />
        ) : (
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>kit</th>
                  <th>who</th>
                  <th>roll</th>
                  <th>signed in</th>
                  <th>
                    <span className={s.srOnly}>actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => (
                  <tr key={k.kitId} data-testid={`kit-row-${k.kitId}`}>
                    <td className={s.kitCell}>{k.kitId}</td>
                    <td>
                      {k.attendee?.nickname ? (
                        <>
                          <b>{k.attendee.nickname}</b> <span className={s.faint}>{k.attendee.name}</span>
                        </>
                      ) : (
                        <span className={s.faint}>{k.attendee?.name ?? k.presetName ?? 'not claimed'}</span>
                      )}
                    </td>
                    <td>{k.attendee?.roll ?? k.presetRoll ?? ''}</td>
                    <td>
                      {k.attendee ? (
                        <span className={s.inBadge}>
                          <Doodle name="check" size={14} /> {time(k.attendee.firstSignInAt)}
                        </span>
                      ) : (
                        <span className={s.faint}>not yet</span>
                      )}
                    </td>
                    <td className={s.actionCell}>
                      {k.bound && (
                        <Button tone="paper" size="sm" icon="undo" onClick={() => setResetting(k)} aria-label={`reset ${k.kitId}`}>
                          reset
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ResetSheet kit={resetting} onClose={() => setResetting(null)} appUrl={appUrl} eventDate={eventDate} />
    </section>
  );
}

export function KitsPanel() {
  const cfg = useAppConfig();
  const appUrl = cfg.data?.appUrl ?? window.location.origin;
  const eventDate = cfg.data?.eventDate ?? '2026-11-21';
  return (
    <div className={s.panel}>
      <header className={s.panelHead}>
        <h1 className={s.panelTitle}>kits and sign-ins</h1>
        <Scribble color="var(--tangerine)" style={{ width: 220 }} />
      </header>
      <div className={s.twoCol}>
        <Generate />
        <BatchBanner appUrl={appUrl} eventDate={eventDate} />
      </div>
      <KitTable appUrl={appUrl} eventDate={eventDate} />
    </div>
  );
}
