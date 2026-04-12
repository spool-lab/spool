# Stage D Cold-Launch Smoke Test

Run this manual smoke test after the Stage D SDK split to verify that
first-party connectors load correctly from the first-run bundle path.

## Preconditions

- macOS arm64 (adapt for other platforms)
- Chrome installed with a logged-in X account (for Twitter sync validation)

## Test: Cold launch from clean state

1. **Build a fresh app**:
   ```bash
   pnpm --filter @spool/app clean
   pnpm --filter @spool/app build:mac
   ```

2. **Delete any previous connector install**:
   ```bash
   rm -rf ~/.spool/connectors
   ```

3. **Disable network**: turn off Wi-Fi / Ethernet.

4. **Launch the freshly built app**:
   ```bash
   open packages/app/dist-electron/mac-arm64/Spool.app
   ```

5. **Verify bundle extraction**: while the app is running, check:
   ```bash
   ls ~/.spool/connectors/node_modules/@spool-lab/
   ```
   Expected: `connector-twitter-bookmarks/` directory present.

6. **Verify registration**: in the app UI, navigate to the Connectors panel.
   Expected: Twitter Bookmarks appears as a registered connector without
   a "load failed" error.

7. **Try a manual sync**:
   - Click "Sync Now" on Twitter Bookmarks
   - Expected: error with `NETWORK_OFFLINE` or `NETWORK_TIMEOUT` code
     (not a loader crash, not a capability error)
   - This confirms the connector reached the fetch layer before failing

8. **Re-enable network and sync again**:
   - Click "Sync Now" on Twitter Bookmarks
   - Expected: at least one page of bookmarks fetched and written to DB
   - Verify in the app UI that tweets appear in search

## Test: `.do-not-restore` opt-out

1. Create the opt-out file:
   ```bash
   echo "@spool-lab/connector-twitter-bookmarks" > ~/.spool/connectors/.do-not-restore
   rm -rf ~/.spool/connectors/node_modules/@spool-lab/connector-twitter-bookmarks
   ```

2. Restart the app.

3. Expected: Twitter Bookmarks does NOT re-extract. Directory remains absent.

4. Cleanup: delete the opt-out file and restart to restore.

## Test: Cancel propagation during backoff

1. Start a Twitter sync with Chrome offline so the fetch stalls
2. Click "Stop" / trigger `scheduler.stop()` from the status bar
3. Expected: sync terminates within 200ms — log shows `stopReason: 'cancelled'`,
   no 120-second hang from the 429 backoff loop

## Failure diagnostics

If any step fails, check `~/Library/Logs/Spool/main.log` for loader and
capability diagnostic output. Common failure modes:

- **"entry file not found"**: the tarball's `dist/index.js` is missing.
  Check the plugin's `"files"` field in package.json includes `"dist"`.
- **"capability used but not declared"**: the plugin is using a capability
  it didn't list in `spool.capabilities`. Update the manifest.
- **"metadata mismatch"**: the connector instance fields don't match the
  manifest's `spool.*` fields. Synchronize them.
