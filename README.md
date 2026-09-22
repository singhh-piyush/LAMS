# LAMS — Laboratory Asset Management System

DTMG202 (Data Management) & WBDV202 (Web Development) integrated project, Semester 2, 2026.

A web application for the IoT lab's equipment. Students browse what is available, reserve
items and see their own loans and fines; the technician issues and returns equipment, chases
overdue items, settles fines and runs reports. Everything is backed by a PostgreSQL database.

---

# Running it on your own machine

**Start here.** These steps take a fresh clone of this repository to a working app in about
five minutes. Everyone in the group runs their own copy against their own local database.

## 1. Install the two things you need

| | |
|---|---|
| **Node.js** | v18 or newer — <https://nodejs.org> (take the LTS build) |
| **PostgreSQL** | v12 or newer — <https://www.postgresql.org/download> |

**Write down the PostgreSQL password you choose during installation.** You need it in step 3,
and there is no easy way to recover it afterwards.

Nothing else is required. No Docker, no build step, no framework.

## 2. Get the code and install the dependencies

```bash
git clone https://github.com/singhh-piyush/LAMS.git
cd LAMS/LAMS
npm install
```

The repository folder is `LAMS` and the application folder inside it is also `LAMS` — that
second `cd` is not a typo. Everything below is run from the inner folder, the one containing
`package.json`.

## 3. Create your config file

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

Open `.env` and set **`DB_PASSWORD`** to the PostgreSQL password from step 1. That is the only
line you must change; every other default works as-is.

`.env` is git-ignored. Your password stays on your machine and must never be committed.

## 4. Create and fill the database

```bash
npm run setup-db
```

This creates the `lams_db` database and runs `lams_database_setup.sql` against it. You should
see:

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
OK - every asset status matches the reservation table
```

Re-run this command at any time to reset the demo data to a clean state — useful right before
the presentation, and after anyone has been clicking around testing.

## 5. Start it

```bash
npm start
```

Open <http://localhost:3000>.

## 6. Log in

Every account uses the password **`Password123`**.

| Number | Who | Role |
|---|---|---|
| `25116045` | Kailash Bhyro Deyal | Student (has an overdue Raspberry Pi) |
| `25067628` | Kynan Poliah | Student (overdue item, one unpaid and one paid fine) |
| `22493903` | Piyush Singh | Student (clean history) |
| `TECH001` | Ahmed Hassan | Technician |
| `TECH002` | Nalini Sharma | Technician |

## If something goes wrong

| What you see | What it means |
|---|---|
| `Cannot find module 'express'` | You skipped `npm install`, or you ran it in the wrong folder. It belongs in the inner `LAMS` folder, next to `package.json`. |
| `Could not connect to PostgreSQL` | PostgreSQL is not running, or `DB_USER` / `DB_PASSWORD` in `.env` are wrong. |
| `Database: NOT CONNECTED` when the server starts | Run `npm run setup-db` first. |
| `Port 3000 already in use` | Something else is on that port. Change `PORT` in `.env`, and change `BASE_URL` to match. |
| The page loads but every list is empty | The database exists but was never filled. Run `npm run setup-db`. |

Prefer to do the database by hand instead of using `npm run setup-db`? Create a database
called `lams_db`, open a query tool against it, and run the whole of
`lams_database_setup.sql`. The script does the same thing.

---

# How the system works

## Roles

There are two roles in the application. A student sees only their own loans, reservations and
fines. A technician sees everything, plus the tabs for issuing, returning, inventory, reports
and table browsing.

Role checks live on the **server**, in `requireAuth` and `requireTechnician`. Logging in as a
student and requesting a technician-only URL returns `403`, not a hidden button — hiding a nav
item in the browser is not access control.

## The life of a loan

The normal path is **one click**, because the student books the item first:

1. Student finds the item under **Browse Assets** and presses **Reserve**, choosing a pickup
   date. The item's status becomes `Reserved` and a row is written to the `reservation` table.
2. It appears on the student's **My Dashboard** under *Your Reservations*, and in the
   technician's **Checkout / Return** tab under *Awaiting Collection*.
3. The student arrives. The technician presses **Issue** — in one transaction this creates the
   loan, sets the asset to `Checked Out` and marks the reservation `Completed`. That status is
   the answer to "did they actually collect it".
4. On the way back, the technician picks a condition and presses **Return**. Anything marked
   `Damaged` goes to `Under Repair` automatically.
5. **If the item is late, the return raises a fine** — see below.

Either side can press **Cancel** on a reservation, which sets it to `Cancelled` and puts the
item back on the shelf. Reservations do not expire on their own; the technician clears them.

The **Walk-in checkout** form at the bottom of that tab is the exception: it is for a student
who turns up without having reserved anything. Trying to use it on an item that is already
reserved is refused and points you at the Awaiting Collection list, so a reservation can never
be left hanging as `Pending` after the item has gone out.

## Fines

A loan returned after its due date raises a fine automatically, at **R5.00 for every day
late**, written in the same transaction as the return itself. An item can therefore never be
recorded as back without the fine that goes with it.

```
returned 9 days late  ->  fine of R45.00, reason "Late return - 9 days"
returned on time      ->  no fine row at all
```

**A loan is only fined once.** A technician can raise a fine while an item is still out —
that is what the seeded "Overdue return - item still out" fines are — so if the loan already
has an unpaid fine, returning it does not add a second one for the same lateness. The message
says *"13 day(s) late - already fined"* instead.

The technician settles a fine from **Browse Tables → Fines**, which is the only table in that
tab with a button on its rows. **Settle** marks it paid and stamps today's date. The update
carries the "not already paid" test in its `WHERE` clause, so two technicians clicking at the
same time cannot both record a payment — the second one is told it was already settled.

Students see their own fines under **Your Fines** on their dashboard: what each one was for,
when it was issued, how much, and whether it has been paid. Paid fines stay listed, so there
is a record rather than a number that silently drops to zero.

## Managing the inventory

The **Inventory** tab is read-only for students. A technician also gets:

- an **Add Asset** button above the table, which opens a form with Category and Lab chosen
  from dropdowns
- **Edit** on each row, which opens the same form filled in, for the name, serial number,
  category, lab, condition and cost
- **Remove** on each row

Status is deliberately not editable by hand. It is driven by loans and reservations, and
letting it be typed in is exactly what would put `asset.status` and the `loan` table out of
step with each other.

**Remove, not delete.** Equipment is never deleted from the database. A `loan` row references
the asset with `ON DELETE RESTRICT`, so deleting anything ever borrowed would either fail or
destroy the borrowing history. Removing sets the status to `Decommissioned`, cancels any
active reservation on it, and keeps every past loan and fine intact — the item simply stops
being issuable. An item currently on loan cannot be removed until it comes back, and its
recorded **condition is left alone**, because that is the last thing we knew about the
physical item.

## Chasing overdue items

Each row of **Overdue Loans & Fines** has an **Email Student** button. The technician confirms,
and the reminder is built from the loan row and sent through the same mail transport as the
password reset.

Every reminder is recorded on the loan itself:

```sql
RemindersSent  INTEGER NOT NULL DEFAULT 0,
LastRemindedAt TIMESTAMP,
```

so the **Reminders** column shows how many times a student has been chased and when it last
happened. The columns live on `Loan` rather than on `Fine` because a loan can be overdue
without ever having been fined — `STM-001-2024` in the seed data is exactly that case, so a
counter on `Fine` would have nowhere to go. `Fine` is also one-to-many from `Loan`, which
would leave "which fine row holds the count" with no sensible answer.

## Reports

The **Reports** tab runs six queries straight against the database. This is the Data Management
"demonstration of queries" deliverable, and it is technician-only because four of the six show
other students' details. The SQL for each one is in `LAMS/server.js`, in the `REPORTS` object.

1. All assets with their category and room — a three-table join
2. Everything currently on loan, with who holds it and when it is due
3. Overdue items, with the student's phone number and days overdue
4. Most borrowed assets, and assets never borrowed — a `LEFT JOIN` so zero-loan items appear
5. Students with two or more late returns — `GROUP BY ... HAVING`
6. Total maintenance cost per category

## Browsing the tables

The **Browse Tables** tab is the reports' counterpart: instead of six fixed questions it shows
the tables themselves, picked from a row of buttons and narrowed down with filters. It is its
own tab rather than a second list inside Reports so the table underneath gets the full width
of the page — `Loan` is ten columns wide.

Each table has the filters that are actually useful for it:

| Table | Filters |
|---|---|
| `Asset` | category, lab, status, condition, acquired from/to, search |
| `Loan` | state (On Loan / Overdue / Returned), issued from/to, due by, search |
| `Reservation` | status, pickup from/to, search |
| `Fine` | settled (Paid / Unpaid), issued from/to, search |
| `Maintenance` | technician, date from/to, search |
| `AssetCategory`, `Room` | search |

A filter left blank is left out of the `WHERE` clause entirely, so clearing everything gives
the whole table back. `Loan` has no status column — the State filter and the State column both
come from the same `CASE` expression over `ReturnDate` and `DueDate`, so the two can never
disagree.

Three things about this are worth pointing out in the demo:

- **The seven tables are listed in `server.js`, not taken from the URL.** `/api/tables/:key`
  looks the key up in a fixed object, so `PasswordReset` is unreachable and
  `/api/tables/pg_shadow` returns 404. `Users` is not in the list either — a technician has no
  reason to page through every student's email and phone number. The details they do need for
  chasing an overdue item are on the Overdue Loans table instead.
- **Filter values are bound as query parameters**, never pasted into the SQL. Only the column
  labels come from the file. Putting `'; DROP TABLE loan; --` in a search box returns 0 rows
  and leaves the table alone.
- **It is technician-only**, like the reports, because `Loan`, `Fine` and `Reservation` all
  show other students' names and numbers.

---

# The database

Nine tables, created by `lams_database_setup.sql`:

`AssetCategory`, `Room`, `Users`, `Asset`, `Loan`, `Fine`, `Maintenance`, `Reservation`,
`PasswordReset`

The table is `Users`, not `User` — `USER` is a reserved word in PostgreSQL, so an unquoted
`User` does not mean what it looks like it means.

**Two business rules are enforced by the database itself**, not just by the code:

```sql
CREATE UNIQUE INDEX one_open_loan_per_asset
    ON Loan (AssetID) WHERE ReturnDate IS NULL;

CREATE UNIQUE INDEX one_active_reservation_per_asset
    ON Reservation (AssetID) WHERE Status IN ('Pending', 'Confirmed');
```

An asset can have many past loans but only one open one, and many past reservations but only
one active one. Both are partial unique indexes, so issuing or reserving something twice is
impossible even from psql. Worth showing in the demo — try checking out `RPI-001-2024` twice.

Other things the schema does: `CHECK` constraints on every status and condition column, foreign
keys with deliberate `ON DELETE` rules (`RESTRICT` where history must survive, `CASCADE` where
the child row is meaningless without its parent), and four views.

---

# Email

The "Forgot your password?" link sends a reset email. Which transport it uses is set by
`MAIL_TRANSPORT` in `.env`:

| Value | What it does |
|---|---|
| `console` | **Default.** Prints the reset link to the terminal. Needs no account, so a fresh clone works immediately. |
| `mailtrap` | Sends to a Mailtrap sandbox inbox. Set `MAILTRAP_TOKEN` and `MAILTRAP_INBOX_ID`. Mail is captured, never delivered to a real person. |
| `smtp` | Any normal SMTP server (Mailtrap SMTP, Gmail with an App Password, ...). Set the `SMTP_*` values. |

Switching provider is a `.env` change only — no code changes.

**You reset by student number or email**, the same as the login box accepts — so a student who
only ever remembers their number can still get in.

Wherever you start from, the link is sent to **the email address stored on that account**,
never to an address typed into the form. That matters: if it mailed whatever was typed, then
a student number plus any address would send someone else's reset link to the sender.

The link is single-use and expires one hour after it is issued. Only a SHA-256 hash of the
token is stored, so a copy of the database cannot be used to reset anyone's password. The
endpoint gives the same answer whether or not the account exists, and does not repeat back
which address it used, so it cannot be used to find out who has an account or to look up
somebody's email from their student number.

---

# Project files

| File | What it is |
|---|---|
| `lams_database_setup.sql` | Schema, constraints, indexes, views and seed data. The DTMG deliverable. |
| `LAMS/server.js` | Express API — login, assets, loans, reservations, fines, reports, email |
| `LAMS/mailer.js` | Email transport (console / Mailtrap / SMTP) |
| `LAMS/setup-db.js` | The `npm run setup-db` helper. **Local use only** — it creates the database. |
| `LAMS/env.js` | Small `.env` reader |
| `LAMS/public/index.html` | Login page and the main application |
| `LAMS/public/app.js` | Front-end logic |
| `LAMS/public/styles.css` | All styling |
| `LAMS/public/reset.html` | The page the password-reset email links to |

Everything the browser is allowed to download lives in `LAMS/public/`. The server serves that
one folder, so `server.js`, `mailer.js` and `.env` are not reachable over HTTP.

---

# Notes for the demo

- **Seed dates are relative to today.** Loans are inserted as `CURRENT_DATE - 20` and so on,
  so the overdue report always returns rows no matter which day you present.
- **Three assets have never been borrowed** (`ARM-003-2024`, `PSU-001-2024`, `ROB-002-2024`)
  so the "never borrowed" rows in the utilisation report are always populated.
- **Run `npm run setup-db` before presenting.** It puts the demo data back exactly as
  described above, whatever anyone has been clicking on.
- A good five-minute run-through: reserve an item as a student → issue it as the technician →
  return something overdue and show the fine appear → settle that fine → open a report → show
  a 403 by requesting a technician URL while logged in as a student.

# Known limitations

- Fines are raised and settled in the system, but there is no payment integration — pressing
  **Settle** records that the student paid, it does not take the money.
- Overdue reminders are email only, one button per loan. There is no SMS.
- Maintenance records can be viewed and reported on but not added through the app; they are
  loaded with the seed data.
- `asset.status` duplicates what the loan table already implies. It is kept for speed, and the
  partial unique index above is what stops the two disagreeing.
- Sessions are held in memory, so restarting the server logs everyone out.
