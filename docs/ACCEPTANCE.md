# Before relying on cloud sync and push

These checks require your configured Supabase project and physical devices.

- Apply the migration, run the SQL tests against local Supabase, register two users, and verify one cannot select or mutate the other's records.
- Use two devices with one account. Create/edit offline, reconnect, verify automatic upload and download. Edit the same event on both devices; verify both versions are retained. Delete offline on one device and edit on the other; verify the explicit conflict.
- Complete and snooze actions offline; reopen to verify persistence, then synchronize and verify their state on the other device. Retry an interrupted sync without duplicate records/actions.
- Export JSON and import into a fresh guest database. Compare event counts and action history. Import an older copy over changed data and explicitly resolve differences.
- Test production PWA first load, installation and offline reload on Android Chrome, iPad Home Screen, macOS Safari, and Windows Edge/Chrome. Verify the week/month calendar, touch targets, editor focus, keyboard access, overnight continuation, and selected timezone.
- Configure and enable push on each device. Verify a due booking action repeats, a snoozed action waits, and a synced completion stops further sends. Test denied permission, expired subscription, offline delivery, and sign-out unsubscribing. Inspect Cron failures. Never treat push as guaranteed delivery.
- Configure auth redirects for the exact Pages subpath; verify confirmation email, login, logout, and password recovery. Ensure service-role/VAPID private/scheduler secrets never appear in dist or repository files.
