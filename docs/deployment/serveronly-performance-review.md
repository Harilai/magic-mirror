# Serveronly performance review

**Repository:** `Harilai/magic-mirror`  
**Branch:** `feature/magicmirror-serveronly-deployment`  
**Reviewed:** 2026-11-13  
**Scope:** static source/configuration review for the current Serveronly + Chromium deployment. No target board was available; no performance result or hardware certification is claimed.

## Executive assessment

Serveronly can reduce the overhead of a full desktop installation, but it does not make the display process headless. The deployment still runs Node.js and the configured node helpers, a graphical session, Chromium, and the MagicMirror frontend. On a single-board deployment, Chromium remains a material part of the memory budget.

A minimal Linux installation plus a lightweight X11/Wayland session is therefore useful, but code-level image handling is also worth optimizing before selecting a 2 GB device.

## Findings

### P1 — Meteosat source images are much larger than their display size

The current configuration sets `imageSize: 350` and `wmsImageSize: 1800`. The frontend sets the image stack to 350 CSS pixels wide and CSS scales both the satellite image and overlay to that width. However, the backend retains and serves the processed satellite image and combined overlay at 1800 × 1800 pixels.

At four bytes per decoded RGBA pixel, one 1800 × 1800 browser image represents about 12.36 MiB of pixel data; the satellite image plus overlay represent about 24.72 MiB before other browser surfaces and copies. At 700 × 700 (2× the CSS width), the equivalent pair is about 3.74 MiB. These are decoded-pixel estimates, not a measurement of Chromium's total RSS/PSS.

**Implemented on the work branch:** the WMS source remains at 1800 px; the processed browser image and overlay now use a 2× display-width target capped at the WMS source size. With the current 350 px CSS width, both output layers are 700 px. Older cached output without matching render-size metadata is regenerated rather than reused. This change does not reduce source download resolution. Visual sharpness, alpha edges and image/overlay alignment still require a real browser check at 1920 × 1080.

Relevant source: `modules/MMM-Meteosat/MMM-Meteosat.js`, `modules/MMM-Meteosat/node_helper.js`, `modules/MMM-Meteosat/src/overlay.js`, `modules/MMM-Meteosat/MMM-Meteosat.css`.

### P1 — Meteosat downloads buffer and write the same image more than once

`readBodyWithLimit()` collects the complete response in chunks and then calls `Buffer.concat()`. The WMS image is bounded at 40 MiB and the overlay at 5 MiB. The code writes the complete buffer to a validation temporary file, reads it with the Sharp worker, deletes that file, hashes the in-memory buffer, then writes the same buffer to another temporary file before the atomic rename.

This is robustly bounded, but it increases peak heap usage and duplicates disk I/O. During `Buffer.concat()`, the chunks and the resulting buffer coexist temporarily.

**Implemented on the work branch:** WMS satellite images and overlay layers now stream to one unique temporary file while enforcing byte limits and calculating SHA-256 incrementally. Sharp validates the temporary file before an atomic rename. This removes the full response buffer, its concatenation copy, and the second validation/write cycle. Non-2xx bodies are cancelled rather than buffered for log previews. Tests cover byte limits, cancellation cleanup, streamed hashes, complete WMS image handling and overlay cache writes.

Relevant source: `modules/MMM-Meteosat/src/sources/wms.js` and `modules/MMM-Meteosat/src/overlay.js`.

### P1 — Sharp worker allocates two avoidable per-pixel buffers and performs a square root for every pixel

For an 1800 × 1800 input, `sharpWorker.js` currently creates:
- an RGBA buffer of 12,960,000 bytes;
- a separate source-alpha buffer of 3,240,000 bytes;
- a separate output-alpha mask of 3,240,000 bytes.

That is about 18.54 MiB of JavaScript pixel buffers at 1800 × 1800, excluding Sharp/libvips allocations. The worker also calls `Math.hypot()` once per pixel. The alpha value can be updated directly in the RGBA buffer, preserving the source alpha, and squared-distance comparisons can avoid a square root for pixels clearly inside or outside the narrow feather boundary.

**Recommendation:** optimize the worker in-place and use squared radii, calculating `Math.sqrt()` only for pixels in the feather band. Keep the current mask semantics, and add pixel-for-pixel equivalence tests over opaque and partially transparent fixtures, including non-square images and boundary pixels. Keep the separate child process: it isolates native image-processing peaks from the long-lived MagicMirror server.

Relevant source: `modules/MMM-Meteosat/src/sharpWorker.js` and `modules/MMM-Meteosat/src/imageProcessor.js`.

### P2 — Spotify polls every second during active playback

The configured `MMM-Spotify` module uses its default `updateInterval: 1000` while playback is active and `idleInterval: 10000` while idle. This is mainly a network/API and periodic CPU cost, not a major steady-state memory problem.

**Next implementation item:** test a 2,000–3,000 ms active polling interval and retain the 10,000 ms idle interval. Disable `debug: true` in the deployed configuration unless actively diagnosing an issue. Confirm that progress updates and controls remain acceptable.

Relevant source: `modules/MMM-Spotify/MMM-Spotify.js`, `modules/MMM-Spotify/node_helper.js`, and `config/config.js`.

### P2 — WMS source resolution should be benchmarked, not lowered blindly

The source request is 1800 × 1800, even though the displayed image width is 350 CSS pixels. Rendering the cached output at 700 px should be the first change. Only after a visual comparison should the source request be tested at 1200 or 900 px. The source size affects the satellite detail and the contour overlay, so lowering it without a display comparison could degrade the mirror.

### Low-priority modules

- `MMM-MagicMover` moves regions on a 10-minute interval in the current config. Its timers are infrequent and are not a meaningful RAM target.
- `MMM-TodayEvents` refreshes once per minute and displays at most three events. Its state is small.
- Calendar feeds are configured for weekly refresh. This is not a material continuous load.
- `MMM-Remote-Control` registers routes on MagicMirror's shared Express server rather than opening a separate listener. Its periodic module-list/update checks are background work, but should not be the first memory optimization target.

## Runtime memory model

For the proposed single-device deployment, budget these separately:

1. Linux kernel, services, graphics stack, and window manager.
2. MagicMirror Node.js server and its loaded node helpers.
3. Chromium browser, renderer, GPU/utility processes, decoded images, DOM, fonts, and CSS surfaces.
4. Transient Meteosat download, Sharp/libvips processing, and overlay refresh.

A minimal server OS reduces item 1, but does not remove items 2–4. The existing Serveronly kiosk launcher starts a normal Chromium kiosk, not headless Chromium. Do not size the board from the Node server's memory alone.

## Acceptance measurements before purchase

Run the full configured mirror on the exact OS and board and record:

- total RAM and `MemAvailable` from `/proc/meminfo`;
- Chromium and Node process PSS (prefer PSS over summing RSS, since Chromium processes share memory);
- cgroup `MemoryCurrent` for backend and kiosk services, where available;
- peak memory during a Meteosat refresh and overlay update;
- swap-in/swap-out activity and OOM/kernel logs;
- CPU and elapsed time during Meteosat processing;
- at least an overnight run with Spotify, weather, calendar and Remote Control enabled.

Use `MemAvailable`, not just the `free` column from `free`, to assess headroom. A cached Linux filesystem page is reclaimable and should not be mistaken for an application memory leak.

The new `server:resource-monitor` command samples Linux `MemAvailable`/swap and PSS/RSS for matching MagicMirror, Chromium and Meteosat worker processes. It records samples and peak PSS to a mode-0600 JSON report. The monitor is a sampling aid: it does not yet measure cgroup pressure, CPU utilisation, disk I/O, thermal throttling or GPU memory. The `server:device-check` remains a compatibility preflight, not a performance certification.

## Hardware implications

### First x86 candidate: Dell Wyse 5070

The standard Wyse 5070 variants use Intel Celeron J4105 or Pentium Silver J5005, UHD 600/605 graphics, 4/8 GB RAM configurations, DisplayPort outputs, Gigabit Ethernet, and optional WLAN. Community reports describe Debian running successfully on a 4 GB / 32 GB eMMC unit. Its x86-64 architecture is the lower-risk Node.js and Sharp route, but confirm the exact CPU, RAM, storage, PSU and Wi-Fi option on the listing. It needs DisplayPort-to-HDMI for the mirror controller.

### Budget wildcard: Fujitsu Futro S920

A homelab user reported buying S920 units with a quad-core AMD CPU, 4 GB RAM and 64 GB SSD for under €40, but that is a community report rather than a current Spanish offer or a MagicMirror test. Other listings may have only 2 GB RAM, small flash storage and no power supply. The model has DisplayPort and DVI-I rather than native HDMI; WLAN was optional. Treat it as a conditional bargain only when the complete bundle is documented.

### ARM boards

Users in the MagicMirror community report running alternative boards such as Le Potato and Orange Pi 3 LTS. Those reports show that alternatives can work, but they do not certify the exact OS image, Chromium graphics stack, native Sharp package, or this project's custom modules. Prefer ARM64 over ARMv7 where practical. Do not choose a board from CPU architecture alone.

## Decision

- Do not buy a board yet.
- Keep x86-64 thin clients and ARM64 boards in the shortlist, but require at least 4 GB RAM for the preferred single-device setup unless a real-device benchmark proves 2 GB adequate.
- First implement and test the Meteosat output resize and in-place alpha-mask optimization, then reduce duplicate buffering in WMS downloads.
- Then benchmark the complete mirror at 1920 × 1080 and use the results to set a defensible minimum RAM/CPU specification.

This review is static. It does not certify any board, guarantee a memory figure, or imply that the proposed optimizations have already been implemented.


## Compact and silent installation constraints

The compute unit is intended to sit behind the mirror glass. Acoustic output and depth therefore matter as much as CPU performance.

- **Cooling preference:** fanless passive cooling; no moving parts in the compute unit. A fanless chassis still needs thermal clearance and must not be sealed against an insulating surface.
- **Depth preference:** target at or below 30 mm for the compute unit; 30–36 mm is a compromise, not an ideal behind-glass solution. A flat SBC with a ventilated passive heatsink case is preferred if its software stack passes the same acceptance tests.
- **Footprint:** prefer a board/box that can be mounted to the rear frame without covering the active screen area or blocking panel ventilation.
- **Power:** an external fanless DC adapter is acceptable, but it must be mounted with strain relief and away from heat-sensitive film/adhesive.
- **Thermal envelope:** test with the actual rear cavity, panel heat and ambient temperature. A fanless unit can throttle when installed in a closed, warm cavity even if it is quiet on an open desk.

### Hardware candidates with acoustic/size evidence

| Candidate | Cooling / physical evidence | Practical status |
|---|---|---|
| Dell Wyse 5070 Standard | Community teardown/review describes the standard chassis as all-passive; official dimensions are 184 × 184 × 35.6 mm. Independent idle measurements around 2.7 W headless and 5.6 W with monitor are reported, depending on configuration. | Silent and efficient, but the 184 mm square footprint is bulky behind a mirror. Keep as a fallback if it can be mounted on the rear frame outside the display cavity. |
| Dell Wyse 3040 | 101.6 × 101.6 × 27.94 mm; Atom x5-Z8350, soldered 2 GB RAM and 8/16 GB eMMC in Dell documentation. | Thin and very compact, but the fixed 2 GB RAM and small storage make it a risky MagicMirror candidate. Not approved without a full workload test. |
| Fujitsu FUTRO S940 | Fujitsu describes it as fanless; J5005 variants and 4/8 GB RAM are documented. | Worth comparing, but verify dimensions and the exact listing configuration before treating it as a shallow device. |
| ARM64 SBC with passive case | Smallest likely form factor and can be fanless. | High integration risk: exact maintained OS image, Chromium graphics acceleration, Wi-Fi, Sharp, and sustained thermal behaviour must be checked per board. |

**Current purchase filter:** do not buy a fan-cooled unit for the mirror enclosure. Prefer passive cooling and a shallower design; do not trade away RAM, storage reliability, Chromium support or thermal safety just to meet a low depth figure.


## Runtime resource monitor

Start the backend and Chromium kiosk first, then run this from a second terminal or SSH session on the same Linux device:

```bash
npm run server:resource-monitor -- --duration=900 --interval=5 --output=resources.json
```

The default filter includes Chromium processes, the `serveronly` backend, MagicMirror paths, Meteosat and the Sharp worker. The monitor samples `/proc/meminfo` for total/available/swap memory and reads `smaps_rollup` for PSS where permissions allow. PSS is more suitable than adding RSS for a multi-process Chromium instance because shared pages are proportionally accounted for. If `smaps_rollup` cannot be read, the report flags an RSS-only fallback for that process.

Run a representative workload during the measurement: wait for initial Meteosat retrieval, at least one later update, active and idle Spotify, weather/calendar refresh, and Remote Control access. For a credible purchase decision, repeat with the actual 1920 × 1080 panel powered and the compute unit mounted in its final rear cavity. The monitor currently does not sample CPU, cgroup pressure, GPU memory, SSD latency or temperature, so those remain separate acceptance checks.
