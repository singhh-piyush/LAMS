const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = 3000;

// Database Connection Configuration
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'lams_db',
    password: 'Vsxjdd101#',
    port: 5432,
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================================================
// API 1: LOGIN
// ============================================================================
app.post('/api/login', (req, res) => {
    const { studentNumber, password, userType } = req.body;
    
    // Demo credentials (hardcoded for presentation)
    if (studentNumber === '25116045') {
        res.json({ 
            success: true, 
            userId: 1, 
            name: 'Student User', 
            role: 'student' 
        });
    } else if (studentNumber === 'TECH001') {
        res.json({ 
            success: true, 
            userId: 2, 
            name: 'Technician User', 
            role: 'technician' 
        });
    } else {
        res.json({ success: false, message: 'Invalid credentials' });
    }
});

// ============================================================================
// API 2: GET CATEGORIES
// ============================================================================
app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT categoryname FROM assetcategory 
            ORDER BY categoryname ASC
        `);
        res.json(result.rows.map(r => r.categoryname));
    } catch (error) {
        console.error('Categories error:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// ============================================================================
// API 3: GET ROOMS
// ============================================================================
app.get('/api/rooms', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT roomname FROM room 
            ORDER BY roomname ASC
        `);
        res.json(result.rows.map(r => r.roomname));
    } catch (error) {
        console.error('Rooms error:', error);
        res.status(500).json({ error: 'Failed to fetch rooms' });
    }
});

// ============================================================================
// API 4: GET AVAILABLE ASSETS (with search & filter)
// ============================================================================
app.get('/api/assets/available', async (req, res) => {
    try {
        const { search, category, room } = req.query;
        
        let query = `
            SELECT 
                a.assetid, 
                a.assetname, 
                a.serialnumber, 
                a.condition, 
                a.status,
                ac.categoryname, 
                r.roomname
            FROM asset a
            LEFT JOIN assetcategory ac ON a.categoryid = ac.categoryid
            LEFT JOIN room r ON a.roomid = r.roomid
            WHERE a.status = 'Available'
        `;
        
        const params = [];
        let paramCount = 1;
        
        if (search) {
            query += ` AND (a.assetname ILIKE $${paramCount} OR a.serialnumber ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }
        
        if (category) {
            query += ` AND ac.categoryname = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        
        if (room) {
            query += ` AND r.roomname = $${paramCount}`;
            params.push(room);
            paramCount++;
        }
        
        query += ` ORDER BY a.assetname ASC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Available assets error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// API 5: GET INVENTORY (all assets with checkout info)
// ============================================================================
app.get('/api/inventory', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                a.assetid, 
                a.assetname, 
                a.serialnumber, 
                a.condition, 
                a.status,
                ac.categoryname, 
                r.roomname,
                l.loanid,
                CONCAT("user".firstname, ' ', "user".lastname) as checkedoutto,
                l.checkoutdate, 
                l.duedate
            FROM asset a
            LEFT JOIN assetcategory ac ON a.categoryid = ac.categoryid
            LEFT JOIN room r ON a.roomid = r.roomid
            LEFT JOIN loan l ON a.assetid = l.assetid AND l.returndate IS NULL
            LEFT JOIN "user" ON l.userid = "user".userid
            ORDER BY a.assetname ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Inventory error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// API 6: GET OVERDUE ITEMS
// ============================================================================
app.get('/api/overdue', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                l.loanid, 
                l.duedate, 
                a.assetname,
                a.serialnumber,
                "user".studentnumber, 
                CONCAT("user".firstname, ' ', "user".lastname) as studentname,
                COALESCE(f.fineamount, 0) as fineamount
            FROM loan l
            JOIN asset a ON l.assetid = a.assetid
            JOIN "user" ON l.userid = "user".userid
            LEFT JOIN fine f ON l.loanid = f.loanid
            WHERE l.returndate IS NULL AND l.duedate < NOW()
            ORDER BY l.duedate ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Overdue error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// API 7: RESERVATION CREATE
// ============================================================================
app.post('/api/reservation/create', async (req, res) => {
    const { studentId, assetId, desiredPickupDate } = req.body;
    
    try {
        // Update asset status to Reserved
        await pool.query(
            'UPDATE asset SET status = $1 WHERE assetid = $2',
            ['Reserved', assetId]
        );
        
        res.json({ 
            success: true, 
            message: 'Asset reserved successfully! Please pick it up at the specified time.' 
        });
    } catch (error) {
        console.error('Reservation error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================================
// API 8: TECHNICIAN CHECKOUT
// ============================================================================
app.post('/api/technician/checkout', async (req, res) => {
    const { studentNumber, assetSerial, technicianId } = req.body;
    
    try {
        // Get user ID from student number
        const userResult = await pool.query(
            'SELECT userid FROM "user" WHERE studentnumber = $1',
            [studentNumber]
        );
        
        if (userResult.rows.length === 0) {
            return res.json({ success: false, error: 'Student not found' });
        }
        
        const userId = userResult.rows[0].userid;
        
        // Get asset ID from serial number
        const assetResult = await pool.query(
            'SELECT assetid FROM asset WHERE serialnumber = $1',
            [assetSerial]
        );
        
        if (assetResult.rows.length === 0) {
            return res.json({ success: false, error: 'Asset not found' });
        }
        
        const assetId = assetResult.rows[0].assetid;
        
        // Create checkout date and calculate due date (7 days from now)
        const checkoutDate = new Date();
        const dueDate = new Date(checkoutDate);
        dueDate.setDate(dueDate.getDate() + 7);
        
        // Insert loan record
        await pool.query(
            'INSERT INTO loan (assetid, userid, checkoutdate, duedate) VALUES ($1, $2, $3, $4)',
            [assetId, userId, checkoutDate, dueDate]
        );
        
        // Update asset status to Checked Out
        await pool.query(
            'UPDATE asset SET status = $1 WHERE assetid = $2',
            ['Checked Out', assetId]
        );
        
        res.json({ success: true, message: 'Asset checked out successfully' });
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// API 9: TECHNICIAN RETURN
// ============================================================================
app.post('/api/technician/return', async (req, res) => {
    const { loanId } = req.body;
    
    try {
        // Get asset ID from loan
        const loanResult = await pool.query(
            'SELECT assetid FROM loan WHERE loanid = $1',
            [loanId]
        );
        
        if (loanResult.rows.length === 0) {
            return res.json({ success: false, error: 'Loan not found' });
        }
        
        const assetId = loanResult.rows[0].assetid;
        
        // Update loan with return date
        await pool.query(
            'UPDATE loan SET returndate = NOW() WHERE loanid = $1',
            [loanId]
        );
        
        // Update asset status back to Available
        await pool.query(
            'UPDATE asset SET status = $1 WHERE assetid = $2',
            ['Available', assetId]
        );
        
        res.json({ success: true, message: 'Asset returned successfully' });
    } catch (error) {
        console.error('Return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ============================================================================
// API 10: STUDENT DASHBOARD
// ============================================================================
app.get('/api/student/dashboard/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        // Get active loans for this student
        const activeLoansResult = await pool.query(`
            SELECT 
                l.loanid, 
                a.assetname, 
                a.serialnumber,
                l.checkoutdate, 
                l.duedate,
                COALESCE(f.fineamount, 0) as fineamount
            FROM loan l
            JOIN asset a ON l.assetid = a.assetid
            LEFT JOIN fine f ON l.loanid = f.loanid
            WHERE l.userid = $1 AND l.returndate IS NULL
            ORDER BY l.duedate DESC
        `, [userId]);
        
        // Count total fines
        const finesResult = await pool.query(`
            SELECT COALESCE(SUM(fineamount), 0) as totalfines
            FROM fine f
            JOIN loan l ON f.loanid = l.loanid
            WHERE l.userid = $1
        `, [userId]);
        
        // Count total loans ever made
        const totalResult = await pool.query(`
            SELECT COUNT(*) as totalborrowed
            FROM loan
            WHERE userid = $1
        `, [userId]);
        
        res.json({ 
            activeLoans: activeLoansResult.rows.length,
            activeLoansList: activeLoansResult.rows,
            fines: parseFloat(finesResult.rows[0].totalfines) || 0,
            totalBorrowed: parseInt(totalResult.rows[0].totalborrowed) || 0
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: error.message });
    }
});
// ============================================================================
// API 11: TECHNICIAN DASHBOARD
// ============================================================================
app.get('/api/technician/dashboard', async (req, res) => {
    try {
        // Get total, available, and checked out counts
        const assetStats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'Available' THEN 1 END) as available,
                COUNT(CASE WHEN status = 'Checked Out' THEN 1 END) as checkedout
            FROM asset
        `);
        
        // Get overdue count
        const overdueStats = await pool.query(`
            SELECT COUNT(*) as overduecount FROM loan 
            WHERE returndate IS NULL AND duedate < NOW()
        `);
        
        // Get checked out details
        const checkedOutDetails = await pool.query(`
            SELECT 
                l.loanid, 
                a.assetname, 
                a.serialnumber, 
                "user".studentnumber,
                CONCAT("user".firstname, ' ', "user".lastname) as checkedoutto,
                l.checkoutdate, 
                l.duedate,
                CASE WHEN l.duedate < NOW() THEN 'Overdue' ELSE 'Active' END as duestatus
            FROM loan l
            JOIN asset a ON l.assetid = a.assetid
            JOIN "user" ON l.userid = "user".userid
            WHERE l.returndate IS NULL
            ORDER BY l.duedate DESC
        `);
        
        res.json({
            totalAssets: parseInt(assetStats.rows[0].total),
            availableCount: parseInt(assetStats.rows[0].available),
            checkedOutCount: parseInt(assetStats.rows[0].checkedout),
            overdueCount: parseInt(overdueStats.rows[0].overduecount),
            checkedOutDetails: checkedOutDetails.rows
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// API 12: ASSET UTILIZATION REPORTS
// ============================================================================
app.get('/api/reports/utilization', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                a.assetname, 
                ac.categoryname, 
                r.roomname,
                COUNT(l.loanid) as timesborrowed,
                MAX(l.checkoutdate) as lastborrowed
            FROM asset a
            LEFT JOIN assetcategory ac ON a.categoryid = ac.categoryid
            LEFT JOIN room r ON a.roomid = r.roomid
            LEFT JOIN loan l ON a.assetid = l.assetid
            GROUP BY a.assetid, a.assetname, ac.categoryname, r.roomname
            ORDER BY timesborrowed DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Reports error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// START SERVER
// ============================================================================
app.listen(PORT, () => {
    console.log(`✅ LAMS Server running on http://localhost:3000`);
    console.log(`📊 Database: lams_db (PostgreSQL)`);
    console.log(`🔐 Demo Credentials:`);
    console.log(`   Student: 25116045 (any password)`);
    console.log(`   Technician: TECH001 (any password)`);
});
