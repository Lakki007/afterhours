/*
  Inputs. The label is handwriting above the box; errors are a pink scrap under it.
    <TextField label="kit id" value=... onChange=... error="..." />
*/
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useId } from 'react';
import s from './kit.module.css';

interface FieldShell {
  label: string;
  hint?: string;
  error?: string | null;
}

export const TextField = forwardRef<HTMLInputElement, FieldShell & { suffix?: ReactNode } & InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { label, hint, error, suffix, className, id, ...rest },
  ref,
) {
  const uid = useId();
  const fid = id ?? uid;
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={fid}>
        {label}
      </label>
      <div className={s.inputWrap}>
        <input
          {...rest}
          ref={ref}
          id={fid}
          className={`${s.input} ${className ?? ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-e` : hint ? `${fid}-h` : undefined}
          style={suffix ? { paddingRight: 56, ...rest.style } : rest.style}
        />
        {suffix && <div className={s.inputSuffix}>{suffix}</div>}
      </div>
      {hint && !error && (
        <span id={`${fid}-h`} className={s.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={`${fid}-e`} className={s.err} role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const uid = useId();
  const fid = id ?? uid;
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={fid}>
        {label}
      </label>
      <textarea {...rest} ref={ref} id={fid} className={`${s.input} ${s.textarea} ${className ?? ''}`} aria-invalid={error ? true : undefined} />
      {hint && !error && <span className={s.hint}>{hint}</span>}
      {error && (
        <span className={s.err} role="alert">
          {error}
        </span>
      )}
    </div>
  );
});
