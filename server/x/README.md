# X (not connected yet)

Admin → Content → **X Posts** writes posts for X, and the Content Calendar
schedules them. **Nothing talks to X yet.** There's no X code in this folder or
in `api/`, no token, and no X dependency. A "scheduled" post is a time on the
calendar: when it comes, the post shows **Due: post by hand**, and someone
copies it to X and clicks **Mark posted**.

| Piece | File |
|---|---|
| Composer and saved posts | `src/components/AdminX.jsx` |
| The rules a post follows, and the publisher's payload | `src/utils/x/posts.js` |
| Firestore reads and writes | `src/utils/x/store.js` |
| The 1600×900 player card | `src/utils/x/graphics.js` |
| Calendar entries | `src/utils/contentCalendar/platforms.js` (`xEntry`) |
| Rules | `firestore.rules` (`xPosts`) |

## Firestore

`xPosts/{id}` is admin-only.

| Field | |
|---|---|
| `name`, `text` | the post's name in the list, and its text |
| `status` | `draft`, `scheduled` or `posted` (by hand). The page can set only these. |
| `scheduledAt` | ms; set while scheduled |
| `postedAt` | when it was marked posted |
| `media` | up to 4: `{ id, kind, url?, alt, w?, h? }`. `kind` is `card`, `upload`, `instagram` or `link`. A `link` has its `url`; the others are stored (below). |
| `card` | the player card's settings, to redraw it |
| `thumb` | a small JPEG data URI for the list |
| `playerIds`, `subject` | who it's about |
| `linkedTo` | `[{ platform: "instagram" \| "youtube", id, label }]`: the same content elsewhere. Each record keeps its own text, images and time. The link lives here because a scheduled or published Instagram post is locked by the rules; the calendar reads it both ways (`linksOf`). |
| `createdAt`, `updatedAt`, `createdBy` | |

`xPosts/{id}/media/{mediaId}` is `{ data }`, a JPEG data URI shrunk to fit a
Firestore doc. Images live here because Storage is closed to the browser.

**Reserved for the publisher.** The rules refuse both from the page: the `x`
field, and the statuses `publishing`, `published` and `failed`. The calendar and
the composer already read them.

## Connecting the API

Follow `server/instagram/`, which has the same shape. Nothing in the composer's
data has to change.

1. **Credentials.** Add server-only env vars (never `REACT_APP_`) and a
   read-only `scripts/xCheck.mjs`. Check X's current API access tier and pricing
   first; posting and media upload limits depend on it.
2. **Client.** `server/x/client.js`: auth, rate-limit tracking, and errors that
   carry X's message. It's the only file that reads the token.
3. **Publisher.** `server/x/publish.js`, a state machine like
   `server/instagram/publish.js`: claim the post in a transaction (a new attempt
   id, status `publishing`), upload each image, post once, then record
   `x: { tweetId, permalink, publishedAt, error }` and status `published`.
   - Build the request from `toXPayload(post)` in `src/utils/x/posts.js`, and
     recheck it with `scheduleProblems`.
   - Image bytes: `kind: "link"` is fetched from its `url`; anything else comes
     from `xPosts/{id}/media/{id}`. The stored images are JPEG, within X's limits.
   - Never post twice. Save the id as soon as X returns it, and on a retry check
     for it before posting.
4. **API.** `api/x.js` with the same admin check as `api/instagram.js`, with
   actions such as `publish`, `schedule` and `schedule-cancel`.
5. **Cron.** Add a `scheduledActive` flag and a `runDue` step (`vercel.json`), as
   Instagram's, so a due post goes out by itself.
6. **Rules.** Tighten `xPosts` to match `instagramPosts`: only the server sets
   `scheduled`, and a scheduled, publishing or published post is locked to the
   page. Move scheduling in `store.js`, `AdminX.jsx` and `CalendarPostPanel.jsx`
   to the API, as Instagram's already is.
7. **Copy.** Remove the "isn't connected" notices and **Due: post by hand**
   (`AdminX.jsx`, `xEntry`, `CalendarPostPanel.jsx`). Keep **Mark posted** for
   posts made outside We-Draft, as Instagram does.

## Not supported yet

- **Video.** Images only. Instagram's clips can't be reused as they are, because
  `sweepOrphans` deletes any clip no saved Instagram post lists. X video needs
  its own upload path.
- **Threads, polls and quote posts.**
