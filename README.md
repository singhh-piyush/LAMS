# LAMS — Laboratory Asset Management System

DTMG202 (Data Management) & WBDV202 (Web Development) integrated project, Semester 2, 2026.

A web application for the IoT lab's equipment. Students browse what is available and see
their own loans; the technician issues and returns equipment, chases overdue items and
views reports. Everything is backed by a PostgreSQL database.

---

## What you need

| | |
|---|---|
| **Node.js** | v18 or newer — <https://nodejs.org> (LTS) |
| **PostgreSQL** | v12 or newer — <https://www.postgresql.org/download> |

Nothing else. No Docker, no build step, no framework.

---

## Setup (about 5 minutes)

**1. Install the dependencies**

```bash
cd LAMS
npm install
```

**2. Create your config file**

Copy `.env.example` to `.env` and put your own PostgreSQL password in it:

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

The only line you *must* change is `DB_PASSWORD` — the password you chose when you
installed PostgreSQL.

**3. Create and populate the database**

```bash
npm run setup-db
```

This creates the `lams_db` database and runs `lams_database_setup.sql`. You should see:

```
Users: 11
Categories: 8
Rooms: 3
Assets: 16
Loans: 20
Fines: 5
Maintenance: 6
Reservations: 3
OK - every asset status matches the loan table
```

You can re-run this at any time to reset the demo data back to a clean state — useful
right before the presentation.

**4. Start the server**

```bash
npm start
```

Then open <http://localhost:3000>.

---

## Test accounts

Every account uses the password **`Password123`**.

| Number | Who | Role |
|---|---|---|
| `25116045` | Kailash Bhyro Deyal | Student (has an overdue Raspberry Pi) |
| `25067628` | Kynan Poliah | Student (overdue item + an unpaid fine) |
| `22493903` | Piyush Singh | Student (clean history) |
| `TECH001` | Ahmed Hassan | Technician |
| `TECH002` | Nalini Sharma | Technician |

---

## Email (password reset)

The "Forgot your password?" link sends a reset email. Which transport it uses is set by
`MAIL_TRANSPORT` in `.env`:

| Value | What it does |
|---|---|
| `console` | **Default.** Prints the reset link to the terminal. Needs no account, so a fresh clone works immediately. |
| `mailtrap` | Sends to a Mailtrap sandbox inbox. Set `MAILTRAP_TOKEN` and `MAILTRAP_INBOX_ID`. Mail is captured, never delivered to a real person — this is what we demo with. |
| `smtp` | Any normal SMTP server (Mailtrap SMTP, Gmail with an App Password, ...). Set the `SMTP_*` values. |

Switching provider is a `.env` change only — no code changes.

---

## Project files

| File | What it is |
|---|---|
| `lams_database_setup.sql` | Schema, constraints, views and seed data. The DTMG deliverable. |
| `LAMS/server.js` | Express API — login, assets, loans, reports, password reset |
| `LAMS/app.js` | Front-end logic |
| `LAMS/index.html` | Login page and the main application |
| `LAMS/reset.html` | The page the password-reset email links to |
| `LAMS/styles.css` | All styling |
| `LAMS/mailer.js` | Email transport (console / Mailtrap / SMTP) |
| `LAMS/setup-db.js` | The `npm run setup-db` helper |
| `LAMS/env.js` | Small `.env` reader |

---

## Notes for the demo

- **Seed dates are relative to today.** Loans are inserted as `CURRENT_DATE - 20` and so on,
  so the overdue report always returns rows no matter which day you present.
- **The business rule is enforced by the database**, not just the code:
  ```sql
  CREATE UNIQUE INDEX one_open_loan_per_asset ON Loan (AssetID) WHERE ReturnDate IS NULL;
  ```
  An asset can have many past loans but only one open one, so issuing something that is
  already out is impossible. Worth showing — try checking out `RPI-001-2024` twice.
- **Role checks are on the server.** Logging in as a student and requesting a
  technician-only URL returns 403, not a hidden button.
- **Three assets have never been borrowed** (`ARM-003-2024`, `PSU-001-2024`, `ROB-002-2024`)
  so the "never borrowed" rows in the utilisation report are always populated.

## Known limitations

- Fines are recorded, not collected — there is no payment integration.
- No email or SMS chasing of overdue items; the technician phones the number on screen.
- `asset.status` duplicates what the loan table already implies. It is kept for speed, and
  the partial unique index above is what stops the two disagreeing.
- Sessions are held in memory, so restarting the server logs everyone out.
