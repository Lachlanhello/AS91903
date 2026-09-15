/* =========================================================
   Shot Put Field Tool — db.js
   A small persistent data store, backed by a single JSON file
   on disk (data/shotput-db.json) instead of a full SQL engine.

   Why not a "real" SQL database? Packages like better-sqlite3
   need a compiled native binary, which can fail to install on
   some school/managed laptops without a compiler available.
   This module gives the same shape as a database - separate
   tables, ids, relationships, query-style functions - using
   only Node's built-in fs module, so `npm install` can never
   fail because of it. If you specifically need real SQL for
   your assessment, this can be swapped for better-sqlite3
   later without changing anything that calls this file.
   ========================================================= */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DB_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DB_DIR, "shotput-db.json");

function emptyDatabase() {
  return { users: [], athletes: [], throws: [], nextId: { users: 1, athletes: 1, throws: 1 } };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const seeded = seedDatabase(emptyDatabase());
    save(seeded);
    return seeded;
  }
  const raw = fs.readFileSync(DB_PATH, "utf8");
  return JSON.parse(raw);
}

function save(data) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  // Write to a temp file then rename, so a crash mid-write can never
  // leave shotput-db.json half-written and unreadable.
  const tmpPath = DB_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, DB_PATH);
}

// Seeds two demo accounts and a handful of demo throws, so the app is
// usable immediately on first run without any manual setup.
function seedDatabase(data) {
  const adminId = data.nextId.users++;
  const visitorId = data.nextId.users++;
  data.users.push(
    { id: adminId, username: "admin", passwordHash: bcrypt.hashSync("ShotPut2026!", 10), role: "admin" },
    { id: visitorId, username: "visitor", passwordHash: bcrypt.hashSync("Spectator2026!", 10), role: "visitor" }
  );

  const demoThrows = [
    ["Jordan Smith", 14.20], ["Jordan Smith", 15.85],
    ["Amelia Ngata", 16.50], ["Amelia Ngata", 17.05], ["Amelia Ngata", 16.10],
    ["Kai Walker", 13.10],
  ];
  const athleteIdByName = {};
  demoThrows.forEach(([name, distance]) => {
    if (!athleteIdByName[name]) {
      const id = data.nextId.athletes++;
      athleteIdByName[name] = id;
      data.athletes.push({ id, name });
    }
    data.throws.push({
      id: data.nextId.throws++,
      athleteId: athleteIdByName[name],
      distance,
      recordedAt: new Date().toISOString(),
      recordedBy: "admin",
    });
  });

  return data;
}

/* ---------- Users ---------- */

function findUserByUsername(username) {
  const data = load();
  return data.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.passwordHash);
}

/* ---------- Athletes & throws ---------- */

function getOrCreateAthleteId(data, name) {
  const existing = data.athletes.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const id = data.nextId.athletes++;
  data.athletes.push({ id, name });
  return id;
}

function addThrow(athleteName, distance, recordedBy) {
  const data = load();
  const athleteId = getOrCreateAthleteId(data, athleteName);
  const record = {
    id: data.nextId.throws++,
    athleteId,
    distance,
    recordedAt: new Date().toISOString(),
    recordedBy,
  };
  data.throws.push(record);
  save(data);
  return { ...record, athleteName };
}

function getAllThrows() {
  const data = load();
  const athleteNameById = Object.fromEntries(data.athletes.map((a) => [a.id, a.name]));
  return data.throws
    .map((t) => ({
      id: t.id,
      athleteName: athleteNameById[t.athleteId] || "Unknown athlete",
      distance: t.distance,
      recordedAt: t.recordedAt,
    }))
    .sort((a, b) => a.id - b.id);
}

function clearAllThrows() {
  const data = load();
  data.throws = [];
  data.athletes = [];
  save(data);
}

module.exports = {
  findUserByUsername,
  verifyPassword,
  addThrow,
  getAllThrows,
  clearAllThrows,
};