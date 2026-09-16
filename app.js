/* =========================================================
   Shot Put Field Tool — app.js  (browser-only client code)

   Throw data lives on the SERVER (see db.js / server.js), so
   every logged-in user sees the same shared leaderboard. The
   only thing kept in this browser is the last-typed athlete
   name, purely as a typing convenience.

   The field graphic and the throw animation are both derived
   from the one FIELD object below, so the picture and the
   maths can never disagree about where a distance sits.
   ========================================================= */

/* ---------- Fail loudly, not silently ---------- */

window.addEventListener("error", (event) => {
  console.error("[shotput] uncaught error:", event.error || event.message);
  showFatalErrorBanner(event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[shotput] unhandled promise rejection:", event.reason);
  showFatalErrorBanner(String((event.reason && event.reason.message) || event.reason));
});

function showFatalErrorBanner(message) {
  if (document.getElementById("shotput-fatal-banner")) return;
  const banner = document.createElement("div");
  banner.id = "shotput-fatal-banner";
  banner.setAttribute("role", "alert");
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:9999;background:#a12b23;" +
    "color:#fff;padding:14px 18px;font-family:sans-serif;font-size:15px;line-height:1.4;";
  banner.textContent =
    "Something went wrong loading this page's script: " + message +
    " — press F12 and open the Console tab for details.";
  document.body.prepend(banner);
}

/* ---------- Small helpers ---------- */

const SVG_NS = "http://www.w3.org/2000/svg";
const NAME_HINT_KEY = "shotput_last_athlete";

function formatDistance(value) {
  return value.toFixed(2) + " m";
}

function getAthleteNameHint() {
  try { return localStorage.getItem(NAME_HINT_KEY) || ""; } catch (e) { return ""; }
}

function setAthleteNameHint(name) {
  try { localStorage.setItem(NAME_HINT_KEY, name); } catch (e) { /* ignore */ }
}

// Build an SVG element with attributes in one call.
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

/* ---------- Server API ---------- */

async function apiGetMe() {
  const res = await fetch("/api/me");
  if (!res.ok) throw new Error("Not logged in.");
  return res.json();
}

async function apiGetThrows() {
  const res = await fetch("/api/throws");
  if (!res.ok) throw new Error("Could not load throws from the server.");
  return res.json();
}

async function apiAddThrow(athleteName, distance) {
  const res = await fetch("/api/throws", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ athleteName, distance }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not save that throw.");
  }
  return res.json();
}

async function apiClearThrows() {
  const res = await fetch("/api/throws/clear", { method: "POST" });
  if (!res.ok) throw new Error("Could not clear throws.");
}

/* ---------- Header badge (who am I, and can I record?) ---------- */

async function renderUserBadge() {
  const badge = document.getElementById("user-badge");
  const badgeText = document.getElementById("user-badge-text");
  if (!badge || !badgeText) return null;

  try {
    const me = await apiGetMe();
    badgeText.textContent =
      me.username + (me.role === "admin" ? " (admin)" : " (visitor)");
    badge.hidden = false;

    // Admin-only links are hidden by default in the HTML and only
    // revealed here, so a visitor never sees a link they can't use.
    if (me.role === "admin") {
      document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = false; });
    }
    return me;
  } catch (err) {
    console.warn("[shotput] not logged in or /api/me failed:", err.message);
    return null;
  }
}

/* =========================================================
   LEADERBOARD
   Groups every recorded throw by athlete, then ranks the
   athletes by their single best distance. Every throw ever
   recorded is counted - nothing is dropped, and the ranking
   is by BEST throw, not by whoever threw most recently.
   ========================================================= */

function buildLeaderboard(throws) {
  const byAthlete = new Map();

  throws.forEach((t) => {
    const key = t.athleteName;
    if (!byAthlete.has(key)) {
      byAthlete.set(key, { name: key, best: t.distance, attempts: 0, total: 0 });
    }
    const entry = byAthlete.get(key);
    entry.attempts += 1;
    entry.total += t.distance;
    if (t.distance > entry.best) entry.best = t.distance;
  });

  return Array.from(byAthlete.values())
    .map((e) => ({ ...e, average: e.total / e.attempts }))
    .sort((a, b) => b.best - a.best); // highest best throw first
}

// A small pill used for "Leading" / "Personal best" - text, never
// colour alone, so the meaning survives for colour-blind users.
function tagHtml(label) {
  return '<span class="best-tag">' +
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 21h8M12 17v4M7 4h10l-1 8a4 4 0 0 1-8 0L7 4Z"/>' +
    '<path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/></svg>' +
    label + "</span>";
}

function renderLeaderboardTable(tbodyEl, tableEl, emptyEl, throws) {
  if (!tbodyEl) return;

  const rows = buildLeaderboard(throws);
  tbodyEl.innerHTML = "";

  if (rows.length === 0) {
    if (tableEl) tableEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (tableEl) tableEl.hidden = false;
  if (emptyEl) emptyEl.hidden = true;

  rows.forEach((entry, index) => {
    const tr = document.createElement("tr");
    if (index === 0) tr.classList.add("is-best");

    const rank = document.createElement("td");
    rank.textContent = String(index + 1);

    const name = document.createElement("td");
    name.textContent = entry.name;

    const best = document.createElement("td");
    best.textContent = formatDistance(entry.best);

    const attempts = document.createElement("td");
    attempts.textContent = String(entry.attempts);

    const status = document.createElement("td");
    if (index === 0) status.innerHTML = tagHtml("Leading");

    tr.append(rank, name, best, attempts, status);
    tbodyEl.appendChild(tr);
  });

  console.log("[shotput] leaderboard rendered:", rows.length, "athlete(s) from", throws.length, "throw(s)");
}

/* =========================================================
   FIELD GEOMETRY
   The sector half-angle (17.46°) is half of the real 34.92°
   shot put sector used in competition.
   ========================================================= */

const FIELD = {
  originX: 100,
  originY: 210,
  halfAngleDeg: 17.46,
  maxDistance: 30,
  maxRadius: 660,
};
const SCALE = FIELD.maxRadius / FIELD.maxDistance; // pixels per metre
const RING_DISTANCES = [5, 10, 15, 20, 25];
const VIEW_W = 900;
const VIEW_H = 420;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function pointAtRadius(radiusPx, angleDeg) {
  const theta = toRadians(angleDeg);
  return {
    x: FIELD.originX + radiusPx * Math.cos(theta),
    y: FIELD.originY + radiusPx * Math.sin(theta),
  };
}

function fieldPoint(distanceMetres, angleDeg) {
  return pointAtRadius(distanceMetres * SCALE, angleDeg);
}

function ringPath(distanceMetres) {
  const r = distanceMetres * SCALE;
  const p1 = fieldPoint(distanceMetres, -FIELD.halfAngleDeg);
  const p2 = fieldPoint(distanceMetres, FIELD.halfAngleDeg);
  return "M " + p1.x.toFixed(1) + " " + p1.y.toFixed(1) +
    " A " + r.toFixed(1) + " " + r.toFixed(1) + " 0 0 1 " +
    p2.x.toFixed(1) + " " + p2.y.toFixed(1);
}

// Draws the turf, apron, sector lines, distance rings and the
// throwing circle into the <g id="field-graphic"> placeholder.
function buildField(graphic) {
  graphic.innerHTML = "";

  graphic.appendChild(svgEl("rect", { class: "grass", x: 0, y: 0, width: VIEW_W, height: VIEW_H }));
  graphic.appendChild(svgEl("rect", { class: "apron", x: 0, y: 0, width: FIELD.originX + 45, height: VIEW_H }));

  // Sector boundary lines, extended past the last ring.
  const edgeR = FIELD.maxRadius + 100;
  [-FIELD.halfAngleDeg, FIELD.halfAngleDeg].forEach((angle) => {
    const p = pointAtRadius(edgeR, angle);
    graphic.appendChild(svgEl("line", {
      class: "sector-line",
      x1: FIELD.originX, y1: FIELD.originY,
      x2: p.x.toFixed(1), y2: p.y.toFixed(1),
    }));
  });

  RING_DISTANCES.forEach((d, index) => {
    const isFar = index === RING_DISTANCES.length - 1;
    graphic.appendChild(svgEl("path", { class: isFar ? "ring ring-far" : "ring", d: ringPath(d) }));

    const labelPoint = fieldPoint(d, 0);
    const label = svgEl("text", {
      class: isFar ? "ring-label ring-label-far" : "ring-label",
      x: labelPoint.x.toFixed(1),
      y: (FIELD.originY - 10).toFixed(1),
    });
    label.textContent = d + "m";
    graphic.appendChild(label);
  });

  graphic.appendChild(svgEl("circle", {
    class: "throw-circle", cx: FIELD.originX, cy: FIELD.originY, r: 26,
  }));
  graphic.appendChild(svgEl("line", {
    class: "toe-line",
    x1: FIELD.originX, y1: FIELD.originY - 30,
    x2: FIELD.originX, y2: FIELD.originY + 30,
  }));

  const startLabel = svgEl("text", {
    class: "start-label", x: FIELD.originX, y: FIELD.originY - 42,
  });
  startLabel.textContent = "START";
  graphic.appendChild(startLabel);

  graphic.appendChild(svgEl("rect", {
    class: "field-border", x: 3, y: 3, width: VIEW_W - 6, height: VIEW_H - 6, rx: 10,
  }));
}

/* =========================================================
   FIELD VIEW
   ========================================================= */

function initFieldView() {
  const form = document.getElementById("throw-form");
  if (!form) {
    console.log("[shotput] no throw form on this page - skipping Field View init");
    return;
  }
  console.log("[shotput] initialising Field View...");

  const nameInput = document.getElementById("athlete-name");
  const distanceInput = document.getElementById("distance-input");
  const stepDown = document.getElementById("distance-step-down");
  const stepUp = document.getElementById("distance-step-up");
  const errorEl = document.getElementById("distance-error");
  const resultEl = document.getElementById("throw-result");
  const motionNoteEl = document.getElementById("motion-note");
  const throwButton = form.querySelector('button[type="submit"]');

  const fieldGraphic = document.getElementById("field-graphic");
  const markersLayer = document.getElementById("markers-layer");
  const flightLayer = document.getElementById("flight-layer");
  const shotBall = document.getElementById("shot-ball");
  const shotShadow = document.getElementById("shot-shadow");
  const trailLine = document.getElementById("trail-line");

  const leaderboardTbody = document.getElementById("leaderboard-tbody");
  const leaderboardTable = document.getElementById("leaderboard-table");
  const leaderboardEmpty = document.getElementById("leaderboard-empty");

  // Fail loudly if the HTML and this file have drifted apart.
  const required = { fieldGraphic, markersLayer, flightLayer, shotBall, shotShadow, trailLine, distanceInput, errorEl, resultEl };
  Object.entries(required).forEach(([key, el]) => {
    if (!el) throw new Error("Field View is missing required element: " + key);
  });

  buildField(fieldGraphic);
  console.log("[shotput] field built:", fieldGraphic.childNodes.length, "shapes drawn");

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  console.log("[shotput] prefers-reduced-motion:", prefersReducedMotion);
  if (prefersReducedMotion && motionNoteEl) motionNoteEl.hidden = false;

  // Every throw the server knows about, kept here so markers can be
  // redrawn. Each gets an angle so it keeps the same spot on the field.
  let throws = [];
  let isAnimating = false;

  nameInput.value = getAthleteNameHint();

  /* ---------- Landing markers: one dot per throw, kept permanently ---------- */

  function renderMarkers(newestId) {
    markersLayer.innerHTML = "";
    if (throws.length === 0) return;

    const bestDistance = Math.max(...throws.map((t) => t.distance));

    throws.forEach((record) => {
      const isBest = record.distance === bestDistance;
      const isNewest = record.id === newestId;
      const point = fieldPoint(record.distance, record.angle);

      const g = svgEl("g", {
        class: "throw-marker" + (isBest ? " is-best" : "") + (isNewest ? " is-newest" : ""),
      });

      // Native SVG tooltip - hovering a dot says who threw it.
      const title = svgEl("title", {});
      title.textContent = record.athleteName + " — " + formatDistance(record.distance);
      g.appendChild(title);

      g.appendChild(svgEl("circle", {
        class: "marker-dot",
        cx: point.x.toFixed(1), cy: point.y.toFixed(1),
        r: isBest ? 8 : 6,
      }));

      if (isBest) {
        const star = svgEl("text", {
          class: "marker-star",
          x: point.x.toFixed(1), y: (point.y - 13).toFixed(1),
        });
        star.textContent = "★";
        g.appendChild(star);
      }

      markersLayer.appendChild(g);
    });
  }

  function pulseLanding(point) {
    const ring = svgEl("circle", {
      class: "landing-pulse",
      cx: point.x.toFixed(1), cy: point.y.toFixed(1), r: 6,
    });
    markersLayer.appendChild(ring);
    ring.addEventListener("animationend", () => ring.remove());
  }

  /* ---------- Flight ---------- */

  function setFlightVisible(visible) {
    flightLayer.style.opacity = visible ? "1" : "0";
  }

  function positionFlightAtOrigin() {
    shotBall.setAttribute("cx", FIELD.originX);
    shotBall.setAttribute("cy", FIELD.originY);
    shotShadow.setAttribute("cx", FIELD.originX);
    shotShadow.setAttribute("cy", FIELD.originY);
    trailLine.setAttribute("x1", FIELD.originX);
    trailLine.setAttribute("y1", FIELD.originY);
    trailLine.setAttribute("x2", FIELD.originX);
    trailLine.setAttribute("y2", FIELD.originY);
  }

  // A small random angle inside the legal sector, so throws don't all
  // stack on one line. It never affects the DISTANCE, which is always
  // exactly what was typed and is always shown as text.
  function randomAngle() {
    const limit = FIELD.halfAngleDeg - 2.5;
    return (Math.random() * 2 - 1) * limit;
  }

  function animateThrow(record, onDone) {
    isAnimating = true;
    if (throwButton) throwButton.disabled = true;
    setFlightVisible(true);

    const duration = Math.min(1800, 850 + record.distance * 28);
    let start = null;
    let frames = 0;
    console.log("[shotput] animating", record.distance, "m over ~" + Math.round(duration) + "ms");

    function frame(timestamp) {
      if (!start) start = timestamp;
      frames++;
      const progress = Math.min((timestamp - start) / duration, 1);

      // Constant travel speed along the ground, plus a parabolic
      // "height" factor used only to grow the ball and shrink its
      // shadow - a top-down way of showing the shot arcing upward.
      const distanceSoFar = record.distance * progress;
      const point = fieldPoint(distanceSoFar, record.angle);
      const height = 4 * progress * (1 - progress);

      shotBall.setAttribute("cx", point.x.toFixed(1));
      shotBall.setAttribute("cy", point.y.toFixed(1));
      shotBall.setAttribute("r", (8 + height * 7).toFixed(1));

      shotShadow.setAttribute("cx", point.x.toFixed(1));
      shotShadow.setAttribute("cy", point.y.toFixed(1));
      shotShadow.setAttribute("rx", (7 - height * 3).toFixed(1));
      shotShadow.setAttribute("ry", (3.5 - height * 1.5).toFixed(1));
      shotShadow.style.opacity = (0.5 - height * 0.28).toFixed(2);

      trailLine.setAttribute("x2", point.x.toFixed(1));
      trailLine.setAttribute("y2", point.y.toFixed(1));

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        console.log("[shotput] animation done after", frames, "frames");
        isAnimating = false;
        if (throwButton) throwButton.disabled = false;
        renderMarkers(record.id);
        pulseLanding(point);
        setTimeout(() => setFlightVisible(false), 300);
        if (onDone) onDone();
      }
    }

    requestAnimationFrame(frame);
  }

  /* ---------- Validation & messages ---------- */

  function showError(message) {
    errorEl.textContent = message;
    distanceInput.setAttribute("aria-invalid", "true");
    distanceInput.focus();
  }

  function clearError() {
    errorEl.textContent = "";
    distanceInput.removeAttribute("aria-invalid");
  }

  function announceResult(record) {
    const entry = buildLeaderboard(throws).find((e) => e.name === record.athleteName);
    const isPersonalBest = entry && entry.best === record.distance;
    resultEl.textContent =
      record.athleteName + " — throw recorded: " + formatDistance(record.distance) +
      (isPersonalBest ? " — new personal best!" : "");
    resultEl.classList.add("is-recorded");
  }

  /* ---------- Load whatever is already on the server ---------- */

  async function loadExistingThrows() {
    try {
      const serverThrows = await apiGetThrows();
      // Give each existing throw a stable angle so its marker doesn't
      // jump around every time the page is reloaded.
      throws = serverThrows.map((t) => ({ ...t, angle: randomAngle() }));
      renderMarkers(null);
      renderLeaderboardTable(leaderboardTbody, leaderboardTable, leaderboardEmpty, throws);
      console.log("[shotput] loaded", throws.length, "existing throw(s) from server");
    } catch (err) {
      console.error("[shotput] could not load throws:", err);
      showFatalErrorBanner("Could not load existing throws: " + err.message);
    }
  }

  /* ---------- Events ---------- */

  function stepDistance(delta) {
    const current = Number(distanceInput.value) || 0;
    const next = Math.max(0, Math.round((current + delta) * 100) / 100);
    distanceInput.value = next.toFixed(2);
  }

  if (stepDown) stepDown.addEventListener("click", () => stepDistance(-0.1));
  if (stepUp) stepUp.addEventListener("click", () => stepDistance(0.1));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isAnimating) return; // don't queue throws on top of each other
    console.log("[shotput] form submitted");
    clearError();

    const raw = distanceInput.value.trim();
    if (raw === "") return showError("Enter a throw distance before recording.");

    const distance = Number(raw);
    if (Number.isNaN(distance)) return showError("Enter numbers only, for example 12.50.");
    if (distance <= 0) return showError("Enter a distance greater than 0 metres.");
    if (distance > FIELD.maxDistance) {
      return showError("Enter a realistic distance of " + FIELD.maxDistance + " metres or less.");
    }

    const name = nameInput.value.trim() || "Athlete " + (throws.length + 1);

    try {
      // Save to the server FIRST, so nothing is ever animated for a
      // throw that wasn't actually recorded.
      const saved = await apiAddThrow(name, distance);
      console.log("[shotput] saved to server:", saved);
      setAthleteNameHint(name);

      const record = { ...saved, angle: randomAngle() };
      throws.push(record);

      // Update the text result and leaderboard straight away - they
      // must never depend on the animation finishing (or running).
      announceResult(record);
      renderLeaderboardTable(leaderboardTbody, leaderboardTable, leaderboardEmpty, throws);

      if (prefersReducedMotion) {
        renderMarkers(record.id);
      } else {
        positionFlightAtOrigin();
        animateThrow(record);
      }

      distanceInput.value = "";
    } catch (err) {
      console.error("[shotput] could not record throw:", err);
      showError(err.message || "Something went wrong recording that throw.");
    }
  });

  /* ---------- Start ---------- */

  positionFlightAtOrigin();
  setFlightVisible(false);
  loadExistingThrows();
}

/* =========================================================
   RESULTS VIEW
   ========================================================= */

function initResultsView() {
  const leaderboardTbody = document.getElementById("leaderboard-tbody");
  const throwTbody = document.getElementById("throw-tbody");
  if (!throwTbody) return; // not the results page

  console.log("[shotput] initialising Results View...");

  const leaderboardTable = document.getElementById("leaderboard-table");
  const leaderboardEmpty = document.getElementById("leaderboard-empty");
  const throwTable = document.getElementById("throw-table");
  const emptyState = document.getElementById("empty-state");
  const summaryAthletes = document.getElementById("summary-athletes");
  const summaryCount = document.getElementById("summary-count");
  const summaryCurrent = document.getElementById("summary-current");
  const summaryBest = document.getElementById("summary-best");
  const clearBtn = document.getElementById("clear-throws");

  async function render() {
    let throws = [];
    try {
      throws = await apiGetThrows();
    } catch (err) {
      console.error("[shotput] could not load throws:", err);
      showFatalErrorBanner("Could not load throws: " + err.message);
      return;
    }

    const board = buildLeaderboard(throws);
    const overallBest = board.length ? board[0] : null;

    if (summaryAthletes) summaryAthletes.textContent = String(board.length);
    if (summaryCount) summaryCount.textContent = String(throws.length);
    if (summaryCurrent) {
      summaryCurrent.textContent = throws.length
        ? formatDistance(throws[throws.length - 1].distance)
        : "—";
    }
    if (summaryBest) {
      summaryBest.textContent = overallBest
        ? formatDistance(overallBest.best) + " (" + overallBest.name + ")"
        : "—";
    }

    renderLeaderboardTable(leaderboardTbody, leaderboardTable, leaderboardEmpty, throws);

    // Full chronological log - every single attempt, nothing dropped.
    throwTbody.innerHTML = "";
    if (throws.length === 0) {
      if (throwTable) throwTable.hidden = true;
      if (emptyState) emptyState.hidden = false;
      return;
    }
    if (throwTable) throwTable.hidden = false;
    if (emptyState) emptyState.hidden = true;

    const bestByAthlete = new Map(board.map((e) => [e.name, e.best]));

    throws.forEach((t, index) => {
      const tr = document.createElement("tr");
      const isPersonalBest = bestByAthlete.get(t.athleteName) === t.distance;
      if (isPersonalBest) tr.classList.add("is-best");

      const num = document.createElement("td");
      num.textContent = String(index + 1);

      const name = document.createElement("td");
      name.textContent = t.athleteName;

      const dist = document.createElement("td");
      dist.textContent = formatDistance(t.distance);

      const status = document.createElement("td");
      if (isPersonalBest) status.innerHTML = tagHtml("Personal best");

      tr.append(num, name, dist, status);
      throwTbody.appendChild(tr);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      if (!window.confirm("Clear all recorded throws? This cannot be undone.")) return;
      try {
        await apiClearThrows();
        render();
      } catch (err) {
        console.error("[shotput] could not clear throws:", err);
        window.alert(err.message || "Could not clear throws.");
      }
    });
  }

  render();
}

/* ---------- Start everything ---------- */

document.addEventListener("DOMContentLoaded", () => {
  console.log("[shotput] DOMContentLoaded - initialising");
  try {
    renderUserBadge();
    initFieldView();
    initResultsView();
    console.log("[shotput] init complete");
  } catch (err) {
    console.error("[shotput] init failed:", err);
    showFatalErrorBanner(err.message);
  }
});