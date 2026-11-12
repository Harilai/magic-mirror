# Serveronly + Chromium deployment

This deployment runs the existing MagicMirror Serveronly backend as a user service and starts Chromium in kiosk mode after the backend responds. It does **not** remove or replace the existing Electron launch path.

## Requirements

- Linux with a graphical desktop session (X11 or Wayland) for the kiosk display.
- Node.js matching this repository's engine: `>=22.22.2 <23` or `>=24` (prefer Node 22.22.2 for a controlled ARMv7 Serveronly test).\n- A supported CPU/OS/libc combination for any native module. In this configuration, `MMM-Meteosat` requires a compatible `sharp` binary; see [the hardware compatibility matrix](./serveronly-hardware-compatibility.md).
- Dependencies installed in the MagicMirror checkout (`npm install` or the project's documented production install).
- Chromium installed and available as `chromium`, or set `MM_BROWSER_BIN` to its executable path.
- A valid local `config/config.js`.

The preflight intentionally does not install packages, modify the user's config, stop processes, or open firewall ports.\n\nFor a broader target-device diagnostic (architecture, Node, libc, Chromium, configured module entry points, `sharp` image-processing smoke test, and selected security warnings), run:\n\n```bash\nnpm run server:device-check\n# Machine-readable output for support bundles:\nnpm run server:device-check -- --json\n```\n\nThe device check exits non-zero when a required acceptance check fails. Warnings still require review; they are not an automatic approval.

## 1. Check the configuration

From the repository root:

```bash
node scripts/serveronly-preflight.js
```

It checks the Node.js engine range, loads the selected config, validates the effective port and verifies that the configured bind address/port can be opened. The effective port follows MagicMirror's precedence: `MM_PORT`, then `config.port`, then 8080.

If the port is occupied, the script exits with an error and does not kill or signal the process. Identify it yourself with:

```bash
ss -ltnp
```

Do not resolve a conflict by killing an unknown process.

## 2. Test Serveronly manually first

```bash
npm run server
```

From another terminal, open `http://127.0.0.1:8080/` (replace 8080 if your effective port differs). Confirm the mirror loads, the browser console is clean, and the custom modules initialize. Stop the server with Ctrl+C and confirm the process exits cleanly.

If `config.address` is set to a specific LAN address rather than a wildcard or loopback address, the kiosk launcher will connect to that configured address. If the address is `0.0.0.0` or `::`, it connects through loopback.

## 3. Test Chromium kiosk manually

With Serveronly running, execute:

```bash
node scripts/serveronly-kiosk.js
```

The launcher reads the same config and port override, waits up to 60 seconds for the HTTP(S) server to answer, then starts Chromium with kiosk flags. Override the wait with `MM_KIOSK_STARTUP_TIMEOUT_MS` and the browser executable with `MM_BROWSER_BIN`.

For HTTPS, Chromium must trust the configured certificate. The readiness probe tolerates a local self-signed certificate so it can detect the backend, but Chromium itself is not launched with certificate-validation bypass flags.

## 4. Install the user-level systemd units

User-level units are used because Chromium needs the logged-in desktop session's display and D-Bus environment.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/magicmirror-server.service.example ~/.config/systemd/user/magicmirror-server.service
cp deploy/systemd/magicmirror-kiosk.service.example ~/.config/systemd/user/magicmirror-kiosk.service
```

Edit both files:

- Change `WorkingDirectory=%h/MagicMirror` if the checkout is elsewhere.
- Ensure `node` is available in the systemd user manager's `PATH`. For an nvm installation, add the exact Node installation's `bin` directory to `Environment=PATH=...` in both units, or use the absolute Node executable in `ExecStartPre` and `ExecStart`. `MMM-Meteosat` starts a child worker by resolving `node` from `PATH`; set `MMM_METEOSAT_NODE_BINARY` to the same executable if the service path is non-standard.
- If using `MM_CONFIG_FILE` or `MM_PORT`, set the same values in **both** units.

Then reload and start the backend:

```bash
systemctl --user daemon-reload
systemctl --user enable --now magicmirror-server.service
systemctl --user status magicmirror-server.service
journalctl --user -u magicmirror-server.service -f
```

Start the kiosk unit from a terminal inside the active graphical session after importing the session environment:

```bash
systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR
systemctl --user start magicmirror-kiosk.service
systemctl --user status magicmirror-kiosk.service
journalctl --user -u magicmirror-kiosk.service -f
```

The kiosk unit requires the backend. Stopping/restarting the backend also stops the kiosk unit; start the kiosk unit again after a backend restart if systemd has not restarted it automatically.

To stop both:

```bash
systemctl --user stop magicmirror-kiosk.service magicmirror-server.service
```

Do not enable the kiosk unit at boot until you have confirmed how your desktop starts its graphical session. The server unit can be enabled independently; kiosk startup should be tied to the actual desktop-session lifecycle on the target distribution.

## 5. Network and security notes

- The kiosk uses the local configured address; remote-control clients use the device's LAN address and the effective MagicMirror port.
- Keep `MMM-Remote-Control`'s `secureEndpoints: true`.
- Keep a restrictive, correct `ipWhitelist`. Do not use an empty whitelist on a network-facing mirror unless unrestricted access is an intentional, reviewed decision.
- Do not configure router port forwarding to the mirror or Spotify OAuth callback.
- The Spotify OAuth callback (default 8888) is separate from the MagicMirror HTTP port and is only needed when running its authentication flow.
- Do not put Spotify credentials, OAuth tokens, or Remote Control API keys in these unit files or deployment scripts.

## 6. Current limitations

- This is a deployment scaffold, not proof that every custom module is compatible with Serveronly/Chromium.
- It does not install or configure Raspotify, audio devices, GPU acceleration, display rotation, touch input, or screen blanking.
- The kiosk launcher assumes the desktop session has already provided a usable display environment.
- The preflight port check is a point-in-time check; a different process could claim the port between preflight and server bind. MagicMirror's own bind error remains authoritative.
- Native dependencies such as `sharp` must be installed for the target CPU architecture, operating system and libc. Do not copy `node_modules` from a different architecture. On ARMv7, the locked `sharp` prebuilt requires glibc >=2.36 and Electron 44 is not available; use Serveronly + a matching Chromium package only after checking the target OS. Prefer ARM64 or x86_64 for the baseline deployment. See [the detailed compatibility matrix](./serveronly-hardware-compatibility.md).

Run the manual tests on the target board before enabling automatic startup.
