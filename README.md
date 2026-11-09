# Ритм — Personal Shift & Activity Planner

**Понятная инструкция по-русски: [как настроить работу, занятия и посещения](docs/QUICKSTART-RU.md).**

A Russian-first, dark-only offline PWA. No personal shifts or attendance are invented. The catalog includes an owner-requested, verified November 2026 import from Vesna studio; see [import provenance and exact date coverage](docs/VESNA-IMPORT.md). React + TypeScript + Vite, Dexie/IndexedDB, Luxon, Supabase Auth/Postgres, and an opt-in Web Push dispatcher. CSS is local and has no font/CDN dependency.

## Run locally

Node 22.12+ (Node 24 LTS recommended), npm:

```powershell
cd 'F:\ChatGPT projects\shift-planner'
npm ci
npm run dev
```

Open the printed local URL. `npm test` runs the domain, persistence, and mocked sync tests. `npm run build` produces `dist/`; `npm run preview` serves the built PWA. The development server does not install the service worker. Test offline installation against the production preview or HTTPS deployment, after its first successful load.

## First use

1. In **Настройки → Работа**, set your normal weekly working days/hours, then enter only the temporary shifts/rest days you already know. Unmarked dates inherit the normal week; a period is just the editing range. A single marked date or a fully cleared period can be saved. Clearing a saved date restores its normal working hours. An optional two-day/two-rest-day fill is an editable draft. Original base records remain intact.
2. **Мои занятия** is one catalog for Spanish, dance, pool, and other activities. Each has either scheduled times or a flexible visit template. Booking behavior is regular enrollment, booking each visit, or no booking. Optional absence reminders do not require a separate obligation category. Legacy fixed-commitment records remain supported and editable.
3. **Календарь** opens as a Monday-first month, with an optional hourly week, with work and all scheduled classes shown together. Click a class and choose **Пойду** directly in its details or the day agenda. Unselected options are dashed. In-person options whose occupied windows overlap work are hidden by default and can be revealed crossed out, with choosing disabled. Online options remain visible with soft work-overlap warnings. Already selected/booked in-person visits remain visible for cancellation; impossible unbooked visits do not prompt booking. Changing shifts recalculates availability without deleting source classes. Chosen-plan conflicts are red. Both buffers are included. Alternative options do not block each other. Flexible templates offer **выбрать время**, without invented slots.
4. Both calendar views and the day agenda show complete occupied activity windows, e.g. **18:30–20:30** for a **19:00–20:00** studio class with 30-minute buffers. Weekly position, height, overlap columns and day membership use that same occupied window, including travel across midnight. Work still shows its working interval. Details retain the actual lesson time; booking and cancellation deadlines continue to use its real start. Overnight blocks continue into the next day and show a date offset. Simultaneous classes have separate columns over the work background. The **Все доступные занятия** toggle hides options when needed. An additional opt-in **Скрыть занятия с пересечениями** filter removes unselected options overlapping work, sleep or chosen plans (including buffers). Alternative unselected options do not block each other; online/work compatibility is retained. Chosen/booked visits stay visible. The filter applies to month, week and day agenda without mutating data. The **Слои и исходный график** control shows replaced originals and lets you disable overrides.
5. **Центр действий** contains booking, cancellation, absence, and conflict actions. Confirming a booking also marks its occurrence booked. Snooze delays attention for an hour and preserves the pending action. Cancelling an actually booked visit creates a separate cancellation task; declining an unbooked class does not. No message is sent to a teacher, gym, school, or other organization.
6. Export JSON periodically. Deleted events are restorable under **Настройки → Резервные копии → Удалённые события**.
7. **Посещения** is a separate attendance log. Mark a named activity on a day, inspect colored weekly marks, and filter monthly counts with activity tabs. Case-insensitive activity names aggregate across schedule rows; one mark per activity/day is idempotent. Marks are ordinary private, offline-first records with the same sync/conflict/backup support. They do not mutate plans or complete booking actions. No attendance is inferred automatically.

## Schedule semantics

Events retain an IANA source timezone; display uses the chosen settings timezone (Europe/Moscow initially). Changing display zone preserves instants. New events inherit that zone. Recurrences retain their local source time. Equal start/end without an explicit end date means 24 hours; an earlier end clock means the following day. Explicit end dates support multi-day events.

Weekly recurrences have selected weekdays, an anchor date, and an optional inclusive end date. Situational work periods replace the base only on dates with an explicit enabled shift, rest, or recovery choice; overnight replacement windows include the actual shift end. Unmarked days, including cleared choices, inherit the base except for the post-night day, which automatically replaces daytime base work with sleep and a free evening. This also applies to previously saved period records without a data rewrite. Disabling or deleting the period restores the base even if child rows have not separately changed. Legacy cycles still use their explicitly configured day/night/recovery/off sequence. Every effective overnight work interval automatically adds a post-night day, including nights crossing the week or editing-period boundary (e.g. November 22–23). Explicit sleep marks take precedence without duplication. Disabled/deleted/replaced nights leave no inferred sleep. Recovery is a post-night day: remaining work until the night end, then approximately eight hours of sleep (configurable in the shift editor). Existing all-day recovery marks use the same timed view without rewriting saved records. Duplicate night tails are unioned with the actual night; sleep appears on the hour grid and leaves the evening free. Day labels clip overnight work to that local day, e.g. 00:00–08:30.

Ordinary overrides clip only overlapping work/recovery/off intervals and preserve both outer parts. A suppressing override adds no work. Disabled or deleted overrides restore originals. Overlapping overrides use lexicographic record-ID precedence, which is stable across devices; the layer panel documents this rule. Keep overrides disjoint where possible. Working intervals are unioned so layered work never counts twice; each original record remains editable in settings. Recovery overlaps produce informational warnings. Selected activities, required commitments, personal plans, and work produce hard conflicts for overlapping occupied windows. The optional activityFormat field distinguishes in_person and online. Existing Spanish schedules default to online unless explicitly configured otherwise; studio imports and other activities default to in_person. Online/work overlap is informational and produces no absence/conflict action; other true overlaps and explicitly skipped lessons retain their actions. Obsolete conflict/absence/booking actions are auto-resolved only when their occurrence(s) are present in the loaded reminder scope, and reopen if needed again. Available/cancelled classes do not block time. Touching endpoints are allowed.

Nonexistent and ambiguous times at daylight-saving transitions are rejected for one-off input; affected recurring occurrences are skipped with an explanation in the recurrence editor. Create explicit exceptions at unambiguous times. Actual duration uses elapsed time across timezone offset changes.

## Supabase setup

No project or external account has been created. Create your project in Supabase, then:

1. Enable email/password authentication, require email confirmation, configure a minimum password length of 12, and configure SMTP for reliable auth mail. Add the exact app URL to Auth's Site URL and redirect allowlist (including local preview URLs for development).
2. Apply both numbered SQL migrations in `supabase/migrations/` in order with the SQL editor, or `supabase link --project-ref YOUR_REF` then `supabase db push` using the Supabase CLI. The second migration permits private attendance records.
3. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` and **only the public publishable/anon key**. Restart/rebuild. Never put a service-role key into any `VITE_` variable, GitHub Pages build variable, source file, or browser.
4. Register in Settings, confirm email, and sign in. Password recovery mail returns to the app and exposes a new-password form.
5. Verify with two accounts that private records are isolated. Against a local Supabase stack, run `supabase test db` for the pgTAP RLS/RPC tests. These tests require Supabase/Docker and have not been executed without a configured stack.

RLS permits users to read their own rows. Writes use `apply_change`, a narrowly scoped SECURITY DEFINER RPC which takes the user from `auth.uid()`, validates the expected revision, serializes writes per record, increments server revisions, and records UUID mutation receipts for retry idempotency. Direct browser writes to records/receipts are revoked. Push subscriptions have per-user RLS. The scheduler-only claim RPC is executable only by service_role.

## Offline persistence and synchronization

Each account has a separate IndexedDB database; guest plans stay in their own database. Transfer guest plans by export, sign-in, then import. Signing out retains that account's local cache on this browser; avoid shared browser profiles for private data. Active push subscriptions are unsubscribed on sign-out.

All edits commit to IndexedDB first, with an immutable mutation UUID per queued change and the last known server revision. Auto-sync runs after edits, reconnection, focus, and periodically while open. Manual sync and the last successful timestamp appear in Settings. Failures leave edits queued and visible. The pull is paginated and includes tombstones; it does not trust device clocks. There is no hard deletion or timestamp-based last-write-wins.

Concurrent edits and edit-versus-delete conflicts preserve local and remote versions. Settings lets you choose either version or keep both event records. A local edit during an in-flight request stays queued on top of the acknowledged revision. Identical simultaneous writes converge. Import validates the entire file before an atomic merge; differing records enter the same comparison flow, and a chosen imported version is queued for upload.

No browser storage is guaranteed against user clearing or OS eviction. Request persistent storage in Settings where supported, use sync, and keep JSON backups. Imported backups preserve event/action IDs and completion history. Tombstones and mutation receipts are retained indefinitely for offline safety; do not prune them casually.

## Web Push and reminder limits

In-app reminders need no notification permission. Actions remain visible until explicit completion, including overdue actions; no scheduler or background JavaScript is needed to preserve them. Required actions are materialized on opening the app for a rolling window from 7 days ago to 90 days ahead. Previously created pending actions and history remain indefinitely, even when outside that window or their underlying conflict changes. Such actions are labelled for manual review. Keep opening the app to extend the horizon; the server does not independently expand recurrence templates.

Optional background Web Push requires HTTPS, browser permission, a logged-in account, synced actions, VAPID keys, and a server Cron job:

1. Generate a VAPID pair locally using the standard `web-push` package (`npx web-push generate-vapid-keys`). Set the public key in `VITE_VAPID_PUBLIC_KEY` and rebuild.
2. Set Edge Function secrets via `supabase secrets set`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (your `mailto:` contact), and a long random `CRON_SECRET`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` **only on the server**. Keep secrets out of shell history when possible by using a temporary, untracked env file and `--env-file`.
3. Deploy `supabase functions deploy push-dispatch --no-verify-jwt`. This function explicitly authenticates every request using `x-cron-secret`; it is not a public dispatcher despite the gateway JWT setting.
4. In Supabase Cron, create a job every minute that POSTs to `https://YOUR_REF.supabase.co/functions/v1/push-dispatch`, with the `x-cron-secret` header. Store that secret in Supabase Vault, not the SQL source. Example SQL is in `docs/cron.sql.example`.
5. Click **Разрешить push** on each device, then **Синхронизировать сейчас**. The scheduler reads pending synced actions, respects snooze/completion and user repeat intervals, atomically claims each action/device to avoid duplicate concurrent sends, retries failures, and removes expired subscriptions. It never contacts third-party organizations. Notification tags collapse repeated notifications for the same action on one device.

The app must be added to the Home Screen on iOS/iPadOS 16.4+ and permission must be requested from a user gesture. See [WebKit's platform requirements](https://webkit.org/blog/13878/) and [Apple's Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers). Browser/OS policies, connectivity, Focus mode, suspension, and user settings may delay or suppress push. No background delivery guarantee is possible. Offline completions reach the server only after sync, so an already queued notification can arrive after local completion. Successful network delivery is not proof the user saw it. A server crash after claiming can delay a retry to the next interval. Push text contains the action title; consider lock-screen privacy.

The dispatcher permits standard FCM, Mozilla, Apple, and Windows notification hosts, blocking arbitrary endpoint URLs. Additional providers require a reviewed allowlist change. This is a small single-user planner, not a bulk notification service: large numbers of users/actions require pagination monitoring and a worker queue. Monitor failed Cron/Edge invocations.

## GitHub Pages deployment

1. Create a GitHub repository and push this folder as its root. No Git repository or remote has been created by this task.
2. In Settings → Pages choose **GitHub Actions** as the source.
3. Add repository **variables** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_VAPID_PUBLIC_KEY`. These are public browser configuration, not server secrets.
4. Run **Deploy GitHub Pages** manually from Actions. It tests/builds with `BASE_PATH=/<repository-name>/`, uploads `dist`, and deploys to Pages. For a `username.github.io` root repository or custom root domain, change BASE_PATH to `/`.
5. Set the deployed URL in Supabase Auth redirects. Test first load, installation, refresh while offline, and auth redirects at that subpath on each target platform.

`ci.yml` tests and builds every push/PR. Deployment is manual so a source push alone cannot publish a personal app. HTTPS is supplied by Pages; personal data goes to your private Supabase rows, not the static repository. GitHub Pages hosts a publicly reachable app shell; authentication protects cloud data. Choose a private-access hosting provider instead if the shell itself must be restricted.

## Verification and operational scope

Automated tests cover weekly/cycle calculations, override clipping and restoration, overnight events, DST ambiguity/gaps, occupied-window conflicts, distinct reminder kinds, completion/snooze persistence, IndexedDB reopening/account isolation, idempotent retry keys, queued edits during sync, concurrent sync serialization, and deletion conflicts. Mocked sync tests do not replace a deployed multi-device integration test. SQL policies and push delivery require the real Supabase environment for final verification. No Android/iPadOS/macOS device has been provisioned by this task. Use `docs/ACCEPTANCE.md` for the remaining device/cloud checks.

Code layout: `model.ts` defines persisted types and validation; `engine.ts` is pure scheduling/reminder/merge logic; `store.ts` handles persistence, auth client, sync and backup; `main.tsx` contains the interface; `sw.ts` handles offline cache and notification display; `supabase/` contains migration, server-only dispatcher, and SQL tests.

Security dependencies: build-tool overrides select patched glob/minimatch versions and the unaffected deepmerge 4.1.1 release. Recheck `npm audit` when updating the lockfile and run build/tests after removing or changing overrides.
