// LABORATORY ASSET MANAGEMENT SYSTEM (LAMS)
// Express + PostgreSQL back end
// Group S - DTMG202 & WBDV202 Project

const { loadEnv } = require('./env');
loadEnv();

const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { sendMail, MODE: MAIL_MODE } = require('./mailer');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const LOAN_DAYS = 7;      // business rule: a loan runs for seven days
const FINE_PER_DAY = 5;   // business rule: R5 for every day an item is late

// ============================================================================
// DATABASE
// ============================================================================
const pool = new Pool({
    user:     process.env.DB_USER     || 'postgres',
    host:     process.env.DB_HOST     || 'localhost',
    database: process.env.DB_NAME     || 'lams_db',
    password: process.env.DB_PASSWORD || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10)
});

pool.on('error', (err) => console.error('Unexpected database error:', err.message));

// ============================================================================
// MIDDLEWARE
// ============================================================================
// There is no CORS middleware here on purpose. The pages in public/ are served by
// this same server and call it with relative URLs, so every request is same-origin.
// The old cors({ origin: true, credentials: true }) reflected whatever Origin it was
// sent and allowed credentials with it, which is the one combination the CORS spec
// tells you not to use.
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'lams-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }   // 8 hours
}));

// The pages live in public/ and are served from there. Serving __dirname instead
// would hand out server.js, mailer.js and setup-db.js as plain text to anyone who
// asked for them by name.
app.use(express.static(path.join(__dirname, 'public')));

// Only a logged-in user may continue.
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    next();
}

// Only a technician (or admin) may continue. This is the real access control -
// hiding a nav button in the browser is not access control, so every
// technician-only route below is guarded here on the server.
function requireTechnician(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    if (req.session.user.role !== 'technician') {
        return res.status(403).json({ error: 'Technicians only' });
    }
    next();
}

// ============================================================================
// SHARED CHECKS
// ============================================================================

// An id out of the URL is always a string. Anything that is not a whole number
// reaches Postgres as an invalid integer and comes back as a 500, so it is turned
// away here and the caller gets a message instead of a crash.
function toId(value) {
    return /^\d+$/.test(String(value)) ? Number(value) : null;
}

// A date filter typed by hand, or sent straight to the API, has to look like a
// date before it is bound - otherwise the cast fails inside Postgres and the whole
// request 500s.
function isDateString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !isNaN(Date.parse(value));
}

// Used by both the add and the edit route so the two cannot drift apart. Returns
// an error string, or null when the values are usable. These are the same limits
// the column widths and CHECK constraints enforce; catching them here turns a
// database error into something the technician can actually act on.
function validateAssetInput(input) {
    const { serialNumber, assetName, categoryId, roomId, cost } = input;

    if (!serialNumber || !assetName || !categoryId || !roomId) {
        return 'Serial number, name, category and lab are all required';
    }
    if (String(serialNumber).trim().length > 100) {
        return 'Serial number is too long - 100 characters at most';
    }
    if (String(assetName).trim().length > 150) {
        return 'Asset name is too long - 150 characters at most';
    }
    if (cost !== '' && cost != null) {
        const amount = Number(cost);
        if (!Number.isFinite(amount)) return 'Cost must be a number';
        if (amount < 0) return 'Cost cannot be negative';
    }
    return null;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

// Log in with a student/technician number and password.
app.post('/api/login', async (req, res) => {
    const { studentNumber, password } = req.body;

    if (!studentNumber || !password) {
        return res.json({ success: false, message: 'Please enter your number and password' });
    }

    try {
        const result = await pool.query(
            `SELECT userid, studentnumber, firstname, lastname, usertype, passwordhash, isactive
             FROM users WHERE studentnumber = $1 OR email = $1`,
            [studentNumber]
        );

        // Same message whether the account is missing, inactive or the password
        // is wrong, so the login page cannot be used to discover which accounts exist.
        const fail = () => res.json({ success: false, message: 'Invalid credentials' });

        if (result.rows.length === 0) return fail();

        const user = result.rows[0];
        if (!user.isactive) return fail();

        const ok = await bcrypt.compare(password, user.passwordhash);
        if (!ok) return fail();

        const role = user.usertype === 'Student' ? 'student' : 'technician';

        req.session.user = {
            userId: user.userid,
            name: `${user.firstname} ${user.lastname}`,
            role: role,
            studentNumber: user.studentnumber
        };

        res.json({ success: true, ...req.session.user });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// Lets the page restore a session after a refresh.
app.get('/api/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    res.json(req.session.user);
});

// ---------------------------------------------------------------------------
// PASSWORD RESET
// ---------------------------------------------------------------------------

// Step 1: request a reset link.
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    // Always the same answer, whether or not the address is registered.
    const sameAnswer = {
        success: true,
        message: 'If that email address is registered, a reset link has been sent to it.'
    };

    if (!email) return res.json(sameAnswer);

    try {
        const result = await pool.query(
            'SELECT userid, firstname FROM users WHERE email = $1 AND isactive = TRUE',
            [email.trim().toLowerCase()]
        );

        if (result.rows.length > 0) {
            const user = result.rows[0];

            // The raw token goes in the email. Only its SHA-256 hash is stored,
            // so a copy of the database cannot be used to reset anyone's password.
            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

            // Any earlier unused tokens for this user stop working.
            await pool.query('DELETE FROM passwordreset WHERE userid = $1', [user.userid]);

            // The database works out the expiry, not Node. ExpiresAt is a TIMESTAMP
            // WITHOUT TIME ZONE and the checks against it use CURRENT_TIMESTAMP, so a
            // JavaScript Date sent from a machine that is not on UTC lands in the
            // column already shifted by that machine's offset - two hours here, which
            // turned the promised one hour into three.
            await pool.query(
                "INSERT INTO passwordreset (tokenhash, userid, expiresat)" +
                " VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
                [tokenHash, user.userid]
            );

            const link = `${BASE_URL}/reset.html?token=${token}`;
            await sendMail({
                to: email.trim(),
                subject: 'LAMS password reset',
                text: `Hello ${user.firstname},\n\n` +
                      `A password reset was requested for your LAMS account.\n\n` +
                      `Open this link to choose a new password:\n${link}\n\n` +
                      `The link expires in one hour and can only be used once.\n` +
                      `If you did not request this, you can ignore this email.\n`,
                html: `<p>Hello ${user.firstname},</p>` +
                      `<p>A password reset was requested for your LAMS account.</p>` +
                      `<p><a href="${link}">Choose a new password</a></p>` +
                      `<p>The link expires in one hour and can only be used once.<br>` +
                      `If you did not request this, you can ignore this email.</p>`
            });
        }

        res.json(sameAnswer);
    } catch (error) {
        console.error('Forgot password error:', error.message);
        res.json(sameAnswer);
    }
});

// Step 2: use the link to set a new password.
app.post('/api/reset-password', async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.json({ success: false, message: 'Missing token or password' });
    }
    if (password.length < 8) {
        return res.json({ success: false, message: 'Password must be at least 8 characters' });
    }

    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const result = await pool.query(
            `SELECT userid FROM passwordreset
             WHERE tokenhash = $1 AND used = FALSE AND expiresat > CURRENT_TIMESTAMP`,
            [tokenHash]
        );

        if (result.rows.length === 0) {
            return res.json({ success: false, message: 'That reset link is invalid or has expired' });
        }

        const userId = result.rows[0].userid;
        const newHash = await bcrypt.hash(password, 10);

        await pool.query('UPDATE users SET passwordhash = $1 WHERE userid = $2', [newHash, userId]);
        await pool.query('UPDATE passwordreset SET used = TRUE WHERE tokenhash = $1', [tokenHash]);

        res.json({ success: true, message: 'Password updated. You can now log in.' });
    } catch (error) {
        console.error('Reset password error:', error.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============================================================================
// LOOKUPS (used to fill the search filters)
// ============================================================================
app.get('/api/categories', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT categoryname FROM assetcategory ORDER BY categoryname ASC');
        res.json(result.rows.map(r => r.categoryname));
    } catch (error) {
        console.error('Categories error:', error.message);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

app.get('/api/rooms', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT roomname FROM room ORDER BY roomname ASC');
        res.json(result.rows.map(r => r.roomname));
    } catch (error) {
        console.error('Rooms error:', error.message);
        res.status(500).json({ error: 'Failed to fetch rooms' });
    }
});

// ============================================================================
// ASSETS
// ============================================================================

// Available assets, with optional search and filters.
app.get('/api/assets/available', requireAuth, async (req, res) => {
    try {
        const { search, category, room } = req.query;

        let query = `
            SELECT a.assetid, a.assetname, a.serialnumber, a.condition, a.status,
                   ac.categoryname, r.roomname
            FROM asset a
            JOIN assetcategory ac ON a.categoryid = ac.categoryid
            JOIN room r           ON a.roomid     = r.roomid
            WHERE a.status = 'Available'
        `;
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            query += ` AND (a.assetname ILIKE $${params.length} OR a.serialnumber ILIKE $${params.length})`;
        }
        if (category) {
            params.push(category);
            query += ` AND ac.categoryname = $${params.length}`;
        }
        if (room) {
            params.push(room);
            query += ` AND r.roomname = $${params.length}`;
        }

        query += ' ORDER BY a.assetname ASC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Available assets error:', error.message);
        res.status(500).json({ error: 'Failed to fetch assets' });
    }
});

// Full inventory, including who currently holds each item.
app.get('/api/inventory', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.assetid, a.assetname, a.serialnumber, a.condition, a.status, a.cost,
                   ac.categoryname, r.roomname,
                   l.loanid,
                   u.firstname || ' ' || u.lastname AS checkedoutto,
                   l.checkoutdate, l.duedate
            FROM asset a
            JOIN assetcategory ac ON a.categoryid = ac.categoryid
            JOIN room r           ON a.roomid     = r.roomid
            LEFT JOIN loan l      ON a.assetid    = l.assetid AND l.returndate IS NULL
            LEFT JOIN users u     ON l.userid     = u.userid
            ORDER BY a.assetname ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Inventory error:', error.message);
        res.status(500).json({ error: 'Failed to fetch inventory' });
    }
});

// Categories and rooms with their IDs, for the add/edit asset dropdowns.
app.get('/api/lookups', requireAuth, async (req, res) => {
    try {
        const categories = await pool.query(
            'SELECT categoryid, categoryname FROM assetcategory ORDER BY categoryname');
        const rooms = await pool.query(
            'SELECT roomid, roomname FROM room ORDER BY roomname');
        res.json({ categories: categories.rows, rooms: rooms.rows });
    } catch (error) {
        console.error('Lookups error:', error.message);
        res.status(500).json({ error: 'Failed to load lookups' });
    }
});

// Add a new asset.
app.post('/api/assets', requireTechnician, async (req, res) => {
    const { serialNumber, assetName, categoryId, roomId, condition, cost } = req.body;

    const problem = validateAssetInput(req.body);
    if (problem) return res.json({ success: false, error: problem });

    try {
        const result = await pool.query(
            `INSERT INTO asset (serialnumber, assetname, categoryid, roomid, condition, cost,
                                acquisitiondate, status)
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, 'Available')
             RETURNING assetid, assetname`,
            [serialNumber.trim(), assetName.trim(), categoryId, roomId,
             condition || 'Good', cost === '' || cost == null ? null : cost]
        );
        res.json({ success: true, message: `${result.rows[0].assetname} added to the inventory` });
    } catch (error) {
        if (error.code === '23505') {
            return res.json({ success: false, error: 'An asset with that serial number already exists' });
        }
        if (error.code === '23503') {
            return res.json({ success: false, error: 'That category or lab does not exist' });
        }
        if (error.code === '23514') {
            return res.json({ success: false, error: 'That condition is not a valid value' });
        }
        console.error('Add asset error:', error.message);
        res.status(500).json({ success: false, error: 'Could not add the asset' });
    }
});

// Update an asset's details. Status is deliberately not editable here - it is
// driven by loans and reservations, so letting it be typed in by hand is what
// would put the asset table and the loan table out of step.
app.put('/api/assets/:id', requireTechnician, async (req, res) => {
    const { serialNumber, assetName, categoryId, roomId, condition, cost } = req.body;

    const assetId = toId(req.params.id);
    if (assetId === null) return res.json({ success: false, error: 'Asset not found' });

    const problem = validateAssetInput(req.body);
    if (problem) return res.json({ success: false, error: problem });

    try {
        const result = await pool.query(
            `UPDATE asset
             SET serialnumber = $1, assetname = $2, categoryid = $3,
                 roomid = $4, condition = $5, cost = $6
             WHERE assetid = $7
             RETURNING assetname`,
            [serialNumber.trim(), assetName.trim(), categoryId, roomId,
             condition || 'Good', cost === '' || cost == null ? null : cost,
             assetId]
        );

        if (result.rows.length === 0) {
            return res.json({ success: false, error: 'Asset not found' });
        }
        res.json({ success: true, message: `${result.rows[0].assetname} updated` });
    } catch (error) {
        if (error.code === '23505') {
            return res.json({ success: false, error: 'Another asset already uses that serial number' });
        }
        if (error.code === '23503') {
            return res.json({ success: false, error: 'That category or lab does not exist' });
        }
        if (error.code === '23514') {
            return res.json({ success: false, error: 'That condition is not a valid value' });
        }
        console.error('Update asset error:', error.message);
        res.status(500).json({ success: false, error: 'Could not update the asset' });
    }
});

// Remove an asset from circulation. It is never actually deleted: a loan row
// references the asset, so deleting it would either fail on the foreign key or
// destroy the borrowing history. This marks it Decommissioned instead, which
// keeps every past loan and fine intact.
app.post('/api/assets/:id/remove', requireTechnician, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const asset = await client.query(
            'SELECT assetid, assetname, status FROM asset WHERE assetid = $1 FOR UPDATE',
            [req.params.id]
        );
        if (asset.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: 'Asset not found' });
        }

        const a = asset.rows[0];
        if (a.status === 'Decommissioned') {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: `${a.assetname} has already been removed` });
        }
        if (a.status === 'Checked Out') {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: `${a.assetname} is on loan - take the return first` });
        }

        // A removed item must not stay booked for somebody.
        await client.query(
            "UPDATE reservation SET status = 'Cancelled' WHERE assetid = $1 AND status IN ('Pending','Confirmed')",
            [a.assetid]
        );
        // Only the status changes. Condition records the physical state of the item
        // and is still worth keeping on a removed asset - overwriting it would throw
        // away the last thing we knew about it.
        await client.query(
            "UPDATE asset SET status = 'Decommissioned' WHERE assetid = $1",
            [a.assetid]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: `${a.assetname} removed. Its loan history is kept.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Remove asset error:', error.message);
        res.status(500).json({ success: false, error: 'Could not remove the asset' });
    } finally {
        client.release();
    }
});

// ============================================================================
// OVERDUE (technician only - it exposes every student's contact details)
// ============================================================================
app.get('/api/overdue', requireTechnician, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT l.loanid, l.duedate,
                   CURRENT_DATE - l.duedate AS daysoverdue,
                   a.assetname, a.serialnumber,
                   u.studentnumber, u.phonenumber, u.email,
                   u.firstname || ' ' || u.lastname AS studentname,
                   COALESCE(SUM(DISTINCT f.fineamount) FILTER (WHERE f.paid = FALSE), 0) AS fineamount,
                   l.reminderssent, l.lastremindedat
            FROM loan l
            JOIN asset a  ON l.assetid = a.assetid
            JOIN users u  ON l.userid  = u.userid
            LEFT JOIN fine f ON l.loanid = f.loanid
            WHERE l.returndate IS NULL AND l.duedate < CURRENT_DATE
            GROUP BY l.loanid, l.duedate, l.reminderssent, l.lastremindedat,
                     a.assetname, a.serialnumber,
                     u.studentnumber, u.phonenumber, u.email, u.firstname, u.lastname
            ORDER BY l.duedate ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Overdue error:', error.message);
        res.status(500).json({ error: 'Failed to fetch overdue items' });
    }
});

// Email an overdue reminder to the student holding the item.
// The technician presses one button; the message is built from the loan row.
app.post('/api/overdue/:loanId/notify', requireTechnician, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.firstname, u.email,
                   a.assetname, a.serialnumber,
                   r.roomname,
                   l.duedate,
                   CURRENT_DATE - l.duedate AS daysoverdue,
                   COALESCE(SUM(f.fineamount) FILTER (WHERE f.paid = FALSE), 0) AS fineamount
            FROM loan l
            JOIN asset a ON l.assetid = a.assetid
            JOIN room r  ON a.roomid  = r.roomid
            JOIN users u ON l.userid  = u.userid
            LEFT JOIN fine f ON l.loanid = f.loanid
            WHERE l.loanid = $1 AND l.returndate IS NULL AND l.duedate < CURRENT_DATE
            GROUP BY u.firstname, u.email, a.assetname, a.serialnumber, r.roomname, l.duedate
        `, [req.params.loanId]);

        if (result.rows.length === 0) {
            return res.json({ success: false, error: 'That loan is not overdue' });
        }

        const row = result.rows[0];
        const due = new Date(row.duedate).toLocaleDateString('en-ZA');
        const fine = Number(row.fineamount) || 0;

        const lines = [
            `Dear ${row.firstname},`,
            '',
            'The following item is overdue and needs to be returned:',
            '',
            `Item:      ${row.assetname}`,
            `Asset tag: ${row.serialnumber}`,
            `Due date:  ${due} (${row.daysoverdue} days late)`
        ];
        if (fine > 0) lines.push(`Fine so far: R ${fine.toFixed(2)}`);
        lines.push(
            '',
            `Please bring it back to the ${row.roomname} as soon as you can.`,
            '',
            'Laboratory Asset Management System',
            'Department of Information Systems'
        );

        await sendMail({
            to: row.email,
            subject: `Overdue equipment: ${row.serialnumber}`,
            text: lines.join('\n')
        });

        // Record that this loan has been chased.
        await pool.query(
            `UPDATE loan SET reminderssent = reminderssent + 1,
                             lastremindedat = CURRENT_TIMESTAMP
             WHERE loanid = $1`,
            [req.params.loanId]
        );

        res.json({ success: true, message: `Reminder sent to ${row.firstname} (${row.email})` });
    } catch (error) {
        console.error('Overdue reminder error:', error.message);
        res.status(500).json({ success: false, error: 'Could not send the reminder' });
    }
});

// ============================================================================
// RESERVATIONS
// ============================================================================
app.post('/api/reservation/create', requireAuth, async (req, res) => {
    const { assetId, desiredPickupDate } = req.body;
    const userId = req.session.user.userId;   // taken from the session, never from the request body

    const id = toId(assetId);
    if (id === null || !desiredPickupDate) {
        return res.json({ success: false, error: 'Please choose a pickup date' });
    }

    // The date picker sets a min attribute, but that only stops the form. Anything
    // posted straight to the API would sail past it, which is how a reservation
    // ended up dated 1990.
    if (!isDateString(desiredPickupDate)) {
        return res.json({ success: false, error: 'That pickup date is not a valid date' });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (desiredPickupDate < today) {
        return res.json({ success: false, error: 'The pickup date cannot be in the past' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const asset = await client.query(
            'SELECT status, assetname FROM asset WHERE assetid = $1 FOR UPDATE',
            [id]
        );
        if (asset.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: 'Asset not found' });
        }
        if (asset.rows[0].status !== 'Available') {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: 'That asset is no longer available' });
        }

        // The reservation is actually recorded now, not just implied by a status change.
        await client.query(
            `INSERT INTO reservation (assetid, userid, requestedpickupdate, status)
             VALUES ($1, $2, $3, 'Pending')`,
            [id, userId, desiredPickupDate]
        );
        await client.query("UPDATE asset SET status = 'Reserved' WHERE assetid = $1", [id]);

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `${asset.rows[0].assetname} reserved. Collect it from the technician on the date you chose.`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Reservation error:', error.message);
        res.status(500).json({ success: false, error: 'Could not create the reservation' });
    } finally {
        client.release();
    }
});

// List reservations. A technician sees every active one (this is the queue they
// work from); a student sees only their own.
app.get('/api/reservations', requireAuth, async (req, res) => {
    const user = req.session.user;

    try {
        const isTechnician = user.role === 'technician';

        const result = await pool.query(`
            SELECT r.reservationid, r.reservationdate, r.requestedpickupdate, r.status,
                   a.assetid, a.assetname, a.serialnumber, a.status AS assetstatus,
                   ac.categoryname, rm.roomname,
                   u.userid, u.studentnumber,
                   u.firstname || ' ' || u.lastname AS reservedby,
                   r.requestedpickupdate < CURRENT_DATE AS overdue_pickup
            FROM reservation r
            JOIN asset a          ON r.assetid    = a.assetid
            JOIN assetcategory ac ON a.categoryid = ac.categoryid
            JOIN room rm          ON a.roomid     = rm.roomid
            JOIN users u          ON r.userid     = u.userid
            WHERE r.status IN ('Pending', 'Confirmed')
              AND ($1 = TRUE OR r.userid = $2)
            ORDER BY r.requestedpickupdate ASC
        `, [isTechnician, user.userId]);

        res.json(result.rows);
    } catch (error) {
        console.error('Reservations error:', error.message);
        res.status(500).json({ error: 'Failed to load reservations' });
    }
});

// One-click issue: turn a reservation into a loan.
// This is the normal path - the student already booked the item, so the
// technician just hands it over and presses one button.
app.post('/api/reservations/:id/issue', requireTechnician, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const reservation = await client.query(`
            SELECT r.reservationid, r.assetid, r.userid, r.status,
                   a.assetname, a.status AS assetstatus,
                   u.firstname || ' ' || u.lastname AS studentname
            FROM reservation r
            JOIN asset a ON a.assetid = r.assetid
            JOIN users u ON u.userid  = r.userid
            WHERE r.reservationid = $1
            FOR UPDATE OF r, a
        `, [req.params.id]);

        if (reservation.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: 'Reservation not found' });
        }

        const r = reservation.rows[0];
        if (r.status !== 'Pending' && r.status !== 'Confirmed') {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: `That reservation is already ${r.status.toLowerCase()}` });
        }
        if (r.assetstatus === 'Checked Out') {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: `${r.assetname} is already on loan` });
        }

        await client.query(
            `INSERT INTO loan (assetid, userid, checkoutdate, duedate)
             VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_DATE + $3::int)`,
            [r.assetid, r.userid, LOAN_DAYS]
        );
        await client.query("UPDATE asset SET status = 'Checked Out' WHERE assetid = $1", [r.assetid]);
        // The reservation is now fulfilled - this is the "did they collect it" answer.
        await client.query("UPDATE reservation SET status = 'Completed' WHERE reservationid = $1", [r.reservationid]);

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `${r.assetname} issued to ${r.studentname}. Due back in ${LOAN_DAYS} days.`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') {
            return res.json({ success: false, error: 'That asset already has an open loan' });
        }
        console.error('Issue reservation error:', error.message);
        res.status(500).json({ success: false, error: 'Could not issue the reservation' });
    } finally {
        client.release();
    }
});

// Cancel a reservation and free the asset.
// A technician may cancel any reservation; a student may cancel only their own.
app.post('/api/reservations/:id/cancel', requireAuth, async (req, res) => {
    const user = req.session.user;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const reservation = await client.query(`
            SELECT r.reservationid, r.assetid, r.userid, r.status, a.assetname
            FROM reservation r
            JOIN asset a ON a.assetid = r.assetid
            WHERE r.reservationid = $1
            FOR UPDATE OF r, a
        `, [req.params.id]);

        if (reservation.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: 'Reservation not found' });
        }

        const r = reservation.rows[0];

        if (user.role !== 'technician' && r.userid !== user.userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, error: 'That is not your reservation' });
        }
        if (r.status !== 'Pending' && r.status !== 'Confirmed') {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: `That reservation is already ${r.status.toLowerCase()}` });
        }

        await client.query("UPDATE reservation SET status = 'Cancelled' WHERE reservationid = $1", [r.reservationid]);
        // Only free the asset if it is not somehow out on loan.
        await client.query(
            "UPDATE asset SET status = 'Available' WHERE assetid = $1 AND status = 'Reserved'",
            [r.assetid]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: `Reservation for ${r.assetname} cancelled` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Cancel reservation error:', error.message);
        res.status(500).json({ success: false, error: 'Could not cancel the reservation' });
    } finally {
        client.release();
    }
});

// ============================================================================
// CHECKOUT AND RETURN (technician only)
// ============================================================================
app.post('/api/technician/checkout', requireTechnician, async (req, res) => {
    const { studentNumber, assetSerial } = req.body;

    if (!studentNumber || !assetSerial) {
        return res.json({ success: false, error: 'Student number and asset serial are both required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(
            "SELECT userid FROM users WHERE studentnumber = $1 AND isactive = TRUE",
            [studentNumber.trim()]
        );
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: 'No active user with that number' });
        }

        const assetResult = await client.query(
            'SELECT assetid, status, assetname FROM asset WHERE serialnumber = $1 FOR UPDATE',
            [assetSerial.trim()]
        );
        if (assetResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: 'No asset with that serial number' });
        }

        const asset = assetResult.rows[0];
        if (asset.status === 'Checked Out') {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: `${asset.assetname} is already on loan` });
        }
        if (asset.status === 'Decommissioned' || asset.status === 'Under Repair') {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: `${asset.assetname} is ${asset.status.toLowerCase()} and cannot be issued` });
        }
        // A reserved item must go out through its reservation, so that the
        // reservation gets closed off rather than left hanging as Pending.
        if (asset.status === 'Reserved') {
            await client.query('ROLLBACK');
            return res.json({
                success: false,
                error: `${asset.assetname} is reserved. Issue it from the "Awaiting Collection" list instead.`
            });
        }

        await client.query(
            `INSERT INTO loan (assetid, userid, checkoutdate, duedate)
             VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_DATE + $3::int)`,
            [asset.assetid, userResult.rows[0].userid, LOAN_DAYS]
        );
        await client.query("UPDATE asset SET status = 'Checked Out' WHERE assetid = $1", [asset.assetid]);

        await client.query('COMMIT');
        res.json({ success: true, message: `${asset.assetname} issued. Due back in ${LOAN_DAYS} days.` });
    } catch (error) {
        await client.query('ROLLBACK');
        // 23505 is the partial unique index refusing a second open loan.
        if (error.code === '23505') {
            return res.json({ success: false, error: 'That asset already has an open loan' });
        }
        console.error('Checkout error:', error.message);
        res.status(500).json({ success: false, error: 'Checkout failed' });
    } finally {
        client.release();
    }
});

app.post('/api/technician/return', requireTechnician, async (req, res) => {
    const { loanId, conditionOnReturn } = req.body;

    const id = toId(loanId);
    if (id === null) return res.json({ success: false, error: 'Loan ID is required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Postgres works out how late the item is, for the same reason the reset
        // token expiry does: CURRENT_DATE and DueDate are both the database's,
        // so the answer does not change with the time zone of whoever is running
        // the server.
        const loanResult = await client.query(
            `SELECT l.loanid, l.assetid, l.duedate, a.assetname,
                    GREATEST(0, CURRENT_DATE - l.duedate) AS dayslate
             FROM loan l JOIN asset a ON a.assetid = l.assetid
             WHERE l.loanid = $1 AND l.returndate IS NULL`,
            [id]
        );
        if (loanResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: 'No open loan with that ID' });
        }

        const loan = loanResult.rows[0];
        const condition = ['Like New', 'Good', 'Fair', 'Damaged'].includes(conditionOnReturn)
            ? conditionOnReturn : 'Good';

        await client.query(
            'UPDATE loan SET returndate = CURRENT_DATE, conditiononreturn = $1 WHERE loanid = $2',
            [condition, loan.loanid]
        );
        await client.query("UPDATE asset SET status = 'Available' WHERE assetid = $1", [loan.assetid]);

        // If the item came back damaged, park it for repair instead of re-issuing it.
        if (condition === 'Damaged') {
            await client.query(
                "UPDATE asset SET status = 'Under Repair', condition = 'Needs Repair' WHERE assetid = $1",
                [loan.assetid]
            );
        }

        // A late return raises a fine, inside the same transaction as the return
        // itself - so an item is never recorded as back without the fine that goes
        // with it. The wording matches the fines already in the database.
        const daysLate = Number(loan.dayslate) || 0;
        let fine = 0;
        if (daysLate > 0) {
            fine = daysLate * FINE_PER_DAY;
            await client.query(
                `INSERT INTO fine (loanid, fineamount, finedate, reason, paid)
                 VALUES ($1, $2, CURRENT_DATE, $3, FALSE)`,
                [loan.loanid, fine, `Late return - ${daysLate} days`]
            );
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `${loan.assetname} returned` +
                     (daysLate > 0
                        ? ` (${daysLate} day(s) late - R ${fine.toFixed(2)} fine raised)`
                        : ''),
            daysLate,
            fine
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Return error:', error.message);
        res.status(500).json({ success: false, error: 'Return failed' });
    } finally {
        client.release();
    }
});

// Mark a fine as settled. The WHERE clause carries the Paid = FALSE test, so two
// technicians clicking at the same time cannot both record a payment - the second
// one updates no rows and is told the fine was already settled.
app.post('/api/fines/:id/pay', requireTechnician, async (req, res) => {
    const fineId = toId(req.params.id);
    if (fineId === null) return res.json({ success: false, error: 'Fine not found' });

    try {
        const result = await pool.query(
            `UPDATE fine SET paid = TRUE, paiddate = CURRENT_DATE
             WHERE fineid = $1 AND paid = FALSE
             RETURNING fineid, fineamount`,
            [fineId]
        );

        if (result.rows.length === 0) {
            const exists = await pool.query('SELECT paid FROM fine WHERE fineid = $1', [fineId]);
            return res.json({
                success: false,
                error: exists.rows.length === 0
                    ? 'Fine not found'
                    : 'That fine has already been settled'
            });
        }

        res.json({
            success: true,
            message: `Fine of R ${Number(result.rows[0].fineamount).toFixed(2)} marked as paid`
        });
    } catch (error) {
        console.error('Settle fine error:', error.message);
        res.status(500).json({ success: false, error: 'Could not settle the fine' });
    }
});

// ============================================================================
// DASHBOARDS
// ============================================================================

// A student only ever sees their own loans - the user id comes from the
// session, so changing a number in the URL cannot show someone else's data.
app.get('/api/student/dashboard', requireAuth, async (req, res) => {
    const userId = req.session.user.userId;

    try {
        const activeLoans = await pool.query(`
            SELECT l.loanid, a.assetname, a.serialnumber, l.checkoutdate, l.duedate,
                   COALESCE(SUM(f.fineamount) FILTER (WHERE f.paid = FALSE), 0) AS fineamount
            FROM loan l
            JOIN asset a ON l.assetid = a.assetid
            LEFT JOIN fine f ON l.loanid = f.loanid
            WHERE l.userid = $1 AND l.returndate IS NULL
            GROUP BY l.loanid, a.assetname, a.serialnumber, l.checkoutdate, l.duedate
            ORDER BY l.duedate ASC
        `, [userId]);

        const fines = await pool.query(`
            SELECT COALESCE(SUM(f.fineamount), 0) AS totalfines
            FROM fine f JOIN loan l ON f.loanid = l.loanid
            WHERE l.userid = $1 AND f.paid = FALSE
        `, [userId]);

        // The total on its own does not tell a student what they are being charged
        // for, and a fine that has been paid disappeared from their view entirely.
        // This is the itemised list behind that number, settled ones included.
        const fineList = await pool.query(`
            SELECT f.fineid, f.fineamount, f.finedate, f.reason, f.paid, f.paiddate,
                   a.assetname
            FROM fine f
            JOIN loan l  ON f.loanid  = l.loanid
            JOIN asset a ON l.assetid = a.assetid
            WHERE l.userid = $1
            ORDER BY f.paid ASC, f.finedate DESC
        `, [userId]);

        const totals = await pool.query(
            'SELECT COUNT(*) AS totalborrowed FROM loan WHERE userid = $1', [userId]
        );

        const reservations = await pool.query(
            "SELECT COUNT(*) AS c FROM reservation WHERE userid = $1 AND status IN ('Pending','Confirmed')",
            [userId]
        );

        res.json({
            activeLoans: activeLoans.rows.length,
            activeLoansList: activeLoans.rows,
            fines: parseFloat(fines.rows[0].totalfines) || 0,
            finesList: fineList.rows,
            totalBorrowed: parseInt(totals.rows[0].totalborrowed, 10) || 0,
            reservations: parseInt(reservations.rows[0].c, 10) || 0
        });
    } catch (error) {
        console.error('Student dashboard error:', error.message);
        res.status(500).json({ error: 'Failed to load dashboard' });
    }
});

app.get('/api/technician/dashboard', requireTechnician, async (req, res) => {
    try {
        const assetStats = await pool.query(`
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE status = 'Available')   AS available,
                   COUNT(*) FILTER (WHERE status = 'Checked Out') AS checkedout
            FROM asset
        `);

        const overdueStats = await pool.query(
            'SELECT COUNT(*) AS overduecount FROM loan WHERE returndate IS NULL AND duedate < CURRENT_DATE'
        );

        const checkedOut = await pool.query(`
            SELECT l.loanid, a.assetname, a.serialnumber,
                   u.studentnumber,
                   u.firstname || ' ' || u.lastname AS checkedoutto,
                   l.checkoutdate, l.duedate,
                   CASE WHEN l.duedate < CURRENT_DATE THEN 'Overdue' ELSE 'Active' END AS duestatus
            FROM loan l
            JOIN asset a ON l.assetid = a.assetid
            JOIN users u ON l.userid  = u.userid
            WHERE l.returndate IS NULL
            ORDER BY l.duedate ASC
        `);

        res.json({
            totalAssets:      parseInt(assetStats.rows[0].total, 10),
            availableCount:   parseInt(assetStats.rows[0].available, 10),
            checkedOutCount:  parseInt(assetStats.rows[0].checkedout, 10),
            overdueCount:     parseInt(overdueStats.rows[0].overduecount, 10),
            checkedOutDetails: checkedOut.rows
        });
    } catch (error) {
        console.error('Technician dashboard error:', error.message);
        res.status(500).json({ error: 'Failed to load dashboard' });
    }
});

// ============================================================================
// REPORTS
//
// The six queries the Data Management module asks us to demonstrate.
//
// Technician only: four of the six show other students' names, loans or fines,
// and the business rules say a student may only see their own.
// ============================================================================
const REPORTS = {
    register: {
        label: 'Asset Register',
        title: 'Asset Register',
        sql: `SELECT a.SerialNumber   AS "Asset Tag",
       a.AssetName     AS "Equipment",
       ac.CategoryName AS "Category",
       r.RoomName      AS "Location",
       a.Condition     AS "Condition",
       a.Status        AS "Status"
FROM Asset a
JOIN AssetCategory ac ON a.CategoryID = ac.CategoryID
JOIN Room r           ON a.RoomID     = r.RoomID
ORDER BY ac.CategoryName, a.AssetName;`
    },

    onloan: {
        label: 'Items on Loan',
        title: 'Items Currently on Loan',
        sql: `SELECT a.SerialNumber AS "Asset Tag",
       a.AssetName    AS "Equipment",
       u.StudentNumber AS "Student Number",
       u.FirstName || ' ' || u.LastName AS "Borrower",
       l.CheckoutDate::date AS "Issued",
       l.DueDate            AS "Due",
       l.DueDate - CURRENT_DATE AS "Days Remaining"
FROM Loan l
JOIN Asset a ON l.AssetID = a.AssetID
JOIN Users u ON l.UserID  = u.UserID
WHERE l.ReturnDate IS NULL
ORDER BY l.DueDate ASC;`
    },

    overdue: {
        label: 'Overdue Items',
        title: 'Overdue Items',
        sql: `SELECT a.SerialNumber AS "Asset Tag",
       a.AssetName    AS "Equipment",
       u.StudentNumber AS "Student Number",
       u.FirstName || ' ' || u.LastName AS "Borrower",
       u.PhoneNumber  AS "Contact",
       l.DueDate      AS "Due",
       CURRENT_DATE - l.DueDate AS "Days Overdue"
FROM Loan l
JOIN Asset a ON l.AssetID = a.AssetID
JOIN Users u ON l.UserID  = u.UserID
WHERE l.DueDate < CURRENT_DATE
  AND l.ReturnDate IS NULL
ORDER BY CURRENT_DATE - l.DueDate DESC;`
    },

    utilisation: {
        label: 'Equipment Utilisation',
        title: 'Equipment Utilisation',
        sql: `SELECT a.SerialNumber AS "Asset Tag",
       a.AssetName    AS "Equipment",
       ac.CategoryName AS "Category",
       COUNT(l.LoanID) AS "Times Borrowed",
       MAX(l.CheckoutDate)::date AS "Last Issued"
FROM Asset a
JOIN AssetCategory ac ON a.CategoryID = ac.CategoryID
LEFT JOIN Loan l      ON a.AssetID    = l.AssetID
GROUP BY a.AssetID, a.SerialNumber, a.AssetName, ac.CategoryName
ORDER BY "Times Borrowed" DESC, a.AssetName ASC;`
    },

    latereturns: {
        label: 'Repeat Late Returns',
        title: 'Repeat Late Returns',
        sql: `SELECT u.StudentNumber AS "Student Number",
       u.FirstName || ' ' || u.LastName AS "Student",
       u.PhoneNumber AS "Contact",
       COUNT(*)      AS "Late Returns",
       MAX(l.ReturnDate - l.DueDate) AS "Longest Delay"
FROM Loan l
JOIN Users u ON l.UserID = u.UserID
WHERE l.ReturnDate IS NOT NULL
  AND l.ReturnDate > l.DueDate
GROUP BY u.UserID, u.StudentNumber, u.FirstName, u.LastName, u.PhoneNumber
HAVING COUNT(*) >= 2
ORDER BY "Late Returns" DESC;`
    },

    maintenance: {
        label: 'Maintenance Spend',
        title: 'Maintenance Spend by Category',
        sql: `SELECT ac.CategoryName AS "Category",
       COUNT(m.MaintenanceID) AS "Repairs",
       SUM(m.Cost)            AS "Total Cost",
       ROUND(AVG(m.Cost), 2)  AS "Average Cost"
FROM Maintenance m
JOIN Asset a          ON m.AssetID    = a.AssetID
JOIN AssetCategory ac ON a.CategoryID = ac.CategoryID
GROUP BY ac.CategoryName
ORDER BY "Total Cost" DESC;`
    }
};

// PostgreSQL type OIDs, used to right-align numbers and show money as rands.
const NUMERIC_TYPES = new Set([20, 21, 23, 26, 700, 701, 1700]);
const MONEY_TYPES   = new Set([1700]);

// The list of available reports, for the picker.
app.get('/api/reports', requireTechnician, (req, res) => {
    res.json(Object.keys(REPORTS).map(key => ({
        key: key,
        label: REPORTS[key].label,
        title: REPORTS[key].title
    })));
});

// Run one report and return its SQL alongside the rows it produced.
app.get('/api/reports/:key', requireTechnician, async (req, res) => {
    const report = REPORTS[req.params.key];
    if (!report) return res.status(404).json({ error: 'No such report' });

    try {
        const result = await pool.query(report.sql);
        res.json({
            key: req.params.key,
            title: report.title,
            // The column labels come from the SQL aliases, so the page shows
            // "Student Number" rather than the raw studentnumber column.
            columns: result.fields.map(f => ({
                name: f.name,
                numeric: NUMERIC_TYPES.has(f.dataTypeID),
                money: MONEY_TYPES.has(f.dataTypeID)
            })),
            rows: result.rows,
            rowCount: result.rowCount
        });
    } catch (error) {
        console.error(`Report "${req.params.key}" failed:`, error.message);
        res.status(500).json({ error: 'Could not run that report' });
    }
});

// ============================================================================
// TABLE BROWSER
//
// The six reports above answer fixed questions. This lets a technician look at
// the underlying tables and narrow them down, most usefully by date.
//
// Every table is described here rather than taking a table name from the URL.
// That keeps the list to these seven, so neither PasswordReset nor Users can be
// reached through it - a technician has no reason to page through everyone's
// contact details. Filter values are always bound as query parameters; only the
// column labels come from this file.
// ============================================================================

// Options that the schema already fixes with a CHECK constraint.
const ASSET_STATUSES   = ['Available', 'Checked Out', 'Reserved', 'Under Repair', 'Decommissioned'];
const ASSET_CONDITIONS = ['New', 'Good', 'Fair', 'Needs Repair', 'Decommissioned'];
const RESERVATION_STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];

// A loan has no status column - it is implied by the two dates. The same
// expression is used as a visible column and as the State filter so the two can
// never disagree.
const LOAN_STATE = `CASE WHEN l.ReturnDate IS NOT NULL THEN 'Returned'
          WHEN l.DueDate < CURRENT_DATE  THEN 'Overdue'
          ELSE 'On Loan' END`;

const FINE_STATE = `CASE WHEN f.Paid THEN 'Paid' ELSE 'Unpaid' END`;

const TABLES = {
    asset: {
        label: 'Assets',
        title: 'Asset',
        select: `SELECT a.AssetID        AS "ID",
       a.SerialNumber    AS "Asset Tag",
       a.AssetName       AS "Equipment",
       ac.CategoryName   AS "Category",
       r.RoomName        AS "Lab",
       a.Condition       AS "Condition",
       a.Status          AS "Status",
       a.AcquisitionDate AS "Acquired",
       a.Cost            AS "Cost"
FROM Asset a
JOIN AssetCategory ac ON a.CategoryID = ac.CategoryID
JOIN Room r           ON a.RoomID     = r.RoomID`,
        filters: [
            { key: 'category',  label: 'Category',      type: 'select',
              optionsSql: 'SELECT CategoryName FROM AssetCategory ORDER BY CategoryName',
              where: 'ac.CategoryName = $$' },
            { key: 'lab',       label: 'Lab',           type: 'select',
              optionsSql: 'SELECT RoomName FROM Room ORDER BY RoomName',
              where: 'r.RoomName = $$' },
            { key: 'status',    label: 'Status',        type: 'select', options: ASSET_STATUSES,
              where: 'a.Status = $$' },
            { key: 'condition', label: 'Condition',     type: 'select', options: ASSET_CONDITIONS,
              where: 'a.Condition = $$' },
            { key: 'from',      label: 'Acquired from', type: 'date',
              where: 'a.AcquisitionDate >= $$::date' },
            { key: 'to',        label: 'Acquired to',   type: 'date',
              where: 'a.AcquisitionDate <= $$::date' },
            { key: 'q',         label: 'Search',        type: 'search',
              placeholder: 'Name or asset tag',
              where: '(a.AssetName ILIKE $$ OR a.SerialNumber ILIKE $$)' }
        ],
        orderBy: 'ac.CategoryName, a.AssetName'
    },

    loan: {
        label: 'Loans',
        title: 'Loan',
        select: `SELECT l.LoanID       AS "ID",
       a.SerialNumber       AS "Asset Tag",
       a.AssetName          AS "Equipment",
       u.StudentNumber      AS "Student Number",
       u.FirstName || ' ' || u.LastName AS "Borrower",
       l.CheckoutDate::date AS "Issued",
       l.DueDate            AS "Due",
       l.ReturnDate         AS "Returned",
       ${LOAN_STATE}        AS "State",
       l.RemindersSent      AS "Reminders"
FROM Loan l
JOIN Asset a ON l.AssetID = a.AssetID
JOIN Users u ON l.UserID  = u.UserID`,
        filters: [
            { key: 'state',  label: 'State',       type: 'select',
              options: ['On Loan', 'Overdue', 'Returned'],
              where: `${LOAN_STATE} = $$` },
            { key: 'from',   label: 'Issued from', type: 'date',
              where: 'l.CheckoutDate::date >= $$::date' },
            { key: 'to',     label: 'Issued to',   type: 'date',
              where: 'l.CheckoutDate::date <= $$::date' },
            { key: 'dueby',  label: 'Due by',      type: 'date',
              where: 'l.DueDate <= $$::date' },
            { key: 'q',      label: 'Search',      type: 'search',
              placeholder: 'Student or equipment',
              where: `(u.StudentNumber ILIKE $$ OR u.FirstName ILIKE $$ OR u.LastName ILIKE $$
               OR a.AssetName ILIKE $$ OR a.SerialNumber ILIKE $$)` }
        ],
        orderBy: 'l.CheckoutDate DESC, l.LoanID DESC'
    },

    reservation: {
        label: 'Reservations',
        title: 'Reservation',
        select: `SELECT rs.ReservationID AS "ID",
       a.SerialNumber          AS "Asset Tag",
       a.AssetName             AS "Equipment",
       u.StudentNumber         AS "Student Number",
       u.FirstName || ' ' || u.LastName AS "Student",
       rs.ReservationDate::date AS "Booked",
       rs.RequestedPickupDate  AS "Pickup",
       rs.Status               AS "Status"
FROM Reservation rs
JOIN Asset a ON rs.AssetID = a.AssetID
JOIN Users u ON rs.UserID  = u.UserID`,
        filters: [
            { key: 'status', label: 'Status',      type: 'select', options: RESERVATION_STATUSES,
              where: 'rs.Status = $$' },
            { key: 'from',   label: 'Pickup from', type: 'date',
              where: 'rs.RequestedPickupDate >= $$::date' },
            { key: 'to',     label: 'Pickup to',   type: 'date',
              where: 'rs.RequestedPickupDate <= $$::date' },
            { key: 'q',      label: 'Search',      type: 'search',
              placeholder: 'Student or equipment',
              where: `(u.StudentNumber ILIKE $$ OR u.FirstName ILIKE $$ OR u.LastName ILIKE $$
               OR a.AssetName ILIKE $$ OR a.SerialNumber ILIKE $$)` }
        ],
        orderBy: 'rs.RequestedPickupDate DESC, rs.ReservationID DESC'
    },

    fine: {
        label: 'Fines',
        title: 'Fine',
        select: `SELECT f.FineID   AS "ID",
       f.LoanID         AS "Loan",
       a.SerialNumber   AS "Asset Tag",
       u.StudentNumber  AS "Student Number",
       u.FirstName || ' ' || u.LastName AS "Student",
       f.FineAmount     AS "Amount",
       f.Reason         AS "Reason",
       f.FineDate       AS "Issued",
       ${FINE_STATE}    AS "Settled",
       f.PaidDate       AS "Paid On"
FROM Fine f
JOIN Loan l  ON f.LoanID  = l.LoanID
JOIN Asset a ON l.AssetID = a.AssetID
JOIN Users u ON l.UserID  = u.UserID`,
        filters: [
            { key: 'settled', label: 'Settled',     type: 'select', options: ['Paid', 'Unpaid'],
              where: `${FINE_STATE} = $$` },
            { key: 'from',    label: 'Issued from', type: 'date',
              where: 'f.FineDate >= $$::date' },
            { key: 'to',      label: 'Issued to',   type: 'date',
              where: 'f.FineDate <= $$::date' },
            { key: 'q',       label: 'Search',      type: 'search',
              placeholder: 'Student or reason',
              where: `(u.StudentNumber ILIKE $$ OR u.FirstName ILIKE $$ OR u.LastName ILIKE $$
               OR f.Reason ILIKE $$)` }
        ],
        orderBy: 'f.FineDate DESC, f.FineID DESC',

        // Fines are the one thing a technician settles from this screen, so this
        // table gets an action column. The id and the test both name columns that
        // the select above already returns.
        action: {
            label: 'Settle',
            handler: 'settleFine',
            idColumn: 'ID',
            enabledWhen: { column: 'Settled', equals: 'Unpaid' }
        }
    },

    maintenance: {
        label: 'Maintenance',
        title: 'Maintenance',
        select: `SELECT m.MaintenanceID AS "ID",
       a.SerialNumber        AS "Asset Tag",
       a.AssetName           AS "Equipment",
       m.MaintenanceDate     AS "Date",
       m.ServiceType         AS "Service",
       m.Cost                AS "Cost",
       m.TechnicianName      AS "Technician",
       m.Notes               AS "Notes"
FROM Maintenance m
JOIN Asset a ON m.AssetID = a.AssetID`,
        filters: [
            { key: 'technician', label: 'Technician', type: 'select',
              optionsSql: 'SELECT DISTINCT TechnicianName FROM Maintenance WHERE TechnicianName IS NOT NULL ORDER BY 1',
              where: 'm.TechnicianName = $$' },
            { key: 'from',       label: 'Date from',  type: 'date',
              where: 'm.MaintenanceDate >= $$::date' },
            { key: 'to',         label: 'Date to',    type: 'date',
              where: 'm.MaintenanceDate <= $$::date' },
            { key: 'q',          label: 'Search',     type: 'search',
              placeholder: 'Service or equipment',
              where: '(m.ServiceType ILIKE $$ OR a.AssetName ILIKE $$ OR a.SerialNumber ILIKE $$)' }
        ],
        orderBy: 'm.MaintenanceDate DESC, m.MaintenanceID DESC'
    },

    assetcategory: {
        label: 'Categories',
        title: 'AssetCategory',
        select: `SELECT ac.CategoryID AS "ID",
       ac.CategoryName      AS "Category",
       ac.Description       AS "Description",
       COUNT(a.AssetID)     AS "Assets"
FROM AssetCategory ac
LEFT JOIN Asset a ON ac.CategoryID = a.CategoryID`,
        groupBy: 'ac.CategoryID, ac.CategoryName, ac.Description',
        filters: [
            { key: 'q', label: 'Search', type: 'search', placeholder: 'Category name',
              where: '(ac.CategoryName ILIKE $$ OR ac.Description ILIKE $$)' }
        ],
        orderBy: 'ac.CategoryName'
    },

    room: {
        label: 'Labs',
        title: 'Room',
        select: `SELECT r.RoomID   AS "ID",
       r.RoomName       AS "Lab",
       r.Building       AS "Building",
       r.Floor          AS "Floor",
       r.Capacity       AS "Capacity",
       r.ContactPerson  AS "Contact",
       COUNT(a.AssetID) AS "Assets"
FROM Room r
LEFT JOIN Asset a ON r.RoomID = a.RoomID`,
        groupBy: 'r.RoomID, r.RoomName, r.Building, r.Floor, r.Capacity, r.ContactPerson',
        filters: [
            { key: 'q', label: 'Search', type: 'search', placeholder: 'Lab or building',
              where: '(r.RoomName ILIKE $$ OR r.Building ILIKE $$ OR r.ContactPerson ILIKE $$)' }
        ],
        orderBy: 'r.RoomName'
    }
};

// Turn the query string into a WHERE clause. A filter that was left blank is
// skipped, so the table comes back whole. $$ in a filter's template is replaced
// by the real placeholder number - reusing one number where a search covers
// several columns, so the value is only bound once.
function buildTableQuery(table, query) {
    const conditions = [];
    const params = [];

    (table.filters || []).forEach(filter => {
        const raw = query[filter.key];
        if (raw === undefined || raw === null || String(raw).trim() === '') return;

        const value = String(raw).trim();

        // A date filter is cast to a date by Postgres. If the value is not shaped
        // like one the cast throws and the whole request 500s, so an unusable date
        // is dropped rather than sent. Injection is not the worry here - the value
        // is still bound as a parameter either way - it is simply a crash.
        if (filter.type === 'date' && !isDateString(value)) return;

        params.push(filter.type === 'search' ? `%${value}%` : value);
        conditions.push(filter.where.replace(/\$\$/g, '$' + params.length));
    });

    let sql = table.select;
    if (conditions.length > 0) sql += '\nWHERE ' + conditions.join('\n  AND ');
    if (table.groupBy)         sql += '\nGROUP BY ' + table.groupBy;
    if (table.orderBy)         sql += '\nORDER BY ' + table.orderBy;
    sql += '\nLIMIT 500';

    return { sql: sql, params: params };
}

// The picker, with each table's filters and the options to put in its dropdowns.
app.get('/api/tables', requireTechnician, async (req, res) => {
    try {
        const list = [];

        for (const key of Object.keys(TABLES)) {
            const table = TABLES[key];
            const filters = [];

            for (const filter of table.filters || []) {
                let options = filter.options || null;
                if (filter.optionsSql) {
                    const result = await pool.query(filter.optionsSql);
                    options = result.rows.map(row => Object.values(row)[0]);
                }
                filters.push({
                    key: filter.key,
                    label: filter.label,
                    type: filter.type,
                    placeholder: filter.placeholder || null,
                    options: options
                });
            }

            list.push({ key: key, label: table.label, title: table.title, filters: filters });
        }

        res.json(list);
    } catch (error) {
        console.error('Table list error:', error.message);
        res.status(500).json({ error: 'Could not load the table list' });
    }
});

// One table, filtered by whatever was sent in the query string.
app.get('/api/tables/:key', requireTechnician, async (req, res) => {
    const table = TABLES[req.params.key];
    if (!table) return res.status(404).json({ error: 'No such table' });

    const { sql, params } = buildTableQuery(table, req.query);

    try {
        const result = await pool.query(sql, params);
        res.json({
            key: req.params.key,
            title: table.title,
            columns: result.fields.map(f => ({
                name: f.name,
                numeric: NUMERIC_TYPES.has(f.dataTypeID),
                money: MONEY_TYPES.has(f.dataTypeID)
            })),
            rows: result.rows,
            rowCount: result.rowCount,
            // Only the fines table sets this. The browser draws a button from it,
            // so the table stays a plain list everywhere else.
            action: table.action || null
        });
    } catch (error) {
        console.error(`Table "${req.params.key}" failed:`, error.message);
        res.status(500).json({ error: 'Could not read that table' });
    }
});

// ============================================================================
// START
// ============================================================================
app.listen(PORT, async () => {
    console.log(`\nLAMS server running on ${BASE_URL}`);
    console.log(`Mail transport: ${MAIL_MODE}`);

    try {
        const check = await pool.query('SELECT COUNT(*) AS c FROM users');
        console.log(`Database: connected (${check.rows[0].c} users)\n`);
    } catch (error) {
        console.error(`\nDatabase: NOT CONNECTED - ${error.message}`);
        console.error('Check your .env settings, then run:  npm run setup-db\n');
    }
});
