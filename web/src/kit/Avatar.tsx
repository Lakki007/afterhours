/*
  Avatar: draws a shared AvatarConfig as a hand-inked blob character.
  Used everywhere a person appears (home, leaderboard, projector).
    <Avatar config={me.avatar} size={96} />
  `look` (-1..1 on each axis) nudges the pupils: the builder feeds it the pointer.
*/
import { type AvatarConfig, DEFAULT_AVATAR, type PaletteColor } from '@afterhours/shared';
import type { CSSProperties, ReactNode } from 'react';

export interface Look {
  x: number;
  y: number;
}

const FILL: Record<PaletteColor, string> = {
  tangerine: 'var(--tangerine)',
  lime: 'var(--lime)',
  pink: 'var(--pink)',
  grape: 'var(--grape)',
  sky: 'var(--sky)',
  sun: 'var(--sun)',
  paper: 'var(--paper-3)',
  ink: 'var(--ink)',
};

/** A colour that stands out against each body colour, for hats and accessories. */
const ACCENT: Record<string, string> = {
  tangerine: 'var(--sky)',
  lime: 'var(--grape)',
  pink: 'var(--sun)',
  grape: 'var(--lime)',
  sky: 'var(--tangerine)',
  sun: 'var(--pink)',
};

const INK = 'var(--ink)';
const PAPER = 'var(--paper-3)';

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return pts.join(' ');
}

function Body({ shape, fill }: { shape: AvatarConfig['shape']; fill: string }) {
  const common = { fill, stroke: INK, strokeWidth: 3.6, strokeLinejoin: 'round' as const };
  switch (shape) {
    case 'square':
      return <path {...common} d="M19 20L83 17Q89 17 88 24L86 82Q86 88 80 88L20 90Q13 90 13 83L14 26Q14 21 19 20z" />;
    case 'tv':
      return (
        <>
          <path {...common} d="M20 24L82 21Q89 21 89 28L88 78Q88 85 81 85L19 87Q12 87 12 80L13 31Q13 25 20 24z" />
          <path d="M23 33L77 31Q80 31 80 35L79 74Q79 77 76 77L24 78Q21 78 21 75L21 36Q21 33 23 33z" fill={PAPER} fillOpacity="0.38" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
        </>
      );
    case 'bean':
      return <path {...common} d="M50 11C71 11 81 30 80 53 79 75 68 90 50 90 32 90 20 75 20 53 20 30 29 11 50 11z" />;
    case 'cloud':
      return <path {...common} d="M27 84C10 84 7 63 24 59 19 40 41 31 51 42 59 28 84 35 81 55 96 59 93 84 76 84z" />;
    case 'flower': {
      const petals = Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <circle key={i} cx={50 + Math.cos(a) * 31} cy={55 + Math.sin(a) * 31} r="15" {...common} />;
      });
      return (
        <>
          {petals}
          <circle cx="50" cy="55" r="30" fill={fill} />
        </>
      );
    }
    case 'blob':
    default:
      return <path {...common} d="M50 14C72 12 90 28 88 52 86 76 70 90 48 88 26 87 11 72 13 48 15 28 30 15 50 14z" />;
  }
}

function Eyes({ kind, look }: { kind: AvatarConfig['eyes']; look: Look }) {
  const dx = look.x * 3.2;
  const dy = look.y * 2.6;
  const move = `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`;
  const arc = { fill: 'none', stroke: INK, strokeWidth: 3.4, strokeLinecap: 'round' as const };
  switch (kind) {
    case 'wide':
      return (
        <>
          {[37, 63].map((x) => (
            <g key={x}>
              <circle cx={x} cy="49" r="9" fill={PAPER} stroke={INK} strokeWidth="3" />
              <circle cx={x + dx} cy={49 + dy} r="3.8" fill={INK} />
            </g>
          ))}
        </>
      );
    case 'sleepy':
      return (
        <>
          <path d="M29 50Q37 58 45 50" {...arc} />
          <path d="M55 50Q63 58 71 50" {...arc} />
        </>
      );
    case 'wink':
      return (
        <>
          <circle cx="37" cy="50" r="4.2" fill={INK} transform={move} />
          <path d="M56 51Q63 44 70 51" {...arc} />
        </>
      );
    case 'stars':
      return (
        <>
          <polygon points={star(37, 49, 9)} fill={PAPER} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" transform={move} />
          <polygon points={star(63, 49, 9)} fill={PAPER} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" transform={move} />
        </>
      );
    case 'visor':
      return (
        <>
          <path d="M24 42H76Q79 42 79 45V55Q79 58 76 58H24Q21 58 21 55V45Q21 42 24 42z" fill={INK} />
          <path d="M28 47H44M56 47H64" stroke={PAPER} strokeWidth="2.6" strokeLinecap="round" transform={move} />
        </>
      );
    case 'cyclops':
      return (
        <>
          <circle cx="50" cy="49" r="13" fill={PAPER} stroke={INK} strokeWidth="3.2" />
          <circle cx={50 + dx * 1.3} cy={49 + dy * 1.3} r="5.6" fill={INK} />
        </>
      );
    case 'specs':
      return (
        <>
          <circle cx="35" cy="50" r="10" fill={PAPER} fillOpacity="0.7" stroke={INK} strokeWidth="3" />
          <circle cx="65" cy="50" r="10" fill={PAPER} fillOpacity="0.7" stroke={INK} strokeWidth="3" />
          <path d="M45 49Q50 45 55 49" fill="none" stroke={INK} strokeWidth="3" />
          <circle cx={35 + dx} cy={50 + dy} r="3.2" fill={INK} />
          <circle cx={65 + dx} cy={50 + dy} r="3.2" fill={INK} />
        </>
      );
    case 'dots':
    default:
      return (
        <>
          <circle cx="37" cy="50" r="4.4" fill={INK} transform={move} />
          <circle cx="63" cy="50" r="4.4" fill={INK} transform={move} />
        </>
      );
  }
}

function Mouth({ kind }: { kind: AvatarConfig['mouth'] }) {
  const line = { fill: 'none', stroke: INK, strokeWidth: 3.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'flat':
      return <path d="M39 69H61" {...line} />;
    case 'oh':
      return <ellipse cx="50" cy="70" rx="5.6" ry="7" fill={INK} />;
    case 'teeth':
      return (
        <>
          <path d="M33 63H67V71Q50 81 33 71z" fill={PAPER} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <path d="M42 63V74M50 63V77M58 63V74" stroke={INK} strokeWidth="2" />
        </>
      );
    case 'tongue':
      return (
        <>
          <path d="M44 70Q46 84 56 78Q57 73 56 70z" fill="var(--pink)" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M36 64Q50 78 64 64" {...line} />
        </>
      );
    case 'smirk':
      return <path d="M38 70Q52 73 65 61" {...line} />;
    case 'wobble':
      return <path d="M33 68q4.500-6 9 0t9 0 9 0 9 0" {...line} />;
    case 'cat':
      return <path d="M35 64Q43 74 50 65Q57 74 65 64" {...line} />;
    case 'grin':
    default:
      return <path d="M36 63Q50 82 64 63z" fill={PAPER} stroke={INK} strokeWidth="3.2" strokeLinejoin="round" />;
  }
}

function Top({ kind, accent }: { kind: AvatarConfig['top']; accent: string }) {
  const st = { stroke: INK, strokeWidth: 3.4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  switch (kind) {
    case 'antenna':
      return (
        <>
          <path d="M50 18Q47 8 54 5" fill="none" {...st} />
          <circle cx="54" cy="5.500" r="4.600" fill="var(--sun)" {...st} strokeWidth="3" />
        </>
      );
    case 'cap':
      return (
        <>
          <path d="M23 32Q28 8 52 9Q74 10 78 32z" fill={accent} {...st} />
          <path d="M60 31H93Q92 38 79 37L60 36z" fill={accent} {...st} />
        </>
      );
    case 'beanie':
      return (
        <>
          <path d="M24 33Q24 8 50 8Q76 8 76 33z" fill={accent} {...st} />
          <rect x="21" y="28" width="58" height="9" rx="4" fill={PAPER} {...st} strokeWidth="3" />
          <circle cx="50" cy="6" r="5" fill={PAPER} {...st} strokeWidth="3" />
        </>
      );
    case 'crown':
      return <path d="M28 30L28 9L40 20L50 5L60 20L72 9L72 30z" fill="var(--sun)" {...st} />;
    case 'sprout':
      return (
        <>
          <path d="M50 20V9" fill="none" {...st} />
          <path d="M50 11Q36 1 31 10Q42 17 50 11z" fill={accent} {...st} strokeWidth="2.800" />
          <path d="M50 11Q64 1 69 10Q58 17 50 11z" fill={accent} {...st} strokeWidth="2.800" />
        </>
      );
    case 'horns':
      return (
        <>
          <path d="M27 30L20 6L42 21z" fill={INK} {...st} />
          <path d="M73 30L80 6L58 21z" fill={INK} {...st} />
        </>
      );
    case 'headphones':
      return (
        <>
          <path d="M18 54Q16 11 50 11Q84 11 82 54" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" />
          <rect x="9" y="44" width="15" height="22" rx="6" fill={accent} {...st} />
          <rect x="76" y="44" width="15" height="22" rx="6" fill={accent} {...st} />
        </>
      );
    case 'none':
    default:
      return null;
  }
}

function Extra({ kind }: { kind: AvatarConfig['extra'] }): ReactNode {
  switch (kind) {
    case 'blush':
      return (
        <>
          <ellipse cx="27" cy="62" rx="6" ry="4" fill="var(--pink)" fillOpacity="0.75" />
          <ellipse cx="73" cy="62" rx="6" ry="4" fill="var(--pink)" fillOpacity="0.75" />
        </>
      );
    case 'freckles':
      return (
        <g fill={INK} fillOpacity="0.7">
          {[[28, 60], [33, 64], [26, 66], [72, 60], [67, 64], [74, 66]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />
          ))}
        </g>
      );
    case 'bandaid':
      return (
        <g transform="rotate(-24 68 38)">
          <rect x="56" y="33" width="24" height="10" rx="4.500" fill="var(--paper-2)" stroke={INK} strokeWidth="2.400" />
          <path d="M65 36V40M70 36V40" stroke={INK} strokeWidth="1.800" strokeLinecap="round" />
        </g>
      );
    case 'mustache':
      return <path d="M34 66Q42 58 50 65Q58 58 66 66Q58 73 50 68Q42 73 34 66z" fill={INK} />;
    case 'scar':
      return <path d="M62 36L70 60M59 45L66 43M62 53L69 50" fill="none" stroke={INK} strokeWidth="2.800" strokeLinecap="round" />;
    case 'sweat':
      return <path d="M79 30Q85 40 79 45Q73 40 79 30z" fill="var(--sky)" stroke={INK} strokeWidth="2.400" strokeLinejoin="round" />;
    case 'earring':
      return <circle cx="14" cy="64" r="4.600" fill="none" stroke="var(--sun)" strokeWidth="3.400" />;
    case 'none':
    default:
      return null;
  }
}

export interface AvatarProps {
  config?: AvatarConfig | null;
  size?: number | string;
  look?: Look;
  /** Draw the hand-wobble filter on the outlines (nicer big, skip in long lists). */
  wobble?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Avatar({ config, size = 80, look = { x: 0, y: 0 }, wobble = false, className, style, title }: AvatarProps) {
  const c = config ?? DEFAULT_AVATAR;
  const fill = FILL[c.color];
  const accent = ACCENT[c.color] ?? 'var(--sky)';
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={{ overflow: 'visible', ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g filter={wobble ? 'url(#ah-wobble)' : undefined}>
        <Body shape={c.shape} fill={fill} />
        <Top kind={c.top} accent={accent} />
        <Extra kind={c.extra} />
        <Eyes kind={c.eyes} look={look} />
        <Mouth kind={c.mouth} />
      </g>
    </svg>
  );
}
