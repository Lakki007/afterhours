/*
  In-app QR scanner. Uses BarcodeDetector + getUserMedia where the browser has
  them (Android Chrome). Everywhere else, and whenever the camera is denied, it
  says what to do instead: open the phone's camera app (our QRs are plain URLs
  that open the app), or type the code. Never a dead end.
    <Scanner onCode={(text) => ...} onClose={...} />
*/
import { useEffect, useRef, useState } from 'react';
import { haptics, sfx } from '../../fun';
import { Button, Doodle } from '../../kit';
import s from './scanner.module.css';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

export function canScanInApp(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

type Phase = 'starting' | 'scanning' | 'denied' | 'unsupported';

export function Scanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>(canScanInApp() ? 'starting' : 'unsupported');
  const done = useRef(false);
  const cb = useRef(onCode);
  useEffect(() => {
    cb.current = onCode;
  });

  useEffect(() => {
    if (!canScanInApp()) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ['qr_code'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) return;
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        setPhase('scanning');
        let last = 0;
        const loop = async (t: number) => {
          if (stopped || done.current) return;
          if (t - last > 180 && v.readyState >= 2) {
            last = t;
            try {
              const found = await detector.detect(v);
              const hit = found[0]?.rawValue;
              if (hit && !done.current) {
                done.current = true;
                sfx.success();
                haptics.success();
                cb.current(hit);
                return;
              }
            } catch {
              /* frame not ready */
            }
          }
          raf = requestAnimationFrame((n) => void loop(n));
        };
        raf = requestAnimationFrame((n) => void loop(n));
      } catch {
        if (!stopped) setPhase('denied');
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div className={s.wrap}>
      {(phase === 'starting' || phase === 'scanning') && (
        <div className={s.viewport}>
          <video ref={video} className={s.video} playsInline muted />
          <div className={s.frame} aria-hidden="true" />
          <p className={s.hint}>{phase === 'starting' ? 'waking the camera...' : 'point it at the qr sticker'}</p>
        </div>
      )}
      {phase === 'denied' && (
        <div className={s.fallback}>
          <Doodle name="eye" size={40} fill="var(--pink)" />
          <p>
            <b>camera said no.</b> that's fine: open your phone's camera app and point it at the code, it opens right here. or type the code below.
          </p>
        </div>
      )}
      {phase === 'unsupported' && (
        <div className={s.fallback}>
          <Doodle name="qr" size={40} fill="var(--sky)" />
          <p>
            <b>open your camera app</b> and point it at the code. it opens right here in the app. or type the code below.
          </p>
        </div>
      )}
      <Button tone="paper" size="sm" onClick={onClose}>
        type it instead
      </Button>
    </div>
  );
}
