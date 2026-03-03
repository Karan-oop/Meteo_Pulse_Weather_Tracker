/* ASYNC WEATHER TRACKER — script.js
   APIs:
     • Open-Meteo Geocoding : https://geocoding-api.open-meteo.com
     • Open-Meteo Weather   : https://api.open-meteo.com */

// ── CONFIG ──────────────────────────────────────────────────────
const GEO_URL     = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const LS_KEY      = "wt_history_v2";
const MAX_HIST    = 8;
const DEBOUNCE_MS = 370;

// ── DOM REFS ────────────────────────────────────────────────────
const cityInput        = document.getElementById("cityInput");
const searchBtn        = document.getElementById("searchBtn");
const inputClearBtn    = document.getElementById("inputClearBtn");
const inlineMsg        = document.getElementById("inlineMsg");
const historyWrap      = document.getElementById("historyWrap");
const noHistory        = document.getElementById("noHistory");
const clearHistBtn     = document.getElementById("clearHistBtn");
const emptyState       = document.getElementById("emptyState");
const weatherErr       = document.getElementById("weatherErr");
const weatherRows      = document.getElementById("weatherRows");
const skeletonRows     = document.getElementById("skeletonRows");
const consoleBody      = document.getElementById("consoleBody");
const clearConsoleBtn  = document.getElementById("clearConsoleBtn");
const autocompleteDrop = document.getElementById("autocompleteDrop");
const weatherBanner    = document.getElementById("weatherBanner");
const weatherCanvas    = document.getElementById("weatherCanvas");
const lightningOverlay = document.getElementById("lightningOverlay");
const headerIconPill   = document.getElementById("headerIconPill");

// ── STATE
let selectedGeo   = null;   // { lat, lon, name, country, admin1 }
let acActiveIndex = -1;
let debounceTimer = null;
let animationId   = null;
let particles     = [];
let currentScene  = null;

/*CANVAS / PARTICLE SYSTEM */

const ctx = weatherCanvas.getContext("2d");

/** Keep canvas pixel-perfect on resize */
function resizeCanvas() {
  weatherCanvas.width  = window.innerWidth;
  weatherCanvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// ── WMO code → scene name ────────────────────────────────────
function codeToScene(wmoCode, isDay, temp) {
  if (!isDay) return "night";
  if (wmoCode === 0)            return temp > 30 ? "hot" : "sunny";
  if (wmoCode <= 3)             return "cloudy";
  if (wmoCode <= 49)            return "fog";
  if (wmoCode <= 69)            return "rain";
  if (wmoCode <= 79)            return "snow";
  if (wmoCode <= 99)            return "storm";
  return "cloudy";
}

// ── WMO code → emoji + label ─────────────────────────────────
function codeToCondition(code, isDay) {
  const d = !!isDay;
  const map = {
    0:  { e: d ? "☀️"  : "🌙", t: "Clear Sky" },
    1:  { e: d ? "🌤️" : "🌙", t: "Mainly Clear" },
    2:  { e: "⛅",              t: "Partly Cloudy" },
    3:  { e: "☁️",              t: "Overcast" },
    45: { e: "🌫️",              t: "Fog" },
    48: { e: "🌫️",              t: "Icy Fog" },
    51: { e: "🌦️",              t: "Light Drizzle" },
    53: { e: "🌦️",              t: "Drizzle" },
    55: { e: "🌧️",              t: "Dense Drizzle" },
    61: { e: "🌧️",              t: "Slight Rain" },
    63: { e: "🌧️",              t: "Moderate Rain" },
    65: { e: "🌧️",              t: "Heavy Rain" },
    71: { e: "❄️",              t: "Slight Snowfall" },
    73: { e: "❄️",              t: "Moderate Snowfall" },
    75: { e: "❄️",              t: "Heavy Snowfall" },
    77: { e: "🌨️",              t: "Snow Grains" },
    80: { e: "🌦️",              t: "Slight Showers" },
    81: { e: "🌧️",              t: "Showers" },
    82: { e: "🌧️",              t: "Heavy Showers" },
    85: { e: "🌨️",              t: "Snow Showers" },
    86: { e: "🌨️",              t: "Heavy Snow Showers" },
    95: { e: "⛈️",              t: "Thunderstorm" },
    96: { e: "⛈️",              t: "Thunderstorm + Hail" },
    99: { e: "⛈️",              t: "Heavy Thunderstorm" },
  };
  // Find the closest matching code (floor match)
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) { if (code >= k) best = k; }
  return map[best] || { e: "🌡️", t: "Unknown" };
}

// ── Banner background colours per scene ──────────────────────
const bannerBgMap = {
  sunny:  "rgba(182,255,59,0.09)",
  hot:    "rgba(255,140,30,0.12)",
  cloudy: "rgba(120,140,180,0.10)",
  fog:    "rgba(140,160,180,0.08)",
  rain:   "rgba(56,130,255,0.10)",
  storm:  "rgba(130,80,255,0.12)",
  snow:   "rgba(180,220,255,0.10)",
  night:  "rgba(20,30,80,0.20)",
};

// ── CSS orb colours per scene (written to --orb-* vars) ──────
const orbPalette = {
  sunny:  ["#1a1e05", "#2a2200", "#0c0f00"],
  hot:    ["#1e0e00", "#2a1000", "#0c0500"],
  cloudy: ["#0c1018", "#14202e", "#080e16"],
  fog:    ["#0e1016", "#141c24", "#080c12"],
  rain:   ["#040a18", "#06101e", "#020610"],
  storm:  ["#080410", "#10081c", "#040210"],
  snow:   ["#080e18", "#0c1424", "#060c14"],
  night:  ["#010308", "#03060e", "#010206"],
};

/** Apply a weather scene: update CSS vars, banner, icon, particles */
function applyScene(scene, emoji) {
  // Orb colours → CSS custom properties on :root
  const [a, b, c] = orbPalette[scene] || orbPalette.cloudy;
  document.documentElement.style.setProperty("--orb-a", a);
  document.documentElement.style.setProperty("--orb-b", b);
  document.documentElement.style.setProperty("--orb-c", c);

  // Banner background
  weatherBanner.style.setProperty("--banner-bg", bannerBgMap[scene] || bannerBgMap.cloudy);

  // Header icon
  headerIconPill.textContent = emoji;

  // Start particle canvas animation
  startScene(scene);

  // Lightning for storm scenes
  if (scene === "storm") scheduleLightning();
}

/* ── Particle class ─────────────────────────────────────────── */
class Particle {
  constructor(scene) {
    this.scene = scene;
    this.reset(true);
  }

  /** Initialise or re-randomise particle properties */
  reset(init = false) {
    const W = weatherCanvas.width, H = weatherCanvas.height;

    switch (this.scene) {
      case "rain":
        this.x   = Math.random() * (W + 200) - 100;
        this.y   = init ? Math.random() * H : -15;
        this.vx  = -2.2;
        this.vy  = 22 + Math.random() * 8;
        this.len = 18 + Math.random() * 14;
        this.a   = 0.12 + Math.random() * 0.22;
        this.w   = 0.7  + Math.random() * 0.6;
        break;

      case "storm":
        this.x   = Math.random() * (W + 200) - 100;
        this.y   = init ? Math.random() * H : -15;
        this.vx  = -4;
        this.vy  = 32 + Math.random() * 12;
        this.len = 24 + Math.random() * 16;
        this.a   = 0.18 + Math.random() * 0.28;
        this.w   = 0.9  + Math.random() * 0.8;
        break;

      case "snow":
        this.x          = Math.random() * (W + 40) - 20;
        this.y          = init ? Math.random() * H : -10;
        this.vx         = -0.4 + Math.random() * 0.8;
        this.vy         = 0.7  + Math.random() * 1.4;
        this.r          = 1.5  + Math.random() * 4;
        this.a          = 0.35 + Math.random() * 0.55;
        this.wobble      = Math.random() * Math.PI * 2;
        this.wobbleSpeed = 0.015 + Math.random() * 0.025;
        break;

      case "sunny":
      case "hot":
        this.x       = Math.random() * W;
        this.y       = Math.random() * H;
        this.r       = 0.8  + Math.random() * 2.2;
        this.a       = 0;
        this.targetA = 0.12 + Math.random() * 0.28;
        this.phase   = Math.random() * Math.PI * 2;
        this.speed   = 0.008 + Math.random() * 0.018;
        break;

      case "night":
        this.x       = Math.random() * W;
        this.y       = Math.random() * H * 0.75;
        this.r       = 0.4  + Math.random() * 1.6;
        this.a       = 0;
        this.targetA = 0.3  + Math.random() * 0.65;
        this.phase   = Math.random() * Math.PI * 2;
        this.speed   = 0.004 + Math.random() * 0.01;
        break;

      case "cloudy":
      case "fog":
        this.x  = init ? Math.random() * W : W + 220;
        this.y  = 20 + Math.random() * H * 0.45;
        this.vx = -0.15 - Math.random() * 0.3;
        this.vy = 0;
        this.w  = 160 + Math.random() * 220;
        this.h  = 45  + Math.random() * 70;
        this.a  = this.scene === "fog"
          ? 0.04 + Math.random() * 0.07
          : 0.03 + Math.random() * 0.05;
        break;
    }
  }

  update() {
    const W = weatherCanvas.width, H = weatherCanvas.height;

    switch (this.scene) {
      case "rain":
      case "storm":
        this.x += this.vx;
        this.y += this.vy;
        if (this.y > H + 20) this.reset();
        break;

      case "snow":
        this.wobble += this.wobbleSpeed;
        this.x += this.vx + Math.sin(this.wobble) * 0.55;
        this.y += this.vy;
        if (this.y > H + 12) this.reset();
        if (this.x < -15) this.x = W + 15;
        break;

      case "sunny":
      case "hot":
      case "night":
        this.phase += this.speed;
        this.a = (Math.sin(this.phase) * 0.5 + 0.5) * this.targetA;
        break;

      case "cloudy":
      case "fog":
        this.x += this.vx;
        if (this.x < -(this.w + 20)) this.reset();
        break;
    }
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.a);

    switch (this.scene) {
      case "rain":
      case "storm": {
        ctx.strokeStyle = "rgba(160,200,255,1)";
        ctx.lineWidth = this.w;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + this.vx * (this.len / this.vy), this.y + this.len);
        ctx.stroke();
        break;
      }

      case "snow": {
        ctx.fillStyle = "#e5f2ff";
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case "sunny":
      case "hot": {
        ctx.fillStyle = this.scene === "hot" ? "#ffcc44" : "#fff380";
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case "night": {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case "cloudy":
      case "fog": {
        const g = ctx.createRadialGradient(
          this.x + this.w / 2, this.y + this.h / 2, 0,
          this.x + this.w / 2, this.y + this.h / 2, this.w * 0.6
        );
        g.addColorStop(0, `rgba(170,190,220,${this.a})`);
        g.addColorStop(1, "rgba(170,190,220,0)");
        ctx.fillStyle = g;
        ctx.fillRect(this.x, this.y, this.w, this.h);
        break;
      }
    }

    ctx.restore();
  }
}

/** Draw animated sun for sunny / hot scenes */
function drawSun(hot) {
  const W  = weatherCanvas.width;
  const t  = Date.now() * 0.001;
  const cx = W * 0.84, cy = 90;
  const baseR  = hot ? 58 : 46;
  const pulseR = baseR + 22 + Math.sin(t * 1.6) * 9;

  ctx.save();

  // Atmospheric halo
  const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
  g1.addColorStop(0, hot ? "rgba(255,170,20,0.16)" : "rgba(255,230,60,0.14)");
  g1.addColorStop(1, "rgba(255,200,50,0)");
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
  ctx.fill();

  // Sun disc
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR);
  g2.addColorStop(0,    hot ? "#fff5b0" : "#fffee0");
  g2.addColorStop(0.45, hot ? "#ffcc30" : "#ffe060");
  g2.addColorStop(1,    "rgba(255,200,50,0)");
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Start (or switch to) a weather scene animation */
function startScene(scene) {
  if (animationId) cancelAnimationFrame(animationId);
  particles = [];
  currentScene = scene;

  // How many particles to spawn per scene
  const counts = {
    rain: 130, storm: 180, snow: 110,
    sunny: 55, hot: 75, night: 160,
    cloudy: 14, fog: 22,
  };

  const n = counts[scene] || 0;
  for (let i = 0; i < n; i++) particles.push(new Particle(scene));

  function loop() {
    ctx.clearRect(0, 0, weatherCanvas.width, weatherCanvas.height);
    if (scene === "sunny" || scene === "hot") drawSun(scene === "hot");
    for (const p of particles) { p.update(); p.draw(); }
    animationId = requestAnimationFrame(loop);
  }

  loop();
}

/** Schedule randomised lightning double-flash for storm scenes */
function scheduleLightning() {
  if (currentScene !== "storm") return;
  const delay = 3500 + Math.random() * 9000;
  setTimeout(() => {
    flash(1);
    setTimeout(() => flash(0), 80);
    setTimeout(() => { flash(0.6); setTimeout(() => flash(0), 60); }, 140);
    scheduleLightning();
  }, delay);
}

function flash(opacity) {
  lightningOverlay.style.opacity = opacity;
}

/* ════════════════════════════════════════════════════════════════
   CONSOLE LOGGER
   ════════════════════════════════════════════════════════════════ */

/** Append a styled log line to the console panel */
function cLog(type, msg) {
  const line  = document.createElement("div");
  line.className = "c-line";

  const badge = document.createElement("span");
  badge.className = `c-badge ${type}`;
  badge.textContent = type.toUpperCase();

  const text  = document.createElement("span");
  text.className = "c-text";
  text.innerHTML  = msg;

  line.appendChild(badge);
  line.appendChild(text);
  consoleBody.appendChild(line);
  requestAnimationFrame(() => { consoleBody.scrollTop = consoleBody.scrollHeight; });
}

/* ════════════════════════════════════════════════════════════════
   LOADING STATE
   ════════════════════════════════════════════════════════════════ */

function setLoading(on) {
  searchBtn.disabled = on;
  cityInput.disabled = on;
  searchBtn.classList.toggle("loading", on);

  if (on) {
    // Show skeleton loader, hide everything else
    emptyState.style.display  = "none";
    weatherErr.classList.remove("show");
    weatherRows.classList.remove("show");
    weatherBanner.classList.remove("show");
    skeletonRows.classList.add("show");
  } else {
    skeletonRows.classList.remove("show");
  }
}

/* ════════════════════════════════════════════════════════════════
   INLINE MESSAGES
   ════════════════════════════════════════════════════════════════ */

function showMsg(type, text) {
  inlineMsg.textContent = text;
  inlineMsg.className   = `inline-msg show ${type}`;
  // Shake input on error
  if (type === "err") {
    cityInput.classList.add("shake");
    setTimeout(() => cityInput.classList.remove("shake"), 450);
  }
}

function hideMsg() {
  inlineMsg.className   = "inline-msg";
  inlineMsg.textContent = "";
}

/* ════════════════════════════════════════════════════════════════
   WEATHER PANEL STATES
   ════════════════════════════════════════════════════════════════ */

function showEmpty() {
  emptyState.style.display = "flex";
  weatherErr.classList.remove("show");
  weatherRows.classList.remove("show");
  weatherBanner.classList.remove("show");
  skeletonRows.classList.remove("show");
}

function showError(msg) {
  emptyState.style.display = "none";
  weatherErr.textContent   = "\u26A0 " + msg;
  weatherErr.classList.add("show");
  weatherRows.classList.remove("show");
  weatherBanner.classList.remove("show");
  skeletonRows.classList.remove("show");
}

function showWeatherData() {
  emptyState.style.display = "none";
  weatherErr.classList.remove("show");
  skeletonRows.classList.remove("show");
  weatherBanner.classList.add("show");
  weatherRows.classList.add("show");
}

/* ════════════════════════════════════════════════════════════════
   ANIMATED TEMPERATURE COUNTER
   ════════════════════════════════════════════════════════════════ */

/** Counts from 0 to target over ~820ms with ease-out-cubic */
function animateCounter(target, el, suffix) {
  suffix = suffix || "°C";
  const dur = 820;
  const t0  = performance.now();

  function tick(now) {
    const p    = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * ease) + suffix;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = target + suffix;
  }

  requestAnimationFrame(tick);
}

/* ════════════════════════════════════════════════════════════════
   RENDER WEATHER DATA
   ════════════════════════════════════════════════════════════════ */

function renderWeather(current, geoMeta) {
  const temp      = Math.round(current.temperature_2m);
  const feelsLike = Math.round(current.apparent_temperature ?? current.temperature_2m);
  const humidity  = current.relative_humidity_2m;
  const wind      = current.wind_speed_10m;
  const wmoCode   = current.weathercode ?? current.weather_code ?? 0;
  const isDay     = current.is_day ?? 1;
  const vis       = current.visibility;

  const condition = codeToCondition(wmoCode, isDay);
  const scene     = codeToScene(wmoCode, !!isDay, temp);
  const locName   = geoMeta.name;
  const country   = geoMeta.country;

  // Apply dynamic background scene
  applyScene(scene, condition.e);

  // ── Banner ──
  animateCounter(temp, document.getElementById("bannerTemp"));
  document.getElementById("bannerCondition").textContent = condition.t;
  document.getElementById("bannerLocation").textContent  = locName + ", " + country;

  // ── Detail rows ──
  document.getElementById("wCity").textContent    = locName + ", " + country;
  document.getElementById("wTemp").textContent    = temp + "°C";
  document.getElementById("wWeather").textContent = condition.t;

  if (humidity !== undefined && humidity !== null) {
    document.getElementById("wHumidity").textContent    = humidity + "%";
    document.getElementById("humidityFill").style.width = humidity + "%";
  } else {
    document.getElementById("wHumidity").textContent = "N/A";
  }

  document.getElementById("wWind").textContent  = wind !== undefined ? wind + " km/h" : "N/A";
  document.getElementById("wFeels").textContent = feelsLike + "°C";
  document.getElementById("wVis").textContent   = vis !== undefined
    ? (vis / 1000).toFixed(1) + " km" : "N/A";

  // ── Location badge ──
  const badge = document.getElementById("locBadge");
  if (geoMeta.admin1) {
    badge.textContent = geoMeta.admin1;
    badge.classList.add("show");
  } else {
    badge.classList.remove("show");
  }

  showWeatherData();
}

function capitalise(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/* ════════════════════════════════════════════════════════════════
   AUTOCOMPLETE DROPDOWN
   ════════════════════════════════════════════════════════════════ */

function closeDropdown() {
  autocompleteDrop.classList.remove("open");
  autocompleteDrop.innerHTML = "";
  acActiveIndex = -1;
}

function renderDropdown(results, query) {
  autocompleteDrop.innerHTML = "";
  acActiveIndex = -1;

  if (!results || results.length === 0) {
    autocompleteDrop.innerHTML =
      '<div class="ac-empty">No places found for "<strong>' + query + '</strong>"</div>';
    autocompleteDrop.classList.add("open");
    return;
  }

  results.forEach(function(place) {
    const item = document.createElement("div");
    item.className = "ac-item";

    // Highlight matched portion of name
    const q  = query.toLowerCase();
    const n  = place.name.toLowerCase();
    let hl   = place.name;
    const mi = n.indexOf(q);
    if (mi !== -1) {
      hl = place.name.slice(0, mi)
        + "<em>" + place.name.slice(mi, mi + query.length) + "</em>"
        + place.name.slice(mi + query.length);
    }

    const sub = [place.admin1, place.country].filter(Boolean).join(", ");

    item.innerHTML =
      '<span class="ac-pin">&#x1F4CD;</span>' +
      '<div class="ac-info">' +
        '<div class="ac-name">' + hl + '</div>' +
        '<div class="ac-sub">' + sub + '</div>' +
      '</div>' +
      '<div class="ac-coords">' +
        place.latitude.toFixed(2) + ', ' + place.longitude.toFixed(2) +
      '</div>';

    item.addEventListener("mousedown", function(e) {
      e.preventDefault();
      selectPlace(place);
    });

    autocompleteDrop.appendChild(item);
  });

  autocompleteDrop.classList.add("open");
}

function setActiveDropdownItem(i) {
  const items = autocompleteDrop.querySelectorAll(".ac-item");
  items.forEach(el => el.classList.remove("active"));
  if (i >= 0 && i < items.length) {
    items[i].classList.add("active");
    acActiveIndex = i;
  }
}

/** Called when user clicks a dropdown suggestion */
function selectPlace(place) {
  selectedGeo = {
    lat: place.latitude, lon: place.longitude,
    name: place.name, country: place.country, admin1: place.admin1 || "",
  };

  cityInput.value = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
  closeDropdown();
  toggleClearBtn();
  cLog("sync",
    '[GEO SELECTED] <span class="hl">' + place.name + '</span>' +
    ' — lat: ' + place.latitude.toFixed(4) + ', lon: ' + place.longitude.toFixed(4)
  );
  doFetch();
}

/* ════════════════════════════════════════════════════════════════
   GEOCODING  (Open-Meteo Geocoding API)
   ════════════════════════════════════════════════════════════════ */

async function geocodeQuery(query) {
  const url = GEO_URL + "?name=" + encodeURIComponent(query) + "&count=6&language=en&format=json";
  cLog("async", '[GEOCODE] Searching <span class="hl">"' + query + '"</span>...');

  return fetch(url)
    .then(r => r.json())
    .then(d => d.results || [])
    .catch(function(err) {
      cLog("error", "[GEOCODE] Network error: " + err.message);
      return [];
    });
}

/* ════════════════════════════════════════════════════════════════
   LIVE AUTOCOMPLETE
   ════════════════════════════════════════════════════════════════ */

async function handleAutoComplete(query) {
  if (query.length < 2) { closeDropdown(); return; }

  autocompleteDrop.innerHTML = '<div class="ac-loading">&#x1F50D; Searching...</div>';
  autocompleteDrop.classList.add("open");

  try {
    const results = await geocodeQuery(query);
    renderDropdown(results, query);
  } catch (_) {
    closeDropdown();
  }
}

/* ════════════════════════════════════════════════════════════════
   CORE FETCH  (2-step: geocode → weather)
   ════════════════════════════════════════════════════════════════ */

async function doFetch(fallbackCity) {
  const query = (fallbackCity || cityInput.value).trim();

  if (!query) {
    showMsg("err", "\u26A0 Please enter a city, town or locality.");
    cLog("error", "Validation failed — empty input.");
    return;
  }

  // ── Event loop demonstration ──
  cLog("sync", '[CALL STACK] doFetch() entered — query: <span class="hl">"' + query + '"</span>');
  cLog("sync", "[CALL STACK] Setting loading state synchronously.");

  setLoading(true);
  hideMsg();
  closeDropdown();

  Promise.resolve().then(function() {
    cLog("micro", "[MICROTASK QUEUE] Promise.resolve().then() — ran before next macrotask.");
  });
  setTimeout(function() {
    cLog("macro", "[TASK QUEUE] setTimeout(0) — macrotask ran after all microtasks.");
  }, 0);

  cLog("sync", "[CALL STACK] Synchronous code continues after dispatch.");

  // ── Step 1: Geocode (skip if coords already known) ──
  let geo = selectedGeo;

  if (!geo) {
    try {
      cLog("async", '[WEB API] Geocode fetch dispatched for <span class="hl">"' + query + '"</span>...');
      const results = await geocodeQuery(query);

      if (!results || results.length === 0) throw new Error("GEO_NOT_FOUND");

      const best = results[0];
      geo = {
        lat: best.latitude, lon: best.longitude,
        name: best.name, country: best.country, admin1: best.admin1 || "",
      };

      cLog("success",
        '[GEOCODE] Resolved \u2192 <span class="hl">' + geo.name + "</span>, " + geo.country +
        " (" + geo.lat.toFixed(4) + ", " + geo.lon.toFixed(4) + ")"
      );

    } catch (geoErr) {
      setLoading(false);
      if (geoErr.message === "GEO_NOT_FOUND") {
        showMsg("err", '\u{1F50D} "' + query + '" not found. Try a more specific name.');
        showError("Location not found.");
      } else {
        showMsg("err", "\uD83C\uDF10 Network error \u2014 check your connection.");
        showError("Network error.");
      }
      cLog("error", "[GEOCODE ERROR] " + geoErr.message);
      cLog("info",  "[FINALLY] Loading reset after geocode failure.");
      return;
    }
  }

  // ── Step 2: Fetch weather from Open-Meteo ──
  const weatherUrl =
    WEATHER_URL +
    "?latitude="  + geo.lat +
    "&longitude=" + geo.lon +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weathercode,wind_speed_10m,visibility" +
    "&wind_speed_unit=kmh&timezone=auto";

  cLog("async",
    '[WEB API] Open-Meteo fetch \u2192 lat: <span class="hl">' + geo.lat.toFixed(4) +
    '</span>, lon: <span class="hl">' + geo.lon.toFixed(4) + "</span>"
  );

  try {
    const response = await fetch(weatherUrl)
      .then(function(r) {
        cLog("micro", '[MICROTASK] .then() on weather fetch \u2192 HTTP <span class="hl">' + r.status + "</span>");
        return r;
      })
      .catch(function(netErr) {
        cLog("error", "[MICROTASK] .catch() \u2192 Network error: " + netErr.message);
        throw new Error("NETWORK");
      });

    cLog("async", "[CALL STACK] await resumed \u2014 weather response received.");

    const data = await response.json();

    if (!response.ok) {
      throw new Error("API:" + response.status + ":" + (data && data.reason ? data.reason : "Unknown error"));
    }

    cLog("success", '[SUCCESS] Weather data received for <span class="hl">' + geo.name + "</span> \u2014 rendering UI.");
    cLog("sync",    "[CALL STACK] Synchronous DOM update begins.");

    renderWeather(data.current, geo);

    // Save search to history
    const histLabel = [geo.name, geo.admin1, geo.country].filter(Boolean).join(", ");
    pushHistory(histLabel, geo);

    selectedGeo = null;
    cLog("sync", "[CALL STACK] doFetch() complete \u2014 frame popped from stack.");

  } catch (err) {
    cLog("error", "[CATCH] " + err.message);

    if (err.message === "NETWORK" || err.message.indexOf("fetch") !== -1) {
      showMsg("err", "\uD83C\uDF10 Network error \u2014 check your internet connection.");
      showError("Network error.");
    } else if (err.message.indexOf("API:") === 0) {
      showMsg("err", "\u26A0 Weather data unavailable for this location.");
      showError("No weather data.");
    } else {
      showMsg("err", "\u274C " + err.message);
      showError("Something went wrong.");
    }

  } finally {
    setLoading(false);
    selectedGeo = null;
    cLog("info", "[FINALLY] Loading reset \u2014 always runs regardless of outcome.");
  }
}

/* ════════════════════════════════════════════════════════════════
   LOCAL STORAGE — SEARCH HISTORY
   ════════════════════════════════════════════════════════════════ */

function getHistory() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch (_) { return []; }
}

function pushHistory(label, geo) {
  let hist = getHistory();
  hist = hist.filter(h => h.label.toLowerCase() !== label.toLowerCase());
  hist.unshift({ label: label, geo: geo });
  if (hist.length > MAX_HIST) hist = hist.slice(0, MAX_HIST);
  localStorage.setItem(LS_KEY, JSON.stringify(hist));
  cLog("info", 'LocalStorage \u2014 <span class="hl">"' + label + '"</span> saved.');
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(LS_KEY);
  cLog("info", "LocalStorage \u2014 history cleared.");
  renderHistory();
}

function renderHistory() {
  const hist = getHistory();
  historyWrap.innerHTML = "";

  if (hist.length === 0) {
    historyWrap.appendChild(noHistory);
    return;
  }

  hist.forEach(function(entry, i) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = entry.label;
    chip.style.animationDelay = (i * 0.05) + "s";

    chip.addEventListener("click", function() {
      cLog("sync", '[EVENT] History chip clicked \u2192 <span class="hl">"' + entry.label + '"</span>');
      cityInput.value = entry.label;
      toggleClearBtn();
      if (entry.geo) {
        selectedGeo = entry.geo;
        cLog("info", '[LOCAL STORAGE] Using saved coords for <span class="hl">' + entry.label + "</span>");
      }
      doFetch(entry.label);
    });

    historyWrap.appendChild(chip);
  });
}

/* ════════════════════════════════════════════════════════════════
   UI HELPERS
   ════════════════════════════════════════════════════════════════ */

function toggleClearBtn() {
  inputClearBtn.classList.toggle("visible", cityInput.value.length > 0);
}

/* ════════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ════════════════════════════════════════════════════════════════ */

// Search button click
searchBtn.addEventListener("click", function() {
  cLog("sync", "[EVENT] 'click' on Search button.");
  selectedGeo = null;
  doFetch(cityInput.value.trim());
});

// Input typing — debounced autocomplete
cityInput.addEventListener("input", function() {
  toggleClearBtn();
  selectedGeo = null;
  const q = cityInput.value.trim();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function() { handleAutoComplete(q); }, DEBOUNCE_MS);
});

// Keyboard navigation in dropdown
cityInput.addEventListener("keydown", function(e) {
  const items = autocompleteDrop.querySelectorAll(".ac-item");

  if (e.key === "ArrowDown") {
    e.preventDefault();
    setActiveDropdownItem(Math.min(acActiveIndex + 1, items.length - 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActiveDropdownItem(Math.max(acActiveIndex - 1, 0));
  } else if (e.key === "Enter") {
    cLog("sync", "[EVENT] Enter key pressed.");
    if (acActiveIndex >= 0 && items[acActiveIndex]) {
      items[acActiveIndex].dispatchEvent(new MouseEvent("mousedown"));
    } else {
      selectedGeo = null;
      doFetch(cityInput.value.trim());
    }
  } else if (e.key === "Escape") {
    closeDropdown();
  }
});

// Close dropdown on outside click
document.addEventListener("click", function(e) {
  if (!e.target.closest(".search-wrap-outer")) closeDropdown();
});

// Clear input × button
inputClearBtn.addEventListener("click", function() {
  cityInput.value = "";
  selectedGeo = null;
  toggleClearBtn();
  closeDropdown();
  cityInput.focus();
});

// Clear history button
clearHistBtn.addEventListener("click", function() {
  cLog("sync", "[EVENT] Clear History clicked.");
  clearHistory();
});

// Clear console button
clearConsoleBtn.addEventListener("click", function() {
  consoleBody.innerHTML = "";
  cLog("sync", "Console cleared.");
});

// Quick tip chips
document.querySelectorAll(".tip-chip").forEach(function(chip) {
  chip.addEventListener("click", function() {
    const q = chip.dataset.q;
    cityInput.value = q;
    selectedGeo = null;
    toggleClearBtn();
    closeDropdown();
    cLog("sync", '[TIP CHIP] Clicked \u2192 <span class="hl">"' + q + '"</span>');
    doFetch(q);
  });
});

/* ════════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════════ */

cLog("sync",  "[INIT] Script loaded \u2014 DOM fully parsed.");
cLog("sync",  "[INIT] Event listeners registered (search, input, keyboard, tips).");
cLog("info",  "[INIT] Open-Meteo API ready \u2014 no API key required.");
cLog("async", "[EVENT LOOP] Call stack empty \u2014 idle, awaiting user input...");

renderHistory();
cLog("info", "[INIT] LocalStorage read \u2014 " +
  '<span class="hl">' + getHistory().length + "</span> history item(s) loaded.");

showEmpty();

// Gentle starfield while idle

startScene("night");
