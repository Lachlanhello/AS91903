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
  return {
    users: [], athletes: [], throws: [], events: [], entries: [],
    nextId: { users: 1, athletes: 1, throws: 1, events: 1, entries: 1 },
  };
}

// Age groups are fixed, and validated on the server so a hand-crafted
// request can't slip an invalid one into the data file.
const AGE_GROUPS = ["junior", "intermediate", "senior"];

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const seeded = seedDatabase(emptyDatabase());
    save(seeded);
    return seeded;
  }
  const raw = fs.readFileSync(DB_PATH, "utf8");
  const data = JSON.parse(raw);
  return migrate(data);
}

// Adds any tables/counters a database file saved by an older version of
// this app doesn't have yet, so upgrading never loses existing throws.
function migrate(data) {
  let changed = false;
  if (!Array.isArray(data.events))  { data.events = [];  changed = true; }
  if (!Array.isArray(data.entries)) { data.entries = []; changed = true; }
  if (!data.nextId) { data.nextId = {}; changed = true; }
  ["users", "athletes", "throws", "events", "entries"].forEach((table) => {
    if (typeof data.nextId[table] !== "number") {
      const rows = Array.isArray(data[table]) ? data[table] : [];
      data.nextId[table] = rows.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
      changed = true;
    }
  });
  if (changed) save(data);
  return data;
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

  // No demo throws are seeded - the app starts with a clean field.

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

function addThrow(athleteName, distance, eventId, recordedBy) {
  const data = load();
  const athleteId = getOrCreateAthleteId(data, athleteName);
  const event = data.events.find((e) => e.id === Number(eventId));
  const matchingEntry = data.entries.find((entry) =>
    entry.eventId === Number(eventId) &&
    entry.athleteName.trim().toLowerCase() === athleteName.trim().toLowerCase()
  );
  const record = {
    id: data.nextId.throws++,
    athleteId,
    eventId: Number(eventId),
    distance,
    recordedAt: new Date().toISOString(),
    recordedBy,
  };
  data.throws.push(record);
  save(data);
  return {
    ...record,
    athleteName,
    eventName: event ? event.name : "Unassigned",
    ageGroup: matchingEntry ? matchingEntry.ageGroup : null,
  };
}

function getAllThrows() {
  const data = load();
  const athleteNameById = Object.fromEntries(data.athletes.map((a) => [a.id, a.name]));
  const eventNameById = Object.fromEntries(data.events.map((e) => [e.id, e.name]));
  return data.throws
    .map((t) => {
      const athleteName = athleteNameById[t.athleteId] || "Unknown athlete";
      const matchingEntry = data.entries.find((entry) =>
        entry.eventId === Number(t.eventId) &&
        entry.athleteName.trim().toLowerCase() === athleteName.trim().toLowerCase()
      );
      return {
        id: t.id,
        athleteName,
        ageGroup: matchingEntry ? matchingEntry.ageGroup : null,
        representing: matchingEntry ? matchingEntry.representing : null,
        eventId: t.eventId || null,
        eventName: eventNameById[t.eventId] || "Unassigned",
        distance: t.distance,
        recordedAt: t.recordedAt,
      };
    })
    .sort((a, b) => a.id - b.id);
}

function clearAllThrows() {
  const data = load();
  data.throws = [];
  data.athletes = [];
  save(data);
}


/* =========================================================
   Events
   An event is a competition an admin sets up (e.g. "Senior
   Boys Shot Put, Term 3"). Guests enter an event by giving
   their name, age group, and who they represent.
   ========================================================= */

function getAllEvents() {
  const data = load();
  // Newest first, and each event carries its own entry count so the
  // events page doesn't have to make a second request per event.
  return data.events
    .map((e) => ({
      ...e,
      entryCount: data.entries.filter((x) => x.eventId === e.id).length,
    }))
    .sort((a, b) => b.id - a.id);
}

function getEventById(id) {
  const data = load();
  return data.events.find((e) => e.id === Number(id)) || null;
}

function createEvent(name, eventDate, createdBy) {
  const data = load();
  const record = {
    id: data.nextId.events++,
    name,
    eventDate: eventDate || null,
    status: "open",                // "open" = accepting entries, "closed" = not
    createdBy,
    createdAt: new Date().toISOString(),
  };
  data.events.push(record);
  save(data);
  return { ...record, entryCount: 0 };
}

function setEventStatus(id, status) {
  const data = load();
  const event = data.events.find((e) => e.id === Number(id));
  if (!event) return null;
  event.status = status;
  save(data);
  return event;
}

function deleteEvent(id) {
  const data = load();
  const eventId = Number(id);
  const before = data.events.length;
  data.events = data.events.filter((e) => e.id !== eventId);
  // Deleting an event also removes its entries, so no entry is ever
  // left pointing at an event that no longer exists.
  data.entries = data.entries.filter((x) => x.eventId !== eventId);
  save(data);
  return data.events.length < before;
}

/* =========================================================
   Entries
   ========================================================= */

function getEntriesForEvent(eventId) {
  const data = load();
  return data.entries
    .filter((x) => x.eventId === Number(eventId))
    .sort((a, b) => a.id - b.id);
}

function getAllEntries() {
  const data = load();
  const eventNameById = Object.fromEntries(data.events.map((e) => [e.id, e.name]));
  return data.entries
    .map((x) => ({ ...x, eventName: eventNameById[x.eventId] || "Unknown event" }))
    .sort((a, b) => a.id - b.id);
}

// Returns null if this athlete is already entered in this event, so the
// same person can't be added to one event twice.
function findDuplicateEntry(eventId, athleteName) {
  const data = load();
  return data.entries.find((x) =>
    x.eventId === Number(eventId) &&
    x.athleteName.trim().toLowerCase() === athleteName.trim().toLowerCase()
  ) || null;
}

function findEntryForAthlete(eventId, athleteName) {
  const data = load();
  return data.entries.find((x) =>
    x.eventId === Number(eventId) &&
    x.athleteName.trim().toLowerCase() === athleteName.trim().toLowerCase()
  ) || null;
}

function addEntry(eventId, athleteName, ageGroup, representing, enteredBy) {
  const data = load();
  const record = {
    id: data.nextId.entries++,
    eventId: Number(eventId),
    athleteName,
    ageGroup,
    representing,
    enteredBy,
    enteredAt: new Date().toISOString(),
  };
  data.entries.push(record);
  save(data);
  return record;
}

function deleteEntry(id) {
  const data = load();
  const before = data.entries.length;
  data.entries = data.entries.filter((x) => x.id !== Number(id));
  save(data);
  return data.entries.length < before;
}

module.exports = {
  AGE_GROUPS,
  findUserByUsername,
  verifyPassword,
  addThrow,
  getAllThrows,
  clearAllThrows,
  getAllEvents,
  getEventById,
  createEvent,
  setEventStatus,
  deleteEvent,
  getEntriesForEvent,
  getAllEntries,
  findDuplicateEntry,
  findEntryForAthlete,
  addEntry,
  deleteEntry,
};