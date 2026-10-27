/* global Module */

const DEFAULT_MESSAGES = Object.freeze({
  loading: "Loading Meteosat image …",
  noImage: "No Meteosat image is available yet.",
  error: "Meteosat image could not be loaded.",
  stale: "delayed"
});

const DEFAULT_TIMESTAMP_OPTIONS = Object.freeze({
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

Module.register("MMM-Meteosat", {
  defaults: {
    product: "geocolour",
    cacheId: "",
    imageSize: 550,
    wmsImageSize: 1800,
    updateInterval: 10 * 60 * 1000,
    showTimestamp: true,
    timestampType: "acquisition",
    timestampLocale: undefined,
    timestampOptions: DEFAULT_TIMESTAMP_OPTIONS,
    showSource: true,
    showProduct: true,
    showStatus: true,
    showCoastlines: false,
    showCountryBorders: false,
    overlayOpacity: 0.6,
    logLevel: "INFO",
    staleAfter: 90 * 60 * 1000,
    retryDelays: [15 * 1000, 45 * 1000],
    messages: DEFAULT_MESSAGES
  },

  start() {
    this.messages = {
      ...DEFAULT_MESSAGES,
      ...(this.config.messages || {})
    };

    this.imageAvailable = false;
    this.imageVersion = Date.now();
    this.imagePath = null;
    this.acquisitionTime = null;
    this.downloadedAt = null;
    this.productLabel = null;
    this.stale = false;
    this.staleReason = null;
    this.overlayPath = null;
    this.overlayVersion = null;
    this.statusText = this.messages.loading;

    this.sendSocketNotification("METEOSAT_CONFIG", {
      instanceId: this.identifier,
      product: this.config.product,
      cacheId: this.config.cacheId,
      updateInterval: this.config.updateInterval,
      wmsImageSize: this.config.wmsImageSize,
      imageSize: this.config.imageSize,
      logLevel: this.config.logLevel,
      staleAfter: this.config.staleAfter,
      retryDelays: this.config.retryDelays,
      showTimestamp: this.config.showTimestamp,
      timestampType: this.config.timestampType,
      timestampLocale: this.config.timestampLocale,
      showSource: this.config.showSource,
      showProduct: this.config.showProduct,
      showStatus: this.config.showStatus,
      showCoastlines: this.config.showCoastlines,
      showCountryBorders: this.config.showCountryBorders,
      overlayOpacity: this.config.overlayOpacity
    });
  },

  suspend() {
    this.sendSocketNotification("METEOSAT_SUSPEND", { instanceId: this.identifier });
  },

  resume() {
    this.sendSocketNotification("METEOSAT_RESUME", { instanceId: this.identifier });
  },

  getStyles() {
    return ["MMM-Meteosat.css"];
  },

  socketNotificationReceived(notification, payload = {}) {
    if (payload.instanceId && payload.instanceId !== this.identifier) return;

    if (notification === "METEOSAT_IMAGE_UPDATED" || notification === "METEOSAT_IMAGE_UNCHANGED") {
      this.imageAvailable = true;
      this.imageVersion = payload.imageVersion || this.imageVersion;
      this.imagePath = payload.imagePath || this.imagePath;
      this.acquisitionTime = payload.acquisitionTime || this.acquisitionTime;
      this.downloadedAt = payload.downloadedAt || this.downloadedAt;
      this.productLabel = payload.productLabel || this.productLabel;
      this.stale = payload.stale === true;
      this.staleReason = payload.staleReason || null;
      this.overlayPath = payload.overlayPath || null;
      this.overlayVersion = payload.overlayVersion || null;
      this.statusText = "";
      this.updateDom(notification === "METEOSAT_IMAGE_UPDATED" ? 500 : 250);
      return;
    }

    if (notification === "METEOSAT_CONFIG_ERROR") {
      this.showStatusMessage(payload.message || this.messages.error);
      return;
    }

    if (notification === "METEOSAT_NO_IMAGE") {
      this.showStatusMessage(this.messages.noImage);
      return;
    }

    if (notification === "METEOSAT_IMAGE_ERROR") {
      this.showStatusMessage(this.messages.error);
    }
  },

  showStatusMessage(message) {
    this.imageAvailable = false;
    this.statusText = message;
    this.updateDom(250);
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-meteosat";

    if (this.imageAvailable && this.imagePath) {
      wrapper.appendChild(this.createImageStack());
      if (this.config.showTimestamp || this.config.showSource || this.config.showProduct) {
        wrapper.appendChild(this.createCaption());
      }
      return wrapper;
    }

    if (this.config.showStatus) wrapper.appendChild(this.createStatus());
    return wrapper;
  },

  createImageStack() {
    const stack = document.createElement("div");
    stack.className = "mmm-meteosat-image-stack";
    stack.style.width = `${this.config.imageSize}px`;
    stack.appendChild(this.createImage());

    if (this.overlayPath) {
      const overlay = document.createElement("img");
      overlay.className = "mmm-meteosat-overlay";
      overlay.src = `/modules/MMM-Meteosat/${this.overlayPath}?v=${encodeURIComponent(this.overlayVersion || this.imageVersion)}`;
      overlay.alt = "";
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.opacity = String(Math.min(1, Math.max(0, Number(this.config.overlayOpacity) || 0)));
      overlay.onerror = () => overlay.remove();
      stack.appendChild(overlay);
    }

    return stack;
  },

  createImage() {
    const image = document.createElement("img");
    image.className = "mmm-meteosat-image";
    image.src = `/modules/MMM-Meteosat/${this.imagePath}?v=${encodeURIComponent(this.imageVersion)}`;
    image.alt = this.productLabel ? `Current Meteosat ${this.productLabel} image` : "Current Meteosat image";
    image.onerror = () => this.showStatusMessage(this.messages.error);
    return image;
  },

  createCaption() {
    const caption = document.createElement("div");
    caption.className = "mmm-meteosat-timestamp";
    const parts = [];

    if (this.config.showSource) parts.push("EUMETSAT");
    if (this.config.showProduct && this.productLabel) parts.push(this.productLabel);

    const timestamp = this.getSelectedTimestamp();
    if (this.config.showTimestamp && timestamp) parts.push(this.formatTimestamp(timestamp));
    if (this.stale && this.messages.stale) parts.push(this.messages.stale);

    caption.textContent = parts.join(" · ");
    if (this.staleReason) caption.dataset.staleReason = this.staleReason;
    return caption;
  },

  getSelectedTimestamp() {
    return String(this.config.timestampType).toLowerCase() === "download"
      ? this.downloadedAt
      : this.acquisitionTime || this.downloadedAt;
  },

  log(level, message) {
    const levels = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
    const configured = String(this.config.logLevel || "INFO").toUpperCase();
    const activeLevel = Object.hasOwn(levels, configured) ? configured : "INFO";
    if (!Object.hasOwn(levels, level) || levels[level] > levels[activeLevel]) return;
    const text = `[MMM-Meteosat][${this.identifier}][${level}] ${message}`;
    if (level === "ERROR") console.error(text);
    else if (level === "WARN") console.warn(text);
    else console.log(text);
  },

  formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    try {
      return new Intl.DateTimeFormat(
        this.config.timestampLocale || undefined,
        {
          ...DEFAULT_TIMESTAMP_OPTIONS,
          ...(this.config.timestampOptions || {})
        }
      ).format(date);
    } catch (error) {
      this.log("ERROR", `Invalid timestamp configuration: ${error.message}`);
      return new Intl.DateTimeFormat(undefined, DEFAULT_TIMESTAMP_OPTIONS).format(date);
    }
  },

  createStatus() {
    const status = document.createElement("div");
    status.className = "mmm-meteosat-status";
    status.textContent = this.statusText;
    return status;
  }
});
