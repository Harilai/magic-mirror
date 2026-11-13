# Serveronly performance review

**Repository:** `Harilai/magic-mirror`  
**Branch:** `feature/magicmirror-serveronly-deployment`  
**Reviewed:** 2026-11-13  
**Scope:** static source/configuration review, implementation of the initial Meteosat/Spotify/resource-monitor optimizations, and CI validation. No target board was available; no device-level performance result or hardware certification is claimed.

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

### P1 — Sharp worker allocation and per-pixel CPU cost

In the baseline implementation, the 1800 × 1800 processing path created an RGBA buffer plus separate source-alpha and output-alpha buffers (about 18.54 MiB of JavaScript pixel buffers), and called `Math.hypot()` once per pixel.

**Implemented on the work branch:** the mask logic now lives in `src/alphaMask.js`; the worker changes alpha bytes directly in the RGBA buffer and uses squared-distance checks, calculating a square root only in the narrow feather band. It retains the separate Sharp child process so a processing peak is isolated from the long-lived MagicMirror server. Pixel-equivalence tests compare against the previous `Math.hypot` algorithm, verify RGB bytes remain unchanged, and test malformed dimensions. These tests passed in CI. The exact CPU-time reduction still needs benchmarking on the target board.

Relevant source: `modules/MMM-Meteosat/src/alphaMask.js`, `modules/MMM-Meteosat/src/sharpWorker.js`, `modules/MMM-Meteosat/src/imageProcessor.js`.
### P2 — Spotify polls every second during active playback

The configured `MMM-Spotify` module uses its default `updateInterval: 1000` while playback is active and `idleInterval: 10000` while idle. This is mainly a network/API and periodic CPU cost, not a major steady-state memory problem.

**Implemented in the project configuration:** `MMM-Spotify` now uses a 2,000 ms active polling interval and the 10,000 ms idle interval, with debug logging disabled. This halves the normal active polling frequency; validate that the two-second progress refresh is acceptable on the mirror.

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

The new `server:resource-monitor` command samples Linux `MemAvailable`/swap, PSS/RSS for matching MagicMirror, Chromium and Meteosat worker processes, and available Linux thermal zones. It records samples, peak PSS and peak temperature by sensor to a mode-0600 JSON report. The sampler excludes its own PID from target totals. The monitor is a sampling aid: it does not yet measure cgroup pressure, CPU utilisation, disk I/O, GPU memory or actual clock throttling. The `server:device-check` remains a compatibility preflight, not a performance certification.

## Hardware implications

### First x86 candidate: HP t430

The HP t430 is the best physical/software balance found so far for a single-device installation: 135 × 135 × 32 mm (0.58 L), approximately 416 g, fanless according to HP's product literature, and native HDMI. Look for the Celeron N4000 (2 cores), 4 GB embedded DDR4 and 32 GB eMMC SKU. HP also sold 2 GB / 16 GB ThinPro configurations; those are not acceptable for this deployment. Wireless is optional on some SKUs, so confirm the Wi-Fi module or plan to use Ethernet.

The N4000's UHD 600 is a newer graphics generation than the Z83-F's Atom x5-Z8350, but this remains an entry-level dual-core platform and the memory/eMMC are not upgradeable. Current used listings around €50 plus delivery are above the €40 delivered ceiling; this is a watch-list candidate, not a buy recommendation. Its exact CPU flags, Chromium acceleration and full mirror performance must pass the device checks.

Sources: [HP t430 specifications and dimensions](https://h20195.www2.hp.com/v2/GetDocument.aspx?docname=4AA7-2899ENUC), [HP fanless product brochure](https://inquirecontent1.ingrammicro.com/Manufacturer-Brochure/1048745626.pdf), [used 4 GB / 32 GB listing](https://www.marktplaats.nl/v/computers-en-software/desktop-pc-s/m2452276202-hp-t430-thin-client-compacte-en-efficiente-mini-pc).

### Secondary x86 candidate: Minisforum Z83-F

The Z83-F is smaller at 120 × 120 × 27 mm and fanless, with a nominal 4 GB / 64 GB eMMC configuration and HDMI. However, a detailed Linux Mint user report describes sluggish browsing, page-scroll lag and poor YouTube performance on its Atom x5-Z8350. It is not the preferred combined Serveronly + Chromium host without a real target-device test. Current used listings around €50 plus shipping are also above budget.

### Larger fallback: Dell Wyse 5070

The standard Wyse 5070 variants use Intel Celeron J4105 or Pentium Silver J5005, UHD 600/605 graphics, 4/8 GB RAM configurations, DisplayPort outputs, Gigabit Ethernet and optional WLAN. Community reports describe Debian running successfully on a 4 GB / 32 GB eMMC unit. Its x86-64 architecture is a lower-risk Node.js and Sharp route, but its 184 × 184 × 35.6 mm chassis is mechanically bulky; it is suitable only if mounted on the rear frame outside the shallow cavity.


### ARM boards

Users in the MagicMirror community report running alternative boards such as Le Potato and Orange Pi 3 LTS. Those reports show that alternatives can work, but they do not certify the exact OS image, Chromium graphics stack, native Sharp package, or this project's custom modules. Prefer ARM64 over ARMv7 where practical. Do not choose a board from CPU architecture alone.

## Decision

- Do not buy a board yet.
- Keep x86-64 thin clients and ARM64 boards in the shortlist, but require at least 4 GB RAM for the preferred single-device setup unless a real-device benchmark proves 2 GB adequate.
- Meteosat browser-output resize (1800 → 700), in-place alpha-mask processing and streamed WMS/overlay downloads are implemented and CI-tested.
- The Linux resource monitor and target-device Sharp benchmark are implemented; the remaining sizing work is to run them against the full 1920 × 1080 mirror on the actual candidate hardware.

This review combines source analysis and CI-tested changes. It does not certify a physical board, guarantee a memory figure, or prove 1920 × 1080 Chromium acceleration or stable overnight operation.


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
| HP t430 | 135 × 135 × 32 mm; HP product literature describes fanless cooling; N4000 dual-core, 4 GB embedded DDR4 / 32 GB eMMC SKU, native HDMI, UHD 600; Wi-Fi optional. | Best current compact single-device candidate; exact 4 GB / 32 GB SKU required. Current used listings around €50 plus shipping are over budget. |
| Minisforum Z83-F | Fanless Atom x5-Z8350; nominal 4 GB / 64 GB eMMC, HDMI; 120 × 120 × 27 mm. | Smaller but weaker browser-performance reports and current used listings around €50 plus shipping. Secondary watch-list candidate only. |
| Dell Wyse 5070 Standard | Passive x86-64; J4105/J5005; 4–8 GB RAM; 184 × 184 × 35.6 mm. | Technically more flexible but large square footprint; fallback only if mounted outside the shallow cavity. |
| Dell Wyse 3040 | 101.6 × 101.6 × 27.94 mm; Atom x5-Z8350, soldered 2 GB RAM and 8/16 GB eMMC. | Too little memory and storage; exclude. |
| Fujitsu FUTRO S940 | Fanless J5005 variants exist with 4/8 GB RAM; 250 × 193 × 52 mm and ventilation clearance requirements. | Too deep and large for the behind-glass installation. |
| ARM64 SBC with passive case | Smallest possible footprint and fanless case. | High integration risk: exact maintained OS image, accelerated Chromium, Wi-Fi, Sharp and sustained thermal behaviour must be tested per board. |
**Current purchase filter:** do not buy a fan-cooled unit for the mirror enclosure. Prefer passive cooling and a shallower design; do not trade away RAM, storage reliability, Chromium support or thermal safety just to meet a low depth figure.


## Repeatable Meteosat compute benchmark

On each Linux candidate, from the MagicMirror checkout run:

```bash
npm run server:benchmark-meteosat -- --source-size=1800 --render-size=700 --repeat=3
```

The benchmark creates a synthetic 1800 × 1800 PNG, invokes the real Sharp child worker, applies the same alpha mask and 700 px render limit as the mirror, and reports:
- end-to-end duration and worker processing duration (min/median/max);
- the child worker's peak RSS from Linux `process.resourceUsage().maxRSS`;
- input/output file sizes and resulting dimensions;
- Node version, CPU model and architecture.

Use the same source/render/repeat settings on every candidate. Do not compare a 600 px CI smoke run with an 1800 px device run. The benchmark isolates the Meteosat image-processing path; it does **not** include Chromium, MagicMirror's server, GPU memory, the complete desktop session, or thermal behaviour inside the mirror cavity. Pair it with `server:resource-monitor` while the full frontend is running. CI exercises a small 600 → 300 px smoke run to verify the benchmark path, not to set a hardware performance baseline.

## Runtime resource monitor

Start the backend and Chromium kiosk first, then run this from a second terminal or SSH session on the same Linux device:

```bash
npm run server:resource-monitor -- --duration=900 --interval=5 --output=resources.json
```

The default filter includes Chromium processes, the `serveronly` backend, MagicMirror paths, Meteosat and the Sharp worker. The monitor samples `/proc/meminfo` for total/available/swap memory and reads `smaps_rollup` for PSS where permissions allow. PSS is more suitable than adding RSS for a multi-process Chromium instance because shared pages are proportionally accounted for. If `smaps_rollup` cannot be read, the report flags an RSS-only fallback for that process.

Run a representative workload during the measurement: wait for initial Meteosat retrieval, at least one later update, active and idle Spotify, weather/calendar refresh, and Remote Control access. For a credible purchase decision, repeat with the actual 1920 × 1080 panel powered and the compute unit mounted in its final rear cavity. The monitor currently does not sample CPU, cgroup pressure, GPU memory, SSD latency or clock-throttling flags. Thermal-zone reporting is best-effort; some boards do not expose usable sensors through Linux sysfs.


## Alternative topology: backend on an always-on host, Chromium on the mirror

MagicMirror's backend and browser can run on separate machines. A forum deployment reports DietPi + bare services + MagicMirror Serveronly using about 194–206 MiB on the server device, and DietPi + bare X + Chromium kiosk using about 240–248 MiB on a separate client. The author describes a small/basic module set and that is not a measurement of this project's full frontend, 1080p display, or Meteosat/Spotify configuration. Use it as evidence that the split topology is practical, not as a RAM guarantee.

The project's regular `clientonly/index.js` starts Electron, so it is not the low-memory path for this deployment. The work branch now supports `MM_KIOSK_URL` in `scripts/serveronly-kiosk.js`: the display device can start Chromium directly against the remote backend without a local config file or server process. A separate systemd example, `magicmirror-client-kiosk.service.example`, is provided for that topology.

**Why this matters for hardware selection:** a small, passive ARM board may be suitable as a browser-only client even if it would be an unsafe choice for the combined Node + Sharp + Chromium host. The server still needs a reliable always-on machine on the same trusted LAN. Chromium continues to render all frontend modules, so the client still requires an actual memory/thermal test.

Potential display client to test: Raspberry Pi Zero 2 W, 65 × 30 mm, 512 MB RAM, Wi-Fi 2.4 GHz and Mini-HDMI up to 1080p60. A MagicMirror forum user measured about 240–248 MiB for a minimal Chromium kiosk on a separate client Pi, but on a different installation. This leaves limited headroom on a 512 MB board once the full configured frontend is loaded. The board is therefore a **proof-of-concept candidate only**, not an approved purchase. Retail listings around €21–€25 were found but some were out of stock; power supply, microSD and Mini-HDMI cable/adapter must be included in the complete-cost calculation.

The split topology is the first option to benchmark if there is already a suitable always-on server in the home. It could eliminate the need to put the heavier x86 mini-PC behind the glass.


### Revised split-client hardware ranking

The Raspberry Pi Zero 2 W is physically ideal (65 × 30 mm) but has only 512 MB RAM. Community evidence is mixed: a minimal server/client deployment reports 240–248 MiB for bare X + Chromium kiosk on a separate client, while another 2025 MagicMirror discussion reports Chromium failing to load on the Zero 2 W and identifies 512 MB as a constraint. Raspberry Pi's current kiosk guidance recommends a Pi 3 or newer with at least 1 GB RAM.

Therefore, use **Raspberry Pi 3B+ (1 GB)** as the first split-client test candidate if a separate backend is available. The official board footprint is about 85 × 56 mm and it exposes full-size HDMI; a lightweight third-party kiosk project lists 3B+ (1 GB) as tested, with a heatsink recommended for continuous use. It is less tiny than the Zero 2 W but remains small and low profile. Its software-rendering requirements on the older VideoCore IV mean visual smoothness must still be tested at 1920 × 1080.

Used listings around €35 were found for Pi 3B+ units supplied with fan cases and/or PSU. Passive-case listings were seen around €52. The current search has not established a fully equipped, passive, silent Pi 3B+ kit at or below €40. Treat the 35 € fan-cooled bundle only as a price lead, not a recommendation for this mirror.

The split-server layout remains the more promising route for a compact client, but it does not make the Zero 2 W a safe purchase. A 1 GB client gives more margin; full UI and overnight tests remain mandatory.


## Market check — compact and silent units (2026-11-14)

A fresh listing check does not yet produce a complete, compact, fanless x86 unit at or below €40 delivered.

| Device/listing | Configuration and price | Physical / technical fit | Decision |
|---|---|---|---|
| HP t430, Marktplaats | Celeron N4000, 4 GB RAM, 32 GB eMMC, original adapter; €50 plus €3.99 pickup-point delivery or €6.29 home delivery. | 135 × 135 × 32 mm, passive cooling in HP product literature, native HDMI, UHD 600. Wi-Fi must be confirmed on the exact SKU. | **Best single-device candidate**, but €53.99–€56.29 delivered exceeds the €40 ceiling. |
| Dell Wyse 5070, eBay | J4105, 4 GB RAM, 16 GB eMMC, Wi-Fi; €41 + €9 shipping. | Fanless standard model, but 184 × 184 × 35.6 mm and only 16 GB storage in this listing. | Not preferred: larger footprint, tight storage and €50 delivered. |
| HP t520, retailer listing | GX-212JC, 4 GB DDR3L, 32 GB M.2 flash; €39.68 before delivery. | 200 × 200 × 45.1 mm. Single SODIMM can be upgraded, but this is an older dual-core platform. The listing does not establish passive cooling or the final delivered cost. | Budget lead only; not approved for behind-glass use until noise, thermal and shipping details are verified. |
| Fujitsu FUTRO S930, eBay | GX-424CC, 4 GB, no SSD and no power supply; €30 + €9 shipping. | 250 × 195 × 57 mm; DVI-I/DisplayPort rather than native HDMI. | Reject for this installation: too deep and incomplete. |

Sources:
- HP official t430 datasheet: https://h20195.www2.hp.com/v2/getpdf.aspx/4AA4-5632ENW.pdf
- HP t430 4 GB / 32 GB / adapter listing: https://www.marktplaats.nl/v/computers-en-software/desktop-pc-s/m2452276202-hp-t430-thin-client-compacte-en-efficiente-mini-pc
- Wyse 5070 used listings: https://www.ebay.es/b/Thin-clients-para-empresas/175702/bn_16588564
- HP t520 configuration and dimensions: https://business.currys.co.uk/catalogue/computing/desktops/windows-desktops/hp-flexible-t520-tower-gx-212jc-1-2-ghz-4-gb-ssd-32-gb/P244800P

**Purchase decision:** no purchase is approved. If the budget remains a hard €40 delivered, the most promising path is a split deployment only if an always-on backend host already exists: a small passive display client can then run Chromium only. Otherwise, the HP t430 is the most balanced compact single-device candidate found so far, but its current complete listing is over budget. Do not substitute a 2 GB / 16 GB t430 or a fan-cooled unit merely to hit the price target.

## Current software validation status

At commit `45a4b1c039648fb8dc2af22f14a5e302722456ee`, GitHub Actions on Ubuntu 24.04 with Node.js 22.22.2 passed:
- 58/58 MMM-Meteosat tests, including render-size regeneration, alpha-mask pixel equivalence, streamed WMS/overlay downloads, response size limits, abort cleanup and benchmark output.
- 22/22 standalone deployment tests, including resource PSS parsing, thermal-zone readings, monitor self-exclusion, x86 SSE4.2 gating, environment-sourced Remote Control secret checks and remote kiosk readiness.
- Full-size synthetic Sharp benchmark smoke run: 1800 × 1800 source → 700 × 700 output; 164 ms end-to-end, 99 ms in the worker and 83,900 KB worker max RSS on an AMD EPYC 9V74 hosted runner.

[CI run with full-size benchmark and all tests](https://github.com/Harilai/magic-mirror/actions/runs/43439082018).

The benchmark input is synthetic and the runner is a hosted x86-64 server. These results verify the processing path; they are not a prediction for a low-power N4000, ARM board, Chromium, GPU memory, complete OS, thermal cavity or overnight reliability.


## Security gate before deployment

The project config now reads the `MMM-Remote-Control` API key only from `MM_REMOTE_CONTROL_API_KEY`. The example backend systemd unit loads the optional, untracked file `~/.config/magicmirror/secrets.env`. The device diagnostic distinguishes an environment-sourced key, a non-environment key, and a missing key; the diagnostic does not print key material.

A key was previously committed to the repository. It must be replaced with a newly generated local key before the backend is exposed to the LAN. The old value remains in Git history, so do not reuse it. With `secureEndpoints: true`, a missing key blocks protected Remote Control operations instead of silently opening them.
