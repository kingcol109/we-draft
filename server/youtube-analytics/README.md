# YouTube Analytics

Admin → **YouTube Analytics** (`/admin?section=youtube`) shows YouTube
performance for We-Draft's channel and links it to the site's own video
records and players. Only admins can see it, and nothing here is shown on
the public site.

| Piece | File |
|---|---|
| Admin tab | `src/components/AdminYouTubeAnalytics.js` |
| API (admin actions, OAuth callback, cron) | `api/youtube-analytics.js` |
| OAuth, Google HTTP, retries | `google.js` |
| Run lock and status | `runs.js` |
| Sync Videos | `videos.js` |
| Sync Analytics | `analytics.js` |
| Sync Historical Data | `history.js` |
| Tag, ignore, add to site | `associations.js` |
| Pure calculations | `metrics.js` |
| Tests | `npm run youtube-analytics:test`, plus `src/components/AdminYouTubeAnalytics.test.js` |

## The legacy video data is never replaced

`videos/{docId}` stays the editorial record. Public pages read it, and it
holds the YouTube URL (`Video`), `GenTitle`, `GenThumb` (the custom
thumbnail), `items[]` (per-player title and thumbnail, plus recruit tags),
`playerIds`, `Tags`, `Short`, `PublishAt` and the other editorial fields.

- **Syncs never write to `videos`.** They only read it, to link each YouTube
  video to its record by the video ID parsed from `Video`. Links are never
  made by matching titles.
- **Only three admin actions write to `videos`, and each one is an explicit
  click:**
  - Tagging a player on a linked video appends a plain player tag, the same
    shape Video Management saves.
  - Removing a tag only works if the tag has no custom title or thumbnail.
    Otherwise the server refuses and points you to Video Management.
  - **Add to site** creates a new record after a confirmation.
- **Custom titles and thumbnails win.** The dashboard shows `GenTitle` (or
  the first item's title) and `GenThumb` (or an item's `thumb`) before
  YouTube's own.
- **The Video Management editor now keeps every tag.** It used to load and
  save only 3 tag slots, which would silently drop a 4th tag.

## Firestore

All of these are admin-read only, and only the server writes them
(`firestore.rules`).

| Path | Contents | Written by |
|---|---|---|
| `ytVideos/{videoId}` | YouTube metadata `yt{…}`; `type`/`typeSource`; public `stats{views, likes, comments, fetchedAt, ring, delta24h, delta48h}`; `analytics{lifetime, last1, last2, last7, prev7, last28, growth7, viewsPerDay7, through}`; `perf{first1, first2, first7}`; `history{from, through, complete}`; `legacyDocId`; `trafficSources` | syncs (machine fields only) |
| …same doc, admin fields | `playerIds` (only for videos not on the site), `review{status: "ignored"}`, `associatedBy/At`, `publishedToSiteBy/At` | admin actions only; no sync ever writes these |
| `ytVideos/{id}/daily/{YYYY-MM-DD}` | one Pacific day: views, minutesWatched, avgViewDurationSec, avgViewPct, subsGained, subsLost, likes, comments, shares, impressions, impressionsCtr, `firstObserved` | Analytics / history syncs, Reporting import |
| `ytVideos/{id}/snapshots/{YYYYMMDDHH}` | public view/like/comment counts at sync time (written only when views changed) | Sync Videos |
| `ytChannelDaily/{YYYY-MM-DD}` | channel totals per day, plus impressions/CTR | Analytics / history |
| `ytPlayerStats/{playerId}` | per-player rollup (see below) | Sync Analytics |
| `ytAnalytics/status` | connection state (no secrets), channel, per-op run status, backfill progress, schedule switch | API |
| `ytAnalytics/lock` | the single sync lease | API |
| `ytAnalytics/channel` | channel traffic sources | Sync Analytics |
| `ytAnalytics/reporting` | Reporting API job ID and imported report days | Sync Historical Data |
| `ytAnalyticsPrivate/*` | encrypted refresh token, OAuth state | API only; closed to every client |

Video documents stay small. Anything that grows over time goes in a
subcollection with one document per day or hour, and the IDs are
deterministic (date or hour), so re-running an import overwrites a document
instead of adding a duplicate. The only list on a video document is the
snapshot ring, which is capped at 24 entries.

## What each number means

- **Public**: Data API `viewCount`, `likeCount`, `commentCount`. These are
  lifetime totals as of the last Sync Videos. Likes or comments show as
  null when the channel hides them.
- **Analytics**: processed by YouTube per **Pacific calendar day**. It is
  usually 1–3 days behind, and the last few days get revised. Every window
  stores its `from`/`to` dates and the doc stores `through`.
  - `last7` is the 7 most recent *reported* days, not the last 168 hours.
- **≈ last 24h / 48h**: the difference between two public-count snapshots
  about 24 or 48 hours apart (±4h). It is null if no snapshot falls close
  enough, and it is never interpolated. It is an approximation, and the
  dashboard labels it that way.
- **Latest day / latest 2 days**: Analytics data for the newest reported
  day(s).
- **First 1 / 2 / 7 days**: Analytics data for the publish day (PT) through
  publish day + N−1. Day 1 is only part of a day, so it's not an exact 24
  hours, because the APIs have no hourly data.
  - A window is reported only when it is fully covered: enough days have
    been reported, and history reaches back to the publish day.
  - Once a window is complete it is never recomputed.
- **Growth**: `(last 7 − prior 7) / prior 7`. It is null when the prior 7
  days were 0.
- **Cumulative totals are never turned into daily numbers.** Daily rows
  come only from per-day queries. A re-fetched day *replaces* the stored
  numbers and keeps the first values it saw in `firstObserved`.
- **Player rollup:**
  - Each player's numbers are **sums of video-level metrics** over the
    unique videos associated with that player.
  - A video tagged with three players counts fully for each of them, so
    player totals don't add up to channel totals.
  - `subsGained` is subscribers YouTube attributes to those videos. It is
    **not a count of unique subscribers**.
  - Ignored videos are excluded.
  - Associations come from the linked `videos` record if there is one,
    otherwise from `ytVideos.playerIds`.

## Syncs

There is one run at a time. A transaction-held lease on `ytAnalytics/lock`
makes a second click, a second admin, or the cron get a 409 while a run is
going. A crashed run's lease expires after 330s. Each run records its state,
trigger, counts, errors and live progress on `ytAnalytics/status`. Each run
also stops itself about 60s before Vercel's 300s limit.

- **Sync Videos** (Data API, API key)
  - Lists the uploads playlist, then calls `videos.list` in batches of 50.
  - Links each video to a legacy record by ID and records how many videos
    are new.
  - Detects the video type:
    - The legacy `Short` flag wins.
    - Livestreams and premieres come from `liveStreamingDetails`.
    - Videos over 3 minutes are long-form.
    - Otherwise it checks `youtube.com/shorts/ID` once: 200 means a Short,
      a redirect means not. If that check is inconclusive, the type stays
      unknown.
  - Videos that disappear from YouTube are flagged `unavailable`, never
    deleted.
  - Reports site records whose video isn't on this channel.
- **Sync Analytics** (Analytics API)
  - Channel daily totals for the last 35 days.
  - The lifetime top-200 videos by views, to catch owned videos the public
    uploads list doesn't show (e.g. unlisted).
  - Per-video lifetime, last 7, prior 7 and last 28 totals, 50 videos per
    query.
  - The last 10 days of daily rows for each video with recent views or
    published in the last 14 days.
  - Channel traffic sources for the last 28 days.
  - Then the player rollup.
- **Sync Historical Data**
  - Imports impressions and CTR from the Reporting API (see below).
  - Then backfills each video's daily rows from its publish day, newest
    videos first, as many as fit in the time budget.
  - Progress is saved per video, and the page keeps calling until the
    backfill is done (**Stop after this batch** stops it). Re-running is
    safe.
  - Days with no activity aren't stored. Inside a backfilled range, a
    missing day means 0.

### Impressions and CTR: Reporting API

The Analytics API has no thumbnail-impression metrics; only the Reporting
API's `channel_reach_basic_a1` report has them. The first Sync Historical
Data creates that reporting job, and then YouTube takes over:

- It produces a report for each Pacific day, starting within about 48 hours.
- It usually also produces reports for the 30 days before the job was
  created.
- It keeps reports for 60 days (30 for the historical ones).

**Impressions history therefore starts about 30 days before the first
history sync**, and anything older can't be recovered. When YouTube
re-issues a day, only the newest report for that day is imported, and it
replaces the old numbers.

## Scheduled sync

Vercel Cron calls `GET /api/youtube-analytics` at `:23` every hour
(`vercel.json`, authenticated with `CRON_SECRET` like the other crons). Each
tick runs **at most one** step, and only when **Scheduled sync** is turned on
in the tab (it is off by default):

- Videos, every 3h.
- Otherwise Analytics, daily.
- Otherwise History, daily, or every tick until the backfill is finished.

The cron uses the same lock as the manual buttons, so it can't overlap a run
an admin started.

## Quota

Data API v3 (10,000 units/day by default):

- `playlistItems.list` and `videos.list` cost 1 unit per 50 videos, so a
  500-video channel costs about 20 units per Sync Videos.
- The Shorts check uses no quota.

Analytics API (queries, not units). For N videos, one Sync Analytics makes
about:

- 3 channel queries.
- 4 × ⌈N/50⌉ window queries.
- 1 query per active video.

A first full backfill makes 1 query per video plus 1 per year of channel
history. After that it only processes new videos.

Errors are handled like this:

- Rate limits and 5xx responses are retried up to 3 times (1s, 2s, 4s).
- An expired access token is refreshed once and the call retried.
- Quota exhaustion stops the run with a message. It isn't retried, because
  quota resets at midnight Pacific.
- A revoked authorization sets `needsReconnect`.
- Error messages never include the API key, tokens or request URLs.

## Setup

### Environment variables (Vercel → Settings → Environment Variables, Production)

| Variable | Required | Notes |
|---|---|---|
| `YOUTUBE_API_KEY` | yes | Data API v3 key. Server only. Restrict it to the YouTube Data API v3 in Cloud Console. |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | yes* | The OAuth web client. *If unset, falls back to `YOUTUBE_OAUTH_CLIENT_ID` / `_SECRET` (the client Stream Manager already uses). Mark the secret **Sensitive**. |
| `STREAM_MANAGER_TOKEN_KEY` | yes | Already set for Stream Manager. Encrypts the stored refresh token. |
| `CRON_SECRET` | for the schedule | Already set. |
| `YOUTUBE_REFRESH_TOKEN` | no | Only if you mint a refresh token outside the Connect button, for this client and the `yt-analytics.readonly` scope. A token stored through Connect takes precedence. |
| `YOUTUBE_CHANNEL_ID` | no | The default channel if none is set in the tab. |
| `YOUTUBE_ANALYTICS_ORIGIN` | no | Pins the OAuth redirect origin, e.g. `https://we-draft.com`. |

Never prefix any of these with `REACT_APP_` or `NEXT_PUBLIC_`.

### Google Cloud (project `we-draft`)

1. **APIs & Services → Credentials → the OAuth 2.0 web client → Authorized
   redirect URIs:** add `https://we-draft.com/api/youtube-analytics`. The
   exact URI for whatever host you're on is shown in the tab under **Server
   setup check**. Add `http://localhost:3000/api/youtube-analytics` too if
   you use `vercel dev`.
2. **OAuth consent screen:**
   - Add the `…/auth/yt-analytics.readonly` scope.
   - If the app is in **Testing**, add the Google account that owns the
     channel as a test user.
   - Testing-mode refresh tokens expire after 7 days. Publish the consent
     screen (an internal or unverified app is fine for your own channel) so
     the connection lasts.
3. The YouTube Data API v3, YouTube Analytics API and YouTube Reporting API
   must be enabled (already done).

### Connect

1. Deploy, then go to Admin → YouTube Analytics → **Connect YouTube**.
2. On Google's screen, pick the channel's account or Brand Account.
3. Under Channel, enter the channel's `@handle` or `UC…` ID and click
   **Set**. The read-only analytics scope can't detect the channel by
   itself.
   - The server checks that this sign-in can read that channel's analytics.
4. Run **Sync Videos**, then **Sync Analytics**, then **Sync Historical
   Data**.
5. Turn on **Scheduled sync** once the manual runs look right.

## Limitations

- **Private uploads aren't found, and the channel isn't auto-detected.**
  That would need the broader `youtube.readonly` scope, which isn't
  requested. Unlisted videos are found if they rank in the channel's
  top-200 by views.
- **Only one connected analytics channel at a time.** Videos are keyed by
  YouTube ID and store their `channelId`, so supporting more channels later
  wouldn't need a migration.
- **Impressions and CTR exist only from about 30 days before the first
  history sync onward.** This is a YouTube Reporting API limit.
- **Shorts detection relies on a youtube.com redirect.** If YouTube changes
  that behavior, those videos show as "type unknown" rather than guessed.
- **Per-video traffic sources load on demand** in the detail view, one
  query per click.
