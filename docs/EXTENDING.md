# Extending After Hours

How a feature plugs in, using **reactions** (spec 5.9) as the worked example. A feature lives in three folders and touches nothing else except one line in each registry.

```
shared/src/features/reactions.ts        Zod schemas, types, live event names
server/src/features/reactions/          routes, migrations, stickers, ticks, seed, tests
web/src/features/reactions/             home card, overlays, console panel, scenes
```

## 1. Shared contract (`shared/src/features/<name>.ts`)

Every request, response and live payload is a Zod schema here. Server and web both import it as `@afterhours/shared/features/<name>`. Live events are declared by augmenting the `LiveEvents` map, which types `ctx.live.publish()` on the server and `useLiveEvent()` on the web:

```ts
declare module '../live' {
  interface LiveEvents {
    'reactions.burst': ReactionBurst;
  }
}
```

Event names are `<feature>.<event>`.

## 2. Server (`server/src/features/<name>/index.ts`)

Export one `defineFeature({...})` and add it to `server/src/features/registry.ts` (import + array entry, alphabetical). The slots, all optional:

| slot | what it does |
| --- | --- |
| `name` | folder name; routes mount at `/api/<name>` |
| `routes(app, ctx)` | Fastify routes. Guard with `requireAttendee` / `requireAdmin` / `requireScreen`, parse bodies with `parse(Schema, req.body)` |
| `stickers` | sticker catalogue entries the feature can unlock |
| `boot(ctx)` | once after migrations |
| `tick: { everyMs, run }` | periodic work (reactions flushes its batch every ~400 ms) |
| `seed(ctx)` | demo data for `npm run seed`; `seedAfter: ['other']` if it needs another feature's seed first |

`ctx` (`server/src/core/context.ts`) gives you `db` (node:sqlite, with `one`/`all`/`run`/`tx` helpers), `live.publish(event, payload, audience)`, `points.award(...)` and `points.revokeSource(...)` (idempotent ledger), `stickers.unlock(...)` / `stickers.revokePrefix(...)`, `push.sendPush(...)`, `log` and `now()` (use it instead of `Date.now()` so tests can fake time).

Migrations are numbered SQL files in `server/src/features/<name>/migrations/NNN_*.sql`, applied in order at boot. Prefix table names with the feature name.

Tests sit next to the feature (`reactions.test.ts`) and use `server/test/helpers.ts` (`makeApp`, `signIn`, `req`).

Reading another feature: import its exported service functions read-only (attendance imports schedule's activity lookup). Never write another feature's tables.

## 3. Web (`web/src/features/<name>/index.tsx`)

Export one `defineFeature({...})` from `web/src/core/feature.ts` and add it to `web/src/features/registry.ts`. Slots, all optional:

| slot | where it shows |
| --- | --- |
| `routes: [{ path, Component }]` | attendee screens under `/` (e.g. `polls`, `hunt/s/:token`) |
| `home: { order, Card }` | a card on the attendee home, sorted by order |
| `nav` | an entry in the attendee bottom nav (keep it for the big things) |
| `console: { order, label, path, icon, Panel }` | a panel at `/admin/<path>` |
| `scenes: [{ id, label, Component, useStatus, durationMs, order }]` | projector scenes; `useStatus()` returns `off`, `available` or `takeover` |
| `AttendeeOverlay` / `ScreenOverlay` | always mounted over the attendee app / projector |

Reactions fills four: `home` (the emoji bar), `AttendeeOverlay` (floating emoji on the phone), `ScreenOverlay` (the rain), `console` (stats).

Use these, not your own versions:

- `api.get/post/patch/del(path, body?, Schema)` from `core/api` (validates the response).
- `useLiveEvent('<event>', handler)` from `core/live`. On reconnect the stream replays missed events from its cursor; if the server buffer overflowed, the live layer invalidates every TanStack query, so keep server state in queries and you get refetch-on-reconnect for free.
- `useServerNow()` / `serverNow()` from `core/clock` for every countdown. Never the phone clock.
- UI from `kit/` (Button, Card, Sticker, Tabs, Toast, ProgressRing, Countdown, NumberTicker, Qr, Sheet...) and fun from `fun/` (`sfx`, `haptics`, `confetti`, `celebrate`, `Tilt`).
- Colours, fonts, shadows and motion only from `web/src/styles/tokens.css`. Spec section 2 hard bans apply.

## 4. Checklist for a new feature

1. Shared schemas + `LiveEvents` augmentation.
2. Server feature + migration + tests; add to the server registry.
3. Web feature; add to the web registry.
4. An e2e spec in `e2e/` and screenshots in `docs/screens/<feature>-*.png`.
5. `npm run check` green.
