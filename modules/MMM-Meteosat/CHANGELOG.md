# Changelog

All notable changes to this project will be documented in this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.1] - 2026-07-22

### Fixed

- Run all `sharp` and libvips work in a dedicated Node.js child process instead of the MagicMirror Electron process, avoiding the Linux Electron/Sharp compatibility warning and isolating native image processing failures.
- Make Sharp worker operations abort-aware, time-bounded and atomic so interrupted or failed processing cannot replace a valid cached image.
- Route image and overlay validation through the same isolated worker; the Electron node helper no longer imports `sharp`.
- Add logger tests proving that `ERROR`, `WARN`, `INFO` and `DEBUG` output is filtered according to the configured `logLevel` and carries the matching level label.
- Refresh overlays independently so a slow or failed overlay request cannot delay satellite image checks or downloads.
- Prefer `Cache-Control: max-age` over `Expires` when calculating overlay cache lifetime.
- Route browser-side timestamp errors through the same level-labelled logging convention.

### Changed

- Add the active worker backend to DEBUG image-processing details.

## [1.4.0] - 2026-07-22

### Added

- Optional official EUMETSAT coastline overlays through `showCoastlines`.
- Optional official EUMETSAT country-border overlays through `showCountryBorders`.
- Configurable browser-side overlay opacity through `overlayOpacity`.
- Shared overlay cache by WMS image size with server-directed expiry, PNG validation, SHA-256 metadata and atomic replacement.
- Automated tests for overlay selection, fixed layer URLs, cache lifetime, state validation and opacity limits.

### Changed

- Keep overlays separate from satellite imagery so opacity changes require no new download or image processing.
- Allow overlay download or refresh failures to degrade silently without affecting the satellite image.

## [1.3.0] - 2026-07-22

### Added

- Pause update timers, active downloads, retry waits and image processing while the module is suspended.
- Refresh immediately after resume without starting duplicate update cycles.
- Track the last update attempt, successful download and actual image-content change separately from the satellite acquisition time.
- Mark delayed images in the caption when the acquisition time or unchanged-content duration exceeds `staleAfter`.
- Automated tests for stale-image evaluation.

### Changed

- Keep the visible timestamp focused on the satellite acquisition time by default; operational timestamps remain internal and in `status.json`.

## [1.2.7] - 2026-07-22

### Changed

- Keep the minimum update interval at five minutes and cover it with automated tests.
- Run GitHub Actions on Node.js 22 and 24.
- Extract configuration normalisation and retry handling into independently testable modules.

### Added

- Tests for configuration limits, WMS time parsing, HTTP response-size limits, retry behaviour, cache-state validation, temporary-file cleanup and image processing.
- Small PNG, XML and JSON fixtures used by the automated test suite.

## [1.2.6] - 2026-07-22

### Security and reliability

- Validate configuration before replacing an active client.
- Abort obsolete downloads when an instance is reconfigured.
- Limit HTTP response sizes and Sharp input pixels.
- Use unique temporary files and clean them up reliably.
- Validate persisted cache state and derive served image paths internally.
- Cap retry delays and enforce the documented five-minute minimum interval.
- Sanitize upstream error text before logging.
- Add Node.js tests and a GitHub Actions CI workflow.

### Changed

- Updated the project documentation to match the current EUMETView WMS implementation.
- Removed the redundant `auto` product option and made `geocolour` the explicit default.
- Documented Node.js requirements, cache-ID normalisation, cache metadata and timestamp behaviour.

## [1.2.1] - 2026-07-21

### Added

- Direct retrieval of MTG full-disk imagery from the EUMETSAT EUMETView WMS service.
- Eight EUMETSAT products: GeoColour, Dust RGB, Cloud Phase RGB, Cloud Type RGB, Fog / Low Clouds RGB, Fire Temperature RGB, Snow RGB and Infrared 10.5 µm.
- Eight selectable product values, with GeoColour as the default.
- Configurable WMS source-image resolution through `wmsImageSize`.
- Independent cache directories for each module instance and resolved product.
- Cache state metadata in `status.json`.
- SHA-256 source-image comparison to avoid unnecessary reprocessing.
- Local fallback to the last successfully processed image when an update fails.
- Configurable loading, no-image and error messages.
- Optional source, product and timestamp caption fields.
- Modular source files for products, cache handling, WMS access and image processing.

### Changed

- Reworked image acquisition around EUMETView WMS layers.
- Added a minimum update interval of five minutes.
- Limited `wmsImageSize` to 600–3600 pixels.
- Normalised custom cache identifiers for safe folder names.
- Kept technical error details in the MagicMirror log instead of displaying them on the mirror.
