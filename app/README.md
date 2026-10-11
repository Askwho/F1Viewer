# Pit Wall

A live F1 timing dashboard for the living room. A small relay on this PC connects to F1's own live timing feed and serves a dashboard to any device on the home network, designed for a Galaxy Tab S9 Ultra in landscape.

## Run it

| | Start | Stop |
|---|---|---|
| Desktop | **Pit Wall** shortcut (opens minimised) | **Stop Pit Wall** shortcut |
| Folder | `start.cmd` | `stop.cmd`, Ctrl+C, or close the window |
| Terminal | `npm start` | `npm stop` |

Every way of stopping shuts down cleanly and saves the session recording. Starting it twice just says it's already running. Stopping only works from this PC; the tablet can't shut it down.

Then open `http://<this PC's IP>:8787` on the tablet. The relay prints its addresses on start. In Chrome on the tablet, use ⋮ → *Add to home screen* so it opens full screen.

- `npm run build`: rebuild the dashboard after changing anything in `web/`
- `npm run dev`: hot-reloading dashboard on :5173, talking to a relay on :8787
- `http://localhost:8787/tablet.html`: preview at the tablet's exact size on the PC

## Replays

Any finished session can be replayed from F1's public archive, at real speed and through the same pipeline as live:

```
node server/index.ts --replay 2026/2026-10-04_Bahrain_Grand_Prix/2026-10-04_Race --from lap:20
node server/index.ts --replay <path> --from start|lap:N|h:mm:ss [--speed 4] [--port 8788]
```

Session paths are listed in `https://livetiming.formula1.com/static/2026/Index.json`. Every live session is also recorded to `data/recordings/` (gzipped JSONL).

## F1 TV token (optional: car positions on the map)

Timing, gaps, tyres, race control and team radio work without any login. Live car positions need your F1 TV subscription token:

1. On the PC, sign in at <https://www.formula1.com> with your F1 TV account.
2. Press F12 and open **Application → Cookies → https://www.formula1.com**.
3. Find the cookie named **`login-session`** and copy its **Value**.
4. On the dashboard, tap the **Live** chip (top right). Paste it under *F1 TV token* and save. You can instead save it into `app/data/f1tv-token.txt`.

The relay pulls the token out of the cookie, shows when it expires (about a week), and reconnects. `data/` is git-ignored, so the token never leaves this PC.

## Team radio transcripts (optional)

Each radio clip is downloaded by the relay, transcribed by **ElevenLabs Scribe v2** (primed with the drivers' names and radio jargon; **Whisper Large v3 on Groq** is the fallback without an ElevenLabs key), then tidied by **Claude Haiku 5.5**:
- split into driver and engineer lines
- names and jargon fixed from race context
- a short gist, and a "notable" flag

Add the API keys under **Radio transcripts** in the settings panel; they're saved to `data/keys.json`. `ELEVENLABS_API_KEY` / `GROQ_API_KEY` / `ANTHROPIC_API_KEY` environment variables also work. Clips transcribed by Whisper are redone with Scribe once an ElevenLabs key is added. Audio and results are cached in `data/radio/`, so replays aren't billed twice. A full race costs roughly 10 cents.

## Broadcast delay

The feed runs 30–60 s ahead of TV. Tap the **Live** chip and set the delay, or during a race tap *Leader is crossing the line on TV now* at the exact moment it happens. The delay is remembered per device.

## How it works

```
F1 SignalR Core feed ─► server/ (Node 24, runs TypeScript directly)
                         ├ sources/live.ts     negotiate → subscribe → deltas, auto-reconnect, session changes
                         ├ sources/archive.ts  replay from the static archive
                         ├ hub.ts              merged state + 12 min of history for delayed clients
                         ├ laps.ts             per-lap history (gap trends, closing rates)
                         ├ trace.ts            traces circuit outlines for venues MultiViewer lacks
                         └ index.ts            HTTP + WebSocket on :8787, recorder
                       ─► web/ (Svelte 5) holds updates until now − delay, renders at display refresh rate
```
