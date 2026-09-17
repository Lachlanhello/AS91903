/* =========================================================
   Shot Put Field Tool — server.js
   Express server with:
   - session-based login (admin / visitor accounts)
   - page routes, protected by role
   - a small JSON API the client-side app.js talks to, backed
     by db.js, so throw data is shared across every device and
     browser instead of living in one browser's local storage.
   ========================================================= */

const express = require("express");
const session = require("express-session");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  name: "shotput.sid",
  secret: "shot-put-field-tool-dev-secret", // fine for a school demo; not a production secret
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
    httpOnly: true,
    sameSite: "lax",
    secure: false, // this app runs over plain http://localhost, so the
                   // cookie must NOT be marked secure or it is never sent
  },
}));

// CSS and JS are served from /public, e.g. /css/style.css and /js/app.js.
// The project root is ALSO served as a fallback, so the site still works if
// style.css / app.js happen to be sitting loose in the project folder rather
// than inside public/. A 404 on the stylesheet or script is otherwise
// completely silent in the browser and looks exactly like "the animation is
// broken" - this makes that impossible.
/* ---------- Resilient asset routes ----------
   The pages ask for /js/app.js and /css/style.css. These routes serve the
   first copy of each file that actually exists, checking both the tidy
   public/ layout and the project root. That way a file sitting in the
   "wrong" folder can never silently 404 - a missing script is invisible in
   the browser and looks identical to "the animation is broken". */
function serveFirstExisting(relativePaths, contentType) {
  const fs = require("fs");
  return (req, res) => {
    for (const rel of relativePaths) {
      const full = path.join(__dirname, rel);
      if (fs.existsSync(full)) {
        res.type(contentType);
        return res.sendFile(full);
      }
    }
    res.status(404).type("text/plain").send(
      "Could not find this file in any of: " + relativePaths.join(", ")
    );
  };
}

app.get(["/js/app.js", "/app.js"],
  serveFirstExisting(["public/js/app.js", "js/app.js", "app.js"], "application/javascript"));

app.get(["/css/style.css", "/css/styles.css", "/style.css", "/styles.css"],
  serveFirstExisting(["public/css/style.css", "public/css/styles.css", "css/style.css", "style.css", "styles.css"], "text/css"));

app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname, { index: false }));

/* ---------- Startup self-check ----------
   Prints, at boot, whether the files the pages ask for actually exist.
   If something is in the wrong folder you see it in the terminal
   immediately instead of debugging a blank page in the browser. */
function startupCheck() {
  const fs = require("fs");
  const checks = [
    ["public/js/app.js",     "the field animation + leaderboard script"],
    ["public/css/style.css", "all site styling"],
    ["views/field.html",     "Field View page"],
    ["views/results.html",   "Results page"],
    ["views/index.html",     "Home page"],
    ["views/guide.html",     "Guide page"],
    ["views/login.html",     "Login page"],
    ["views/events.html",    "Events page"],
  ];
  const missing = checks.filter(([rel]) => !fs.existsSync(path.join(__dirname, rel)));
  if (missing.length === 0) {
    console.log("File check: all pages, styles and scripts found.");
    return;
  }
  console.error("");
  console.error("*** FILE CHECK FAILED - these files are missing: ***");
  missing.forEach(([rel, what]) => console.error(`  MISSING  ${rel}   (${what})`));
  console.error("");
  console.error("Your folder should look like this:");
  console.error("  server.js");
  console.error("  db.js");
  console.error("  package.json");
  console.error("  public/css/style.css");
  console.error("  public/js/app.js");
  console.error("  views/  index.html  field.html  results.html  guide.html  login.html");
  console.error("");
}

const VIEWS_DIR = path.join(__dirname, "views");

/* =========================================================
   Middleware
   These four functions were the missing piece that stopped
   the server starting at all: the routes below referred to
   them, but they were never actually written. "require*"
   guards a PAGE (and redirects a browser); "require*Api"
   guards a JSON endpoint (and returns a status code, because
   a fetch() call can't follow a redirect to a login page).
   ========================================================= */

// Is anyone logged in at all?
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect("/login");
}

// Logged in AND an admin? (only admins may record throws)
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === "admin") return next();
  if (req.session && req.session.user) return res.redirect("/results"); // visitor: send somewhere useful
  return res.redirect("/login");
}

function requireAuthApi(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: "Please log in." });
}

function requireAdminApi(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === "admin") return next();
  return res.status(403).json({ error: "Only an admin account can record throws." });
}

function requireVisitorApi(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === "visitor") return next();
  return res.status(403).json({ error: "Only a visitor account can enter athletes." });
}

// Small helper so the page routes below read cleanly.
function sendView(filename) {
  return (req, res) => res.sendFile(path.join(VIEWS_DIR, filename));
}

/* ---------- Login / logout ---------- */

app.get("/login", (req, res) => {
  // Already logged in? Skip the login page.
  if (req.session && req.session.user) {
    return res.redirect(req.session.user.role === "admin" ? "/field" : "/results");
  }
  res.sendFile(path.join(VIEWS_DIR, "login.html"));
});

app.post("/login", (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";

  const user = db.findUserByUsername(username);
  if (!user || !db.verifyPassword(user, password)) {
    return res.redirect("/login?error=1");
  }

  req.session.user = { username: user.username, role: user.role };
  res.redirect(user.role === "admin" ? "/field" : "/results");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("shotput.sid");
    res.redirect("/login");
  });
});

/* ---------- Pages ---------- */

app.get("/", requireAuth, sendView("index.html"));
app.get("/field", requireAuth, sendView("field.html"));
app.get("/results", requireAuth, sendView("results.html"));
app.get("/guide", requireAuth, sendView("guide.html"));
app.get("/events", requireAuth, sendView("events.html"));

/* ---------- JSON API used by public/js/app.js ---------- */

app.get("/api/me", requireAuthApi, (req, res) => {
  res.json(req.session.user);
});

app.get("/api/throws", requireAuthApi, (req, res) => {
  res.json(db.getAllThrows());
});

app.post("/api/throws", requireAdminApi, (req, res) => {
  const name = (req.body.athleteName || "").trim();
  const distance = Number(req.body.distance);
  const eventId = Number(req.body.eventId);

  if (!Number.isInteger(eventId) || eventId <= 0 || !db.getEventById(eventId)) {
    return res.status(400).json({ error: "Choose an event before recording a throw." });
  }

  if (!name) {
    return res.status(400).json({ error: "Athlete name is required." });
  }
  if (!db.findEntryForAthlete(eventId, name)) {
    return res.status(400).json({ error: "Choose an athlete entered in the selected event." });
  }
  if (!Number.isFinite(distance) || distance <= 0) {
    return res.status(400).json({ error: "Enter a distance greater than 0 metres." });
  }
  if (distance > 30) {
    return res.status(400).json({ error: "Enter a realistic distance of 30 metres or less." });
  }

  const record = db.addThrow(name, distance, eventId, req.session.user.username);
  res.status(201).json(record);
});

app.post("/api/throws/clear", requireAdminApi, (req, res) => {
  db.clearAllThrows();
  res.status(204).end();
});


/* =========================================================
   Events API
   Creating / opening / closing / deleting an event is admin
   only. ENTERING an event is open to any logged-in user,
   including visitors - that is the whole point of the guest
   entry system.
   ========================================================= */

app.get("/api/events", requireAuthApi, (req, res) => {
  res.json(db.getAllEvents());
});

app.post("/api/events", requireAdminApi, (req, res) => {
  const name = (req.body.name || "").trim();
  const eventDate = (req.body.eventDate || "").trim();

  if (!name) {
    return res.status(400).json({ error: "Event name is required." });
  }
  if (name.length > 80) {
    return res.status(400).json({ error: "Event name must be 80 characters or fewer." });
  }
  res.status(201).json(db.createEvent(name, eventDate, req.session.user.username));
});

app.post("/api/events/:id/status", requireAdminApi, (req, res) => {
  const status = req.body.status;
  if (status !== "open" && status !== "closed") {
    return res.status(400).json({ error: "Status must be either open or closed." });
  }
  const updated = db.setEventStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: "That event no longer exists." });
  res.json(updated);
});

app.delete("/api/events/:id", requireAdminApi, (req, res) => {
  const ok = db.deleteEvent(req.params.id);
  if (!ok) return res.status(404).json({ error: "That event no longer exists." });
  res.status(204).end();
});

/* ---------- Entries ---------- */

app.get("/api/events/:id/entries", requireAuthApi, (req, res) => {
  const event = db.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: "That event no longer exists." });
  res.json(db.getEntriesForEvent(req.params.id));
});

app.get("/api/entries", requireAuthApi, (req, res) => {
  res.json(db.getAllEntries());
});

// Visitors enter athletes; admins manage events and record throws instead.
app.post("/api/events/:id/entries", requireVisitorApi, (req, res) => {
  const event = db.getEventById(req.params.id);
  if (!event) {
    return res.status(404).json({ error: "That event no longer exists." });
  }
  if (event.status !== "open") {
    return res.status(409).json({ error: "Entries for this event are closed." });
  }

  const athleteName = (req.body.athleteName || "").trim();
  const ageGroup = (req.body.ageGroup || "").trim().toLowerCase();
  const representing = (req.body.representing || "").trim();

  if (!athleteName) {
    return res.status(400).json({ error: "Please enter the athlete's name." });
  }
  if (athleteName.length > 60) {
    return res.status(400).json({ error: "Athlete name must be 60 characters or fewer." });
  }
  if (!db.AGE_GROUPS.includes(ageGroup)) {
    return res.status(400).json({
      error: "Please choose an age group: junior, intermediate or senior.",
    });
  }
  if (!representing) {
    return res.status(400).json({ error: "Please enter who the athlete is representing." });
  }
  if (representing.length > 60) {
    return res.status(400).json({ error: "Representing must be 60 characters or fewer." });
  }
  if (db.findDuplicateEntry(event.id, athleteName)) {
    return res.status(409).json({
      error: athleteName + " is already entered in this event.",
    });
  }

  const entry = db.addEntry(event.id, athleteName, ageGroup, representing, req.session.user.username);
  res.status(201).json(entry);
});

app.delete("/api/entries/:id", requireAdminApi, (req, res) => {
  const ok = db.deleteEntry(req.params.id);
  if (!ok) return res.status(404).json({ error: "That entry no longer exists." });
  res.status(204).end();
});

/* ---------- 404 ---------- */

app.use((req, res) => {
  res.status(404).send(
    '<p style="font-family: sans-serif; padding: 2rem;">' +
    "Page not found. <a href=\"/\">Go back home</a>.</p>"
  );
});

startupCheck();

const server = app.listen(PORT, () => {
  console.log(`Shot Put Field Tool running at http://localhost:${PORT}`);
  console.log("Demo accounts:");
  console.log("admin   / ShotPut2026!    (can record throws)");
  console.log("visitor / Spectator2026!  (leaderboard + results only)");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("");
    console.error(`Port ${PORT} is already in use - another copy of this server`);
    console.error("is probably still running from an earlier terminal window.");
    console.error("");
    console.error("On Windows (PowerShell), find and stop it with:");
    console.error(`  netstat -ano | findstr :${PORT}`);
    console.error("  (note the PID number in the last column, then:)");
    console.error("  taskkill /PID <that number> /F");
    console.error("");
    console.error("Then run npm start again.");
    process.exit(1);
  }
  throw err;
});