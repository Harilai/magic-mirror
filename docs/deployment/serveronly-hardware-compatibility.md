# Serveronly hardware and module compatibility (Blocks 3–4)

**Repository:** `Harilai/magic-mirror`  
**Work branch:** `feature/magicmirror-serveronly-deployment`  
**Reviewed baseline:** MagicMirror `2.39.0-develop`, Node engine `>=22.22.2 <23 || >=24`, Electron `^44.5.1`.  
**Status:** source/configuration audit, upstream platform-documentation check, and automated host-side diagnostic implementation. No target board was available, so this is not a physical-device certification.

## 1. Runtime compatibility by CPU architecture

| Linux target | Node.js 22.22.2 binary | Electron 44 | `sharp` 0.35.5 prebuilt | Serveronly + Chromium assessment |
|---|---|---|---|---|
| x86_64 / x64 | Yes | Yes | Yes; glibc >=2.28 or musl >=1.2.5 (CPU also needs SSE4.2) | Preferred low-risk architecture. Confirm distro Chromium and system libraries. |
| ARM64 / aarch64 | Yes | Yes | Yes; glibc >=2.28 or musl >=1.2.5 | Preferred ARM architecture. Raspberry Pi OS 64-bit supports Pi 3, 4 and 5; desktop edition includes Chromium. |
| ARMv7 / armhf (32-bit) | Yes, official Node 22.22.2 archive publishes `linux-armv7l` | **No**; Electron 44 removed Linux armv7l binaries | Yes, Linux ARM/glibc build; glibc >=2.36 required | Serveronly + Chromium can be considered only when the OS/browser are 32-bit compatible and the libc requirement is met. It cannot use this repository's Electron 44 path. |

Important qualifications:

- The repository engine range accepts Node 22.22.2. The official Node archive explicitly lists Linux x64, ARM64 and ARMv7 binaries for that version.
- Prefer Node 22.22.2 on ARMv7. The current Node platform table marks Linux armv7 experimental (and notes the downgrade from Node 24); do not treat ARMv7 as the long-term preferred deployment target.
- Do not infer `sharp` compatibility from CPU architecture alone. On x86-64 the prebuilt binary requires SSE4.2; the device checker now reads the actual CPU flags in `/proc/cpuinfo` before attempting to load Sharp. It also checks the real native image-conversion path. Check the target's actual libc with `ldd --version` and Node's runtime report.
- The lockfile contains optional platform packages `@img/sharp-linux-arm` and `@img/sharp-linux-arm64`. Install dependencies on the target device; never copy a `node_modules` tree built for a different architecture or libc.
- Raspberry Pi OS Desktop includes Chromium. Raspberry Pi OS has 32-bit and 64-bit editions; its official documentation identifies Pi 3, 4 and 5 as capable of running the 64-bit edition.

## 2. Candidate board assessment

| Candidate | Architecture / memory context | Assessment for this deployment | Current decision |
|---|---|---|---|
| Raspberry Pi 4, 4 GB | ARM64-capable; 4 GB RAM | Good architectural match for 64-bit Raspberry Pi OS, Node 22 ARM64, Chromium and `sharp` ARM64. Compact 85 × 56 mm board, but fanless thermal behaviour in the final enclosure and memory pressure still require measurement. | **Software reference candidate; used prices found exceed the €40 target.** |
| Raspberry Pi 4, 2 GB | ARM64-capable; 2 GB RAM | Same software compatibility, but memory headroom for Chromium and all configured modules is unproven. | Do not approve before full-workload PSS measurement. |
| Raspberry Pi 3 B+ | ARM64-capable but only 1 GB RAM | A 64-bit OS is architecturally possible. A 32-bit OS would require Serveronly rather than Electron 44 and `glibc` >=2.36 for the `sharp` prebuilt. Low RAM and older CPU make Chromium + all configured modules a performance risk. | Not the preferred purchase; do not rule out solely by ISA. |
| HP T520 thin client | x86_64; previously considered 2 GB RAM / 32 GB SSD configuration | x64 Node/Electron/Chromium/`sharp` compatibility is the simplest software path. Confirm actual RAM, storage health, graphics output/adaptor, and distro support on the exact unit. | Strong low-cost x86 candidate if the exact listing is still available and hardware checks pass. |
| HP t430 thin client | x86_64; Celeron N4000 (2 cores), 4 GB embedded DDR4 / 32 GB eMMC configuration; optional Wi-Fi | HP product literature describes fanless cooling; exact dimensions are 135 × 135 × 32 mm. Native HDMI and Intel UHD 600 graphics. Best balanced compact x86 candidate identified so far, but the 4 GB / 32 GB SKU is required. | First single-device candidate to test if found at or below €40 delivered. Wi-Fi is optional on some SKUs and must be confirmed. |
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
- Keep `secureEndpoints: true`; load the new Remote Control key from the untracked `MM_REMOTE_CONTROL_API_KEY` environment file and rotate the legacy key committed in repository history before LAN deployment. The whitelist whitespace defect is corrected in the work branch; still verify the actual LAN subnet on the target device.

## 4. Target-device acceptance checks

Run the automated diagnostic on the exact board and OS image before enabling automatic startup:

```bash
npm run server:device-check
# Optional JSON report:
npm run server:device-check -- --json > device-check.json
```

It checks the runtime, detected distro/libc, RAM, Chromium executable, configured module entry points, Remote Control configuration hygiene, and runs a small native `sharp` image conversion when `MMM-Meteosat` is present. A FAIL means do not promote the device to automatic kiosk startup. Review every WARN manually.

The report deliberately does not print configuration secrets. Do not share the JSON file without reviewing it for system metadata first.

For independent manual inspection, run these commands too:

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


## 6. Acoustic and behind-glass installation requirements

The target device will be mounted behind the mirror glass. The hardware selection must therefore include acoustic, mechanical and thermal criteria in addition to compute compatibility.

- Prefer a **fanless, passively cooled** unit with no moving parts. Treat the external DC adapter separately; do not place it in a sealed, thermally insulated space.
- Prefer **30 mm or less device depth**. 30–36 mm is a compromise. A small SBC with a passive heatsink case is physically preferable, but it must pass the full software acceptance test.
- Avoid large 1L/1.5L and 184 mm-square thin-client enclosures if they consume too much of the rear cavity. Their low noise does not make them mechanically compact.
- Do not mount a fanless case flush against insulating foam or the display back. Passive cooling needs clear air paths and thermal contact as specified by the device design.
- Measure temperature and throttling with the panel powered and the actual rear cavity assembled. The temperature behind the glass can differ materially from an open-bench test.
- Secure the DC lead, HDMI lead and network lead so the enclosure does not put mechanical load on the panel connector or mirror film.

### New candidates to investigate

| Candidate | Confirmed characteristics | Remaining risks |
|---|---|---|
| Radxa ZERO 3W | Official dimensions 65 × 30 mm; RK3566 Cortex-A55; 1/2/4/8 GB RAM options; optional eMMC up to 64 GB; Micro-HDMI 1080p60; Wi-Fi 6. Vendor documents passive operation for light/moderate workloads and an 85°C thermal-control limit. | Best physical form factor found so far. However, a Radxa forum reports software-rendering fallback on Debian Bullseye due to the graphics stack; other reports suggest newer Ubuntu Chromium acceleration can work. The exact OS/browser stack must be tested. Spain listing prices observed were about €78 for 2 GB/16 GB and €104 for 4 GB/32 GB, above budget. |
| Dell Wyse 5070 Standard | Passive cooling reported by independent reviewers; 4-core J4105 or J5005 options, usually 4–8 GB RAM; 184 × 184 × 35.6 mm. | Quiet and x86-64 capable, but 184 mm square and 35.6 mm thick. Used listings often omit PSU, Wi-Fi or storage; poor fit for a shallow rear cavity. |
| HP t430 | Fanless per HP product literature; Celeron N4000 dual-core, 4 GB embedded DDR4 / 32 GB eMMC SKU; 135 × 135 × 32 mm; native HDMI + DisplayPort; optional Wi-Fi. | Best current single-device balance: shallow 32 mm chassis, modern x86-64 graphics and 4 GB / 32 GB SKU. Memory and eMMC are embedded. Used 4 GB / 32 GB listings around €50 plus delivery; above the €40 delivered cap. First unit to test if found within budget. |
| Minisforum Z83-F / equivalent Z83-F fanless chassis | Fanless Atom x5-Z8350; nominal 4 GB soldered RAM, 64 GB eMMC; HDMI + VGA, Gigabit Ethernet, dual-band Wi-Fi; 120 × 120 × 27 mm. | Smaller and thinner than t430, but owner reports describe sluggish browser scrolling and lag; listings around €50 plus shipping. Secondary watch-list model, not a purchase approval. |
| ECS LIVA Q2 | 70 × 70 × 33.4 mm, N4100/N5000, 2/4 GB LPDDR4, 32/64 GB eMMC, HDMI, Wi-Fi. | **Reject for silence:** ECS's own overview says it contains an internal cooling fan. Compact, but not fanless. |
| Fujitsu FUTRO S940 | Fanless J5005 design, with 4/8 GB RAM options. Horizontal dimensions are 250 × 193 × 52 mm without foot; Fujitsu specifies 200 mm ventilation clearance. | Too bulky and deep for this installation despite passive cooling. Remove from the compact shortlist. |
| Orange Pi Zero 3 | 50 × 55 mm; Allwinner H618 quad-core Cortex-A53 ARM64; 1/1.5/2/4 GB LPDDR4 options; Mali-G31; Wi-Fi 5/BT 5; Gigabit Ethernet; Micro-HDMI; 5 V/3 A input. The official manual exposes CPU/GPU/DDR thermal zones through `/sys/class/thermal`. | Excellent footprint and fanless SBC topology, but 1.5 GB and 2 GB retail listings found around €43 and €51 respectively; 4 GB around €64. A MagicMirror user reports Chromium kiosk working in landscape on DietPi, but a 90° portrait rotation caused severe frame-rate collapse (about 2 FPS). Another report describes long-run Chromium instability. | Compact test candidate only; not approved for this project's full configuration. |
| ARM64 SBC + passive enclosure | Small board footprint and fanless case possible. | Validate the exact OS image, Chromium graphics acceleration, native `sharp`, 1080p output, Wi-Fi and thermal stability. |

The Wyse 5070's standard enclosure is fully passive in independent testing, with user measurements around 2.2–5.1 W idle and up to roughly 14 W in one report. These are configuration-dependent measurements, not guaranteed limits. Its square footprint makes it unsuitable for a shallow mirror cavity despite its technical appeal.

The 3040 is much shallower but its RAM and eMMC are soldered. It must not be selected just because it is inexpensive or compact.

The ECS LIVA Q2 must not be described as fanless: the manufacturer overview explicitly states that its compact design includes an internal cooling fan. It is therefore unsuitable for the user's no-moving-parts requirement even though its 70 × 70 × 33.4 mm chassis is attractive.

The HP t430 is now the first compact single-device candidate to test: 135 × 135 × 32 mm, fanless per HP's product literature, N4000 dual-core, native HDMI, and a 4 GB / 32 GB eMMC configuration. However, RAM and eMMC are embedded, Wi-Fi is optional, and used listings are around €50 plus delivery. It is not within budget yet. The Z83-F is smaller at 120 × 120 × 27 mm, but its older Atom x5-Z8350 has poor browser-performance reports and is also above budget.

The Radxa ZERO 3W is the strongest physical fit identified so far: 65 × 30 mm is dramatically smaller than any thin client. However, its software-rendering history on earlier Debian images and current Spanish pricing prevent recommending it at this point. The board is a test candidate only, not an approved purchase.

The S940 should not be treated as a low-profile unit: although it is fanless, its 52 mm horizontal height and specified ventilation clearance are incompatible with the shallow-cavity objective.
 
### HP t430: compact x86 shortlist update

HP t430 is now the leading compact single-device candidate:

- **Dimensions:** 135 × 135 × 32 mm (0.58 L), approximately 416 g; external 45 W-class DC adapter.
- **Acoustics:** HP product literature describes it as fanless. This still requires unblocked ventilation; do not seal a passively cooled unit against the panel or insulation.
- **Compute / video:** Intel Celeron N4000 dual-core (1.1–2.6 GHz), Intel UHD 600, native HDMI plus DisplayPort and USB-C DisplayPort.
- **Memory / storage:** HP variants include 2 GB / 16 GB and 4 GB / 32 GB embedded configurations. Only the 4 GB / 32 GB variant should enter the test pool; RAM and eMMC are not field-upgradeable.
- **Wireless:** Wi-Fi/Bluetooth is optional on some SKUs. Confirm the wireless module is present and recognised, or use Ethernet.
- **Acceptance:** actual unit must pass Node engine, x86 SSE4.2, libc, Chromium and Sharp diagnostics; then run the full 1800→700 Meteosat benchmark and complete 1080p Chromium workload with resource monitor active.

Current used-market evidence: a Marktplaats listing published in October 2026 advertises an N4000 / 4 GB / 32 GB t430 with its original power adapter for €50, delivery from €3.99–€6.29. Another listing advertises tested 4 GB / 32 GB devices at €49.95 each. These are EU marketplace leads, not confirmed delivery to Spain or buy recommendations above the budget. Sources: [HP t430 official specifications and dimensions](https://h20195.www2.hp.com/v2/GetDocument.aspx?docname=4AA7-2899ENUC), [HP fanless product brochure](https://inquirecontent1.ingrammicro.com/Manufacturer-Brochure/1048745626.pdf), [HP t430 QuickSpecs](https://media.bechtle.com/asrc/180712/1c4b3d4ee288fc9434f5175bf56070570/c3/-/7457d4edb88c476aad862f98f883525e/hp-t430-thin-client-datenblatt-2), [4 GB / 32 GB listing](https://www.marktplaats.nl/v/computers-en-software/desktop-pc-s/m2452276202-hp-t430-thin-client-compacte-en-efficiente-mini-pc), [tested 4 GB / 32 GB listing](https://www.marktplaats.nl/q/thinclient/p/2/).

**Purchase status:** no device is approved yet. The compact/fanless constraint is now a first-class selection criterion, not an optional preference.


## 7. Current market and forum evidence (13 November 2026)

The hardware filter has been tightened to include acoustic and mechanical fit. Examples found in current second-hand listings:

- Milanuncios results for Raspberry Pi 4 4 GB showed listings around €100; eBay Spain showed a used 4 GB model with case around €75. Both exceed the user's €40 ceiling. These are snapshots of listings, not appraisals of every used unit.
- The Wyse 5070 remains a quiet x86 platform, but it is roughly 184 mm square and 35.6 mm thick. It is technically suitable but mechanically unattractive for a narrow mirror cavity.
- The Dell Wyse 3040 has a very shallow 27.94 mm chassis, but only 2 GB soldered RAM and 8/16 GB eMMC according to Dell's product guide. It is not a good performance-risk trade.
- The Fujitsu S940 is fanless, but its own manual lists 52 mm horizontal height and calls for 200 mm clearance for ventilation. It is not a compact behind-glass recommendation.
- The Radxa ZERO 3W is a genuine small-format 65 × 30 mm board with 1–8 GB RAM variants and Micro-HDMI. Its vendor design brief permits no additional cooling for light-to-moderate loads, but sustained load or elevated ambient temperature can require supplementary heatsinking. A Radxa forum thread documents earlier Debian Bullseye graphics acceleration problems; do not assume the Chromium compositor is hardware-accelerated without checking `chrome://gpu` on the exact OS image.

**Updated decision:** the HP t430 is the leading compact single-device candidate to investigate (135 × 135 × 32 mm, passive cooling, N4000, 4 GB / 32 GB, HDMI). Its current used price around €50 plus delivery is over the €40 delivered ceiling. No complete, sufficiently specified fanless computer has yet been verified at or under budget in Spain. Do not buy an underspecified or low-memory board to satisfy the price ceiling.


## 8. Split-host candidate: Raspberry Pi Zero 2 W as Chromium client

A separate server/client deployment can materially change the physical board requirements:

- The server host runs Node.js MagicMirror, all module helpers, Spotify polling, Meteosat/Sharp processing, cache and Remote Control.
- The display board only runs Linux, a small X session and Chromium kiosk pointed to `MM_KIOSK_URL`.
- The work branch's `scripts/serveronly-kiosk.js` now supports that remote URL without loading a local MagicMirror config or starting a second backend.
- `deploy/systemd/magicmirror-client-kiosk.service.example` is the separate user service. The ordinary local kiosk service remains available for a single-box deployment.

### Raspberry Pi Zero 2 W

| Property | Value | Impact |
|---|---:|---|
| Board footprint | 65 × 30 mm | Excellent fit behind glass |
| RAM | 512 MB | Low; full frontend workload remains unproven |
| CPU | Quad Cortex-A53, 1 GHz | Adequate only as a candidate for browser-client testing |
| Wi-Fi | 2.4 GHz 802.11n | Fine for a trusted LAN if signal is stable |
| Video | Mini-HDMI, up to 1080p60 | Requires the correct Mini-HDMI cable/adapter |
| Cooling | Passive board, no fan | Silent; still needs a small heatsink/airflow if sustained browser load raises temperature |
| Observed Spain board listings | About €21–25, several currently shown out of stock | Board-only price is not a complete installation cost |

Community evidence: one MagicMirror forum deployment reports roughly 194–206 MiB for a minimal Serveronly backend on a separate host and 240–248 MiB for DietPi + bare X + Chromium kiosk on the client. The author describes a small module set. This is not representative of the current project's full frontend or a guaranteed Zero 2 W RAM requirement.

**Decision:** retain the Zero 2 W as a proof-of-concept only, not the first purchase. Its 512 MB RAM leaves too little headroom for the full configured frontend. With a separate always-on server, test a passively cooled Pi 3B+ (1 GB) first; then consider the Zero 2 W only if the complete frontend passes PSS, 1080p, thermal, Wi-Fi recovery and overnight tests.

### Current best hardware direction

- **If a separate always-on server exists:** first test a passively cooled Raspberry Pi 3B+ (1 GB) as the Chromium-only client. Keep the Zero 2 W (512 MB) as a smaller experimental fallback, not a safe baseline.
- **If one device must do everything:** the Minisforum Z83-F is the most compact fanless x86-64 mini-PC found (120 × 120 × 27 mm, 4 GB/64 GB), but current used prices start around €45–50 plus shipping. A Fujitsu FUTRO S740 or Dell Wyse 5070 offers a lower software-risk route, but the enclosures are substantially larger/deeper.
- **Do not buy the 2 GB Le Potato bundle solely because its listing is €39.69:** it still needs reliable storage/power and the exact Linux/Chromium graphics stack has not been certified for the complete frontend.

The selection remains conditional on the physical rear cavity, the availability of a separate server (for split mode), and actual workload measurements.


### More conservative display client: Raspberry Pi 3 Model B+

The Pi Zero 2 W remains an interesting ultra-small client, but its 512 MB RAM is not a safe baseline for this mirror. A recent user discussion contains both a successful minimal DietPi/Chromium client configuration and reports of Chromium failing to load MagicMirror on the Zero 2 W. Raspberry Pi's own kiosk tutorial recommends a Pi 3 or newer with at least 1 GB RAM for Chromium.

The Raspberry Pi 3B+ is therefore the more conservative client-only candidate:

| Property | Value | Impact |
|---|---:|---|
| RAM | 1 GB | Twice the Zero 2 W memory; still requires full-UI measurement |
| Board dimensions | 85 × 56 mm | Small footprint, still physically compact |
| Thickness | About 19.5 mm board/envelope | Better behind-glass profile than a thin client |
| Video | Full-size HDMI, 1080p | No Mini-HDMI adapter required |
| Wireless | 2.4/5 GHz Wi-Fi | More flexibility than the Zero 2 W's 2.4 GHz-only radio |
| Audio | 3.5 mm analogue output | Useful if audio is required locally, subject to the chosen audio path |
| Cooling | No fan required by the board itself; metal heat spreader | Use passive heatsinking/adequate airflow and test in the final cavity |

Independent kiosk project evidence: a recent lightweight kiosk project lists the Pi 3B+ (1 GB) as its tested platform and recommends a heatsink for continuous operation. It also notes software rendering on this generation; expect less compositor headroom than on a newer GPU. A local second-hand listing around €35 includes a fan and PSU, while another Vinted listing around €35 includes a fan case and microSD. A passively cooled Vinted listing was around €52, above the target. Therefore **there is not yet a complete, silent Pi 3B+ kit verified at or below €40**.

**Updated decision:** if a separate always-on server is available, prefer testing a passively cooled Pi 3B+ client before the 512 MB Zero 2 W. Its 1 GB RAM is the safer starting point under Raspberry Pi's own kiosk guidance. Neither is approved until the full 1920 × 1080 mirror passes memory, temperature, network recovery and overnight tests. If the display client must also run Raspotify/audio processing, include that workload in the benchmark.


### Orange Pi Zero 3 evidence and constraints

The Orange Pi Zero 3 is now included because its 50 × 55 mm PCB is one of the smallest HDMI-capable boards in this comparison. The official user manual lists H618 Cortex-A53 ARM64, Mali-G31, RAM SKUs up to 4 GB, Wi-Fi 5, Gigabit Ethernet, Micro-HDMI and 5 V/3 A power. It also documents CPU, DDR and GPU thermal readings through Linux thermal zones, which the resource monitor can sample.

Community evidence is mixed rather than a blanket pass:
- A MagicMirror forum user ran DietPi and Chromium kiosk; the display worked in landscape, but forcing 90° portrait rotation reduced the frame rate to roughly 2 FPS.
- A separate DietPi kiosk discussion reports intermittent Chromium/GPU instability on an Orange Pi Zero 3 after extended operation.
- These reports do not establish how the current UI performs in native landscape mode with all custom modules active.

Price checks from Spanish/European listings found a 1.5 GB unit around €43, a 2 GB unit around €51, and a 4 GB unit around €64, before the complete bundle (PSU, microSD, passive heatsink/case, HDMI lead) is counted. Therefore it is physically attractive, but does not meet the current €40 all-in budget on the evidence found.

Sources: [Orange Pi Zero 3 official hardware manual](https://uelectronics.com/wp-content/uploads/2026/01/OrangePi_Zero3_H618_user-manual_v1.3.pdf), [MagicMirror forum: Orange Pi Zero 3 screen rotation](https://forum.magicmirror.builders/topic/18347/orange-pi-zero-3-screen-rotation), [DietPi community thread](https://dietpi.com/forum/t/orangepi-zero-3-screen-rotation-and-xrandr-issues/18854), [Spanish listing for Orange Pi Zero 3](https://www.alicantecno.es/es/producto/placa-de-desarrollo-orange-pi-zero-3-con-1-1-5-2-4gb-de-ram-ddr4-allwinner-h618-bluetooth-5-0-wifi-5-wifi-bluetooth-ble-a0fcfc).


### Fanless candidates: latest market evidence

- **Minisforum Z83-F:** the strongest form-factor candidate for a combined x86 deployment found in this search. An active Kleinanzeigen listing asks €50 (negotiable) plus shipping; a €45 listing is already marked as sold. One earlier €39 listing was deleted and would have been at least €45.19 after shipping. This is not yet inside the all-in budget.
- **ECS LIVA Q2:** do not shortlist as a silent solution. ECS itself describes an internal fan; independent reviews note a 40 mm fan that starts under load.
- **ZOTAC ZBOX CI323 Nano:** genuinely passive and x86-64, with upgradeable DDR3L and HDMI, but 127 × 127 × 57 mm depth is too thick for the desired rear cavity. Used Spanish eBay results around €49 plus €14.49 shipping also exceed budget.
- **HP t630:** fanless and upgradeable, but its official case is 42 × 220 × 240 mm without stand, so it is large and deeper than the preferred 30–36 mm maximum. It is not a good behind-glass fit.

Sources: [Z83-F specification and size](https://minis-pc.com/product/coofun-z83-f-processor-intel-atom-x5-z8350-4gb-64gb-windows-10-pro-mini-pc/), [Z83-F used listing](https://www.kleinanzeigen.de/s-anzeige/minisforum-z83-f-luefterloser-mini-pc-4gb-64gb-linux-inkl-ovp/3550945847-228-2904), [ECS LIVA Q2 manufacturer description](https://campaign.ecs.com.tw/ECSWebSite/Product/Product_Overview/EN/System/LIVA%20Q2/LIVA), [LIVA Q2 cooling review](https://www.hexus.net/tech/reviews/systems/126542-ecs-liva-q2/), [ZOTAC CI323 passive specifications](https://www.zotac.com/product/mini_pcs/zbox-ci323-nano), [HP t630 dimensions](https://h10032.www1.hp.com/ctg/Manual/c05193361.pdf).


### x86 CPU feature gate

The automated device check verifies `sse4_2` from `/proc/cpuinfo` before loading the x86 Sharp binary. A missing flag is a hard FAIL and the Sharp load is skipped, avoiding an illegal-instruction crash on older x86 systems. If CPU flags cannot be read, the checker warns and keeps the native Sharp smoke test as the final compatibility check. ARM64 does not use the x86 SSE4.2 test.
