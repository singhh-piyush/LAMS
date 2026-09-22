// LABORATORY ASSET MANAGEMENT SYSTEM (LAMS)
// Express + PostgreSQL back end
// Group S - DTMG202 & WBDV202 Project

const { loadEnv } = require('./env');
loadEnv();

const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { sendMail, MODE: MAIL_MODE } = require('./mailer');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const LOAN_DAYS = 7;   // business rule: a loan runs for seven days

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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'lams-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }   // 8 hours
}));
app.use(express.static(__dirname));

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
            const expires = new Date(Date.now() + 60 * 60 * 1000);   // 1 hour

            // Any earlier unused tokens for this user stop working.
            await pool.query('DELETE FROM passwordreset WHERE userid = $1', [user.userid]);
            await pool.query(
                'INSERT INTO passwordreset (tokenhash, userid, expiresat) VALUES ($1, $2, $3)',
                [tokenHash, user.userid, expires]
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
            SELECT a.assetid, a.assetname, a.serialnumber, a.condition, a.status,
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

// ============================================================================
// OVERDUE (technician only - it exposes every student's contact details)
// ============================================================================
app.get('/api/overdue', requireTechnician, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT l.loanid, l.duedate,
                   CURRENT_DATE - l.duedate AS daysoverdue,
                   a.assetname, a.serialnumber,
                   u.studentnumber, u.phonenumber,
                   u.firstname || ' ' || u.lastname AS studentname,
                   COALESCE(SUM(f.fineamount) FILTER (WHERE f.paid = FALSE), 0) AS fineamount
            FROM loan l
            JOIN asset a  ON l.assetid = a.assetid
            JOIN users u  ON l.userid  = u.userid
            LEFT JOIN fine f ON l.loanid = f.loanid
            WHERE l.returndate IS NULL AND l.duedate < CURRENT_DATE
            GROUP BY l.loanid, l.duedate, a.assetname, a.serialnumber,
                     u.studentnumber, u.phonenumber, u.firstname, u.lastname
            ORDER BY l.duedate ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Overdue error:', error.message);
        res.status(500).json({ error: 'Failed to fetch overdue items' });
    }
});

// ============================================================================
// RESERVATIONS
// ============================================================================
app.post('/api/reservation/create', requireAuth, async (req, res) => {
    const { assetId, desiredPickupDate } = req.body;
    const userId = req.session.user.userId;   // taken from the session, never from the request body

    if (!assetId || !desiredPickupDate) {
        return res.json({ success: false, error: 'Please choose a pickup date' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const asset = await client.query(
            'SELECT status, assetname FROM asset WHERE assetid = $1 FOR UPDATE',
            [assetId]
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
            [assetId, userId, desiredPickupDate]
        );
        await client.query("UPDATE asset SET status = 'Reserved' WHERE assetid = $1", [assetId]);

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

    if (!loanId) return res.json({ success: false, error: 'Loan ID is required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const loanResult = await client.query(
            `SELECT l.loanid, l.assetid, l.duedate, a.assetname
             FROM loan l JOIN asset a ON a.assetid = l.assetid
             WHERE l.loanid = $1 AND l.returndate IS NULL`,
            [loanId]
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

        await client.query('COMMIT');

        const daysLate = Math.max(0, Math.floor(
            (Date.now() - new Date(loan.duedate).getTime()) / 86400000
        ));
        res.json({
            success: true,
            message: `${loan.assetname} returned` + (daysLate > 0 ? ` (${daysLate} day(s) late)` : ''),
            daysLate
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Return error:', error.message);
        res.status(500).json({ success: false, error: 'Return failed' });
    } finally {
        client.release();
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
        description: 'Every item held by the lab, with its category, storage location and current condition.',
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
        description: 'Equipment signed out at the moment, who is holding it and when it falls due.',
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
        description: 'Loans past their due date with nothing returned, including a contact number for follow-up.',
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
        description: 'How often each item has been issued, including equipment that has never been borrowed.',
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
        description: 'Students who have brought equipment back late on two or more separate occasions.',
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
        description: 'Repair and servicing costs grouped by equipment category, to show where the budget goes.',
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
        title: REPORTS[key].title,
        description: REPORTS[key].description
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
            description: report.description,
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
        res.status(500).json({ error: 'Report failed: ' + error.message });
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
