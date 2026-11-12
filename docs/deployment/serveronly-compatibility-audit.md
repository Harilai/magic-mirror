# Deployment compatibility audit (Block 1)

**Repository:** `Harilai/magic-mirror`  
**Audit base:** `develop`  
**Work branch:** `feature/magicmirror-serveronly-deployment`  
**Scope:** deployment architecture, module runtime requirements, listeners, ports, and remote-control security.  
**Status:** audit only; no runtime behaviour changed in this commit.

## 1. Runtime baseline

From `package.json` on `develop`:

- MagicMirror version: `2.39.0-develop`.
- Node.js engine: `>=22.22.2 <23 || >=24`.
- Electron: optional dependency `^44.5.1`.
- Server-only entry point: `node ./serveronly`.
- Electron entry point: `js/electron.js`.
- The server resolves its listening port in `js/server_functions.js`: `MM_PORT` environment variable takes precedence over `config.port`, then falls back to 8080.

**Implication:** Serveronly is already an upstream-supported runtime path in this checkout. The first implementation should preserve both existing launch paths rather than replacing Electron.

## 2. Listener and port inventory

| Component | Listener / port | Finding |
|---|---|---|
| MagicMirror HTTP(S) server | Configured `port`, default 8080; overridden by `MM_PORT` | Single primary web listener. |
| Socket.IO | Same HTTP(S) server and port | It is attached to the MagicMirror server; it does not require a separate port. |
| MMM-Remote-Control UI and REST API | Same MagicMirror server | Its `node_helper.js` registers Express routes on the shared `expressApp`; it does not open another HTTP listener for the remote UI/API. |
| MMM-Spotify OAuth callback | Default TCP 8888 | The Spotify module's authentication flow creates a separate Express listener. This is for initial OAuth callback/authentication, not normal playback polling. Its configured `AUTH_PORT` can be changed. Confirm whether it is actually started in the installed setup before reserving it. |
| Spotify Web API | Outbound HTTPS | Playback/status requests go to Spotify; no local listening port is needed for normal API polling. |
| Raspotify / librespot | mDNS discovery commonly uses UDP 5353; audio transport is handled by librespot/network negotiation | Do not hard-code a guessed TCP control port. Inspect the installed Raspotify/librespot configuration and active sockets on the target OS. |
| MMM-Meteosat | No inbound listener found in its node helper | Downloads EUMETSAT imagery and writes local cache files. |
| MMM-MagicMover | No node helper found | Browser-side DOM movement and timers only; no listener. |
| Clock, calendar, weather, compliments, alert, update notification | No separate listener identified in the reviewed configuration | Calendar and weather make outbound requests; the local birthday ICS URL uses the MagicMirror server itself. |
| MagicMirror system-information helper | Child process spawned by `js/app.js` | A subprocess, not an HTTP service; must be accounted for in process supervision/shutdown. |

### Port allocation policy

1. Treat the MagicMirror HTTP port as configurable; retain 8080 as the default.
2. Do not assign a second port to Socket.IO or MMM-Remote-Control.
3. Treat Spotify OAuth port 8888 as an optional, temporary authentication listener. Check it only when OAuth setup is invoked.
4. Do not reserve UDP 5353 for MagicMirror. It belongs to local-network service discovery and may already be used by Avahi/Bonjour.
5. Before deployment, inspect active TCP and UDP listeners and report conflicts. Never kill an unrelated process automatically.
6. A port conflict must fail visibly and safely; do not silently select another port because clients, QR codes, callback URLs, and firewall rules need to know the effective port.
7. Validate the effective port from `MM_PORT` and configuration, including numeric range and invalid values, before launch.

## 3. MMM-Remote-Control findings

Reviewed files:

- `modules/MMM-Remote-Control/node_helper.js`
- `modules/MMM-Remote-Control/MMM-Remote-Control.js`
- `modules/MMM-Remote-Control/API/README.md`

Findings:

- The remote page is served at `/remote.html`; API routes are registered on the shared Express app.
- The documented default URL is `http://<mirror-ip>:8080/remote.html`.
- The API is under `/api` on the same server.
- `secureEndpoints: true` is enabled in the current configuration. Keep this enabled.
- The current configuration contains an API key literal. It must be rotated because it has been exposed in a tracked configuration, then moved to a local secret source/environment-backed configuration. Never copy the old value into documentation, commits, logs, or examples.
- The current `address: "0.0.0.0"` exposes the listener on all network interfaces. Access must remain restricted by a corrected and tested `ipWhitelist`; do not expose the service through router port forwarding.
- The current whitelist includes an entry with a leading whitespace character. This needs correction and tests for loopback plus the intended LAN subnet.
- QR generation should advertise the effective LAN address and effective port, not assume 8080.

## 4. Module runtime compatibility

| Module | Runtime observations | Follow-up |
|---|---|---|
| MMM-Remote-Control | Node helper uses Node APIs, child processes, filesystem, and shared Express routes. Browser UI uses MagicMirror module APIs. README requires MagicMirror 2.38.0+. | Test system actions under the dedicated service account and Serveronly; verify shutdown/restart semantics under systemd. |
| MMM-Spotify | Node helper uses filesystem, timers, Axios and Spotify API. OAuth callback opens a separate Express listener, default port 8888. | Confirm token files are local/untracked; test OAuth separately from normal playback. Verify Raspotify is a separate audio receiver, not a module listener. |
| MMM-Meteosat | Node helper uses filesystem, timers, network requests, image processing via `sharp`; package declares Node >=20.9.0. | Validate native `sharp` binary for the target CPU/OS/libc; measure RAM and image-processing load on the candidate board. |
| MMM-MagicMover | Browser-side DOM manipulation and `setInterval`; no node helper. | Test visual movement and cleanup in Chromium kiosk mode. |
| MMM-TodayEvents | It is referenced by the current config, but the expected paths `modules/MMM-TodayEvents/package.json` and `node_helper.js` were not found on `develop`. | Locate the actual source/repository or confirm whether it is a local-only module before declaring compatibility. |
| Default modules | Loaded by MagicMirror's core; calendar includes a local ICS URL on port 8080 and remote calendar feeds. | Test feeds and local ICS route in Serveronly; no extra local port expected. |

## 5. Process and service supervision

The core app registers SIGINT and SIGTERM handlers and stops the server and node helpers. It also spawns a system-information child process. The deployment implementation must therefore:

- Run one MagicMirror server process under one systemd unit.
- Run Chromium as a dependent graphical/kiosk process, not a second MagicMirror instance.
- Use systemd process-group/cgroup management so child processes are stopped with the service.
- Avoid blind `pkill` or broad process-name termination.
- Restart the failed component with bounded restart behaviour and useful logs.
- Check that only one managed MagicMirror instance is active.
- Never terminate a process merely because it owns a conflicting port; report PID/process details and require an explicit operator decision.

## 6. Security and configuration issues to address in implementation

- Rotate the currently committed MMM-Remote-Control API key; do not preserve the exposed key.
- Move secrets and per-device values out of tracked config files.
- Correct the whitespace in `ipWhitelist` and validate the intended subnet against the actual LAN.
- Keep `secureEndpoints: true`.
- Bind to the required LAN interface only when remote access is enabled; otherwise prefer loopback.
- Do not expose port 8080 or the OAuth callback directly to the public Internet.
- Ensure the QR code and remote-control URL use the actual configured port and a reachable LAN address.

## 7. Block 1 outcome

**Confirmed:** the core Serveronly entry point exists; Socket.IO and MMM-Remote-Control share the main HTTP server; Spotify OAuth is the only additional local TCP listener identified in the reviewed custom modules; MMM-Meteosat and MMM-MagicMover do not open listeners in their reviewed helpers.

**Not yet proven:** all custom modules work under Chromium/Serveronly; the target board can run the required Node version and native `sharp` dependency; the exact TodayEvents source; Raspotify's runtime sockets on the target OS; and sustained performance on candidate hardware.

**Next block:** implement the alternate launch/deployment path on this branch with explicit port configuration, preflight checks, process ownership, systemd lifecycle, and kiosk startup. Keep Electron as the unchanged default path until integration tests pass.


## 8. Block 3 follow-up: architecture and module audit

The detailed compatibility matrix and target-device acceptance checklist are maintained in [serveronly-hardware-compatibility.md](./serveronly-hardware-compatibility.md).

Corrections and additional findings:

- `MMM-TodayEvents` is present as a tracked frontend file. It has no `node_helper.js` or module-level `package.json`; the earlier uncertainty about its source location is resolved.
- The committed `MMM-Meteosat` lockfile resolves `sharp@0.35.5` and optional Linux ARM and ARM64 platform packages. The upstream prebuilt binaries have different libc minimums; verify the target with `ldd --version` and test `require("sharp")` on the board.
- The Meteosat image worker launches `node` from `PATH` unless `MMM_METEOSAT_NODE_BINARY` is provided. A systemd service using a non-system Node installation must make the same Node executable available to that child process.
- `MMM-Remote-Control` registers its remote routes on the shared server, but some actions explicitly access Electron's `BrowserWindow` and will not control Chromium kiosk windows. Its default monitor commands assume `wlopm`; shutdown/reboot use privileged OS commands and need a deliberate least-privilege configuration.
- `MMM-Spotify` normal playback uses the provisioned token. Its first-time OAuth flow can invoke an external browser and starts the separate callback listener.

**Next block:** prepare target-board acceptance tests and run them on the exact selected hardware/OS. Do not claim sustained performance, reliable automatic boot, GPU acceleration, or module compatibility until those physical tests pass.
