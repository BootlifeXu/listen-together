# Listen Together

A lightweight realtime listening room prototype. It synchronizes **what is playing, playback state, and the server timestamp**; it does not relay or redistribute audio.

## What is implemented

- Create a temporary host room with a short room code.
- Join from a room link, room code, or QR code.
- Server-timestamped playback state over WebSocket.
- Host and listeners can control the shared demo queue.
- Play, pause, seek, next, previous, and track selection.
- Latency-compensated progress display and reconnect handling.
- Search against the supported public demo catalog.
- Local-file mode: listeners choose the same file on their own device while the room synchronizes its playhead.
- Host-led permissions: listeners can monitor playback and attach matching local files, while only the host changes shared playback.
- Host shared upload: the host can share a permitted audio file so room members stream it without selecting a matching local copy.
- Responsive text-first UI for desktop and mobile.
- Basic input validation, random room IDs, user limits, and room expiry.

## Important playback boundary

This prototype deliberately uses a small catalog of public browser-readable demo MP3s. Every browser loads the audio URL itself through its own `<audio>` element. The server only broadcasts commands and timestamps.

### Local-file mode

To use another song without uploading it to the server:

1. Create or join a room.
2. Choose **search catalog** and select **choose a local file** (or select a local file when the room is in local mode).
3. Each participant selects the same audio file from their own device.
4. The room synchronizes play/pause, seek position, track identity, and timestamps; the server never receives the file bytes.

The browser must support the file type and the user must have the right to use the recording. Because only metadata is shared, participants should choose files with matching content and duration. A listener who has not selected the file will see the track and timestamp but will not hear audio until they select their local copy.

### Host shared upload (Supabase Storage)

Use **share with room** when the host wants listeners to hear a host-selected file automatically. The file is uploaded by the server to a **private Supabase Storage bucket**, and every room member streams it from a time-limited signed URL (Range requests supported, so seeking works). Files are deleted from the bucket when the host ends the room or it expires. Uploads are limited to 25 MB and should only contain recordings the host is legally allowed to share.

**Setup**

1. Create a Supabase project (free tier is fine).
2. Copy **Project URL** and the **service_role** key from *Project Settings → API*.
3. Set these environment variables on the server (see `.env.example`):

   ```
   SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...        # server-only, never expose to the browser
   SUPABASE_BUCKET=room-audio           # optional; created automatically (private) on first upload
   ```

4. Redeploy. If these are not set the server falls back to Manus Forge storage (`BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY`); with neither, uploads return a clear "Storage is not configured" error.

This is different from **use local file**, which deliberately keeps the audio only on each participant's device.

## Room permissions

The prototype uses a standard host-led model:

| Capability | Host | Join user |
|---|---:|---:|
| See current track and timestamp | Yes | Yes |
| Play/pause the shared room | Yes | No |
| Seek the shared room | Yes | No |
| Next/previous track | Yes | No |
| Change the queue or search catalog | Yes | No |
| Switch to local-file mode | Yes | No |
| Select a matching local file for their own browser | Yes | Yes |
| End the room | Yes | No |

These restrictions are enforced both in the interface and at the WebSocket server boundary; a listener cannot bypass them by sending a playback command manually.

It does **not**:

- download, proxy, scrape, or restream Spotify or YouTube Music audio;
- bypass login, DRM, geo-blocking, subscription controls, or regional restrictions;
- claim that independent Spotify/YouTube Music playback can be synchronized without the service's supported APIs or playback SDK.

### Why this matters

A browser cannot generally force another participant's browser to play a protected service's audio, and an external service's playback controls are not interchangeable with a normal HTML audio URL. Even if the room broadcasts a track ID and timestamp, a participant may not have access to the same track, account, region, or playback surface. The honest alternatives are:

1. Use a source with a documented, legally permitted browser playback mechanism.
2. Use an official provider SDK/API where the participant has the required access.
3. Synchronize locally available or user-owned audio files, subject to rights and technical constraints.

This app implements option 1 and keeps the synchronization layer provider-independent so option 2 or 3 can be added later.

## Architecture

```text
Browser audio element  ← supported source URL per participant
          ↑
          │ local playback
Host / listener UI ── WebSocket commands + server timestamps ── Room store
          ↑
       HTTP room lifecycle + search
```

### Files

- `server/rooms.ts` — temporary room store, lifecycle endpoints, command validation, timestamp compensation, and WebSocket broadcasts.
- `server/_core/index.ts` — attaches the room routes and WebSocket upgrade handler to the existing Express server.
- `shared/rooms.ts` — shared room, track, command, and message types plus the demo catalog.
- `client/src/pages/Home.tsx` — landing page, room join/create flow, playback controls, search, QR code, and reconnect client.
- `client/src/index.css` — the warm paper/ink responsive UI system.

## Local development

```bash
pnpm install
pnpm dev
```

Then open the preview URL printed by the dev server.

Useful checks:

```bash
pnpm check
pnpm test
pnpm build
```

Open the app in two browser windows to test synchronization. Create a room in one window, copy the room link, open it in the other, and click **join**. For actual audio playback, each browser may need one user gesture because of autoplay policies.

## API surface

- `POST /api/rooms` — create a room and return `{ roomId, userId, snapshot }`.
- `POST /api/rooms/:roomId/join` — create a listener identity for a room.
- `GET /api/rooms/:roomId` — return the current server snapshot.
- `DELETE /api/rooms/:roomId` — host-only room end, with `{ userId }`.
- `GET /api/search?q=...` — search the supported demo catalog.
- `WS /api/rooms/ws?roomId=...&userId=...` — snapshot, ping/pong, and room commands.

Room state is intentionally in memory for the demo. It expires after 12 hours of inactivity, is capped at 500 rooms, and caps rooms at 50 users. A production implementation should move room state to a shared store such as Redis, use signed room membership tokens, add origin checks, rate limiting, metrics, and a durable provider abstraction.

## Production provider abstraction

The next safe extension is an adapter interface such as:

```ts
interface PlaybackProvider {
  search(query: string): Promise<Track[]>;
  canPlayInBrowser(track: Track, viewer: ViewerContext): boolean;
  getPlaybackSource(track: Track, viewer: ViewerContext): Promise<BrowserSource>;
}
```

The room layer should continue to send `trackId`, `playbackState`, `position`, `duration`, and `lastUpdated`; the provider adapter owns how each participant legitimately obtains the matching audio. If a provider cannot expose that browser playback surface, it should be marked unavailable rather than simulated.

## Deployment notes

The WebDev full-stack scaffold already includes the managed Node/Express build. Before publishing:

1. Run `pnpm check`, `pnpm test`, and `pnpm build`.
2. Replace the in-memory room store with a shared persistence layer for multiple instances.
3. Configure an allowed-origin policy and HTTPS/WSS.
4. Use signed, expiring room membership tokens instead of trusting query-string IDs.
5. Confirm the selected audio sources permit the intended distribution model.

No provider credentials are required by this demo.
