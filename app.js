/* =========================================================
   Shot Put Field Tool — app.js
   Browser-only client code. Throw data now lives on the
   server (see db.js / server.js) instead of localStorage, so
   every logged-in user sees the same shared leaderboard. This
   file only keeps one thing in localStorage: the last-typed
   athlete name, purely as a typing convenience.
   ========================================================= */

// If ANYTHING in this file throws an error that isn't caught
// elsewhere, show it as an impossible-to-miss red banner at the
// top of the page - a silent failure is much harder to diagnose
// than a visible one. Open the browser console (F12) for the
// full technical detail alongside this.
window.addEventListener("error", (event) => {
  console.error("[shotput] uncaught error:", event.error || event.message);
  showFatalErrorBanner(event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[shotput] unhandled promise rejection:", event.reason);
  showFatalErrorBanner(String(event.reason && event.reason.message || event.reason));
});

function showFatalErrorBanner(message) {
  if (document.getElementById("shotput-fatal-banner")) return; // only show once
  const banner = document.createElement("div");
  banner.id = "shotput-fatal-banner";
  banner.setAttribute("role", "alert");
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:9999;background:#a12b23;" +
    "color:#fff;padding:14px 18px;font-family:sans-serif;font-size:15px;" +
    "line-height:1.4;box-shadow:0 2px 10px rgba(0,0,0,0.3);";
  banner.textContent =
    "Something went wrong loading this page's script: " + message +
    " — please press F12, open the Console tab, and share what's shown there.";
  document.body.prepend(banner);
}

const NAME_HINT_KEY = "shotput_athlete_name_hint";

function getAthleteNameHint() {
  return localStorage.getItem(NAME_HINT_KEY) || "";
}
function setAthleteNameHint(name) {
  localStorage.setItem(NAME_HINT_KEY, name);
}
function formatDistance(value) {
  return value.toFixed(2) + " m";
}

/* ---------- Server API ----------
   Every call goes through fetchWithTimeout so a stalled connection
   can never hang forever - after 8 seconds it fails with a clear
   error instead of leaving the page looking "stuck". */

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The request timed out - check the server is still running and try again.");
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function apiGetMe() {
  const res = await fetchWithTimeout("/api/me");
  if (!res.ok) return null;
  return res.json();
}

async function apiGetThrows() {
  const res = await fetchWithTimeout("/api/throws");
  if (!res.ok) throw new Error("Could not load throws (status " + res.status + ").");
  return res.json();
}

async function apiAddThrow(athleteName, distance) {
  const res = await fetchWithTimeout("/api/throws", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ athleteName, distance }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not record that throw.");
  return body;
}

async function apiClearThrows() {
  const res = await fetchWithTimeout("/api/throws/clear", { method: "POST" });
  if (!res.ok) throw new Error("Could not clear throws.");
}

/* ---------- User badge / role-based UI ----------
   The server enforces who can do what (see requireAdmin in
   server.js) - this just adjusts what's shown, so a visitor
   never sees admin-only controls in the first place. */

async function renderUserBadge() {
  const badge = document.getElementById("user-badge");
  if (!badge) return;

  try {
    const me = await apiGetMe();
    if (!me) return;

    const textEl = document.getElementById("user-badge-text");
    if (textEl) textEl.textContent = me.username + " (" + me.role + ")";
    badge.hidden = false;

    if (me.role === "admin") {
      document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = false; });
    }
  } catch (err) {
    console.error("Could not load account info:", err);
  }
}

/* ---------- Leaderboard ---------- */

function buildLeaderboard(throws) {
  const byAthlete = new Map();
  throws.forEach((t) => {
    const entry = byAthlete.get(t.athleteName) || { name: t.athleteName, best: -Infinity, attempts: 0 };
    entry.attempts += 1;
    entry.best = Math.max(entry.best, t.distance);
    byAthlete.set(t.athleteName, entry);
  });
  return Array.from(byAthlete.values()).sort((a, b) => b.best - a.best);
}

function getBest(throws) {
  if (throws.length === 0) return null;
  return throws.reduce((best, t) => (t.distance > best.distance ? t : best), throws[0]);
}

function leadingTagHtml(label) {
  return '<span class="best-tag"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 21h8M12 17v4M7 4h10l-1 8a4 4 0 0 1-8 0L7 4Z"/>' +
    '<path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/></svg>' + label + '</span>';
}

// Shared leaderboard table renderer, used by BOTH the leaderboard on
// Field View (refreshed live after every throw) and the full
// leaderboard on Results. Ranked by each athlete's BEST throw, not
// by recency - so it stays a real leaderboard, not a recent-throws list.
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
  if (!form) {
    console.log("[shotput] no #throw-form on this page - skipping Field View init (expected on Home/Results/Guide)");
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

  const shot = document.getElementById("shot");
  const shotShadow = document.getElementById("shot-shadow");
  const trailLine = document.getElementById("trail-line");
  const landingPulse = document.getElementById("landing-pulse");
  const landingLabel = document.getElementById("landing-label");

  const leaderboardTbody = document.getElementById("leaderboard-tbody");
  const leaderboardTable = document.getElementById("leaderboard-table");
  const leaderboardEmpty = document.getElementById("leaderboard-empty");

  // If any required element is missing, fail loudly instead of quietly
  // doing nothing - this is exactly the kind of bug that otherwise
  // looks identical to "the animation just doesn't work".
  const required = { form, nameInput, distanceInput, errorEl, resultEl, shot, shotShadow, trailLine, landingPulse, landingLabel, leaderboardTbody };
  Object.entries(required).forEach(([key, el]) => {
    if (!el) throw new Error("Field View is missing a required element: #" + key + " - check field.html matches app.js");
  });

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  console.log("[shotput] prefers-reduced-motion:", prefersReducedMotion,
    prefersReducedMotion ? "- the shot will jump to its landing spot instead of gliding (this is intentional, not a bug)" : "");

  // Make this genuinely hard to miss, since a shot that "doesn't move"
  // looks identical to a bug unless this is clearly explained.
  if (motionNoteEl && prefersReducedMotion) {
    motionNoteEl.hidden = false;
  }

  nameInput.value = getAthleteNameHint();
  nameInput.addEventListener("input", () => setAthleteNameHint(nameInput.value.trim()));

  async function refreshLeaderboard() {
    try {
      const throws = await apiGetThrows();
      renderLeaderboardTable(leaderboardTbody, leaderboardTable, leaderboardEmpty, throws);
    } catch (err) {
      console.error("Could not refresh leaderboard:", err);
    }
  }
  refreshLeaderboard();

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
    const fallback = "Athlete";
    nameInput.value = fallback;
    return fallback;
  }

  // Purely visual - positions the shot/shadow/trail/label at the
  // landing point. Runs when the ANIMATION finishes, independent of
  // whether the server save has finished yet.
  function landShotAt(distance, point) {
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
  }

  // Runs when the SERVER SAVE finishes - completely independent timing
  // from the animation. This is what used to block the animation from
  // starting at all; now the two happen in parallel instead.
  function showSavedResult(name, distance) {
    resultEl.textContent = name + " — throw recorded: " + formatDistance(distance);
    resultEl.classList.add("is-recorded");
    refreshLeaderboard();
  }

  // Purely visual, and now starts IMMEDIATELY on submit - it no longer
  // waits on the network save (see the submit handler below). This
  // matches how a fully client-side prototype would behave: the throw
  // always animates right away, regardless of how long saving takes.
  function animateThrow(name, distance) {
    const angle = randomAngle();
    const targetPoint = fieldPoint(distance, angle);
    console.log("[shotput] animateThrow called - target point:", targetPoint);

    if (prefersReducedMotion) {
      console.log("[shotput] reduced motion is ON - jumping straight to landing spot, no glide");
      landShotAt(distance, targetPoint);
      return;
    }

    // Slower and with a bigger visual "hop" than earlier versions, so
    // the motion is unmistakable rather than a near-instant jump.
    const duration = Math.min(2400, 1100 + distance * 45);
    let start = null;
    let frameCount = 0;
    console.log("[shotput] starting animation loop, duration ~" + duration + "ms");

    function frame(timestamp) {
      if (!start) start = timestamp;
      frameCount++;
      const progress = Math.min((timestamp - start) / duration, 1);
      const distanceSoFar = distance * progress;
      const point = fieldPoint(distanceSoFar, angle);
      const hop = 7 * progress * (1 - progress); // visual height only

      shot.setAttribute("cx", point.x.toFixed(1));
      shot.setAttribute("cy", point.y.toFixed(1));
      shot.setAttribute("r", (9 + hop * 6).toFixed(1));

      shotShadow.setAttribute("cx", point.x.toFixed(1));
      shotShadow.setAttribute("cy", point.y.toFixed(1));
      shotShadow.setAttribute("rx", (8 - hop * 3).toFixed(1));
      shotShadow.setAttribute("ry", (4 - hop * 1.5).toFixed(1));
      shotShadow.style.opacity = (0.45 - hop * 0.2).toFixed(2);

      trailLine.setAttribute("x2", point.x.toFixed(1));
      trailLine.setAttribute("y2", point.y.toFixed(1));
      trailLine.classList.add("is-visible");

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        console.log("[shotput] animation finished after", frameCount, "frames - shot now at", point);
        landShotAt(distance, targetPoint);
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    console.log("[shotput] form submitted");
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

    const name = resolveAthleteName();
    console.log("[shotput] validated - starting animation immediately and saving in parallel:", name, distance, "m");

    // The animation starts right away and never waits on the network -
    // it behaves the same whether the save takes 50ms or 5 seconds.
    setAthleteNameHint(name);
    animateThrow(name, distance);

    try {
      await apiAddThrow(name, distance);
      console.log("[shotput] saved to server OK");
      showSavedResult(name, distance);
    } catch (err) {
      console.error("[shotput] could not record throw:", err);
      showError(
        "The throw animated, but saving it to the leaderboard failed: " +
        (err.message || "please check your connection and try again.")
      );
    }
  });
}

/* ---------- Results View / Leaderboard ---------- */

function initResultsView() {
  const clearBtn = document.getElementById("clear-throws");
  if (!clearBtn) return; // Not on this page

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

  async function render() {
    let throws;
    try {
      throws = await apiGetThrows();
    } catch (err) {
      console.error("Could not load results:", err);
      if (logEmpty) {
        logEmpty.hidden = false;
        logEmpty.textContent = "Could not load results. Please refresh the page.";
      }
      return;
    }

    const best = getBest(throws);

    summaryAthletes.textContent = String(new Set(throws.map((t) => t.athleteName)).size);
    summaryCount.textContent = String(throws.length);
    summaryCurrent.textContent = throws.length
      ? formatDistance(throws[throws.length - 1].distance) + " (" + throws[throws.length - 1].athleteName + ")"
      : "—";
    summaryBest.textContent = best ? formatDistance(best.distance) + " (" + best.athleteName + ")" : "—";

    renderLeaderboardTable(leaderboardTbody, leaderboardTable, leaderboardEmpty, throws);

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
      const isBest = best && t.distance === best.distance && t.athleteName === best.athleteName;
      if (isBest) row.classList.add("is-best");

      const numCell = document.createElement("td");
      numCell.textContent = String(index + 1);

      const nameCell = document.createElement("td");
      nameCell.textContent = t.athleteName;

      const distCell = document.createElement("td");
      distCell.textContent = formatDistance(t.distance);

      const bestCell = document.createElement("td");
      bestCell.innerHTML = isBest ? leadingTagHtml("Personal best") : "";

      row.append(numCell, nameCell, distCell, bestCell);
      logTbody.appendChild(row);
    });
  }

  clearBtn.addEventListener("click", async () => {
    const confirmed = window.confirm("Clear all recorded throws for every athlete? This cannot be undone.");
    if (!confirmed) return;
    try {
      await apiClearThrows();
      render();
    } catch (err) {
      console.error("Could not clear throws:", err);
    }
  });

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("[shotput] DOMContentLoaded fired, initialising...");
  try {
    renderUserBadge();
    initFieldView();
    initResultsView();
    console.log("[shotput] init complete - if this page has a throw form, it's ready");
  } catch (err) {
    console.error("[shotput] init failed:", err);
    showFatalErrorBanner(err.message);
  }
});