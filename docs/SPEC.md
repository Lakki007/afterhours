# After Hours — build spec

Single source of truth for everyone building this app. If the code and this file disagree, raise it; don't silently pick one.

## 1. What this is

After Hours is a chill afternoon tech event run by Recurse, the technical club of KMIT. This app is the attendee's companion for the afternoon: an installable PWA they open on their phone at the door. It shows what is running now and next, alerts them before highlight activities, and is where they play every poll, hunt, Morse round and mini-game.

- Event date: **21 November 2026**, one afternoon, one venue.
- Audience: college students on their own phones (mostly Android Chrome, some iPhone Safari), on flaky college Wi-Fi or mobile data.
- Scale: design and test for **300 concurrent phones**.
- Three surfaces, one codebase:
  - **Attendee app** (`/`) — phone first, installable.
  - **Organiser console** (`/admin`) — laptop first, PIN protected.
  - **Projector view** (`/screen`) — 16:9 big screen, read only, PIN protected.

## 2. The feel (non-negotiable)

The owner's words: "really interactive, really fun, not some static one, very fun elements, funky style."

Every screen must react to the person using it. A screen that only displays text and a button is a failed screen.

- **Motion everywhere it means something:** springy presses, cards that tilt and drag, numbers that count up, bars that race, stickers that peel and slap on.
- **Sound and haptics:** short synthesised WebAudio blips (no audio files to download), `navigator.vibrate` on Android. One global mute toggle, remembered. Never play sound before the first user gesture.
- **Rewards:** confetti and a sticker on every win. A personal **sticker book** fills as people check in, vote, find hunt stops and beat Morse rounds.
- **Presence:** people see that others are here: live counters ("143 voting"), floating emoji reactions that also rain on the projector, a leaderboard that reshuffles with animation.
- **Voice:** copy is written like a club member talking to a friend. Short, cheeky, lowercase is fine. No corporate phrasing, no "Welcome to the platform".

### Visual direction: "zine at dusk"

A loud, hand-assembled, photocopied-club-poster look. Think cut paper, sticker sheets, marker scribbles, arcade tokens.

- Cream paper base with heavy ink outlines and hard offset shadows; loud flat colour blocks (tangerine, electric lime, hot pink, grape, sky) used in big confident shapes, not gradients.
- Chunky display type for headings, a readable grotesque for body, a handwriting face for scribbled asides. **Fonts are bundled in the repo** (woff2, open licence) so the app works offline and never calls a font CDN.
- Hand-drawn SVG doodles (stars, arrows, squiggles, a mascot is welcome), slight rotations, tape and sticker edges, halftone or grain texture.
- A dark "after hours" variant for the projector view.

**Hard bans** — the owner has rejected these on a previous project as looking "AI made": frosted glass panels, purple-to-blue gradients, letter-spaced all-caps micro labels, glowing status dots, gradient pill buttons, middle-dot separators, generic dashboard cards with soft shadows, emoji used as the only decoration, stock icon-library look. Also banned: anything cartoonish in a clip-art way.

Design tokens live in one file (`web/src/styles/tokens.css`). Feature code uses tokens and the shared UI kit; it never invents colours, fonts or shadows.

Accessibility floor: 4.5:1 text contrast, 44px touch targets, `prefers-reduced-motion` respected (motion reduced, not removed), every game playable without sound.

## 3. Stack

- **Node 24**, TypeScript everywhere, npm workspaces: `shared/`, `server/`, `web/`.
- **server/**: Fastify, `node:sqlite` (built in, no native module), Zod validation, `web-push` for notifications. One process. SQLite file in a mounted volume, WAL mode.
- **web/**: Vite, React, React Router, TanStack Query, `motion` for animation, `vite-plugin-pwa` (Workbox, `injectManifest` so the service worker can handle push). CSS Modules + CSS variables. No Tailwind, no component library.
- **shared/**: Zod schemas and TypeScript types for every request, response and live event. Server and web both import from here. Nobody hand-writes a type that crosses the wire.
- **Live updates:** one SSE stream `GET /api/live` per client, with automatic fallback to polling `GET /api/live/poll?since=<cursor>` if the stream fails or stalls for 5 s. The web app has one `useLive()` layer; features subscribe by event name.
- **Tests:** Vitest for server logic and shared code; Playwright for a few end-to-end flows. `npm test` at the root runs everything that doesn't need a browser.
- **Deploy:** Docker on a DigitalOcean droplet. Multi-stage `Dockerfile` (build web, build server, slim runtime serving the built web statically from Fastify), `docker-compose.yml` with the app plus Caddy for automatic HTTPS, data volume for SQLite, all secrets via env (`.env.example` documents each). HTTPS is mandatory: service workers, push and the camera all need it.

Keep dependencies few. Every dependency added must be justified in the PR/commit message.

## 4. Sign-in

Passwords are handed out on a card in the **entry kit**. Organisers help people sign in at the entry desk.

- An organiser generates **kits** in the console: each kit is a short ID (e.g. `AH-042`) and a password of 3 short words or 6 unambiguous characters (no 0/O, 1/l/I). The console prints them as cut-out cards with a QR code that opens the app with the kit ID prefilled. The password is **never** in the QR.
- Kits can be generated blank (N cards) or from a pasted CSV of `name,roll`.
- Attendee signs in with kit ID + password. On first sign-in they confirm name and roll number, pick a nickname and build an avatar. A kit binds to one attendee; it can be signed in on a second device only after an organiser resets it.
- Passwords are stored hashed (scrypt). Plain passwords exist only in the printable sheet shown once at generation and in a downloadable CSV at that moment.
- Session: httpOnly, SameSite=Lax, Secure cookie; lasts the event day. Login is rate limited per IP and per kit ID.
- Organisers: a console PIN from env (`ADMIN_PIN`), separate cookie. Projector: `SCREEN_PIN`.
- **First sign-in is the event attendance record** (timestamped).

## 5. Features

### 5.1 Home: now and next
- Big "happening now" card with a live progress ring, "up next" with a countdown, the full timeline below.
- A highlight activity gets special treatment (bigger, animated, sticker).
- Organisers can start, end, delay (+5/+10/+15), reorder and edit activities live; every phone updates within 2 s.
- Each activity has: title, blurb, location, start, end, kind (`talk | game | poll | hunt | morse | break | other`), highlight flag, optional link to the in-app feature that goes with it.
- Server time is the source of truth; the client computes an offset and never trusts the phone clock.

### 5.2 Attendance
- Event attendance = first sign-in.
- Per-activity check-in: the projector shows a 4-character code that rotates every 30 s (TOTP-style, derived server side, accepts current and previous window). Attendee types it, or scans the QR beside it. Check-in earns a sticker and points.
- Console: live count per activity, searchable list, CSV export.

### 5.3 Alerts
- Web Push "starts in 15 min" and "live now" for highlight activities, plus organiser broadcast announcements. Sent once each, idempotent across restarts and schedule edits (a delayed activity re-arms its 15-minute alert).
- In-app banner/toast for everyone via the live stream, whether or not push is enabled.
- A friendly permission prompt at a sensible moment (after first sign-in, not on page load). On iPhone, explain that alerts need "Add to Home Screen" and show how.

### 5.4 Polls
- Types: single choice, multi choice, this-or-that (two big tappable halves), rating scale (drag slider or emoji scale), word cloud (short free text), and **quiz** (one correct answer, countdown, points with a speed bonus).
- Organiser builds polls ahead of time, then launches / closes / reveals. One live poll at a time; it takes over the attendee home screen with an animated entrance.
- Results animate live on phones (after voting) and on the projector. Word cloud text passes a profanity filter and can be hidden by an organiser.
- One vote per attendee per poll, enforced server side. Quiz answers never reach the client before reveal.

### 5.5 Treasure hunt (individual)
- A sequence of stops. Each has a clue (text, optional image), and is solved by scanning a QR sticker at the venue or typing an answer. Answers are normalised (case, spaces) and checked server side; the client never holds answers or future clues.
- Each attendee gets the stops in a **shuffled order** (same final stop for all) so people spread out instead of following each other.
- Hints: up to 2 per stop, each costs points. Wrong-answer cooldown to stop brute force.
- Camera QR scanning in-app (`BarcodeDetector` where available, a small JS decoder fallback), with typed code fallback when the camera is denied.
- UI is a map/passport that collects stamps. Finishing triggers a big celebration; finish order and time decide bonus points.
- Console: build stops, print the QR stickers, watch live progress, open/close the hunt.

### 5.6 Morse challenge
- Practice mode with a tappable chart and a free-play key.
- **Decode** rounds: the phone plays a word as beeps, screen flashes and vibration; attendee types it. **Encode** rounds: attendee taps a big telegraph key (short/long press, real tone) to send a given word; timing is judged with tolerance.
- Rounds get harder (longer words, faster speed). Words are picked server side per attendee; the answer for a decode round is never sent to the client in readable form before submission. (Timings are necessarily observable; that is accepted.)
- Scored on accuracy and speed.

### 5.7 Arcade
Three small, quick, tech-flavoured mini-games people can play between sessions, each under 60 seconds a run, each feeding the leaderboard with a capped daily contribution so the arcade cannot outweigh the main challenges. Scores are sanity-checked server side (run tokens, plausible bounds). Suggested: a reaction-time game, a binary/hex speed game, a memory-pattern game. The builder may propose better ones.

### 5.8 Points, leaderboard, sticker book
- One points ledger table: every award is a row (`attendee, source, ref, points, at`) with a unique key so nothing is awarded twice.
- Leaderboard: top list + "you are #N", animated reordering, live. Projector version too.
- Sticker book: a defined set of stickers with unlock rules; unlocking is a ledger-like idempotent event and pops a celebration.

### 5.9 Reactions
A floating reaction bar on the attendee home screen: tap an emoji and it floats up on your phone and on the projector. Rate limited per attendee, batched on the server.

### 5.10 Organiser console
Run of show (5.1), kits and attendance (4, 5.2), polls (5.4), hunt (5.5), Morse and arcade on/off, announcements, leaderboard, and a danger zone (reset a feature's data, behind a typed confirmation).

### 5.11 Projector view
Auto-rotating scenes driven by what is live: join QR and now/next by default; live poll results when a poll is open; check-in code when a check-in is open; leaderboard; hunt progress; reaction rain overlaid on everything. Organiser can pin a scene.

## 6. Security and fairness
- Everything that decides points is validated on the server. Assume attendees open dev tools.
- Zod-validate every input. Rate limit auth, votes, answers, reactions.
- No secrets in the repo. `.env` is git-ignored.
- Escape/whitelist any attendee-supplied text shown on the projector.

## 7. Repo conventions
- Feature code is foldered by feature on both sides: `server/src/features/<name>/` and `web/src/features/<name>/`. A feature registers its routes, live events, attendee screens, console panel and projector scene through small registries set up by the foundation. A feature agent should rarely need to touch another feature's folder.
- Database migrations are numbered SQL files per feature (`server/src/features/<name>/migrations/NNN_*.sql`), applied in order at boot.
- TypeScript strict. No `any` across module boundaries. Lint and typecheck must pass.
- Commit small and often with clear messages. **Never push.** Never commit secrets.
- `npm run dev` starts server and web together. `npm run seed` loads a believable demo event (schedule, polls, hunt, kits with known demo passwords) so anyone can try everything in two minutes.
