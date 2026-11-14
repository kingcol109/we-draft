# Instagram (@wedraftsite)

Publishing from the existing Post Manager (Admin → Content → **Instagram**)
and the **Instagram Analytics** tab next to it (Admin → Content → Instagram
Analytics). Admin-only, with one exception: the Home page's Instagram
section (see **Public feed** below).

| Piece | File |
|---|---|
| Post Manager (makes, saves, publishes) | `src/components/AdminInstagram.jsx` |
| Analytics tab | `src/components/AdminInstagramAnalytics.jsx` |
| The makers' shared drawing tools (also used by X Posts) | `src/components/SocialMakerKit.jsx` |
| Transfer Portal graphics | `src/utils/instagram/transfer.js` |
| Browser → API helper | `src/utils/instagram/api.js` |
| API (admin actions, cron) | `api/instagram.js` |
| Graph API client, token handling, rate-limit tracking | `graph.js` |
| Storage staging (slides Meta fetches) | `staging.js` |
| Uploaded video clips | `videos.js` |
| Publishing state machine | `publish.js` |
| Analytics syncs | `sync.js` |
| Pure metric helpers | `metrics.js` |
| The Home page's public feed | `feed.js` (shown by `src/pages/HomeInstagram.jsx`) |
| Admin → Social (player ↔ account associations) | `src/components/AdminSocial.jsx` |
| Associations, senders, messages | `contacts.js` |
| Messaging webhook | `api/instagram-webhook.js` |
| Tests | `npm run instagram:test` |
| Credential check (read-only) | `node scripts/instagramCheck.mjs` |

## Meta setup

The Meta app **We-Draft Social** uses the *Instagram API with Unified Login*.

- **Host:** `graph.facebook.com`, version v26.0.
- **Token:** a System-user access token (SUAT) for "We-Draft Social System
  User" in the King Cold Sports business portfolio. It never expires, so no
  refresh is needed.
- **`/me`:** returns the system user, not the Instagram account. Calls use
  `INSTAGRAM_USER_ID` directly. `/me/assigned_instagram_accounts` is empty
  because the token has no `business_management` scope, which is expected
  and harmless.
- **Permissions** (from `GET /me/permissions`, checked 2026-11-13):
  `instagram_basic`, `instagram_content_publish`,
  `instagram_manage_insights`, `instagram_manage_comments` and
  `instagram_manage_messages`. Standard Access covers this account for
  publishing and insights, so no App Review is needed for those.
  `instagram_manage_messages` is what Admin → Social uses (see "Social:
  player accounts").

## Environment

These are server-only variables. Never prefix them with `REACT_APP_`.

| Variable | |
|---|---|
| `INSTAGRAM_ACCESS_TOKEN` | the SUAT (Vercel Production, Sensitive) |
| `INSTAGRAM_USER_ID` | @wedraftsite's Instagram account ID |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Firebase Admin, already used by every API. It also signs the Storage URLs. |
| `INSTAGRAM_STAGING_BUCKET` | optional; defaults to `we-draft.firebasestorage.app` |
| `CRON_SECRET` | the cron's bearer secret, already set |

For local scripts and tests, put the two `INSTAGRAM_*` values in
`.env.local`, which is gitignored. `vercel env pull` can't download
Sensitive values: it writes `[SENSITIVE]` placeholders, which the scripts
treat as unset. Paste the real values in by hand, and never commit them.

The service account holds **Storage Object User on the bucket only**. The
bucket is private: `storage.rules` denies every client, and Public access
prevention is on.

## Publishing

1. **Save.** The admin edits the post in the Post Manager as before. Publish
   to Instagram saves it first.
2. **Start** (`publish-start`). A Firestore transaction claims the post: it
   sets status `publishing` and a new 128-bit attempt id. A post that's
   publishing, published or posted by hand returns a 409, never a second
   post. The caption is checked against Instagram's limits: 2,200
   characters, 30 hashtags, 20 mentions.
3. **Stage** (`stage`, one request per slide). The browser draws each slide
   exactly as previewed, as a JPEG on white. The server checks the image
   (JPEG, 8 MB or less, 320–1440 px wide, 4:5 to 1.91:1) and writes it to
   `ig-staging/{postId}/{attempt}/{nn}.jpg`.
4. **Run** (`publish`). It holds a lease so only one run happens at a time,
   and checks `content_publishing_limit`.
   - It signs V4 URLs, valid for 24 hours, then creates the containers: one
     image, or one item per carousel slide and then the carousel, with the
     caption on the carousel. Each container ID is saved as soon as Meta
     returns it.
   - It polls `status_code` until `FINISHED`. If time runs out first, it
     returns `{ pending: true }`. The next call resumes with the same
     containers, so none are duplicated.
   - It sets `step: "publishing"`, then calls `media_publish` once, reads
     the post back, and only then marks it `published` with its media ID,
     permalink and publishedAt.
   - It writes `igMedia/{mediaId}` with `postId`, `playerIds` and `subject`,
     then deletes `ig-staging/{postId}/`.
5. **Failures.** The status becomes `failed`, and `ig.error` holds Meta's
   message, code, subcode, fbtrace id and the step. The staged files are
   kept. Retrying starts a new attempt.
   - If a failure came after `media_publish` was called, the next start
     asks the container first. If it's `PUBLISHED`, the post is found
     (matched by caption and time) instead of being published again.
   - If a delete fails after publishing, `ig.cleanup` is set to `pending`,
     and the hourly cron retries it.

## Post types

Publishing doesn't depend on a post's `type`: every type is a list of drawn
slides and a caption. A new type only needs a drawing module and a maker.

| `type` | Post | Slides |
|---|---|---|
| `custom` | Create a post: a blank canvas of players, logos, text, images and shapes (`src/utils/instagram/custom.js`) | as many as the admin adds, up to 20 |
| `mock` | Weekly Mock carousel | a slide per part of the draft |
| `spotlight` | Player spotlight | cover, scouting report, grade him |
| `player` | Player post | one |
| `portal` | Player entered the transfer portal | one, or carousel: cover, his file, where next? |
| `transfer` | Player transferred to a new school | one, or carousel: cover, what the new school gets |

## Calendar

The Content Calendar reads `instagramPosts` directly
(`src/utils/contentCalendar/platforms.js`, `instagramEntry`) and stores no
copy. A post appears once it's scheduled, published or posted by hand. Change
time, Cancel and dragging a chip go through the same `schedule-change` and
`schedule-cancel` actions as the Post Manager.

**Send to X** starts a separate X draft from a post, linked back to it
(`server/x/README.md`). Nothing goes to X.

## Videos

Player Spotlight posts can carry highlight clips, which go right after the
cover. Other post types don't take videos.

1. **Upload** (`video-upload`, then `video-done`). The server opens a
   resumable upload session at `ig-videos/{32 hex}.mp4|.mov` using the
   page's Origin. The browser then PUTs the file straight to that session,
   and Storage answers that origin's CORS. The bucket's own CORS and
   `storage.rules` stay closed. `video-done` checks that the file arrived
   and is 100 MB or less. The browser checks the type (MP4 or MOV) and
   that the clip is at least 3 seconds long. It warns about clips over 60
   seconds and clips that aren't 4:5.
2. **Save.** The post keeps its clips in `state.videos` and lists their
   paths in `videoPaths`.
3. **Publish.** `publish-start` takes `videos: { [slide index]: path }` and
   copies each clip into the attempt's folder (`{nn}.mp4`) before it claims
   the post. It sets `ig.staged` and `ig.videos` for those slides, and the
   browser sends only the drawn slides. The run creates
   `media_type: VIDEO` carousel items for them. A lone video becomes a reel.
   Cleanup deletes the staged copies, never the originals.
4. **Delete.** Deleting a post deletes its clips unless another saved post
   lists them. At :47 each hour, the cron also deletes clips older than
   3 days that no saved post lists.

## Scheduling

1. **Schedule** opens a date and time picker in the browser's time zone,
   with the time also shown in Eastern. Times must be 5 minutes to 60 days
   ahead.
2. `publish-start` with `scheduledAt` claims the post as `scheduled`. The
   browser then sends every slide right away, because it draws them and
   won't be open at posting time. `schedule-confirm` marks the slides
   complete.
3. If a send fails part-way, the page cancels the schedule. If a post's time
   comes before its slides are complete, it becomes `failed` and nothing
   is posted.
4. `/api/instagram`'s cron runs every minute and calls `runDue`, which is
   one Firestore query on `ig.scheduledActive`.
   - The first due post is claimed in a transaction (scheduled →
     publishing), then published by the same `runPublish` as a click, so
     overlapping ticks can't post it twice.
   - It handles one post per tick. A scheduled publish left part-way is
     picked up again on a later tick.
   - Cleanup retries and analytics still run once an hour, at :47.
5. **Change time** (`schedule-change`) and **Cancel** (`schedule-cancel`)
   work while the post waits. Cancel sets it back to draft or ready and
   deletes its sent slides.
   - A scheduled post is locked in `firestore.rules`, the same as a
     publishing one.
   - Deleting it goes through the API, which removes its slides too.

## Firestore

All of these are admin-read only. See `firestore.rules`.

| Path | Contents | Written by |
|---|---|---|
| `instagramPosts/{id}` | the Post Manager's saved post: `type`, `name`, `state` (the settings that redraw it, never touched by publishing), `caption`, `slides`, `thumb`, `playerIds`, `subject`, `status` | page (draft, ready, posted) |
| …same doc `ig` | `attempt`, `step`, `staged`, `files`, `children`, `container`, `leaseUntil`, `mediaId`, `permalink`, `publishedAt`, `mediaType`, `error`, `lastError`, `cleanup` | server only. The rules block the page from writing `ig`, from setting publishing/published/failed, and from editing a publishing or published post. |
| `igMedia/{mediaId}` | every post on the account: `caption`, `mediaType`, `productType`, `timestamp`, `permalink`, `thumb`, `counts` (like/comment counts), `meta` (Meta's lifetime insights), `calc`, `metricsAt`. Posts published from We-Draft also have `postId`, `postName`, `playerIds` and `subject`. | the media sync, plus publish for the link |
| `igMedia/{id}/daily/{YYYY-MM-DD}` | a post's numbers as seen on each Pacific day, one document per day | the media sync |
| `igAccountDaily/{YYYY-MM-DD}` | `meta`: reach, views, accounts_engaged, total_interactions, likes, comments, saves, shares, replies, profile_links_taps, profile_views, follows, unfollows, newFollowers. `calc.followers`: the follower count seen at that day's sync. `fetchedAt`, `partial`. | the account sync |
| `igAnalytics/account` | the profile: followers, posts, picture | the account sync |
| `igAnalytics/demographics` / `igDemographics/{YYYY-MM}` | follower and engaged-audience breakdowns (age, gender, country, city), and a copy per month | the account sync, once a day |
| `igAnalytics/status` / `lock` | each sync's run status, and the schedule switch / the one-at-a-time lease | the API |

## Analytics: Meta's numbers and ours

- **META** marks a number as Meta reports it.
  - Days are Pacific, because Meta's daily insights end at Pacific midnight.
  - A day's numbers are re-read until they're final: fetched at least 3 days
    after the day ended, since Meta can lag up to 48 hours.
  - Meta accepts ranges of up to 30 days per call, so account days are read
    one at a time, backfilling 90 days on the first run.
  - `impressions` is deprecated, and `views` replaces it.
- **CALC** marks a number We-Draft works out itself.
  - **Engagement rate** = (likes + comments + saves + shares) ÷ reach, per
    post. Reach is the post's unique accounts, the same denominator for
    every post. It's `null` when reach is 0 or unknown.
  - **Follower history:** Meta only gives the current count, so each
    account sync records it for that day.
- Account totals over a range add up the daily values. "Reach" over 28 days
  is therefore the sum of daily reach, not the number of unique accounts.
  The page says so.
- **Rate limits:** every response's `X-App-Usage` and
  `X-Business-Use-Case-Usage` headers are tracked. Syncs stop starting new
  calls above 80% and pick up next run. Meta's throttling codes surface as
  `rate_limited`.
- **Schedule:** Vercel Cron calls `/api/instagram` hourly. Cleanup retries
  always run. The analytics syncs run only when **Scheduled sync** is on,
  with account and posts each every 6 hours. New posts' insights are read
  every run, posts under 60 days old daily, and older posts weekly.

## Not supported

- **Reels:** the Post Manager doesn't make reels. Videos go only into Player Spotlight carousels (see Videos).
- **Stories and album-child metrics:** these aren't read.

## Public feed

The Home page shows @wedraftsite's latest posts. Each post has its image,
link, caption and date. The section also shows the handle, profile picture
and follower count. There are no analytics in it.

- **Writing it:** `feed.js` writes `config/instagramFeed`. Like every config
  doc, it's public read and admin write. The browser never calls Instagram.
- **When:** the cron refreshes it every hour at :47, whether or not the
  analytics schedule is on. Admins can also refresh it right away with the
  API action `feed`.
- **Image links:** Instagram's image URLs expire after about four days
  (their `oe=` parameter), so the hourly rewrite keeps them fresh. If an
  image still fails to load, the page drops that tile, and it hides the
  whole section when none are left.

## Social: player accounts

Admin → **Social** maps We-Draft players to their Instagram accounts. It is
groundwork for messaging players later: interview questions, responses on
their profiles, and articles. None of that is built yet.

### Identity

- **Username:** what an admin types in. It can change, so it is only a
  *provisional* association.
- **IGSID (Instagram-scoped user ID):** the permanent identity. Meta puts it
  on every messaging webhook as `sender.id`.
  - It is scoped to our Meta app and @wedraftsite. It is not a universal
    Instagram ID.
  - It cannot be looked up from a username. The only way to get one is for
    the person to message @wedraftsite.
- Nothing in the code invents an IGSID or links a sender to a player
  automatically. An admin always confirms the match.

### Statuses

| `accountStatus` | Meaning |
|---|---|
| `pending` | A username has been entered, but there is no IGSID yet. |
| `connected` | An IGSID is linked, after an admin confirmed which sender this is. |
| `verified` | Connected, and an admin has confirmed the person is the player. This requires an IGSID. |
| `inactive` | Disconnected or replaced. The record is kept for history and never deleted. |

### Firestore

All of these are admin read and server write (`firestore.rules`).

| Path | Contents |
|---|---|
| `instagramContacts/{id}` | `playerId`, `playerName`, `playerSlug`, `instagramUsername`, `usernameLower`, `instagramScopedUserId`, `accountStatus`, `active`, `primary`, `verificationMethod` (how it was associated: `admin_manual`, `player_provided`, `school_roster`, `inbound_message`, `other`), `verifiedAt`/`verifiedBy`, `connectedAt`/`connectedBy`, `notes`, `createdAt`/`createdBy`, `lastUpdated`/`updatedBy`, `usernameHistory` [{ username, at, source: admin/meta }], and on inactive records `deactivatedAt`, `deactivatedReason` (disconnected/replaced), `replacedBy` and `replaces`. |
| `instagramContacts/{id}/history/{auto}` | the audit trail: `action` (created, edited, linked, verified, username_changed, replaced, disconnected), `at`, `by` (an admin uid, or `meta`), and the details |
| `instagramSenders/{igsid}` | everyone who has messaged us: `username` and `name` (from Meta), `usernameFetchedAt`, `profileError`, `firstMessageAt`, `lastMessageAt`, `messageCount`, `contactId`/`playerId` once linked, and `review` { `state`: needs_review, unmatched, matched or dismissed; `reason`; `suggestedContactId`; `conflictContactId` } |
| `instagramMessages/{mid}` | each message keyed by Meta's message ID: `igsid`, `direction` (in/out), `text`, `attachments`, `replyToMid`, `timestamp`, `receivedAt`, `contactId`, `playerId`, `isDeleted`, `editedAt`. Future question and response records should reference `playerId`, `instagramContactId` and the `mid`. |
| `igAnalytics/webhook` | `lastEventAt`, `lastCounts`, `lastErrorAt`, `lastError` |
| `igAnalytics/dmSync` | `lastRunAt`, `lastResult` (senders, created, suggested, renamed, conflicts), `more` |

**Integrity.** These rules are enforced in transactions in `contacts.js`.
The page never writes these collections itself: it calls `api/instagram.js`
actions `contact-*` and `sender-*`, which are admin-only.

- A player has at most one active contact. Connecting a new one makes the
  old one inactive, with `replacedBy` pointing to the new one.
- A username, or an IGSID, is active on at most one player.
- A contact's `playerId` never changes. Moving an account to another player
  means disconnecting it and creating a new contact.

### Flow

1. **Manual association.** The admin picks a player, enters `@username`, and
   saves. The contact is created as `pending`, with no IGSID.
2. **People already in our DMs.** **Sync existing DMs** (API action
   `senders-sync`) pages through `GET /{ig-user-id}/conversations?platform=instagram&fields=participants,updated_time`.
   Each conversation lists the other person's IGSID and username, and every
   one of them becomes an `instagramSenders` doc with `source: "dm_sync"`.
   - Their messages aren't imported. Only new ones come in, through the
     webhook.
   - Re-running is safe. Existing senders are updated, and dismissed ones
     stay dismissed.
   - Checked against the live account on 2026-11-13: 39 conversations, one
     page, every participant with a username.
3. **They message @wedraftsite.** Meta POSTs to `/api/instagram-webhook`.
   This needs the setup below.
   - The signature is checked first.
   - The message is stored once per `mid`. Meta's retries do nothing extra.
   - The sender doc is created or updated.
   - If the sender is already linked, the message gets their `playerId`.
4. **Username lookup.** This runs for a new sender, and at most once a day
   for each sender after that. The server scans the conversations for the
   IGSID; Meta ignores a `user_id` filter there, but it's one call at our
   size.
   - If the sender isn't in any conversation, it falls back to the User
     Profile API (`GET /{igsid}?fields=username,name`). That API refuses with
     error #230 ("User consent is required") unless the person has recently
     messaged us, so it is only a fallback.
   - Wherever the username comes from, matching works the same. If exactly
     one active, ID-less contact has that username, the sender becomes
     **Needs review** and that contact is shown as the suggestion. Otherwise
     the sender is **Unmatched**.
5. **Admin confirms** (Account Management). There are three choices:
   - **Confirm match:** saves the IGSID onto the suggested contact.
   - **Link to player…:** links the sender to any player's contact, or
     creates a new contact from the sender.
   - **Not a player:** dismisses the sender.

   A link sets the contact to `connected` and attributes the sender's
   earlier messages to the player.
6. **Username changes.** When a linked sender's username changes, the
   contact's username follows. The IGSID stays the same, and the change is
   recorded in `usernameHistory` and the history log.
   - This happens on their next message, or when an admin clicks
     **Refresh**.
   - If another active contact already holds the new username, the
     sender is flagged `username_conflict` instead.
   - An admin can also correct a username with **Edit**.

### Meta setup

**Already in place** (checked against the live token on 2026-11-13):

- `instagram_manage_messages` is granted on the System-user token in
  `INSTAGRAM_ACCESS_TOKEN`. No new permission or token is needed.
- The token reads @wedraftsite's DM conversations, including each
  participant's IGSID and username. **Sync existing DMs** works today, with
  no further setup.
- The User Profile API refuses this token (#230) for people who haven't
  messaged recently. That's why the username lookup uses the conversations
  list first.

**Still needed for live messages through the webhook.** None of these can be
checked from code: they need the App Dashboard or the app secret. Until
they're done, new DMs don't arrive by themselves, though **Sync existing
DMs** still picks up the people.

1. **Webhook.** In App Dashboard → Webhooks → Instagram, set:
   - callback `https://we-draft.com/api/instagram-webhook`
   - verify token = `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`
   - subscribed field `messages`. `message_edit` is also handled.

   If a webhook is already subscribed for another purpose, its callback has
   to become this one, since Meta allows one callback per object. If the
   account's Page isn't subscribed to the app yet, subscribe it with
   `POST /{page-id}/subscribed_apps?subscribed_fields=messages` and a Page
   token.
2. **Env (Vercel, server only):**
   - `META_APP_SECRET`: the app secret, used to check `X-Hub-Signature-256`.
     Every POST is refused while it's unset.
   - `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`: any long random string, the same one
     entered in the dashboard.
3. **Access level.** With Standard Access, Meta sends messaging webhooks only
   for people who have a role on the app. To get live messages from players,
   `instagram_manage_messages` needs **Advanced Access**, which means App
   Review, and the app must be Live. Check the current level in App
   Dashboard → App Review → Permissions and Features. **Sync existing DMs**
   doesn't depend on it.
4. **Instagram app setting.** On @wedraftsite, **Allow access to messages**
   (Settings → Messages and story replies → Message controls → Connected
   tools) must stay on. The conversations API working suggests it already is.

### Not built yet

- Sending messages. Replies must also respect Meta's 24-hour messaging
  window.
- The question bank, interviews and responses on profiles.
- Articles from responses.
- Message types other than text/attachments, edits and deletes: reactions,
  postbacks and read receipts are ignored.
