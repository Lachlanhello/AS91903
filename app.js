/* =========================================================
   Shot Put Field Tool — app.js
   Handles: throw storage (shared between Field View and
   Results View via localStorage), input validation, the
   throw animation, and the leaderboard.

   The field diagram itself (grass, apron, sector lines, rings,
   throw circle) is plain static SVG markup in field.html - it
   is NOT built by this script. Only the moving parts (the shot,
   its shadow, its trail, and the landing marker) are controlled
   here. This means the field always renders correctly even if
   a script error happens elsewhere; only the animation depends
   on JavaScript running.

   This file is browser-only client code, loaded via a
   <script> tag - it has no server logic in it.
   ========================================================= */

const STORAGE_KEY = "shotput_throws";
const NAME_KEY = "shotput_athlete";

/* ---------- Storage helpers ----------
   Each recorded throw stores the athlete's name alongside the
   distance, so results can be grouped into a real leaderboard
   instead of one long undifferentiated list. */

function getThrows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Could not read saved throws:", err);
    return [];
  }
}

function saveThrows(throws) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(throws));
  } catch (err) {
    console.error("Could not save throws:", err);
  }
}

function addThrow(name, distance) {
  const throws = getThrows();
  throws.push({ name: name, distance: distance, recordedAt: new Date().toISOString() });
  saveThrows(throws);
  return throws;
}

function clearThrows() {
  saveThrows([]);
}

// The single best throw across everyone.
function getBest(throws) {
  if (throws.length === 0) return null;
  return throws.reduce((best, t) => (t.distance > best.distance ? t : best), throws[0]);
}

// The best throw belonging to one specific athlete, so "personal
// best" on Field View is scoped to that athlete, not the whole field.
function getBestForAthlete(throws, name) {
  const mine = throws.filter((t) => t.name === name);
  return getBest(mine);
}

// Groups every throw by athlete name and ranks them by their best
// distance - this is the actual leaderboard shown on Field View
// and Results.
function buildLeaderboard(throws) {
  const byName = new Map();
  throws.forEach((t) => {
    if (!byName.has(t.name)) {
      byName.set(t.name, { name: t.name, best: t.distance, attempts: 1 });
    } else {
      const entry = byName.get(t.name);
      entry.attempts += 1;
      if (t.distance > entry.best) entry.best = t.distance;
    }
  });
  return Array.from(byName.values()).sort((a, b) => b.best - a.best);
}

function getAthleteName() {
  return localStorage.getItem(NAME_KEY) || "";
}

function setAthleteName(name) {
  localStorage.setItem(NAME_KEY, name);
}

function formatDistance(value) {
  return value.toFixed(2) + " m";
}

function leadingTagHtml(label) {
  return '<span class="best-tag"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 21h8M12 17v4M7 4h10l-1 8a4 4 0 0 1-8 0L7 4Z"/>' +
    '<path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/></svg>' + label + '</span>';
}

// Shared leaderboard table renderer, used by BOTH the compact
// leaderboard on Field View (updated live after every throw) and
// the full leaderboard on Results (rendered once per page load).
// Keeping this in one place means the two can never drift apart.
function renderLeaderboardTable(tbodyEl, tableEl, emptyEl, throws) {
  if (!tbodyEl) return;

  const leaderboard = buildLeaderboard(throws);
  tbodyEl.innerHTML = "";

  if (leaderboard.length === 0) {
    if (tableEl) tableEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (tableEl) tableEl.hidden = false;
  if (emptyEl) emptyEl.hidden = true;

  leaderboard.forEach((entry, index) => {
    const row = document.createElement("tr");
    const isLeader = index === 0;
    if (isLeader) row.classList.add("is-best");

    const rankCell = document.createElement("td");
    rankCell.textContent = String(index + 1);

    const nameCell = document.createElement("td");
    nameCell.textContent = entry.name;

    const bestCell = document.createElement("td");
    bestCell.textContent = formatDistance(entry.best);

    const attemptsCell = document.createElement("td");
    attemptsCell.textContent = String(entry.attempts);

    const tagCell = document.createElement("td");
    tagCell.innerHTML = isLeader ? leadingTagHtml("Leading") : "";

    row.append(rankCell, nameCell, bestCell, attemptsCell, tagCell);
    tbodyEl.appendChild(row);
  });
}

/* =========================================================
   Field geometry
   Used only to work out where the shot should travel to for a
   given distance. The static field diagram in field.html was
   hand-drawn to match these exact same numbers, so the picture
   and the maths always agree on where a distance sits. The
   half-angle below (17.46°) is half of the real 34.92° shot put
   sector used in competition.
   ========================================================= */

const FIELD = {
  originX: 92,
  originY: 230,
  halfAngleDeg: 17.46,
  maxDistance: 30, // matches the validation limit further down
};
const MAX_RADIUS = 560; // pixels - matches field.html's static markup
const SCALE = MAX_RADIUS / FIELD.maxDistance; // pixels per metre

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function fieldPoint(distanceMetres, angleDeg) {
  const theta = toRadians(angleDeg);
  const radiusPx = distanceMetres * SCALE;
  return {
    x: FIELD.originX + radiusPx * Math.cos(theta),
    y: FIELD.originY + radiusPx * Math.sin(theta),
  };
}

/* ---------- Field View ---------- */

function initFieldView() {
  const form = document.getElementById("throw-form");
  if (!form) return; // Not on this page

  const nameInput = document.getElementById("athlete-name");
  const distanceInput = document.getElementById("distance-input");
  const stepDown = document.getElementById("distance-step-down");
  const stepUp = document.getElementById("distance-step-up");
  const errorEl = document.getElementById("distance-error");
  const resultEl = document.getElementById("throw-result");
  const motionNoteEl = document.getElementById("motion-note");

  const shot = document.getElementById("shot");
  const shotShadow = document.getElementById("shot-shadow");
  const trailLine = document.getElementById("trail-line");
  const landingPulse = document.getElementById("landing-pulse");
  const landingLabel = document.getElementById("landing-label");

  const leaderboardTbody = document.getElementById("leaderboard-tbody");
  const leaderboardTable = document.getElementById("leaderboard-table");
  const leaderboardEmpty = document.getElementById("leaderboard-empty");

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Let the person know *why* the shot isn't animating, rather than
  // leaving it looking broken - this is read from the OS/browser
  // "reduce motion" accessibility setting, not a bug.
  if (motionNoteEl && prefersReducedMotion) {
    motionNoteEl.hidden = false;
  }

  // Restore saved athlete name
  nameInput.value = getAthleteName();
  nameInput.addEventListener("input", () => setAthleteName(nameInput.value.trim()));

  // Show whatever leaderboard state already exists (e.g. from a
  // previous visit) as soon as the page loads.
  renderLeaderboardTable(leaderboardTbody, leaderboardTable, leaderboardEmpty, getThrows());

  // A small random angle within the legal sector, used purely so the
  // shot doesn't land in exactly the same spot every time. It never
  // changes the distance value - that always comes from what the user
  // typed, and is always shown as exact text regardless of the angle.
  function randomAngle() {
    const margin = 2;
    const limit = FIELD.halfAngleDeg - margin;
    return (Math.random() * 2 - 1) * limit;
  }

  function showError(message) {
    errorEl.textContent = message;
    distanceInput.setAttribute("aria-invalid", "true");
    distanceInput.focus();
  }

  function clearError() {
    errorEl.textContent = "";
    distanceInput.removeAttribute("aria-invalid");
  }

  function showLandingPulse(point) {
    landingPulse.setAttribute("cx", point.x.toFixed(1));
    landingPulse.setAttribute("cy", point.y.toFixed(1));
    landingPulse.classList.remove("is-pulsing");
    void landingPulse.getBoundingClientRect(); // restart the CSS animation
    landingPulse.classList.add("is-pulsing");
  }

  function resolveAthleteName() {
    const typed = nameInput.value.trim();
    if (typed) return typed;
    const fallback = "Athlete " + (getThrows().length + 1);
    nameInput.value = fallback;
    return fallback;
  }

  function finishThrow(name, distance, point) {
    shot.setAttribute("cx", point.x.toFixed(1));
    shot.setAttribute("cy", point.y.toFixed(1));
    shot.setAttribute("r", 9);

    shotShadow.setAttribute("cx", point.x.toFixed(1));
    shotShadow.setAttribute("cy", point.y.toFixed(1));
    shotShadow.setAttribute("rx", 8);
    shotShadow.setAttribute("ry", 4);
    shotShadow.style.opacity = "0.45";

    trailLine.setAttribute("x2", point.x.toFixed(1));
    trailLine.setAttribute("y2", point.y.toFixed(1));
    trailLine.classList.add("is-visible");

    landingLabel.setAttribute("x", (point.x + 12).toFixed(1));
    landingLabel.setAttribute("y", (point.y + 4).toFixed(1));
    landingLabel.textContent = formatDistance(distance);
    landingLabel.classList.add("is-visible");

    showLandingPulse(point);

    addThrow(name, distance);
    const ownBest = getBestForAthlete(getThrows(), name);
    const isOwnBest = Boolean(ownBest) && ownBest.distance === distance;

    resultEl.textContent = name + " — throw recorded: " + formatDistance(distance) +
      (isOwnBest ? " — new personal best!" : "");
    resultEl.classList.add("is-recorded");

    // Update the on-page leaderboard immediately, without navigating away.
    renderLeaderboardTable(leaderboardTbody, leaderboardTable, leaderboardEmpty, getThrows());
  }

  function animateThrow(name, distance) {
    const angle = randomAngle();
    const targetPoint = fieldPoint(distance, angle);

    // Respect the person's reduced-motion preference: skip the moving
    // animation entirely and go straight to the result.
    if (prefersReducedMotion) {
      finishThrow(name, distance, targetPoint);
      return;
    }

    const duration = Math.min(1600, 750 + distance * 26);
    let start = null;

    function frame(timestamp) {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const distanceSoFar = distance * progress;
      const point = fieldPoint(distanceSoFar, angle);
      // A small parabolic "hop" used only for the visual height of the
      // ball and its shadow - it has no effect on the measured distance.
      const hop = 4 * progress * (1 - progress);

      shot.setAttribute("cx", point.x.toFixed(1));
      shot.setAttribute("cy", point.y.toFixed(1));
      shot.setAttribute("r", (9 + hop * 6).toFixed(1));

      shotShadow.setAttribute("cx", point.x.toFixed(1));
      shotShadow.setAttribute("cy", point.y.toFixed(1));
      shotShadow.setAttribute("rx", (8 - hop * 3).toFixed(1));
      shotShadow.setAttribute("ry", (4 - hop * 1.5).toFixed(1));
      shotShadow.style.opacity = (0.45 - hop * 0.25).toFixed(2);

      trailLine.setAttribute("x2", point.x.toFixed(1));
      trailLine.setAttribute("y2", point.y.toFixed(1));
      trailLine.classList.add("is-visible");

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        finishThrow(name, distance, targetPoint);
      }
    }

    requestAnimationFrame(frame);
  }

  function stepDistance(delta) {
    const current = Number(distanceInput.value) || 0;
    const next = Math.max(0, Math.round((current + delta) * 100) / 100);
    distanceInput.value = next.toFixed(2);
  }

  if (stepDown) stepDown.addEventListener("click", () => stepDistance(-0.1));
  if (stepUp) stepUp.addEventListener("click", () => stepDistance(0.1));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();

    const raw = distanceInput.value.trim();

    if (raw === "") {
      showError("Enter a throw distance before recording.");
      return;
    }

    const distance = Number(raw);

    if (Number.isNaN(distance)) {
      showError("Enter numbers only, for example 12.50.");
      return;
    }
    if (distance <= 0) {
      showError("Enter a distance greater than 0 metres.");
      return;
    }
    if (distance > FIELD.maxDistance) {
      showError("Enter a realistic distance of " + FIELD.maxDistance + " metres or less.");
      return;
    }

    try {
      const name = resolveAthleteName();
      setAthleteName(name);
      animateThrow(name, distance);
    } catch (err) {
      // Surface unexpected errors on the page itself, not just the
      // console, so a broken throw is never silent.
      console.error("Could not record throw:", err);
      showError("Something went wrong recording that throw. Please try again.");
    }
  });
}

/* ---------- Results View / Leaderboard ---------- */

function initResultsView() {
  const clearBtn = document.getElementById("clear-throws");
  if (!clearBtn) return; // Not on this page (Field View also has a leaderboard table, but no clear button)

  const leaderboardTbody = document.getElementById("leaderboard-tbody");
  const leaderboardTable = document.getElementById("leaderboard-table");
  const leaderboardEmpty = document.getElementById("leaderboard-empty");

  const logTbody = document.getElementById("throw-tbody");
  const logTable = document.getElementById("throw-table");
  const logEmpty = document.getElementById("empty-state");

  const summaryAthletes = document.getElementById("summary-athletes");
  const summaryCount = document.getElementById("summary-count");
  const summaryCurrent = document.getElementById("summary-current");
  const summaryBest = document.getElementById("summary-best");

  function render() {
    const throws = getThrows();
    const best = getBest(throws);

    // --- Summary ---
    const distinctAthletes = new Set(throws.map((t) => t.name)).size;
    summaryAthletes.textContent = String(distinctAthletes);
    summaryCount.textContent = String(throws.length);
    summaryCurrent.textContent = throws.length
      ? formatDistance(throws[throws.length - 1].distance) + " (" + throws[throws.length - 1].name + ")"
      : "—";
    summaryBest.textContent = best ? formatDistance(best.distance) + " (" + best.name + ")" : "—";

    // --- Leaderboard: ranked by each athlete's best throw ---
    renderLeaderboardTable(leaderboardTbody, leaderboardTable, leaderboardEmpty, throws);

    // --- Full throw log: every attempt, in the order it was recorded ---
    logTbody.innerHTML = "";

    if (throws.length === 0) {
      logTable.hidden = true;
      logEmpty.hidden = false;
      return;
    }

    logTable.hidden = false;
    logEmpty.hidden = true;

    throws.forEach((t, index) => {
      const row = document.createElement("tr");
      const isBest = best && t.distance === best.distance && t.name === best.name;
      if (isBest) row.classList.add("is-best");

      const numCell = document.createElement("td");
      numCell.textContent = String(index + 1);

      const nameCell = document.createElement("td");
      nameCell.textContent = t.name;

      const distCell = document.createElement("td");
      distCell.textContent = formatDistance(t.distance);

      const bestCell = document.createElement("td");
      bestCell.innerHTML = isBest ? leadingTagHtml("Personal best") : "";

      row.append(numCell, nameCell, distCell, bestCell);
      logTbody.appendChild(row);
    });
  }

  clearBtn.addEventListener("click", () => {
    const confirmed = window.confirm(
      "Clear all recorded throws? This cannot be undone."
    );
    if (confirmed) {
      clearThrows();
      render();
    }
  });

  render();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initFieldView();
    initResultsView();
  });
}