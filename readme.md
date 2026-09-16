# Shot Put Field Tool

An accessible browser-based tool for recording and understanding shot put
throws, built for athletes, coaches, teachers and spectators.

## Running the app

```powershell
npm install
npm start
```

Then open **http://localhost:3000**.

If you see `EADDRINUSE`, an old copy of the server is still running:

```powershell
netstat -ano | findstr :3000
taskkill /PID <the number in the last column> /F
```

## Accounts

| Role    | Username  | Password         | Can do                          |
|---------|-----------|------------------|---------------------------------|
| Admin   | `admin`   | `ShotPut2026!`   | Record throws, clear throws, everything below |
| Visitor | `visitor` | `Spectator2026!` | View leaderboard, results, guide |

Visitors are blocked from recording throws both in the interface (the Field
View link is hidden) **and** at the API level (a direct POST returns 403), so
the restriction is real security, not just a hidden button.

## Pages

- `/login` — sign in
- `/` — home
- `/field` — record a throw and watch the animation (admin only)
- `/results` — leaderboard + full throw log
- `/guide` — help and accessibility information

## How the data works

Throws are stored on the **server** in `data/shotput-db.json`, so every
logged-in user sees the same shared leaderboard. The file is created and
seeded automatically on first run.

`db.js` uses a JSON file rather than SQLite because packages like
`better-sqlite3` need a compiled native binary, which often fails to install
on managed school laptops. It keeps the same shape as a database (separate
users / athletes / throws tables, ids, relationships, query functions), so it
can be swapped for real SQL later without changing any calling code.

## Project files

| File | Purpose |
|---|---|
| `server.js` | Express server: sessions, login, role-protected routes, JSON API |
| `db.js` | Data store (users, athletes, throws) |
| `views/*.html` | The five pages |
| `public/js/app.js` | Field animation, validation, leaderboard rendering |
| `public/css/style.css` | All styling |

## Troubleshooting

Open the browser console (F12 → Console). The app logs every step with a
`[shotput]` prefix — page init, field built, throw saved, animation frames,
leaderboard rendered. If a script fails, a red banner appears at the top of
the page rather than failing silently.