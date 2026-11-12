# Serveronly hardware and module compatibility (Block 3)

**Repository:** `Harilai/magic-mirror`  
**Work branch:** `feature/magicmirror-serveronly-deployment`  
**Reviewed baseline:** MagicMirror `2.39.0-develop`, Node engine `>=22.22.2 <23 || >=24`, Electron `^44.5.1`.  
**Status:** source/configuration audit plus upstream platform-documentation check. No target board was available, so this is not a physical-device certification.

## 1. Runtime compatibility by CPU architecture

| Linux target | Node.js 22.22.2 binary | Electron 44 | `sharp` 0.35.5 prebuilt | Serveronly + Chromium assessment |
|---|---|---|---|---|
| x86_64 / x64 | Yes | Yes | Yes; glibc >=2.28 or musl >=1.2.5 (CPU also needs SSE4.2) | Preferred low-risk architecture. Confirm distro Chromium and system libraries. |
| ARM64 / aarch64 | Yes | Yes | Yes; glibc >=2.28 or musl >=1.2.5 | Preferred ARM architecture. Raspberry Pi OS 64-bit supports Pi 3, 4 and 5; desktop edition includes Chromium. |
| ARMv7 / armhf (32-bit) | Yes, official Node 22.22.2 archive publishes `linux-armv7l` | **No**; Electron 44 removed Linux armv7l binaries | Yes, Linux ARM/glibc build; glibc >=2.36 required | Serveronly + Chromium can be considered only when the OS/browser are 32-bit compatible and the libc requirement is met. It cannot use this repository's Electron 44 path. |

Important qualifications:

- The repository engine range accepts Node 22.22.2. The official Node archive explicitly lists Linux x64, ARM64 and ARMv7 binaries for that version.
- Prefer Node 22.22.2 on ARMv7. The current Node platform table marks Linux armv7 experimental (and notes the downgrade from Node 24); do not treat ARMv7 as the long-term preferred deployment target.
- Do not infer `sharp` compatibility from CPU architecture alone. Check the target's actual libc with `ldd --version` and Node's runtime report. For the locked `sharp` 0.35.5 package, use the official prebuilt-binary requirements below.
- The lockfile contains optional platform packages `@img/sharp-linux-arm` and `@img/sharp-linux-arm64`. Install dependencies on the target device; never copy a `node_modules` tree built for a different architecture or libc.
- Raspberry Pi OS Desktop includes Chromium. Raspberry Pi OS has 32-bit and 64-bit editions; its official documentation identifies Pi 3, 4 and 5 as capable of running the 64-bit edition.

## 2. Candidate board assessment

| Candidate | Architecture / memory context | Assessment for this deployment | Current decision |
|---|---|---|---|
| Raspberry Pi 4, 2 GB | ARM64-capable; 2 GB RAM | Good architectural match for 64-bit Raspberry Pi OS, Node 22 ARM64, Chromium and `sharp` ARM64. Memory and sustained kiosk performance still need measurement. | **Preferred Pi candidate for a real-device test.** |
| Raspberry Pi 3 B+ | ARM64-capable but only 1 GB RAM | A 64-bit OS is architecturally possible. A 32-bit OS would require Serveronly rather than Electron 44 and `glibc` >=2.36 for the `sharp` prebuilt. Low RAM and older CPU make Chromium + all configured modules a performance risk. | Not the preferred purchase; do not rule out solely by ISA. |
| HP T520 thin client | x86_64; previously considered 2 GB RAM / 32 GB SSD configuration | x64 Node/Electron/Chromium/`sharp` compatibility is the simplest software path. Confirm actual RAM, storage health, graphics output/adaptor, and distro support on the exact unit. | Strong low-cost x86 candidate if the exact listing is still available and hardware checks pass. |
| Le Potato / AML-S905X-CC | ARM64-capable; 2 GB variants considered | CPU architecture is suitable, but the exact maintained distro image, Chromium package/graphics stack, libc version and native package install must be validated for the chosen image. | Conditional; do not buy based on ARM64 capability alone. |

This table compares technical fit, not current availability or price. No purchase is recommended without checking the exact board revision, RAM, storage, power supply, video output, and OS image.

## 3. Configured module audit

| Module | Runtime/dependency findings | Serveronly + Chromium status |
|---|---|---|
| `MMM-MagicMover` | Frontend module. DOM transformations and timers; no `node_helper.js` or native dependency. | Browser-compatible by design; verify visual movement and timer cleanup in the actual kiosk. |
| `MMM-TodayEvents` | Tracked source exists at `modules/MMM-TodayEvents/MMM-TodayEvents.js`. It is frontend-only, listens to `CALENDAR_EVENTS`, and uses MagicMirror's bundled `moment.js`. There is no module `package.json` or `node_helper.js`. | Browser-compatible by design. The earlier Block 1 note that its source was missing is corrected by this finding. |
| `MMM-Spotify` | Node helper uses Axios, filesystem and timers; `open` is used by the initial OAuth flow. No native binary dependency identified. Its OAuth callback starts a separate Express listener, default port 8888. | Normal playback should work after a valid token is provisioned. Initial authentication may try to open a desktop browser; use its custom callback flow or authenticate separately, and keep port 8888 temporary/restricted. |
| `MMM-Remote-Control` | Node helper registers routes on MagicMirror's shared Express server; dependencies are JavaScript packages, not native binaries. System controls invoke shell commands. Some actions explicitly require Electron's `BrowserWindow`. | Remote page/API routes can be served by Serveronly. Electron window actions (minimize/fullscreen/devtools) cannot operate on Chromium and should be treated as unavailable. Shutdown/reboot and monitor commands require deliberate OS-specific configuration and least-privilege permissions. |
| `MMM-Meteosat` | Node helper uses `sharp@0.35.5`; image processing runs in a child Node process. The worker finds `node` via `PATH` unless `MMM_METEOSAT_NODE_BINARY` is set. The image pipeline performs a per-pixel alpha-mask pass. | Conditional on native `sharp` installation for target architecture/libc and correct worker Node path. Benchmark image refresh time, CPU and peak RAM on the board. |
| Default calendar/weather/clock/compliments/alert/update-notification modules | No extra native dependencies identified in this configuration. Calendar and weather make outbound requests; the local birthday ICS feed is served by MagicMirror itself. | Expected to run in the browser/server path; network feeds and local ICS must be tested on target. |

### Remote Control limitations to document for operators

- The endpoints remain hosted on the shared MagicMirror server.
- Electron-specific window commands are not Chromium kiosk controls.
- The default monitor power commands in the inspected module use `wlopm`, which assumes a compatible Wayland environment. Provide and test custom commands for the selected display/session when necessary.
- The default shutdown/reboot commands call `sudo shutdown`. Configure narrowly scoped sudo permissions only after reviewing the exact command and service user; do not grant general passwordless sudo.
- Keep `secureEndpoints: true`, rotate the already-exposed API key, and correct/test the leading-whitespace whitelist entry before LAN deployment.

## 4. Target-device acceptance checks

Run these on the exact board and OS image before enabling automatic startup:

```bash
uname -m
getconf LONG_BIT
ldd --version | head -n 1
node --version
node -p "process.arch"
node -p "process.report.getReport().header.glibcVersionRuntime"
command -v chromium || command -v chromium-browser
```

Then, from the repository:

```bash
npm run server:preflight
npm run server
```

In another shell, open the local mirror in Chromium and verify all configured modules. For `MMM-Meteosat`:

```bash
cd modules/MMM-Meteosat
npm ci
node -e "const sharp = require('sharp'); console.log(sharp.versions)"
```

Confirm that the optional package selected for the target architecture was installed and that `sharp` can process a real image. For non-standard Node installations, set `MMM_METEOSAT_NODE_BINARY` to the same Node executable used by the MagicMirror service, or ensure the matching executable is first in the service `PATH`.

Record at least:

- cold boot to usable mirror time;
- idle and peak RAM, including Chromium and the Meteosat worker;
- CPU time and wall-clock time for a Meteosat image refresh;
- behaviour after Wi-Fi loss and recovery;
- clean service stop, reboot and restart;
- Spotify playback after token provisioning;
- Remote Control operations that are supported in Serveronly, with Electron-only operations marked unavailable.

## 5. Evidence and decision

The architecture findings above were cross-checked against:

- [Node.js v22.22.2 download archive](https://nodejs.org/en/download/archive/v22.22.2)
- [Electron 44.0 release notes](https://www.electronjs.org/blog/electron-44-0)
- [sharp installation and prebuilt binary requirements](https://sharp.pixelplumbing.com/install/)
- [Raspberry Pi OS architecture and desktop editions](https://www.raspberrypi.com/documentation/computers/os.html)

**Decision:** prioritize a 64-bit OS on ARM64 hardware or an x86_64 thin client. Keep ARMv7 as a conditional Serveronly-only fallback, not a baseline for the Electron deployment. No physical compatibility, performance or thermal claim is made until the target board passes the acceptance checks.
