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

async function apiAddThrow(athleteName, distance, eventId) {
  const res = await fetch("/api/throws", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ athleteName, distance, eventId }),
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


/* ---------- Events API ---------- */

async function apiGetEvents() {
  const res = await fetch("/api/events");
  if (!res.ok) throw new Error("Could not load events from the server.");
  return res.json();
}

async function apiCreateEvent(name, eventDate) {
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, eventDate }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not create that event.");
  }
  return res.json();
}

async function apiSetEventStatus(eventId, status) {
  const res = await fetch("/api/events/" + eventId + "/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not update that event.");
  }
  return res.json();
}

async function apiDeleteEvent(eventId) {
  const res = await fetch("/api/events/" + eventId, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not delete that event.");
  }
}

async function apiGetEntries(eventId) {
  const res = await fetch("/api/events/" + eventId + "/entries");
  if (!res.ok) throw new Error("Could not load entries for that event.");
  return res.json();
}

async function apiAddEntry(eventId, athleteName, ageGroup, representing) {
  const res = await fetch("/api/events/" + eventId + "/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ athleteName, ageGroup, representing }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not add that entry.");
  }
  return res.json();
}

async function apiDeleteEntry(entryId) {
  const res = await fetch("/api/entries/" + entryId, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not remove that entry.");
  }
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
    .sort((a, b) => {
      // Ranking is by distance only: highest best throw first, with no
      // name-based ordering sneaking in when two athletes tie on distance.
      if (b.best !== a.best) return b.best - a.best;
      if (b.average !== a.average) return b.average - a.average;
      return b.attempts - a.attempts;
    });
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
// throwing circle into the <g id="fieldGraphic"> placeholder.
function buildField(graphic) {
  graphic.innerHTML = "";

  graphic.appendChild(svgEl("rect", { class: "grass", x: 0, y: 0, width: VIEW_W, height: VIEW_H }));
  graphic.appendChild(svgEl("rect", { class: "apron", x: 0, y: 0, width: FIELD.originX + 45, height: VIEW_H }));

  // Sector boundary lines, extended past the last ring.
  const edgeR = FIELD.maxRadius + 130;
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
    class: "field-border", x: 3, y: 3, width: VIEW_W - 6, height: VIEW_H - 6, rx: 6,
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
  const eventSelect = document.getElementById("throw-event-select");
  const eventStatusEl = document.getElementById("throw-event-status");
  const readOnlyNote = document.getElementById("field-readonly-note");
  const throwButton = form.querySelector('button[type="submit"]');

  const fieldGraphic = document.getElementById("fieldGraphic");
  const markersLayer = document.getElementById("markersLayer");
  const flightLayer = document.getElementById("flightLayer");
  const shotBall = document.getElementById("shotBall");
  const shotShadow = document.getElementById("shotShadow");
  const trailLine = document.getElementById("trailLine");

  const leaderboardTbody = document.getElementById("leaderboard-tbody");
  const leaderboardTable = document.getElementById("leaderboard-table");
  const leaderboardEmpty = document.getElementById("leaderboard-empty");

  // Fail loudly if the HTML and this file have drifted apart.
  const required = { fieldGraphic, markersLayer, flightLayer, shotBall, shotShadow, trailLine, distanceInput, errorEl, resultEl, eventSelect };
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
  let isAdmin = false;
  let selectedEventId = "";

  nameInput.value = getAthleteNameHint();

  function setThrowControlsDisabled(disabled) {
    [nameInput, distanceInput, stepDown, stepUp, throwButton].forEach((control) => {
      if (control) control.disabled = disabled;
    });
  }

  function setEventStatus(message) {
    if (eventStatusEl) eventStatusEl.textContent = message;
  }

  async function loadFieldEvents() {
    try {
      const me = await apiGetMe();
      isAdmin = me.role === "admin";
      if (readOnlyNote) readOnlyNote.hidden = isAdmin;
      setThrowControlsDisabled(!isAdmin);

      const events = await apiGetEvents();
      eventSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = events.length ? "Select an event..." : "No events available";
      eventSelect.appendChild(placeholder);

      events.forEach((event) => {
        const option = document.createElement("option");
        option.value = String(event.id);
        option.textContent = event.name + (event.eventDate ? " — " + event.eventDate : "");
        eventSelect.appendChild(option);
      });

      if (events.length === 0) {
        setEventStatus(isAdmin
          ? "Create an event on the Events page before recording throws."
          : "No events have been created yet.");
      } else {
        setEventStatus(isAdmin
          ? "Choose the event this throw belongs to."
          : "Choose an event to view its throws.");
      }
      await loadExistingThrows();
    } catch (err) {
      console.error("[shotput] could not load Field View events:", err);
      showFatalErrorBanner("Could not load events: " + err.message);
    }
  }

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
      const eventThrows = selectedEventId
        ? serverThrows.filter((t) => String(t.eventId) === selectedEventId)
        : [];
      throws = eventThrows.map((t) => ({ ...t, angle: randomAngle() }));
      renderMarkers(null);
      renderLeaderboardTable(leaderboardTbody, leaderboardTable, leaderboardEmpty, throws);
      console.log("[shotput] loaded", throws.length, "throw(s) for event", selectedEventId || "none");
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

  eventSelect.addEventListener("change", async () => {
    selectedEventId = eventSelect.value;
    setThrowControlsDisabled(!isAdmin || !selectedEventId);
    if (selectedEventId) {
      const selected = eventSelect.options[eventSelect.selectedIndex];
      setEventStatus(isAdmin
        ? "Recording throws for " + selected.textContent + "."
        : "Viewing throws for " + selected.textContent + ".");
    } else {
      setEventStatus(isAdmin ? "Choose an event before recording a throw." : "Choose an event to view its throws.");
    }
    await loadExistingThrows();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isAnimating) return; // don't queue throws on top of each other
    console.log("[shotput] form submitted");
    clearError();

    if (!isAdmin) return showError("Only an admin can record throws.");
    if (!selectedEventId) {
      setEventStatus("Choose an event before recording a throw.");
      eventSelect.focus();
      return;
    }

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
      const saved = await apiAddThrow(name, distance, selectedEventId);
      console.log("[shotput] saved to server:", saved);
      setAthleteNameHint("");
      nameInput.value = "";

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
  setThrowControlsDisabled(true);
  loadFieldEvents();
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


/* =========================================================
   EVENTS VIEW
  Admins create/open/close/delete events and record throws. Visitors
  enter an open event with a name, age group and who they represent.
   ========================================================= */

const AGE_GROUPS = [
  { value: "junior",       label: "Junior" },
  { value: "intermediate", label: "Intermediate" },
  { value: "senior",       label: "Senior" },
];

function ageGroupLabel(value) {
  const found = AGE_GROUPS.find((g) => g.value === value);
  return found ? found.label : value;
}

function initEventsView() {
  const list = document.getElementById("events-list");
  if (!list) return; // not the events page
  console.log("[shotput] initialising Events View...");

  const emptyEl = document.getElementById("events-empty");
  const createForm = document.getElementById("create-event-form");
  const createCard = document.getElementById("create-event-card");
  const nameInput = document.getElementById("event-name");
  const dateInput = document.getElementById("event-date");
  const nameError = document.getElementById("event-name-error");
  const createStatus = document.getElementById("create-event-status");

  let isAdmin = false;

  /* ---------- One card per event ---------- */

  function buildEventCard(event) {
    const card = document.createElement("section");
    card.className = "card event-card";
    card.setAttribute("aria-labelledby", "event-heading-" + event.id);

    /* Header: name, status, date, entry count */
    const head = document.createElement("div");
    head.className = "event-head";

    const heading = document.createElement("h3");
    heading.id = "event-heading-" + event.id;
    heading.textContent = event.name;

    // Status is shown as a word, never colour alone.
    const status = document.createElement("span");
    status.className = "event-status " + (event.status === "open" ? "is-open" : "is-closed");
    status.textContent = event.status === "open" ? "Entries open" : "Entries closed";

    head.append(heading, status);

    const meta = document.createElement("p");
    meta.className = "event-meta";
    const bits = [];
    if (event.eventDate) bits.push(event.eventDate);
    bits.push(event.entryCount === 1 ? "1 entry" : event.entryCount + " entries");
    meta.textContent = bits.join(" · ");

    card.append(head, meta);

    /* Admin controls */
    if (isAdmin) {
      const controls = document.createElement("div");
      controls.className = "event-controls";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "btn btn-secondary";
      toggle.textContent = event.status === "open" ? "Close entries" : "Reopen entries";
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          await apiSetEventStatus(event.id, event.status === "open" ? "closed" : "open");
          await render();
        } catch (err) {
          window.alert(err.message);
          toggle.disabled = false;
        }
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-secondary";
      del.textContent = "Delete event";
      del.addEventListener("click", async () => {
        const ok = window.confirm(
          'Delete "' + event.name + '" and all ' + event.entryCount +
          " of its entries? This cannot be undone."
        );
        if (!ok) return;
        del.disabled = true;
        try {
          await apiDeleteEvent(event.id);
          await render();
        } catch (err) {
          window.alert(err.message);
          del.disabled = false;
        }
      });

      controls.append(toggle, del);
      card.appendChild(controls);
    }

    /* Only visitors may enter athletes. */
    if (event.status === "open" && !isAdmin) {
      card.appendChild(buildEntryForm(event));
    } else if (event.status === "open" && isAdmin) {
      const adminNote = document.createElement("p");
      adminNote.className = "hint";
      adminNote.textContent = "Admins record throws in Field View. Visitors enter athletes here.";
      card.appendChild(adminNote);
    } else {
      const closedNote = document.createElement("p");
      closedNote.className = "hint";
      closedNote.textContent = "This event is not accepting new entries.";
      card.appendChild(closedNote);
    }

    /* The entry list for this event */
    const entriesWrap = document.createElement("div");
    entriesWrap.className = "event-entries";
    entriesWrap.id = "entries-" + event.id;
    const loading = document.createElement("p");
    loading.className = "hint";
    loading.textContent = "Loading entries…";
    entriesWrap.appendChild(loading);
    card.appendChild(entriesWrap);

    loadEntries(event, entriesWrap);
    return card;
  }

  /* ---------- Entry form ---------- */

  function buildEntryForm(event) {
    const form = document.createElement("form");
    form.className = "entry-form";
    form.noValidate = true;

    const legendId = "entry-legend-" + event.id;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "entry-fieldset";
    const legend = document.createElement("legend");
    legend.id = legendId;
    legend.textContent = "Enter this event";
    fieldset.appendChild(legend);

    // --- Athlete name ---
    const nameId = "entry-name-" + event.id;
    const nameGroup = document.createElement("div");
    nameGroup.className = "field-group";
    const nameLabel = document.createElement("label");
    nameLabel.setAttribute("for", nameId);
    nameLabel.textContent = "Athlete name";
    const name = document.createElement("input");
    name.type = "text";
    name.id = nameId;
    name.maxLength = 60;
    name.autocomplete = "name";
    name.placeholder = "e.g. Jordan Smith";
    nameGroup.append(nameLabel, name);

    // --- Age group ---
    const ageId = "entry-age-" + event.id;
    const ageGroup = document.createElement("div");
    ageGroup.className = "field-group";
    const ageLabel = document.createElement("label");
    ageLabel.setAttribute("for", ageId);
    ageLabel.textContent = "Age group";
    const age = document.createElement("select");
    age.id = ageId;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose an age group…";
    age.appendChild(placeholder);
    AGE_GROUPS.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.value;
      opt.textContent = g.label;
      age.appendChild(opt);
    });
    ageGroup.append(ageLabel, age);

    // --- Representing ---
    const repId = "entry-rep-" + event.id;
    const repGroup = document.createElement("div");
    repGroup.className = "field-group";
    const repLabel = document.createElement("label");
    repLabel.setAttribute("for", repId);
    repLabel.textContent = "Representing";
    const rep = document.createElement("input");
    rep.type = "text";
    rep.id = repId;
    rep.maxLength = 60;
    rep.placeholder = "e.g. Wairarapa College";
    const repHint = document.createElement("p");
    repHint.className = "hint";
    repHint.textContent = "The school, club or team the athlete is competing for.";
    repGroup.append(repLabel, rep, repHint);

    // --- Error + submit ---
    const error = document.createElement("p");
    error.className = "error-text";
    error.setAttribute("role", "alert");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "btn btn-primary";
    submit.textContent = "Add entry";

    const result = document.createElement("p");
    result.className = "entry-result";
    result.setAttribute("aria-live", "polite");

    fieldset.append(nameGroup, ageGroup, repGroup, error, submit, result);
    form.appendChild(fieldset);

    function showError(message, focusEl) {
      error.textContent = message;
      if (focusEl) {
        focusEl.setAttribute("aria-invalid", "true");
        focusEl.focus();
      }
    }
    function clearError() {
      error.textContent = "";
      [name, age, rep].forEach((el) => el.removeAttribute("aria-invalid"));
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      clearError();

      // Validate in the order the fields appear, so focus moves to the
      // first thing that actually needs fixing.
      if (!name.value.trim()) return showError("Please enter the athlete's name.", name);
      if (!age.value)         return showError("Please choose an age group.", age);
      if (!rep.value.trim())  return showError("Please enter who the athlete is representing.", rep);

      submit.disabled = true;
      try {
        const entry = await apiAddEntry(event.id, name.value.trim(), age.value, rep.value.trim());
        console.log("[shotput] entry added:", entry);
        result.textContent =
          entry.athleteName + " entered as " + ageGroupLabel(entry.ageGroup) +
          ", representing " + entry.representing + ".";
        name.value = "";
        age.value = "";
        rep.value = "";
        await render();
      } catch (err) {
        console.error("[shotput] entry failed:", err);
        showError(err.message, name);
      } finally {
        submit.disabled = false;
      }
    });

    return form;
  }

  /* ---------- Entry list, grouped by age group ---------- */

  async function loadEntries(event, wrap) {
    let entries = [];
    try {
      entries = await apiGetEntries(event.id);
    } catch (err) {
      wrap.innerHTML = "";
      const p = document.createElement("p");
      p.className = "error-text";
      p.textContent = err.message;
      wrap.appendChild(p);
      return;
    }

    wrap.innerHTML = "";

    if (entries.length === 0) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "No entries yet.";
      wrap.appendChild(p);
      return;
    }

    const heading = document.createElement("h4");
    heading.className = "entries-heading";
    heading.textContent = "Entries (" + entries.length + ")";
    wrap.appendChild(heading);

    // One table per age group, so a coach can read off each grade at a glance.
    AGE_GROUPS.forEach((group) => {
      const inGroup = entries.filter((e) => e.ageGroup === group.value);
      if (inGroup.length === 0) return;

      const groupHeading = document.createElement("h5");
      groupHeading.className = "age-group-heading";
      groupHeading.textContent = group.label + " (" + inGroup.length + ")";

      const table = document.createElement("table");
      table.className = "entries-table";

      const caption = document.createElement("caption");
      caption.className = "visually-hidden";
      caption.textContent = group.label + " entries for " + event.name;
      table.appendChild(caption);

      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      const cols = ["Athlete", "Representing"];
      if (isAdmin) cols.push("Remove");
      cols.forEach((c) => {
        const th = document.createElement("th");
        th.scope = "col";
        if (c === "Remove") {
          const hidden = document.createElement("span");
          hidden.className = "visually-hidden";
          hidden.textContent = "Remove entry";
          th.appendChild(hidden);
        } else {
          th.textContent = c;
        }
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      inGroup.forEach((entry) => {
        const tr = document.createElement("tr");

        const nameCell = document.createElement("td");
        nameCell.textContent = entry.athleteName;

        const repCell = document.createElement("td");
        repCell.textContent = entry.representing;

        tr.append(nameCell, repCell);

        if (isAdmin) {
          const actionCell = document.createElement("td");
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "btn btn-secondary btn-small";
          remove.textContent = "Remove";
          remove.setAttribute("aria-label", "Remove " + entry.athleteName + " from " + event.name);
          remove.addEventListener("click", async () => {
            if (!window.confirm("Remove " + entry.athleteName + " from " + event.name + "?")) return;
            remove.disabled = true;
            try {
              await apiDeleteEntry(entry.id);
              await render();
            } catch (err) {
              window.alert(err.message);
              remove.disabled = false;
            }
          });
          actionCell.appendChild(remove);
          tr.appendChild(actionCell);
        }

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      wrap.append(groupHeading, table);
    });
  }

  /* ---------- Create event (admin) ---------- */

  if (createForm) {
    createForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      nameError.textContent = "";
      nameInput.removeAttribute("aria-invalid");

      const name = nameInput.value.trim();
      if (!name) {
        nameError.textContent = "Please enter a name for the event.";
        nameInput.setAttribute("aria-invalid", "true");
        nameInput.focus();
        return;
      }

      try {
        const created = await apiCreateEvent(name, dateInput.value);
        console.log("[shotput] event created:", created);
        createStatus.textContent = 'Event created: "' + created.name + '" — entries are open.';
        createStatus.classList.add("is-recorded");
        nameInput.value = "";
        dateInput.value = "";
        await render();
      } catch (err) {
        console.error("[shotput] could not create event:", err);
        nameError.textContent = err.message;
        nameInput.setAttribute("aria-invalid", "true");
      }
    });
  }

  /* ---------- Render everything ---------- */

  async function render() {
    let events = [];
    try {
      events = await apiGetEvents();
    } catch (err) {
      console.error("[shotput] could not load events:", err);
      showFatalErrorBanner("Could not load events: " + err.message);
      return;
    }

    list.innerHTML = "";
    if (events.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      console.log("[shotput] no events yet");
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    events.forEach((event) => list.appendChild(buildEventCard(event)));
    console.log("[shotput] rendered", events.length, "event(s)");
  }

  // Find out whether this user is an admin BEFORE the first render, so
  // admin controls appear on the very first paint rather than popping in.
  apiGetMe()
    .then((me) => {
      isAdmin = me.role === "admin";
      if (isAdmin && createCard) createCard.hidden = false;
      return render();
    })
    .catch((err) => {
      console.warn("[shotput] could not confirm role, rendering read-only:", err.message);
      return render();
    });
}

/* ---------- Start everything ---------- */

document.addEventListener("DOMContentLoaded", () => {
  console.log("[shotput] DOMContentLoaded - initialising");
  try {
    renderUserBadge();
    initFieldView();
    initResultsView();
    initEventsView();
    console.log("[shotput] init complete");
  } catch (err) {
    console.error("[shotput] init failed:", err);
    showFatalErrorBanner(err.message);
  }
});