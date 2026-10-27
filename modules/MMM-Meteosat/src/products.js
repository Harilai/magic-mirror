"use strict";

const PRODUCT_PROFILES = Object.freeze({
  geocolour: Object.freeze({
    id: "geocolour",
    label: "GeoColour",
    layer: "mtg_fd:rgb_geocolour"
  }),
  dust: Object.freeze({
    id: "dust",
    label: "Dust RGB",
    layer: "mtg_fd:rgb_dust"
  }),
  cloudphase: Object.freeze({
    id: "cloudphase",
    label: "Cloud Phase RGB",
    layer: "mtg_fd:rgb_cloudphase"
  }),
  cloudtype: Object.freeze({
    id: "cloudtype",
    label: "Cloud Type RGB",
    layer: "mtg_fd:rgb_cloudtype"
  }),
  fog: Object.freeze({
    id: "fog",
    label: "Fog / Low Clouds RGB",
    layer: "mtg_fd:rgb_fog"
  }),
  firetemperature: Object.freeze({
    id: "firetemperature",
    label: "Fire Temperature RGB",
    layer: "mtg_fd:rgb_firetemperature"
  }),
  snow: Object.freeze({
    id: "snow",
    label: "Snow RGB",
    layer: "mtg_fd:rgb_snow"
  }),
  infrared: Object.freeze({
    id: "infrared",
    label: "Infrared 10.5 µm",
    layer: "mtg_fd:ir105_hrfi"
  })
});

function resolveProduct(value) {
  const requested = typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : "geocolour";
  const resolved = requested;
  const profile = PRODUCT_PROFILES[resolved];

  if (!profile) {
    const supported = Object.keys(PRODUCT_PROFILES).join(", ");
    throw new Error(
      `Unsupported product '${requested}'. Supported values: ${supported}.`
    );
  }

  return { requested, resolved, profile };
}

module.exports = { PRODUCT_PROFILES, resolveProduct };
