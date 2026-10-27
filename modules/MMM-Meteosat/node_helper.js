"use strict";

const NodeHelper = require("node_helper");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { resolveProduct } = require("./src/products");
const { getCacheId, getCachePaths, ensureCache, readState, writeState } = require("./src/cache");
const { processImage } = require("./src/imageProcessor");
const { downloadWmsImage, fetchLatestImageTime } = require("./src/sources/wms");
const { MeteosatLogger, LEVELS: LOG_LEVELS } = require("./src/logger");
const { evaluateFreshness } = require("./src/status");
const { selectOverlayVariant, normaliseOverlayOpacity, getOverlayPaths, readOverlayState, ensureOverlay } = require("./src/overlay");

const VERSION = "1.4.1";
const { MINIMUM_UPDATE_INTERVAL, normaliseUpdateInterval, normaliseImageSize, normaliseStaleAfter, normaliseRetryDelays } = require("./src/config");
const { abortError, runWithRetries } = require("./src/retry");
const MAX_CLIENTS = 10;
const MAX_INSTANCE_ID_LENGTH = 128;
const USER_AGENT = `MagicMirror-MMM-Meteosat/${VERSION}`;

function exists(file) { return fs.existsSync(file); }
function statSize(file) { try { return fs.statSync(file).size; } catch { return null; } }
function nowIso() { return new Date().toISOString(); }

module.exports = NodeHelper.create({
  start() {
    this.clients = new Map();
    this.moduleDirectory = __dirname;
    fs.mkdirSync(path.join(__dirname, "cache"), { recursive: true, mode: 0o755 });
  },

  socketNotificationReceived(notification, payload = {}) {
    const instanceId = this.normaliseInstanceId(payload.instanceId);
    try {
      if (notification === "METEOSAT_CONFIG") {
        this.configureClient(instanceId, payload);
        return;
      }
      if (notification === "METEOSAT_STATUS_REQUEST") {
        this.sendCachedStatus(instanceId);
        return;
      }
      if (notification === "METEOSAT_SUSPEND") {
        this.suspendClient(instanceId);
        return;
      }
      if (notification === "METEOSAT_RESUME") this.resumeClient(instanceId);
    } catch (error) {
      console.error(`[MMM-Meteosat][${instanceId}][ERROR] Invalid configuration: ${error.message}`);
      this.sendSocketNotification("METEOSAT_CONFIG_ERROR", { instanceId, message: "Invalid MMM-Meteosat configuration." });
    }
  },

  normaliseInstanceId(value) {
    const instanceId = String(value || "default").trim();
    if (!instanceId || instanceId.length > MAX_INSTANCE_ID_LENGTH || !/^[a-z0-9_.:-]+$/i.test(instanceId)) {
      throw new Error("Invalid module instance identifier.");
    }
    return instanceId;
  },

  buildConfig(instanceId, payload) {
    const selection = resolveProduct(payload.product);
    return {
      cacheId: getCacheId(instanceId, payload.cacheId),
      updateInterval: this.normaliseUpdateInterval(payload.updateInterval),
      wmsImageSize: this.normaliseImageSize(payload.wmsImageSize),
      imageSize: Number.isFinite(payload.imageSize) ? Math.max(1, Math.round(payload.imageSize)) : null,
      logLevel: this.normaliseLogLevel(payload.logLevel),
      staleAfter: this.normaliseStaleAfter(payload.staleAfter),
      retryDelays: this.normaliseRetryDelays(payload.retryDelays),
      showTimestamp: payload.showTimestamp !== false,
      timestampType: ["acquisition", "download"].includes(String(payload.timestampType || "acquisition").toLowerCase())
        ? String(payload.timestampType || "acquisition").toLowerCase() : "acquisition",
      timestampLocale: typeof payload.timestampLocale === "string" && payload.timestampLocale.trim() ? payload.timestampLocale.trim() : null,
      showSource: payload.showSource !== false,
      showProduct: payload.showProduct !== false,
      showStatus: payload.showStatus !== false,
      showCoastlines: payload.showCoastlines === true,
      showCountryBorders: payload.showCountryBorders === true,
      overlayOpacity: normaliseOverlayOpacity(payload.overlayOpacity),
      selection
    };
  },

  configureClient(instanceId, payload) {
    const config = this.buildConfig(instanceId, payload);
    const previous = this.clients.get(instanceId);
    if (!previous && this.clients.size >= MAX_CLIENTS) throw new Error(`Maximum number of clients (${MAX_CLIENTS}) reached.`);

    const generation = (previous?.generation || 0) + 1;
    const logger = new MeteosatLogger(instanceId, config.logLevel);
    const client = {
      config, logger, generation, timer: null,
      suspended: false, resumePending: false,
      updateRunning: false, updateStartedAt: null,
      operationController: null,
      overlayController: null, overlayRunning: false
    };
    const paths = this.getPaths(client);
    ensureCache(paths);
    const state = readState(paths, (message) => logger.warn(message));

    if (previous?.timer) clearInterval(previous.timer);
    previous?.operationController?.abort();
    previous?.overlayController?.abort();
    this.clients.set(instanceId, client);

    logger.info(`Product: ${config.selection.requested} -> ${config.selection.resolved}; cache: ${config.cacheId}; interval: ${config.updateInterval} ms.`);
    logger.block("DEBUG", "Effective configuration", {
      version: VERSION, instance: instanceId, generation,
      requestedProduct: config.selection.requested, resolvedProduct: config.selection.resolved,
      productLabel: config.selection.profile.label, layer: config.selection.profile.layer,
      cacheId: config.cacheId, updateIntervalMs: config.updateInterval,
      minimumUpdateIntervalMs: MINIMUM_UPDATE_INTERVAL, wmsImageSize: config.wmsImageSize,
      displayImageSize: config.imageSize, staleAfterMs: config.staleAfter,
      retryDelaysMs: config.retryDelays, timestampType: config.timestampType,
      showTimestamp: config.showTimestamp, timestampLocale: config.timestampLocale,
      showSource: config.showSource, showProduct: config.showProduct,
      showStatus: config.showStatus, showCoastlines: config.showCoastlines,
      showCountryBorders: config.showCountryBorders, overlayOpacity: config.overlayOpacity,
      logLevel: config.logLevel, userAgent: USER_AGENT
    });
    logger.block("DEBUG", "Cache paths and initial state", {
      cacheDirectory: paths.directory, sourceFile: paths.sourceFile, imageFile: paths.imageFile,
      stateFile: paths.stateFile, sourceExists: exists(paths.sourceFile), imageExists: exists(paths.imageFile),
      stateExists: exists(paths.stateFile), sourceBytes: statSize(paths.sourceFile),
      imageBytes: statSize(paths.imageFile), acquisition: state.imageTime || null,
      downloadedAt: state.downloadedAt || null, lastAttemptAt: state.lastAttemptAt || null,
      lastSuccessfulDownloadAt: state.lastSuccessfulDownloadAt || null,
      lastImageChangeAt: state.lastImageChangeAt || null, contentHash: state.contentHash || null
    });

    this.startClientTimer(instanceId, client);
    this.sendCachedStatus(instanceId);
    void this.updateImage(instanceId, "startup");
  },

  normaliseUpdateInterval,
  normaliseImageSize,
  normaliseLogLevel(value) { const level = String(value || "INFO").toUpperCase(); return Object.hasOwn(LOG_LEVELS, level) ? level : "INFO"; },
  normaliseStaleAfter,
  normaliseRetryDelays,
  getClient(instanceId) { return this.clients.get(instanceId) || null; },
  getPaths(client) { return getCachePaths(this.moduleDirectory, client.config.cacheId, client.config.selection.resolved); },

  startClientTimer(instanceId, client) {
    if (client.timer) clearInterval(client.timer);
    if (client.suspended) {
      client.timer = null;
      return;
    }
    client.timer = setInterval(() => this.updateImage(instanceId, "timer"), client.config.updateInterval);
  },

  suspendClient(instanceId) {
    const client = this.getClient(instanceId);
    if (!client || client.suspended) return;
    client.suspended = true;
    client.resumePending = false;
    if (client.timer) clearInterval(client.timer);
    client.timer = null;
    client.operationController?.abort();
    client.overlayController?.abort();
    client.logger.debug("Module suspended; active satellite and overlay updates stopped.");
  },

  resumeClient(instanceId) {
    const client = this.getClient(instanceId);
    if (!client) return;
    client.suspended = false;
    this.startClientTimer(instanceId, client);
    client.logger.debug("Module resumed; immediate refresh requested.");
    if (client.updateRunning) {
      client.resumePending = true;
      return;
    }
    void this.updateImage(instanceId, "resume");
  },

  isCurrent(instanceId, client, controller) {
    return this.getClient(instanceId) === client
      && client.operationController === controller
      && !controller.signal.aborted
      && !client.suspended;
  },

  assertCurrent(instanceId, client, controller) {
    if (!this.isCurrent(instanceId, client, controller)) throw abortError();
  },

  async updateImage(instanceId, trigger = "manual") {
    const client = this.getClient(instanceId);
    if (!client || client.suspended) return;
    const logger = client.logger;
    if (client.updateRunning) {
      const runningFor = client.updateStartedAt ? Date.now() - client.updateStartedAt : null;
      logger.debug(`Update already running${runningFor !== null ? ` for ${runningFor} ms` : ""}; duplicate ${trigger} trigger skipped.`);
      if (trigger === "resume") client.resumePending = true;
      return;
    }

    const controller = new AbortController();
    client.operationController = controller;
    client.updateRunning = true;
    client.updateStartedAt = Date.now();
    const attemptAt = nowIso();
    const cycleStarted = performance.now();
    const summary = { trigger, result: "failed", capabilitiesSource: null, remoteTime: null, cachedTime: null, downloaded: false, processed: false, downloadBytes: null };
    const { config } = client;
    const { selection } = config;
    const paths = this.getPaths(client);
    ensureCache(paths);
    const debug = (title, entries) => entries && typeof entries === "object" ? logger.block("DEBUG", title, entries) : logger.debug(`${title}${entries ? `: ${entries}` : ""}`);

    void this.refreshOverlayInBackground(instanceId, client, debug);

    try {
      const previousState = readState(paths, (message) => logger.warn(message));
      summary.cachedTime = previousState.imageTime || null;
      const capabilities = await this.runWithRetries(client, controller, "GetCapabilities", () => fetchLatestImageTime(selection.profile, USER_AGENT, debug, controller.signal));
      this.assertCurrent(instanceId, client, controller);
      const latestImageTime = capabilities.imageTime;
      summary.capabilitiesSource = capabilities.source;
      summary.remoteTime = latestImageTime || null;

      const latestTimestamp = Date.parse(latestImageTime);
      const previousTimestamp = Date.parse(previousState.imageTime);
      const cacheComplete = exists(paths.sourceFile) && exists(paths.imageFile);
      let decision = "download";
      if (cacheComplete && Number.isFinite(latestTimestamp) && Number.isFinite(previousTimestamp) && latestTimestamp <= previousTimestamp) decision = "skip";

      if (decision === "skip") {
        const state = writeState(paths, { ...previousState, lastAttemptAt: attemptAt });
        summary.result = "unchanged";
        this.logFreshness(instanceId, state, config.staleAfter);
        this.sendStatus("METEOSAT_IMAGE_UNCHANGED", instanceId, state, paths);
        return;
      }

      const sourceResult = await this.runWithRetries(client, controller, "GetMap", () => downloadWmsImage({
        profile: selection.profile, targetFile: paths.sourceFile, tempFile: paths.tempSourceFile,
        size: config.wmsImageSize, userAgent: USER_AGENT, imageTime: latestImageTime,
        debug, signal: controller.signal,
        isActive: () => this.isCurrent(instanceId, client, controller)
      }));
      this.assertCurrent(instanceId, client, controller);
      summary.downloaded = true;
      summary.downloadBytes = sourceResult.bytes;
      const successfulDownloadAt = sourceResult.downloadedAt || nowIso();

      if (previousState.contentHash === sourceResult.hash && exists(paths.imageFile)) {
        const unchangedState = writeState(paths, {
          ...previousState,
          imageTime: sourceResult.imageTime || previousState.imageTime || null,
          responseTime: sourceResult.responseTime || previousState.responseTime || null,
          downloadedAt: successfulDownloadAt,
          lastAttemptAt: attemptAt,
          lastSuccessfulDownloadAt: successfulDownloadAt,
          lastImageChangeAt: previousState.lastImageChangeAt || previousState.downloadedAt || successfulDownloadAt
        });
        summary.result = "same-content";
        this.logFreshness(instanceId, unchangedState, config.staleAfter);
        this.sendStatus("METEOSAT_IMAGE_UNCHANGED", instanceId, unchangedState, paths);
        return;
      }

      const processing = await processImage({
        sourceFile: paths.sourceFile, targetFile: paths.imageFile, tempFile: paths.tempImageFile, debug, signal: controller.signal,
        isActive: () => this.isCurrent(instanceId, client, controller)
      });
      this.assertCurrent(instanceId, client, controller);
      summary.processed = true;
      const state = writeState(paths, {
        requestedProduct: selection.requested, resolvedProduct: selection.resolved,
        productLabel: selection.profile.label, layer: selection.profile.layer,
        source: sourceResult.source, contentHash: sourceResult.hash,
        imageTime: sourceResult.imageTime, responseTime: sourceResult.responseTime,
        downloadedAt: successfulDownloadAt, lastAttemptAt: attemptAt,
        lastSuccessfulDownloadAt: successfulDownloadAt,
        lastImageChangeAt: successfulDownloadAt, processing
      });
      summary.result = "updated";
      this.logFreshness(instanceId, state, config.staleAfter);
      logger.info(`Image updated: ${selection.profile.label}.`);
      this.sendStatus("METEOSAT_IMAGE_UPDATED", instanceId, state, paths);
    } catch (error) {
      if (error.name === "AbortError") {
        summary.result = "aborted";
        logger.debug(error.message);
      } else {
        this.handleError(instanceId, client, controller, paths, error, attemptAt);
      }
    } finally {
      summary.durationMs = Math.round(performance.now() - cycleStarted);
      logger.block("DEBUG", "Update summary", summary);
      if (client.operationController === controller) client.operationController = null;
      client.updateRunning = false;
      client.updateStartedAt = null;
      if (client.resumePending && !client.suspended && this.getClient(instanceId) === client) {
        client.resumePending = false;
        setImmediate(() => this.updateImage(instanceId, "resume"));
      }
    }
  },

  async refreshOverlayInBackground(instanceId, client, debug) {
    const variant = selectOverlayVariant(client.config.showCoastlines, client.config.showCountryBorders);
    if (!variant || client.overlayRunning || client.suspended || this.getClient(instanceId) !== client) return null;

    const controller = new AbortController();
    client.overlayController = controller;
    client.overlayRunning = true;

    try {
      const result = await runWithRetries({
        operationName: `Overlay ${variant.id}`,
        operation: () => ensureOverlay({
          baseDirectory: this.moduleDirectory,
          variant,
          size: client.config.wmsImageSize,
          userAgent: USER_AGENT,
          signal: controller.signal,
          isActive: () => this.getClient(instanceId) === client && client.overlayController === controller && !controller.signal.aborted && !client.suspended,
          debug
        }),
        retryDelays: client.config.retryDelays || [],
        signal: controller.signal,
        logger: client.logger
      });

      if (this.getClient(instanceId) !== client || client.overlayController !== controller || client.suspended) return null;

      if (result?.changed) {
        client.logger.info(`Overlay updated: ${variant.id}.`);
        const paths = this.getPaths(client);
        const state = readState(paths, (message) => client.logger.warn(message));
        if (exists(paths.imageFile)) {
          this.sendStatus("METEOSAT_IMAGE_UNCHANGED", instanceId, state, paths);
        }
      }

      return result;
    } catch (error) {
      if (error.name === "AbortError") {
        client.logger.debug("Overlay update aborted.");
        return null;
      }
      client.logger.block("WARN", "Overlay update failed; satellite image remains available", {
        variant: variant.id,
        message: error.message,
        status: error.status || null,
        retryable: error.retryable === true
      });
      return null;
    } finally {
      if (client.overlayController === controller) client.overlayController = null;
      client.overlayRunning = false;
    }
  },

  getOverlayPayload(client) {
    const variant = selectOverlayVariant(client.config.showCoastlines, client.config.showCountryBorders);
    if (!variant) return { overlayPath: null, overlayVersion: null };
    const paths = getOverlayPaths(this.moduleDirectory, client.config.wmsImageSize, variant);
    if (!exists(paths.imageFile)) return { overlayPath: null, overlayVersion: null };
    const state = readOverlayState(paths);
    const version = state.contentHash || statSize(paths.imageFile) || Date.now();
    return { overlayPath: paths.relativeImageFile, overlayVersion: version };
  },

  async runWithRetries(client, controller, operationName, operation) {
    return runWithRetries({
      operationName,
      operation,
      retryDelays: client.config.retryDelays || [],
      signal: controller.signal,
      logger: client.logger
    });
  },

  sendCachedStatus(instanceId) {
    const client = this.getClient(instanceId);
    if (!client) return;
    const paths = this.getPaths(client);
    const state = readState(paths, (message) => client.logger.warn(message));
    if (exists(paths.imageFile)) {
      this.logFreshness(instanceId, state, client.config.staleAfter);
      this.sendStatus("METEOSAT_IMAGE_UNCHANGED", instanceId, state, paths);
    } else this.sendSocketNotification("METEOSAT_NO_IMAGE", { instanceId });
  },

  sendStatus(notification, instanceId, state, paths) {
    const client = this.getClient(instanceId);
    const freshness = evaluateFreshness(state, client?.config.staleAfter || 0);
    const overlay = client ? this.getOverlayPayload(client) : { overlayPath: null, overlayVersion: null };
    this.sendSocketNotification(notification, {
      instanceId,
      acquisitionTime: state.imageTime || null,
      downloadedAt: state.lastSuccessfulDownloadAt || state.downloadedAt || null,
      lastAttemptAt: state.lastAttemptAt || null,
      lastImageChangeAt: state.lastImageChangeAt || null,
      stale: freshness.stale,
      staleReason: freshness.reason,
      imagePath: paths.relativeImageFile,
      productLabel: state.productLabel || client?.config.selection.profile.label || null,
      imageVersion: Date.now(),
      overlayPath: overlay.overlayPath,
      overlayVersion: overlay.overlayVersion
    });
  },

  logFreshness(instanceId, state, staleAfter) {
    const client = this.getClient(instanceId);
    const freshness = evaluateFreshness(state, staleAfter);
    if (!freshness.stale) return freshness;
    const details = [];
    if (freshness.imageAgeMs !== null) details.push(`image age ${Math.round(freshness.imageAgeMs / 60_000)} minutes`);
    if (freshness.unchangedForMs !== null) details.push(`content unchanged for ${Math.round(freshness.unchangedForMs / 60_000)} minutes`);
    client?.logger.warn(`The satellite image is stale (${details.join(", ")}; threshold: ${Math.round(staleAfter / 60_000)} minutes).`);
    return freshness;
  },

  handleError(instanceId, client, controller, paths, error, attemptAt) {
    client.logger.block("ERROR", "Update failed", {
      name: error.name, message: error.message, status: error.status,
      retryable: error.retryable === true, details: error.details || null,
      stack: client.config.logLevel === "DEBUG" ? error.stack : null
    });
    if (this.getClient(instanceId) !== client || client.operationController !== controller || client.suspended) return;
    if (exists(paths.imageFile)) {
      const state = writeState(paths, { ...readState(paths), lastAttemptAt: attemptAt });
      this.sendStatus("METEOSAT_IMAGE_UNCHANGED", instanceId, state, paths);
      return;
    }
    this.sendSocketNotification("METEOSAT_IMAGE_ERROR", { instanceId });
  }
});
