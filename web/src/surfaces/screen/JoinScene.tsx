/* The default projector scene: how to get in. The app URL as a big QR. */
import { Draggy } from '../../fun';
import { ByRecurse, Card, Doodle, NumberTicker, Qr, Scribble } from '../../kit';
import { useAppConfig, usePresence } from '../../core/queries';
import { Wordmark } from '../shared/Wordmark';
import s from './screen.module.css';

export const JOIN_SCENE_ID = 'join';

export function JoinScene() {
  const cfg = useAppConfig();
  const presence = usePresence();
  const url = cfg.data?.appUrl ?? window.location.origin;
  const host = url.replace(/^https?:\/\//, '');
  const px = Math.max(40, Math.round(Math.min(window.innerWidth / 17, window.innerHeight / 9.5)));
  return (
    <div className={s.join}>
      <div className={s.joinLeft}>
        <Wordmark size={px * 1.05} />
        <ByRecurse on="dark" height={Math.round(px * 0.75)} />
        <h2 className={s.joinHead}>
          grab your phone.
          <Scribble color="var(--pink)" className={s.joinScribble} />
        </h2>
        <p className={s.joinHand}>point the camera at the square. your kit card has the password.</p>
        <p className={s.joinCount}>
          <Doodle name="users" size={px * 0.55} fill="var(--lime)" stroke="var(--paper)" />
          <span>
            <NumberTicker value={presence.data?.here ?? 0} /> already in
          </span>
        </p>
      </div>
      <div className={s.joinRight}>
        <Draggy className={s.starA}>
          <Doodle name="star" size={px * 1.3} fill="var(--sun)" stroke="var(--paper)" strokeWidth={1.6} />
        </Draggy>
        <Card tone="paper" tape tapeColor="pink" tilt={2.5} lift className={s.qrCard}>
          <Qr text={url} size={px * 5.2} label="Scan to open After Hours" />
          <p className={s.qrUrl}>{host}</p>
        </Card>
        <Doodle name="arrow" size={px * 1.7} stroke="var(--paper)" className={s.arrow} />
      </div>
    </div>
  );
}
