/* /dev/kit: every kit component and every sound, in one place. Not linked from the app. */
import { AVATAR_OPTIONS, type Glyph, GlyphSchema, type PaletteColor, StickerShapeSchema, avatarFromSeed } from '@afterhours/shared';
import { type ReactNode, useState } from 'react';
import { serverNow } from '../core/clock';
import { celebrate, confetti, Draggy, haptics, sfx, Tilt, useMuted } from '../fun';
import {
  Avatar,
  Button,
  Card,
  Countdown,
  Doodle,
  DoodleDefs,
  EmptyState,
  ErrorState,
  IconButton,
  type IconName,
  LoadingState,
  Mascot,
  Meter,
  Modal,
  NumberTicker,
  PageTransition,
  ProgressRing,
  Qr,
  Scribble,
  Sheet,
  Sticker,
  Tabs,
  TextArea,
  TextField,
  type Tone,
  ToastProvider,
  Torn,
  useToast,
} from '../kit';
import s from './kitpage.module.css';

const TONES: Tone[] = ['tangerine', 'lime', 'pink', 'grape', 'sky', 'sun', 'paper', 'ink'];
const ICONS: IconName[] = [
  ...GlyphSchema.options,
  'home', 'book', 'users', 'print', 'download', 'sound', 'mute', 'close', 'plus', 'qr', 'cog', 'bars', 'bell', 'clock', 'gamepad', 'screen', 'dice', 'phone', 'copy', 'search', 'undo', 'lock', 'morse', 'ticket', 'scissors', 'share', 'megaphone', 'trophy', 'pin', 'play', 'list',
];
const STICKER_COLORS: PaletteColor[] = ['tangerine', 'lime', 'pink', 'grape', 'sky', 'sun'];

function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className={s.section}>
      <h2 className={s.h2}>{title}</h2>
      {note && <p className={s.note}>{note}</p>}
      {children}
    </section>
  );
}

function Demo() {
  const toast = useToast();
  const [tab, setTab] = useState('a');
  const [sheet, setSheet] = useState(false);
  const [modal, setModal] = useState(false);
  const [val, setVal] = useState(62);
  const [muted, setMuted] = useMuted();
  const [seed, setSeed] = useState(1);
  const [txt, setTxt] = useState('');
  const sounds: [string, () => void][] = [
    ['tap', sfx.tap], ['pop', sfx.pop], ['tick', sfx.tick], ['success', sfx.success], ['fail', sfx.fail],
    ['fanfare', sfx.fanfare], ['whoosh', sfx.whoosh], ['rattle', sfx.rattle], ['note A5', () => sfx.note(880, 200)],
  ];
  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.h1}>kit</h1>
        <Scribble color="var(--tangerine)" style={{ width: 120 }} />
        <p className={s.note}>every component and every sound. sound only starts after your first tap.</p>
        <IconButton icon={muted ? 'mute' : 'sound'} label={muted ? 'unmute' : 'mute'} quiet tone={muted ? 'pink' : 'lime'} onClick={() => setMuted(!muted)} />
      </header>

      <Section title="buttons" note="Button, IconButton, LinkButton. press them: squish, tap blip, haptic.">
        <div className={s.row}>
          {TONES.map((t) => (
            <Button key={t} tone={t}>
              {t}
            </Button>
          ))}
        </div>
        <div className={s.row}>
          <Button tone="lime" size="sm" icon="check">small</Button>
          <Button tone="sun" icon="star">with icon</Button>
          <Button tone="pink" size="lg" icon="bolt">large</Button>
          <Button tone="paper" ghost>ghost</Button>
          <Button tone="sky" loading>loading</Button>
          <Button tone="tangerine" disabled>disabled</Button>
          <IconButton icon="bell" label="bell" />
        </div>
      </Section>

      <Section title="sounds and haptics" note="synthesised WebAudio, no files. each button plays one.">
        <div className={s.row}>
          {sounds.map(([n, f]) => (
            <Button key={n} tone="sky" size="sm" quiet onClick={f}>
              {n}
            </Button>
          ))}
          <Button tone="paper" size="sm" quiet onClick={() => haptics.celebrate()}>haptic: celebrate</Button>
          <Button tone="paper" size="sm" quiet onClick={() => haptics.fail()}>haptic: fail</Button>
          <Button tone="lime" size="sm" quiet onClick={() => { const stop = sfx.tone(600); window.setTimeout(stop, 400); }}>tone 0.4s</Button>
        </div>
      </Section>

      <Section title="celebrations">
        <div className={s.row}>
          <Button tone="pink" quiet onClick={() => confetti()}>confetti</Button>
          <Button tone="lime" quiet onClick={() => celebrate()}>celebrate (+fanfare)</Button>
          <Button tone="sun" onClick={() => toast('you found it', { kind: 'good', title: 'nice one' })}>toast good</Button>
          <Button tone="pink" onClick={() => toast('that code is old', { kind: 'bad', title: 'nope' })}>toast bad</Button>
          <Button tone="sky" onClick={() => toast('hunt starts now', { kind: 'info', url: '/hunt' })}>toast with link</Button>
          <Button tone="lime" onClick={() => toast('showed up', { kind: 'points', title: '+10 points' })}>toast points</Button>
        </div>
      </Section>

      <Section title="cards, tape, torn paper">
        <div className={s.grid}>
          <Card tone="paper" tape tilt={-1.5}><h3>paper + tape</h3><p>plain card stock, a bit crooked.</p></Card>
          <Card tone="tangerine" halftone tilt={1.4} tape="left" tapeColor="pink"><h3>tangerine</h3><p>halftone corner.</p></Card>
          <Card tone="grape" tilt={-1}><h3>grape</h3><p>light text on the dark block.</p></Card>
          <Card tone="lime" press onClick={() => sfx.pop()}><h3>press me</h3><p>whole card squishes.</p></Card>
          <Torn tone="sun"><div style={{ padding: 18 }}><h3>torn edge</h3><p>ripped banner.</p></div></Torn>
          <Tilt><Card tone="sky" lift><h3>tilt</h3><p>leans toward your finger.</p></Card></Tilt>
        </div>
      </Section>

      <Section title="inputs">
        <div className={s.grid}>
          <TextField label="kit id" placeholder="AH-042" value={txt} onChange={(e) => setTxt(e.target.value)} hint="the hint line" />
          <TextField label="with error" defaultValue="oops" error="that is not right" />
          <TextArea label="textarea" placeholder="paste here" rows={3} />
        </div>
      </Section>

      <Section title="tabs, sheet, modal">
        <Tabs value={tab} onChange={setTab} items={[{ id: 'a', label: 'one', icon: 'star' }, { id: 'b', label: 'two', icon: 'bolt' }, { id: 'c', label: 'three' }]} />
        <div className={s.row}>
          <Button tone="lime" onClick={() => setSheet(true)}>open sheet</Button>
          <Button tone="pink" onClick={() => setModal(true)}>open modal</Button>
        </div>
        <Sheet open={sheet} onClose={() => setSheet(false)} title="a bottom sheet"><p>drag the handle down, tap outside, or press Esc.</p></Sheet>
        <Modal open={modal} onClose={() => setModal(false)} title="a modal"><p>same thing, but in the middle.</p></Modal>
      </Section>

      <Section title="numbers: ticker, countdown, ring, meter">
        <div className={s.row}>
          <NumberTicker value={val} className={s.big} />
          <Button size="sm" tone="sun" onClick={() => setVal(Math.round(Math.random() * 900))}>new number</Button>
          <Countdown to={serverNow() + 5 * 60_000 + 7000} className={s.big} />
          <ProgressRing value={val / 900 > 1 ? 1 : (val % 100) / 100} size={120} tone="tangerine"><NumberTicker value={val % 100} className={s.ringNum} /></ProgressRing>
          <ProgressRing value={0.75} size={90} thickness={12} tone="lime" />
        </div>
        <div className={s.stack}>
          <Meter value={val / 900} tone="pink" label="demo" />
          <Meter value={0.4} tone="sky" />
        </div>
      </Section>

      <Section title="stickers" note="drawn from data: shape + colour + glyph. locked, and slap-on entrance.">
        <div className={s.row}>
          {StickerShapeSchema.options.map((shape, i) => (
            <Sticker key={shape} def={{ shape, color: STICKER_COLORS[i % 6] as PaletteColor, glyph: (GlyphSchema.options[i * 2] ?? 'star') as Glyph }} size={92} tilt={(i % 2 ? 1 : -1) * (3 + i)} />
          ))}
          <Sticker def={{ shape: 'ticket', color: 'pink', glyph: 'key' }} size={92} locked />
          <Draggy><Sticker def={{ shape: 'burst', color: 'sun', glyph: 'bolt' }} size={92} slap /></Draggy>
        </div>
      </Section>

      <Section title="avatars" note={`${Object.values(AVATAR_OPTIONS).reduce((n, a) => n + a.length, 0)} parts. tap to reshuffle.`}>
        <div className={s.row}>
          {Array.from({ length: 10 }, (_, i) => (
            <button key={i} type="button" className={s.avatarBtn} onClick={() => { sfx.pop(); setSeed((v) => v + 7); }} aria-label="reshuffle avatars">
              <Avatar config={avatarFromSeed(seed + i * 13)} size={84} wobble />
            </button>
          ))}
        </div>
      </Section>

      <Section title="states, mascot, page transition">
        <div className={s.grid}>
          <Card><EmptyState title="nothing yet" hint="vote, hunt, play. it shows up here." /></Card>
          <Card><LoadingState label="fetching stickers..." /></Card>
          <Card><ErrorState error="Wi-Fi being moody?" onRetry={() => toast('retrying', { kind: 'info' })} /></Card>
          <Card><div className={s.row}><Mascot mood="happy" /><Mascot mood="wow" /><Mascot mood="sleepy" /><Mascot mood="oops" /></div></Card>
          <Card><PageTransition pageKey={String(seed)}><p>this card flops in each time you reshuffle the avatars.</p></PageTransition></Card>
          <Card><Qr text="https://example.com" size={120} /></Card>
        </div>
      </Section>

      <Section title="doodles" note={`${ICONS.length} hand-drawn icons / glyphs. use <Doodle name="..." />.`}>
        <div className={s.icons}>
          {ICONS.map((n) => (
            <div key={n} className={s.icon}>
              <Doodle name={n} size={34} fill="var(--sun)" />
              <span>{n}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export default function KitPage() {
  return (
    <ToastProvider>
      <DoodleDefs />
      <Demo />
    </ToastProvider>
  );
}
