/*
  First sign-in: confirm who you are, pick a nickname, build a face.
  Saving it is the second celebration (the first is signing in).
*/
import { type AvatarConfig, DEFAULT_AVATAR, type MeResponse, ProfileInputSchema, avatarFromSeed } from '@afterhours/shared';
import { useState } from 'react';
import { isApiError } from '../../core/api';
import { useSaveProfile } from '../../core/queries';
import { celebrate, haptics, sfx } from '../../fun';
import { Button, Card, Doodle, Scribble, TextField } from '../../kit';
import { AvatarBuilder } from './AvatarBuilder';
import s from './attendee.module.css';

const NICKS = ['pixel_pirate', 'null_pointer', 'segfault_sam', 'ctrl_alt_dee', 'git_gud', 'byte_me', 'stack_overflow', 'tab_not_space', 'rubber_duck', 'sudo_sandwich', 'hello_world', 'off_by_one'];

export function Profile({ me }: { me: MeResponse }) {
  const save = useSaveProfile();
  const [name, setName] = useState(me.attendee.name ?? me.preset.name ?? '');
  const [roll, setRoll] = useState(me.attendee.roll ?? me.preset.roll ?? '');
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState<AvatarConfig>(() => ({ ...DEFAULT_AVATAR, ...avatarFromSeed(me.attendee.id * 31 + 7) }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ProfileInputSchema.safeParse({ name, roll, nickname, avatar });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      sfx.fail();
      haptics.fail();
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: () => celebrate({ y: 0.55 }),
      onError: (err) => {
        const next: Record<string, string> = {};
        if (isApiError(err) && err.issues?.length) for (const i of err.issues) next[i.path.split('.')[0] ?? 'form'] ??= i.message;
        else next.form = err.message;
        setErrors(next);
        sfx.fail();
      },
    });
  };

  return (
    <form className={s.profile} onSubmit={submit} noValidate>
      <header className={s.profileHead}>
        <h1 className={s.bigTitle}>who are you?</h1>
        <Scribble color="var(--pink)" style={{ width: 170 }} />
        <p className={s.handNote}>build a face. poke it. it pokes back.</p>
      </header>

      <AvatarBuilder value={avatar} onChange={setAvatar} />

      <Card tone="paper" tilt={0.6} tape tapeColor="sky" className={s.fieldsCard}>
        <TextField label="your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" error={errors.name} />
        <TextField label="roll number" value={roll} onChange={(e) => setRoll(e.target.value)} autoCapitalize="characters" autoComplete="off" error={errors.roll} style={{ textTransform: 'uppercase' }} />
        <TextField
          label="nickname (shows on the leaderboard)"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="pixel_pirate"
          autoComplete="off"
          error={errors.nickname}
          maxLength={16}
          suffix={
            <Button
              tone="sun"
              size="sm"
              className={s.nickDice}
              aria-label="suggest one"
              onClick={() => {
                sfx.rattle();
                setNickname(NICKS[Math.floor(Math.random() * NICKS.length)] ?? 'hello_world');
              }}
            >
              <Doodle name="dice" size={22} />
            </Button>
          }
        />
      </Card>

      {errors.form && (
        <p className={s.formError} role="alert">
          {errors.form}
        </p>
      )}
      <Button type="submit" tone="lime" size="lg" block loading={save.isPending} icon="check">
        that&apos;s me
      </Button>
    </form>
  );
}
