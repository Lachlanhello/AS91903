/* =========================================================
   Shot Put Field Tool — app.js
   Handles: throw storage (shared between Field View and
   Results View via localStorage), input validation, the
   field diagram + throw animation, and the results table.
   This file is browser-only client code, loaded via a
   <script> tag - it has no server logic in it.
   ========================================================= */

const STORAGE_KEY = "shotput_throws";
const NAME_KEY = "shotput_athlete";

/* ---------- Storage helpers ---------- */

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

function addThrow(distance) {
  const throws = getThrows();
  throws.push({ distance: distance, recordedAt: new Date().toISOString() });
  saveThrows(throws);
  return throws;
}

function clearThrows() {
  saveThrows([]);
}

function getBest(throws) {
  if (throws.length === 0) return null;
  return throws.reduce((best, t) => (t.distance > best.distance ? t : best), throws[0]);
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

/* =========================================================
   Field geometry
   Every distance <-> position conversion in this file (the
   static rings, the flying shot, and the landing marker) is
   worked out from this one FIELD object. That way the picture
   and the maths can never disagree about where a distance sits.
   The half-angle below (17.46°) is half of the real 34.92°
   shot put sector used in competition.
   ========================================================= */

const FIELD = {
  originX: 92,
  originY: 190,
  halfAngleDeg: 17.46,
  maxDistance: 30,  // matches the validation limit further down
  maxRadius: 460,   // pixels, chosen to fit the 640-wide viewBox
};
const SCALE = FIELD.maxRadius / FIELD.maxDistance; // pixels per metre
const RING_DISTANCES = [5, 10, 15, 20, 25];
const SVG_NS = "http://www.w3.org/2000/svg";

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

// A point at a given pixel radius and angle from the throwing circle.
function pointAtRadius(radiusPx, angleDeg) {
  const theta = toRadians(angleDeg);
  return {
    x: FIELD.originX + radiusPx * Math.cos(theta),
    y: FIELD.originY + radiusPx * Math.sin(theta),
  };
}

// The point that a given real-world distance and angle map to on screen.
function fieldPoint(distanceMetres, angleDeg) {
  return pointAtRadius(distanceMetres * SCALE, angleDeg);
}

// An SVG arc path for the ring at a given distance, spanning the sector.
function ringPath(distanceMetres) {
  const r = distanceMetres * SCALE;
  const p1 = fieldPoint(distanceMetres, -FIELD.halfAngleDeg);
  const p2 = fieldPoint(distanceMetres, FIELD.halfAngleDeg);
  return "M " + p1.x.toFixed(1) + " " + p1.y.toFixed(1) +
    " A " + r.toFixed(1) + " " + r.toFixed(1) + " 0 0 1 " +
    p2.x.toFixed(1) + " " + p2.y.toFixed(1);
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

// Draws the grass, apron, sector lines, distance rings and throwing
// circle into the <g id="field-graphic"> placeholder in field.html.
function buildField(graphic) {
  graphic.innerHTML = "";

  graphic.appendChild(svgEl("rect", { class: "grass", x: 0, y: 0, width: 640, height: 380 }));
  graphic.appendChild(svgEl("rect", { class: "apron", x: 0, y: 0, width: FIELD.originX + 46, height: 380 }));

  const edgeRadius = FIELD.maxRadius + 60;
  [-FIELD.halfAngleDeg, FIELD.halfAngleDeg].forEach((angle) => {
    const p = pointAtRadius(edgeRadius, angle);
    graphic.appendChild(svgEl("line", {
      class: "sector-line",
      x1: FIELD.originX, y1: FIELD.originY,
      x2: p.x.toFixed(1), y2: p.y.toFixed(1),
    }));
  });

  RING_DISTANCES.forEach((distance, index) => {
    const isFurthest = index === RING_DISTANCES.length - 1;
    graphic.appendChild(svgEl("path", {
      class: isFurthest ? "ring ring-far" : "ring",
      d: ringPath(distance),
    }));
    const labelPoint = fieldPoint(distance, 0);
    const label = svgEl("text", {
      class: isFurthest ? "ring-label ring-label-far" : "ring-label",
      x: labelPoint.x.toFixed(1),
      y: (FIELD.originY - 10).toFixed(1),
    });
    label.textContent = distance + " m";
    graphic.appendChild(label);
  });

  graphic.appendChild(svgEl("circle", {
    class: "throw-circle",
    cx: FIELD.originX, cy: FIELD.originY, r: 24,
  }));
  graphic.appendChild(svgEl("line", {
    class: "toe-line",
    x1: FIELD.originX, y1: FIELD.originY - 24,
    x2: FIELD.originX, y2: FIELD.originY + 24,
  }));
  graphic.appendChild(svgEl("rect", {
    class: "field-border",
    x: 2, y: 2, width: 636, height: 376, rx: 16,
  }));
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

  const fieldGraphic = document.getElementById("field-graphic");
  const shot = document.getElementById("shot");
  const shotShadow = document.getElementById("shot-shadow");
  const trailLine = document.getElementById("trail-line");
  const landingPulse = document.getElementById("landing-pulse");
  const landingLabel = document.getElementById("landing-label");

  buildField(fieldGraphic);

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Restore saved athlete name
  nameInput.value = getAthleteName();
  nameInput.addEventListener("input", () => setAthleteName(nameInput.value.trim()));

  function positionAtOrigin() {
    shot.setAttribute("cx", FIELD.originX);
    shot.setAttribute("cy", FIELD.originY);
    shotShadow.setAttribute("cx", FIELD.originX);
    shotShadow.setAttribute("cy", FIELD.originY);
    trailLine.setAttribute("x1", FIELD.originX);
    trailLine.setAttribute("y1", FIELD.originY);
    trailLine.setAttribute("x2", FIELD.originX);
    trailLine.setAttribute("y2", FIELD.originY);
  }
  positionAtOrigin();

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

  function finishThrow(distance, point) {
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

    addThrow(distance);
    const best = getBest(getThrows());
    const isNewBest = Boolean(best) && best.distance === distance;

    resultEl.textContent = "Throw recorded: " + formatDistance(distance) +
      (isNewBest ? " — new personal best!" : "");
    resultEl.classList.add("is-recorded");
  }

  function animateThrow(distance) {
    const angle = randomAngle();
    const targetPoint = fieldPoint(distance, angle);

    // Respect the person's reduced-motion preference: skip the moving
    // animation entirely and go straight to the result.
    if (prefersReducedMotion) {
      finishThrow(distance, targetPoint);
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
        finishThrow(distance, targetPoint);
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

    animateThrow(distance);
  });
}

/* ---------- Results View ---------- */

function initResultsView() {
  const tbody = document.getElementById("throw-tbody");
  if (!tbody) return; // Not on this page

  const emptyState = document.getElementById("empty-state");
  const table = document.getElementById("throw-table");
  const summaryAthlete = document.getElementById("summary-athlete");
  const summaryCount = document.getElementById("summary-count");
  const summaryCurrent = document.getElementById("summary-current");
  const summaryBest = document.getElementById("summary-best");
  const clearBtn = document.getElementById("clear-throws");

  function render() {
    const throws = getThrows();
    const best = getBest(throws);
    const name = getAthleteName();

    summaryAthlete.textContent = name || "Not set";
    summaryCount.textContent = String(throws.length);
    summaryCurrent.textContent = throws.length
      ? formatDistance(throws[throws.length - 1].distance)
      : "—";
    summaryBest.textContent = best ? formatDistance(best.distance) : "—";

    tbody.innerHTML = "";

    if (throws.length === 0) {
      table.hidden = true;
      emptyState.hidden = false;
      return;
    }

    table.hidden = false;
    emptyState.hidden = true;

    throws.forEach((t, index) => {
      const row = document.createElement("tr");
      const isBest = best && t.distance === best.distance;
      if (isBest) row.classList.add("is-best");

      const numCell = document.createElement("td");
      numCell.textContent = String(index + 1);

      const distCell = document.createElement("td");
      distCell.textContent = formatDistance(t.distance);

      const bestCell = document.createElement("td");
      if (isBest) {
        bestCell.innerHTML =
          '<span class="best-tag"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" ' +
          'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M8 21h8M12 17v4M7 4h10l-1 8a4 4 0 0 1-8 0L7 4Z"/>' +
          '<path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/></svg>Personal best</span>';
      } else {
        bestCell.textContent = "";
      }

      row.append(numCell, distCell, bestCell);
      tbody.appendChild(row);
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