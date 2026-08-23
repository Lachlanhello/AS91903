/* =========================================================
   Shot Put Field Tool — app.js
   Handles: throw storage (shared between Field View and
   Results View via localStorage), input validation, the
   field animation, and rendering the results table.
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
  const shot = document.getElementById("shot");
  const trailLine = document.getElementById("trail-line");
  const landingMarker = document.getElementById("landing-marker");
  const landingPulse = document.getElementById("landing-pulse");
  const landingLabel = document.getElementById("landing-label");

  // Field geometry constants (must match the SVG in field.html).
  // Distance 0 sits at the front of the throwing circle; distance
  // 25m sits at the top edge of the field diagram.
  const CIRCLE_FRONT_Y = 454;
  const FIELD_TOP_Y = 110;
  const MAX_VISUAL_METRES = 25;
  const PX_PER_METRE = (CIRCLE_FRONT_Y - FIELD_TOP_Y) / MAX_VISUAL_METRES;
  const SECTOR_HALF_ANGLE_TAN = 0.314; // approximates the real 34.92 degree sector

  // Restore saved athlete name
  nameInput.value = getAthleteName();
  nameInput.addEventListener("input", () => setAthleteName(nameInput.value.trim()));

  function sectorWidthAt(y) {
    const distFromCircle = CIRCLE_FRONT_Y - y;
    return distFromCircle * SECTOR_HALF_ANGLE_TAN;
  }

  function landingY(distanceMetres) {
    const clamped = Math.min(distanceMetres, MAX_VISUAL_METRES);
    return CIRCLE_FRONT_Y - clamped * PX_PER_METRE;
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

  function animateThrow(distanceMetres) {
    const y = landingY(distanceMetres);
    const halfWidth = sectorWidthAt(y);

    shot.setAttribute("cy", y);

    trailLine.setAttribute("y2", y);
    trailLine.classList.add("is-visible");

    landingMarker.setAttribute("x1", 200 - halfWidth);
    landingMarker.setAttribute("x2", 200 + halfWidth);
    landingMarker.setAttribute("y1", y);
    landingMarker.setAttribute("y2", y);
    landingMarker.classList.add("is-visible");

    landingLabel.setAttribute("x", 200 + halfWidth + 8);
    landingLabel.setAttribute("y", y + 4);
    landingLabel.textContent = formatDistance(distanceMetres);
    landingLabel.classList.add("is-visible");

    // Small pulse ring at the landing point on top of the shot's own
    // travel animation, timed to appear once it arrives.
    window.setTimeout(() => {
      landingPulse.setAttribute("cx", 200);
      landingPulse.setAttribute("cy", y);
      landingPulse.classList.remove("is-pulsing");
      // Restart the CSS animation by forcing reflow before re-adding the class
      void landingPulse.getBoundingClientRect();
      landingPulse.classList.add("is-pulsing");
    }, 850);
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
    if (distance > 30) {
      showError("Enter a realistic distance of 30 metres or less.");
      return;
    }

    animateThrow(distance);
    addThrow(distance);

    resultEl.textContent = "Throw recorded: " + formatDistance(distance);
    resultEl.classList.add("is-recorded");
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

document.addEventListener("DOMContentLoaded", () => {
  initFieldView();
  initResultsView();
});