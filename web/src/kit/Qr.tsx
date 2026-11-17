/*
  Qr: renders text as a crisp SVG QR code (uqr, no network). Always dark on
  light with a quiet zone so phones scan it, whatever is behind it.
    <Qr text="https://..." size={160} />
*/
import { encode } from 'uqr';
import { useMemo } from 'react';

export function Qr({ text, size = 160, className, label }: { text: string; size?: number; className?: string; label?: string }) {
  const { path, n } = useMemo(() => {
    const { data } = encode(text, { ecc: 'M', border: 0 });
    const n = data.length;
    const parts: string[] = [];
    for (let y = 0; y < n; y++) {
      const row = data[y] ?? [];
      let x = 0;
      while (x < n) {
        if (row[x]) {
          let w = 1;
          while (x + w < n && row[x + w]) w++;
          parts.push(`M${x} ${y}h${w}v1h${-w}z`);
          x += w;
        } else x++;
      }
    }
    return { path: parts.join(''), n };
  }, [text]);
  const quiet = 3;
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}
      width={size}
      height={size}
      className={className}
      shapeRendering="crispEdges"
      data-qr-text={text}
      role="img"
      aria-label={label ?? 'QR code'}
    >
      <rect x={-quiet} y={-quiet} width={n + quiet * 2} height={n + quiet * 2} fill="#fff" />
      <path d={path} fill="#1d1630" />
    </svg>
  );
}
