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
| `LAMS/server.js` | Express API — login, assets, loans, reservations, reports, email |
| `LAMS/app.js` | Front-end logic |
| `LAMS/index.html` | Login page and the main application |
| `LAMS/reset.html` | The page the password-reset email links to |
| `LAMS/styles.css` | All styling |
| `LAMS/mailer.js` | Email transport (console / Mailtrap / SMTP) |
| `LAMS/setup-db.js` | The `npm run setup-db` helper |
| `LAMS/env.js` | Small `.env` reader |

---

## How a loan actually happens

The normal path is **one click**, because the student books the item first:

1. Student finds the item under **Browse Assets** and presses **Reserve**, choosing a pickup date.
   The item's status becomes `Reserved` and a row is written to the `reservation` table.
2. It appears on the student's **My Dashboard** under *Your Reservations*, and in the
   technician's **Checkout / Return** tab under *Awaiting Collection*.
3. The student arrives. The technician presses **Issue** — in one transaction this creates the
   loan, sets the asset to `Checked Out` and marks the reservation `Completed`. That status
   is the answer to "did they actually collect it".
4. On the way back, the technician picks a condition and presses **Return**. Anything marked
   `Damaged` goes to `Under Repair` automatically.

Either side can press **Cancel** on a reservation, which sets it to `Cancelled` and puts the
item back on the shelf. Reservations do not expire on their own — the technician clears them.

The **Walk-in checkout** form at the bottom of that tab is the exception: it is for a student
who turns up without having reserved anything. Trying to use it on an item that is already
reserved is refused and points you at the Awaiting Collection list, so a reservation can never
be left hanging as `Pending` after the item has gone out.

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
being issuable. An item that is currently on loan cannot be removed until it comes back.

## Chasing overdue items

Each row of **Overdue Loans & Fines** has an **Email Student** button. The technician
confirms, and the reminder is built from the loan row and sent through the same mail
transport as the password reset, so during the demo it lands in the Mailtrap inbox.

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
of the page - `Loan` is ten columns wide.

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
the whole table back. `Loan` has no status column - the State filter and the State column both
come from the same `CASE` expression over `ReturnDate` and `DueDate`, so the two can never
disagree.

Three things about this are worth pointing out in the demo:

- **The seven tables are listed in `server.js`, not taken from the URL.** `/api/tables/:key`
  looks the key up in a fixed object, so `PasswordReset` is unreachable and `/api/tables/pg_shadow`
  returns 404. `Users` is not in the list either - a technician has no reason to page through
  every student's email and phone number. The details they do need for chasing an overdue item
  are on the Overdue Loans table instead.
- **Filter values are bound as query parameters**, never pasted into the SQL. Only the column
  labels come from the file. Putting `'; DROP TABLE loan; --` in a search box returns 0 rows
  and leaves the table alone.
- **It is technician-only**, like the reports, because `Loan`, `Fine` and `Reservation` all
  show other students' names and numbers.

## Notes for the demo

- **Seed dates are relative to today.** Loans are inserted as `CURRENT_DATE - 20` and so on,
  so the overdue report always returns rows no matter which day you present.
- **Two business rules are enforced by the database**, not just by the code:
  ```sql
  CREATE UNIQUE INDEX one_open_loan_per_asset
      ON Loan (AssetID) WHERE ReturnDate IS NULL;

  CREATE UNIQUE INDEX one_active_reservation_per_asset
      ON Reservation (AssetID) WHERE Status IN ('Pending', 'Confirmed');
  ```
  An asset can have many past loans but only one open one, and many past reservations but
  only one active one. Both are partial unique indexes, so issuing or reserving something
  twice is impossible even from psql. Worth showing — try checking out `RPI-001-2024` twice.
- **Role checks are on the server.** Logging in as a student and requesting a
  technician-only URL returns 403, not a hidden button.
- **Three assets have never been borrowed** (`ARM-003-2024`, `PSU-001-2024`, `ROB-002-2024`)
  so the "never borrowed" rows in the utilisation report are always populated.

## Known limitations

- Fines are recorded, not collected — there is no payment integration.
- Overdue reminders are emailed from the Overdue Loans & Fines table, one button per loan.
  There is no SMS, and no record is kept of which reminders were sent.
- `asset.status` duplicates what the loan table already implies. It is kept for speed, and
  the partial unique index above is what stops the two disagreeing.
- Sessions are held in memory, so restarting the server logs everyone out.
