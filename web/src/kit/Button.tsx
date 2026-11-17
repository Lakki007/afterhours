/*
  Button family. Every press: tactile squish (CSS), a tap blip and a haptic tick,
  all skipped when muted / unsupported. Use `tone` for the colour block.
    <Button tone="lime" icon="check" onClick={...}>got it</Button>
    <LinkButton to="/stickers">sticker book</LinkButton>
    <IconButton icon="close" label="close" />
*/
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { haptics } from '../fun/haptics';
import { sfx } from '../fun/sfx';
import { Doodle, type IconName } from './Doodle';
import s from './kit.module.css';

export type Tone = 'tangerine' | 'lime' | 'pink' | 'grape' | 'sky' | 'sun' | 'paper' | 'ink';

interface BaseProps {
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  ghost?: boolean;
  icon?: IconName;
  /** Skip the tap blip + haptic (games with their own sounds). */
  quiet?: boolean;
}

function cls(p: BaseProps, extra = ''): string {
  return [
    s.btn,
    s[`tone-${p.tone ?? 'tangerine'}`],
    p.size === 'sm' ? s['btn-sm'] : p.size === 'lg' ? s['btn-lg'] : '',
    p.block ? s['btn-block'] : '',
    p.ghost ? s['btn-ghost'] : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

function feel(quiet?: boolean) {
  if (quiet) return;
  sfx.tap();
  haptics.tap();
}

export interface ButtonProps extends BaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  loading?: boolean;
  children?: ReactNode;
}

export function Button({ tone, size, block, ghost, icon, quiet, loading, children, className, onPointerDown, type = 'button', disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cls({ tone, size, block, ghost }, className)}
      onPointerDown={(e) => {
        if (!disabled && !loading) feel(quiet);
        onPointerDown?.(e);
      }}
    >
      {loading ? <span className={s.btnSpin} aria-hidden="true" /> : icon ? <Doodle name={icon} size={size === 'lg' ? 28 : 20} stroke="currentColor" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, tone = 'paper', size = 'md', quiet, className, ...rest }: Omit<ButtonProps, 'children' | 'icon'> & { icon: IconName; label: string }) {
  return (
    <Button {...rest} tone={tone} size={size} quiet={quiet} aria-label={label} title={label} className={`${s['btn-icon']} ${className ?? ''}`}>
      <Doodle name={icon} size={size === 'sm' ? 20 : 24} stroke="currentColor" />
    </Button>
  );
}

export function LinkButton({ tone, size, block, ghost, icon, quiet, children, className, onPointerDown, ...rest }: BaseProps & LinkProps) {
  return (
    <Link
      {...rest}
      className={cls({ tone, size, block, ghost }, className)}
      onPointerDown={(e) => {
        feel(quiet);
        onPointerDown?.(e);
      }}
    >
      {icon && <Doodle name={icon} size={20} stroke="currentColor" />}
      {children}
    </Link>
  );
}
