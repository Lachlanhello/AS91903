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

// CSS and JS are served directly from /public, e.g. /css/style.css
app.use(express.static(path.join(__dirname, "public")));

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
app.get("/field", requireAdmin, sendView("field.html"));
app.get("/results", requireAuth, sendView("results.html"));
app.get("/guide", requireAuth, sendView("guide.html"));

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

  if (!name) {
    return res.status(400).json({ error: "Athlete name is required." });
  }
  if (!Number.isFinite(distance) || distance <= 0) {
    return res.status(400).json({ error: "Enter a distance greater than 0 metres." });
  }
  if (distance > 30) {
    return res.status(400).json({ error: "Enter a realistic distance of 30 metres or less." });
  }

  const record = db.addThrow(name, distance, req.session.user.username);
  res.status(201).json(record);
});

app.post("/api/throws/clear", requireAdminApi, (req, res) => {
  db.clearAllThrows();
  res.status(204).end();
});

/* ---------- 404 ---------- */

app.use((req, res) => {
  res.status(404).send(
    '<p style="font-family: sans-serif; padding: 2rem;">' +
    "Page not found. <a href=\"/\">Go back home</a>.</p>"
  );
});

const server = app.listen(PORT, () => {
  console.log(`Shot Put Field Tool running at http://localhost:${PORT}`);
  console.log("Demo accounts:");
  console.log("  admin   / ShotPut2026!    (can record throws)");
  console.log("  visitor / Spectator2026!  (leaderboard + results only)");
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