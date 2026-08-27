/* =========================================================
   Shot Put Field Tool — server.js
   A small Express server with one route per page ("view").
   Static files (CSS, JS) are served from /public. The HTML
   pages themselves live in /views and are sent as-is - there's
   no templating engine here, just routes that map a URL to
   the matching page.
   ========================================================= */

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// CSS and JS are served directly from /public, e.g.
// /css/styles.css and /js/app.js
app.use(express.static(path.join(__dirname, "public")));

const VIEWS_DIR = path.join(__dirname, "views");

app.get("/", (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, "index.html"));
});

app.get("/field", (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, "field.html"));
});

app.get("/results", (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, "results.html"));
});

app.get("/guide", (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, "guide.html"));
});

// Anything else gets a simple 404 with a way back home
app.use((req, res) => {
  res.status(404).send(
    '<p style="font-family: sans-serif; padding: 2rem;">' +
    "Page not found. <a href=\"/\">Go back home</a>.</p>"
  );
});

app.listen(PORT, () => {
  console.log(`Shot Put Field Tool running at http://localhost:${PORT}`);
});