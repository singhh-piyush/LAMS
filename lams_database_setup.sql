-- LABORATORY ASSET MANAGEMENT SYSTEM (LAMS)
-- PostgreSQL Database Setup Script
-- Group S - DTMG202 & WBDV202 Project
-- Semester 2, 2026
--
-- Run this against an empty database called lams_db.
-- Every user's password is: Password123

-- ============================================================
-- DROP EXISTING OBJECTS (for a clean re-install)
-- ============================================================
DROP VIEW IF EXISTS OverdueItems CASCADE;
DROP VIEW IF EXISTS AssetUtilization CASCADE;
DROP VIEW IF EXISTS StudentLoanSummary CASCADE;
DROP VIEW IF EXISTS InventoryByRoom CASCADE;

DROP TABLE IF EXISTS PasswordReset CASCADE;
-- An earlier version tracked reminders in their own table. They live on Loan
-- now (RemindersSent / LastRemindedAt), so drop the old one if it is still there.
DROP TABLE IF EXISTS Reminder CASCADE;
DROP TABLE IF EXISTS Fine CASCADE;
DROP TABLE IF EXISTS Maintenance CASCADE;
DROP TABLE IF EXISTS Loan CASCADE;
DROP TABLE IF EXISTS Reservation CASCADE;
DROP TABLE IF EXISTS Asset CASCADE;
DROP TABLE IF EXISTS Users CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;   -- old name from the first version
DROP TABLE IF EXISTS Room CASCADE;
DROP TABLE IF EXISTS AssetCategory CASCADE;

-- ============================================================
-- CREATE TABLES
-- ============================================================

-- 1. ASSET CATEGORY
CREATE TABLE AssetCategory (
    CategoryID   SERIAL PRIMARY KEY,
    CategoryName VARCHAR(100) NOT NULL UNIQUE,
    Description  TEXT
);

-- 2. ROOM (laboratory locations)
CREATE TABLE Room (
    RoomID        SERIAL PRIMARY KEY,
    RoomName      VARCHAR(100) NOT NULL UNIQUE,
    Building      VARCHAR(50),
    Floor         INTEGER,
    Capacity      INTEGER,
    ContactPerson VARCHAR(100)
);

-- 3. USERS
-- Named "Users" (not "User") because USER is a reserved word in SQL.
-- Using the reserved word forces double quotes everywhere, which made the
-- table case-sensitive and broke every query in the first version.
CREATE TABLE Users (
    UserID        SERIAL PRIMARY KEY,
    StudentNumber VARCHAR(20)  NOT NULL UNIQUE,
    FirstName     VARCHAR(50)  NOT NULL,
    LastName      VARCHAR(50)  NOT NULL,
    Email         VARCHAR(100) NOT NULL UNIQUE,
    PhoneNumber   VARCHAR(20),
    UserType      VARCHAR(20)  NOT NULL CHECK (UserType IN ('Student', 'Technician', 'Admin')),
    PasswordHash  VARCHAR(255) NOT NULL,
    CreatedDate   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    IsActive      BOOLEAN   DEFAULT TRUE
);

-- 4. ASSET (one row per physical item)
CREATE TABLE Asset (
    AssetID         SERIAL PRIMARY KEY,
    SerialNumber    VARCHAR(100) NOT NULL UNIQUE,
    AssetName       VARCHAR(150) NOT NULL,
    CategoryID      INTEGER NOT NULL REFERENCES AssetCategory(CategoryID) ON DELETE RESTRICT,
    RoomID          INTEGER NOT NULL REFERENCES Room(RoomID) ON DELETE RESTRICT,
    Condition       VARCHAR(20) CHECK (Condition IN ('New', 'Good', 'Fair', 'Needs Repair', 'Decommissioned')) DEFAULT 'Good',
    AcquisitionDate DATE,
    Cost            DECIMAL(10, 2),
    Status          VARCHAR(20) CHECK (Status IN ('Available', 'Checked Out', 'Reserved', 'Under Repair', 'Decommissioned')) DEFAULT 'Available',
    CreatedDate     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. LOAN (the junction table: one row per issue-and-return)
CREATE TABLE Loan (
    LoanID            SERIAL PRIMARY KEY,
    AssetID           INTEGER NOT NULL REFERENCES Asset(AssetID) ON DELETE RESTRICT,
    UserID            INTEGER NOT NULL REFERENCES Users(UserID)  ON DELETE RESTRICT,
    CheckoutDate      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    DueDate           DATE NOT NULL,
    ReturnDate        DATE,
    ConditionOnReturn VARCHAR(20) CHECK (ConditionOnReturn IN ('Like New', 'Good', 'Fair', 'Damaged', 'Not Returned')),
    Notes             TEXT,
    -- overdue chasing: how many reminder emails have gone out for this loan,
    -- and when the last one was sent. Kept on the loan rather than on the fine
    -- because a loan can be overdue without ever being fined.
    RemindersSent     INTEGER NOT NULL DEFAULT 0,
    LastRemindedAt    TIMESTAMP,
    -- a return can never be dated before the item went out
    CONSTRAINT loan_return_after_checkout CHECK (ReturnDate IS NULL OR ReturnDate >= CheckoutDate::DATE),
    CONSTRAINT loan_reminders_not_negative CHECK (RemindersSent >= 0)
);

-- BUSINESS RULE AS A DATABASE CONSTRAINT:
-- an asset may have any number of past loans, but only ONE open loan at a time.
-- A partial unique index makes it impossible to issue an item that is already out.
CREATE UNIQUE INDEX one_open_loan_per_asset
    ON Loan (AssetID) WHERE ReturnDate IS NULL;

-- 6. MAINTENANCE
CREATE TABLE Maintenance (
    MaintenanceID   SERIAL PRIMARY KEY,
    AssetID         INTEGER NOT NULL REFERENCES Asset(AssetID) ON DELETE CASCADE,
    MaintenanceDate DATE NOT NULL DEFAULT CURRENT_DATE,
    ServiceType     VARCHAR(100),
    Cost            DECIMAL(10, 2) NOT NULL DEFAULT 0,
    TechnicianName  VARCHAR(100),
    Notes           TEXT
);

-- 7. FINE (money owed on a late or damaged return)
CREATE TABLE Fine (
    FineID     SERIAL PRIMARY KEY,
    LoanID     INTEGER NOT NULL REFERENCES Loan(LoanID) ON DELETE CASCADE,
    FineAmount DECIMAL(10, 2) NOT NULL CHECK (FineAmount > 0),
    FineDate   DATE DEFAULT CURRENT_DATE,
    Reason     VARCHAR(255),
    Paid       BOOLEAN DEFAULT FALSE,
    PaidDate   DATE
);

-- 8. RESERVATION
CREATE TABLE Reservation (
    ReservationID       SERIAL PRIMARY KEY,
    AssetID             INTEGER NOT NULL REFERENCES Asset(AssetID) ON DELETE CASCADE,
    UserID              INTEGER NOT NULL REFERENCES Users(UserID)  ON DELETE CASCADE,
    ReservationDate     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    RequestedPickupDate DATE NOT NULL,
    Status              VARCHAR(20) CHECK (Status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled')) DEFAULT 'Pending',
    Notes               TEXT
);

-- BUSINESS RULE AS A DATABASE CONSTRAINT:
-- an asset may only be reserved by one person at a time. Past reservations
-- (Completed or Cancelled) do not block a new one, so the same partial-index
-- trick used for open loans applies here too.
CREATE UNIQUE INDEX one_active_reservation_per_asset
    ON Reservation (AssetID) WHERE Status IN ('Pending', 'Confirmed');

-- 9. PASSWORD RESET TOKENS
-- Only the SHA-256 hash of the token is stored, never the token itself,
-- so a copy of this table cannot be used to reset anybody's password.
CREATE TABLE PasswordReset (
    TokenHash  VARCHAR(64) PRIMARY KEY,
    UserID     INTEGER   NOT NULL REFERENCES Users(UserID) ON DELETE CASCADE,
    ExpiresAt  TIMESTAMP NOT NULL,
    Used       BOOLEAN   NOT NULL DEFAULT FALSE,
    CreatedAt  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_asset_status      ON Asset(Status);
CREATE INDEX idx_asset_room        ON Asset(RoomID);
CREATE INDEX idx_asset_category    ON Asset(CategoryID);
CREATE INDEX idx_loan_user         ON Loan(UserID);
CREATE INDEX idx_loan_asset        ON Loan(AssetID);
CREATE INDEX idx_loan_duedate      ON Loan(DueDate);
CREATE INDEX idx_loan_returndate   ON Loan(ReturnDate);
CREATE INDEX idx_reservation_status ON Reservation(Status);
CREATE INDEX idx_user_type         ON Users(UserType);
CREATE INDEX idx_fine_loan         ON Fine(LoanID);
CREATE INDEX idx_reset_user        ON PasswordReset(UserID);

-- ============================================================
-- SAMPLE DATA
-- All dates below are relative to CURRENT_DATE, so the overdue
-- reports return rows no matter which day the demo is run.
-- ============================================================

-- Asset Categories
INSERT INTO AssetCategory (CategoryName, Description) VALUES
('Microcontroller',      'Arduino and similar microcontroller boards'),
('Single Board Computer','Raspberry Pi and other SBCs'),
('Sensor Module',        'Various sensor modules and kits'),
('Multimeter',           'Digital and analog multimeters'),
('Power Supply',         'DC and AC power supplies'),
('Development Board',    'ARM and FPGA development boards'),
('Robotic Platform',     'Robotic chassis and platforms'),
('Oscilloscope Probe',   'Test and measurement probes');

-- Laboratory Rooms
INSERT INTO Room (RoomName, Building, Floor, Capacity, ContactPerson) VALUES
('IoT Lab',      'Engineering Building', 2, 30, 'Mr. J. Smith'),
('ARM Lab',      'Engineering Building', 2, 25, 'Mrs. A. Johnson'),
('Robotics Lab', 'Engineering Building', 3, 20, 'Dr. M. Patel');

-- Users -- every password below is 'Password123', bcrypt hashed.
INSERT INTO Users (StudentNumber, FirstName, LastName, Email, PhoneNumber, UserType, PasswordHash) VALUES
('25116045', 'Kailash',  'Bhyro Deyal', 'kailash.deyal@dut.ac.za',      '0712345678', 'Student',    '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('25014682', 'Dovashen', 'Govender',    'dovashen.govender@dut.ac.za',  '0712345679', 'Student',    '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('25033893', 'Siphelele','Ndzimande',   'siphelele.ndzimande@dut.ac.za','0712345680', 'Student',    '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('25067628', 'Kynan',    'Poliah',      'kynan.poliah@dut.ac.za',       '0712345681', 'Student',    '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('22493903', 'Piyush',   'Singh',       'piyush.singh@dut.ac.za',       '0712345682', 'Student',    '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('25041441', 'Rivell',   'Venketsamy',  'rivell.venketsamy@dut.ac.za',  '0712345683', 'Student',    '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('25000001', 'John',     'Student',     'john.student@dut.ac.za',       '0712345684', 'Student',    '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('25000002', 'Sarah',    'Lewis',       'sarah.lewis@dut.ac.za',        '0712345685', 'Student',    '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('TECH001',  'Ahmed',    'Hassan',      'ahmed.hassan@dut.ac.za',       '0718765432', 'Technician', '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('TECH002',  'Nalini',   'Sharma',      'nalini.sharma@dut.ac.za',      '0718765433', 'Technician', '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u'),
('ADMIN001', 'Dr.',      'Admin',       'admin@dut.ac.za',              '0718765434', 'Admin',      '$2a$10$znFoYQy7NCuMxwCRuZx5He9txE.Wc/K/QozQ7UmflZrRQ8u.w49.u');

-- Assets. Status matches the loan and reservation tables exactly -- see the two
-- consistency checks at the bottom of this script.
--   Open loan:          assets 3, 6, 8, 11, 13  -> 'Checked Out'
--   Active reservation: assets 2, 7, 14         -> 'Reserved'
INSERT INTO Asset (SerialNumber, AssetName, CategoryID, RoomID, Condition, AcquisitionDate, Cost, Status) VALUES
-- IoT Lab
('ARD-001-2024', 'Arduino Uno R3',                1, 1, 'Good', '2024-01-15',  25.00, 'Available'),
('ARD-002-2024', 'Arduino Mega 2560',             1, 1, 'Good', '2024-01-15',  35.00, 'Reserved'),
('RPI-001-2024', 'Raspberry Pi 4 Model B (8GB)',  2, 1, 'Good', '2024-02-01',  85.00, 'Checked Out'),
('SEN-001-2024', 'DHT22 Temperature Sensor',      3, 1, 'New',  '2024-02-15',   8.50, 'Available'),
('SEN-002-2024', 'Ultrasonic Sensor HC-SR04',     3, 1, 'Good', '2024-02-15',   4.50, 'Available'),
('MM-001-2024',  'Digital Multimeter DM-830',     4, 1, 'Fair', '2024-03-01',  15.00, 'Checked Out'),
('PSU-001-2024', 'DC Power Supply 30V 5A',        5, 1, 'Good', '2024-03-10', 120.00, 'Reserved'),
-- ARM Lab
('STM-001-2024', 'STM32 Discovery Board',         6, 2, 'Good', '2024-01-20',  60.00, 'Checked Out'),
('STM-002-2024', 'STM32 Discovery Board',         6, 2, 'Good', '2024-01-20',  60.00, 'Available'),
('ARM-003-2024', 'ARM Cortex-M4 Dev Board',       6, 2, 'Fair', '2024-02-10',  75.00, 'Available'),
('MM-002-2024',  'Digital Multimeter DM-830',     4, 2, 'Good', '2024-03-01',  15.00, 'Checked Out'),
('OSC-001-2024', 'Oscilloscope Probe 100MHz',     8, 2, 'Good', '2024-03-20',  45.00, 'Available'),
-- Robotics Lab
('ROB-001-2024', 'Robot Chassis Tracked',         7, 3, 'Good', '2024-02-01', 180.00, 'Checked Out'),
('ROB-002-2024', 'Robot Chassis Wheeled',         7, 3, 'Good', '2024-02-05', 150.00, 'Reserved'),
('MOT-001-2024', 'DC Motor 12V with Controller',  1, 3, 'Good', '2024-02-15',  25.00, 'Available'),
('PSU-002-2024', 'DC Power Supply 12V 10A',       5, 3, 'Good', '2024-03-05',  80.00, 'Available');

-- Loans.
-- Assets 7 (PSU-001), 10 (ARM-003) and 14 (ROB-002) are deliberately never
-- borrowed, so the "never borrowed" report always returns rows.

-- (a) OPEN AND OVERDUE -- due date has passed, nothing returned
INSERT INTO Loan (AssetID, UserID, CheckoutDate, DueDate, ReturnDate, ConditionOnReturn) VALUES
( 3, 1, CURRENT_DATE - 20, CURRENT_DATE - 13, NULL, NULL),   -- Kailash, Raspberry Pi
( 8, 3, CURRENT_DATE - 16, CURRENT_DATE -  9, NULL, NULL),   -- Siphelele, STM32
(11, 4, CURRENT_DATE - 12, CURRENT_DATE -  5, NULL, NULL);   -- Kynan, Multimeter

-- (b) OPEN AND STILL IN TIME
INSERT INTO Loan (AssetID, UserID, CheckoutDate, DueDate, ReturnDate, ConditionOnReturn) VALUES
(13, 2, CURRENT_DATE -  3, CURRENT_DATE +  4, NULL, NULL),   -- Dovashen, Robot chassis
( 6, 7, CURRENT_DATE -  1, CURRENT_DATE +  6, NULL, NULL);   -- John, Multimeter

-- (c) RETURNED LATE -- gives Kynan and John two late returns each,
--     which is what the "students with 2 or more late returns" report needs
INSERT INTO Loan (AssetID, UserID, CheckoutDate, DueDate, ReturnDate, ConditionOnReturn) VALUES
( 1, 4, CURRENT_DATE - 55, CURRENT_DATE - 48, CURRENT_DATE - 44, 'Good'),   -- Kynan, 4 days late
( 5, 4, CURRENT_DATE - 40, CURRENT_DATE - 33, CURRENT_DATE - 30, 'Fair'),   -- Kynan, 3 days late
( 2, 7, CURRENT_DATE - 50, CURRENT_DATE - 43, CURRENT_DATE - 40, 'Good'),   -- John, 3 days late
( 4, 7, CURRENT_DATE - 35, CURRENT_DATE - 28, CURRENT_DATE - 25, 'Damaged'),-- John, 3 days late
( 9, 2, CURRENT_DATE - 30, CURRENT_DATE - 23, CURRENT_DATE - 20, 'Good');   -- Dovashen, 3 days late

-- (d) RETURNED ON TIME
INSERT INTO Loan (AssetID, UserID, CheckoutDate, DueDate, ReturnDate, ConditionOnReturn) VALUES
( 4, 1, CURRENT_DATE - 58, CURRENT_DATE - 51, CURRENT_DATE - 53, 'Good'),
( 1, 2, CURRENT_DATE - 45, CURRENT_DATE - 38, CURRENT_DATE - 40, 'Like New'),
( 2, 3, CURRENT_DATE - 28, CURRENT_DATE - 21, CURRENT_DATE - 23, 'Good'),
( 3, 5, CURRENT_DATE - 50, CURRENT_DATE - 43, CURRENT_DATE - 45, 'Good'),
(12, 5, CURRENT_DATE - 22, CURRENT_DATE - 15, CURRENT_DATE - 17, 'Good'),
( 5, 6, CURRENT_DATE - 26, CURRENT_DATE - 19, CURRENT_DATE - 21, 'Good'),
( 9, 6, CURRENT_DATE - 14, CURRENT_DATE -  7, CURRENT_DATE -  9, 'Like New'),
( 8, 8, CURRENT_DATE - 44, CURRENT_DATE - 37, CURRENT_DATE - 39, 'Good'),
(15, 8, CURRENT_DATE - 18, CURRENT_DATE - 11, CURRENT_DATE - 13, 'Good'),
(16, 1, CURRENT_DATE - 10, CURRENT_DATE -  3, CURRENT_DATE -  5, 'Good');

-- Fines. Looked up by asset + date rather than hardcoded LoanIDs so the
-- script stays correct if the loans above are ever reordered.
INSERT INTO Fine (LoanID, FineAmount, FineDate, Reason, Paid, PaidDate)
SELECT LoanID, 50.00, CURRENT_DATE - 13, 'Overdue return - item still out', FALSE, NULL
FROM Loan WHERE AssetID = 3 AND ReturnDate IS NULL;

INSERT INTO Fine (LoanID, FineAmount, FineDate, Reason, Paid, PaidDate)
SELECT LoanID, 25.00, CURRENT_DATE - 5, 'Overdue return - item still out', FALSE, NULL
FROM Loan WHERE AssetID = 11 AND ReturnDate IS NULL;

INSERT INTO Fine (LoanID, FineAmount, FineDate, Reason, Paid, PaidDate)
SELECT LoanID, 20.00, CURRENT_DATE - 44, 'Late return - 4 days', TRUE, CURRENT_DATE - 42
FROM Loan WHERE AssetID = 1 AND UserID = 4;

INSERT INTO Fine (LoanID, FineAmount, FineDate, Reason, Paid, PaidDate)
SELECT LoanID, 15.00, CURRENT_DATE - 40, 'Late return - 3 days', TRUE, CURRENT_DATE - 38
FROM Loan WHERE AssetID = 2 AND UserID = 7;

INSERT INTO Fine (LoanID, FineAmount, FineDate, Reason, Paid, PaidDate)
SELECT LoanID, 75.00, CURRENT_DATE - 25, 'Late return and damage to sensor', FALSE, NULL
FROM Loan WHERE AssetID = 4 AND UserID = 7;

-- Maintenance, spread across several categories so the
-- "maintenance cost per category" report has more than one row.
INSERT INTO Maintenance (AssetID, MaintenanceDate, ServiceType, Cost, TechnicianName, Notes) VALUES
( 6, CURRENT_DATE - 38, 'Battery Replacement',     20.00, 'Ahmed Hassan',  'Replaced worn out battery'),
(12, CURRENT_DATE - 33, 'Cleaning and Inspection', 15.00, 'Nalini Sharma', 'General maintenance - unit in good condition'),
( 3, CURRENT_DATE - 27, 'SD Card Replacement',     35.00, 'Ahmed Hassan',  'Corrupted SD card replaced and OS reimaged'),
(13, CURRENT_DATE - 19, 'Motor Repair',           120.00, 'Nalini Sharma', 'Left drive motor rewound'),
( 1, CURRENT_DATE - 12, 'USB Port Repair',         18.50, 'Ahmed Hassan',  'Resoldered loose USB connector'),
( 4, CURRENT_DATE -  6, 'Calibration',             40.00, 'Nalini Sharma', 'Recalibrated after damaged return');

-- Two of the overdue loans have already been chased, so the reminder column
-- is populated during the demo. Siphelele's is deliberately left at zero.
UPDATE Loan SET RemindersSent = 2, LastRemindedAt = CURRENT_TIMESTAMP - INTERVAL '2 days'
WHERE AssetID = 3 AND ReturnDate IS NULL;

UPDATE Loan SET RemindersSent = 1, LastRemindedAt = CURRENT_TIMESTAMP - INTERVAL '1 day'
WHERE AssetID = 11 AND ReturnDate IS NULL;

-- Reservations
INSERT INTO Reservation (AssetID, UserID, RequestedPickupDate, Status) VALUES
(14, 6, CURRENT_DATE + 2, 'Confirmed'),
( 2, 5, CURRENT_DATE + 3, 'Pending'),
( 7, 8, CURRENT_DATE + 5, 'Pending');

-- ============================================================
-- VIEWS
-- ============================================================

CREATE VIEW OverdueItems AS
SELECT
    l.LoanID,
    u.StudentNumber,
    u.FirstName || ' ' || u.LastName AS StudentName,
    u.PhoneNumber,
    a.AssetName,
    a.SerialNumber,
    l.DueDate,
    CURRENT_DATE - l.DueDate AS OverdueDays
FROM Loan l
JOIN Users u ON l.UserID  = u.UserID
JOIN Asset a ON l.AssetID = a.AssetID
WHERE l.ReturnDate IS NULL AND l.DueDate < CURRENT_DATE
ORDER BY l.DueDate ASC;

CREATE VIEW AssetUtilization AS
SELECT
    a.AssetID,
    a.SerialNumber,
    a.AssetName,
    ac.CategoryName,
    r.RoomName,
    COUNT(l.LoanID)      AS TimesBorrowed,
    MAX(l.CheckoutDate)  AS LastBorrowedDate
FROM Asset a
JOIN AssetCategory ac ON a.CategoryID = ac.CategoryID
JOIN Room r           ON a.RoomID     = r.RoomID
LEFT JOIN Loan l      ON a.AssetID    = l.AssetID
GROUP BY a.AssetID, a.SerialNumber, a.AssetName, ac.CategoryName, r.RoomName
ORDER BY TimesBorrowed DESC;

CREATE VIEW StudentLoanSummary AS
SELECT
    u.UserID,
    u.StudentNumber,
    u.FirstName || ' ' || u.LastName AS StudentName,
    COUNT(CASE WHEN l.ReturnDate IS NULL THEN 1 END) AS ActiveLoans,
    COUNT(l.LoanID)                                  AS TotalLoans,
    COALESCE(SUM(CASE WHEN f.Paid = FALSE THEN f.FineAmount ELSE 0 END), 0) AS OutstandingFines
FROM Users u
LEFT JOIN Loan l ON u.UserID = l.UserID
LEFT JOIN Fine f ON l.LoanID = f.LoanID
WHERE u.UserType = 'Student'
GROUP BY u.UserID, u.StudentNumber, u.FirstName, u.LastName;

CREATE VIEW InventoryByRoom AS
SELECT
    r.RoomID,
    r.RoomName,
    r.Building,
    COUNT(a.AssetID) AS TotalAssets,
    SUM(CASE WHEN a.Status = 'Available'    THEN 1 ELSE 0 END) AS AvailableCount,
    SUM(CASE WHEN a.Status = 'Checked Out'  THEN 1 ELSE 0 END) AS CheckedOutCount,
    SUM(CASE WHEN a.Status = 'Reserved'     THEN 1 ELSE 0 END) AS ReservedCount,
    SUM(CASE WHEN a.Status = 'Under Repair' THEN 1 ELSE 0 END) AS UnderRepairCount
FROM Room r
LEFT JOIN Asset a ON r.RoomID = a.RoomID
GROUP BY r.RoomID, r.RoomName, r.Building
ORDER BY r.RoomName;

-- ============================================================
-- SELF CHECK -- these should all report OK after a fresh install
-- ============================================================
SELECT 'Users'      AS table_name, COUNT(*) AS rows FROM Users
UNION ALL SELECT 'Categories',  COUNT(*) FROM AssetCategory
UNION ALL SELECT 'Rooms',       COUNT(*) FROM Room
UNION ALL SELECT 'Assets',      COUNT(*) FROM Asset
UNION ALL SELECT 'Loans',       COUNT(*) FROM Loan
UNION ALL SELECT 'Fines',       COUNT(*) FROM Fine
UNION ALL SELECT 'Maintenance', COUNT(*) FROM Maintenance
UNION ALL SELECT 'Reservations',COUNT(*) FROM Reservation;

-- asset.status must agree with the loan table for every single asset
SELECT CASE WHEN COUNT(*) = 0
            THEN 'OK - every asset status matches the loan table'
            ELSE 'MISMATCH on ' || COUNT(*) || ' asset(s)' END AS loan_status_check
FROM Asset a
WHERE (a.Status = 'Checked Out')
   <> (EXISTS (SELECT 1 FROM Loan l WHERE l.AssetID = a.AssetID AND l.ReturnDate IS NULL));

-- and it must agree with the reservation table too
SELECT CASE WHEN COUNT(*) = 0
            THEN 'OK - every asset status matches the reservation table'
            ELSE 'MISMATCH on ' || COUNT(*) || ' asset(s)' END AS reservation_status_check
FROM Asset a
WHERE (a.Status = 'Reserved')
   <> (EXISTS (SELECT 1 FROM Reservation r
               WHERE r.AssetID = a.AssetID AND r.Status IN ('Pending', 'Confirmed')));

-- ============================================================
-- END OF SETUP SCRIPT
-- ============================================================
