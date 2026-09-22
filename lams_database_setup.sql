-- LABORATORY ASSET MANAGEMENT SYSTEM
-- PostgreSQL Database Setup Script
-- Group S - DTMG202 & WBDV202 Project
-- Semester 2, 2026

-- ============================================================
-- DROP EXISTING OBJECTS (if needed for fresh installation)
-- ============================================================
DROP TABLE IF EXISTS Fine CASCADE;
DROP TABLE IF EXISTS Maintenance CASCADE;
DROP TABLE IF EXISTS Loan CASCADE;
DROP TABLE IF EXISTS Reservation CASCADE;
DROP TABLE IF EXISTS Asset CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;
DROP TABLE IF EXISTS Room CASCADE;
DROP TABLE IF EXISTS AssetCategory CASCADE;

-- ============================================================
-- CREATE TABLES
-- ============================================================

-- 1. ASSET CATEGORY TABLE
CREATE TABLE AssetCategory (
    CategoryID SERIAL PRIMARY KEY,
    CategoryName VARCHAR(100) NOT NULL UNIQUE,
    Description TEXT
);

-- 2. ROOM TABLE (Laboratory Locations)
CREATE TABLE Room (
    RoomID SERIAL PRIMARY KEY,
    RoomName VARCHAR(100) NOT NULL UNIQUE,
    Building VARCHAR(50),
    Floor INTEGER,
    Capacity INTEGER,
    ContactPerson VARCHAR(100)
);

-- 3. USER TABLE
CREATE TABLE "User" (
    UserID SERIAL PRIMARY KEY,
    StudentNumber VARCHAR(20) NOT NULL UNIQUE,
    FirstName VARCHAR(50) NOT NULL,
    LastName VARCHAR(50) NOT NULL,
    Email VARCHAR(100) NOT NULL UNIQUE,
    PhoneNumber VARCHAR(20),
    UserType VARCHAR(20) CHECK (UserType IN ('Student', 'Technician', 'Admin')) NOT NULL,
    PasswordHash VARCHAR(255) NOT NULL,
    CreatedDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    IsActive BOOLEAN DEFAULT TRUE
);

-- 4. ASSET TABLE (3NF - stores references to Category and Room)
CREATE TABLE Asset (
    AssetID SERIAL PRIMARY KEY,
    SerialNumber VARCHAR(100) NOT NULL UNIQUE,
    AssetName VARCHAR(150) NOT NULL,
    CategoryID INTEGER NOT NULL REFERENCES AssetCategory(CategoryID) ON DELETE RESTRICT,
    RoomID INTEGER NOT NULL REFERENCES Room(RoomID) ON DELETE RESTRICT,
    Condition VARCHAR(20) CHECK (Condition IN ('New', 'Good', 'Fair', 'Needs Repair', 'Decommissioned')) DEFAULT 'Good',
    AcquisitionDate DATE,
    Cost DECIMAL(10, 2),
    Status VARCHAR(20) CHECK (Status IN ('Available', 'Checked Out', 'Reserved', 'Under Repair', 'Decommissioned')) DEFAULT 'Available',
    CreatedDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. LOAN TABLE (represents checkout transactions)
CREATE TABLE Loan (
    LoanID SERIAL PRIMARY KEY,
    AssetID INTEGER NOT NULL REFERENCES Asset(AssetID) ON DELETE RESTRICT,
    UserID INTEGER NOT NULL REFERENCES "User"(UserID) ON DELETE RESTRICT,
    CheckoutDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    DueDate DATE NOT NULL,
    ReturnDate DATE,
    ConditionOnReturn VARCHAR(20) CHECK (ConditionOnReturn IN ('Like New', 'Good', 'Fair', 'Damaged', 'Not Returned')),
    Notes TEXT
);

-- 6. MAINTENANCE TABLE
CREATE TABLE Maintenance (
    MaintenanceID SERIAL PRIMARY KEY,
    AssetID INTEGER NOT NULL REFERENCES Asset(AssetID) ON DELETE CASCADE,
    MaintenanceDate DATE NOT NULL DEFAULT CURRENT_DATE,
    ServiceType VARCHAR(100),
    Cost DECIMAL(10, 2),
    TechnicianName VARCHAR(100),
    Notes TEXT
);

-- 7. FINE TABLE (for overdue items)
CREATE TABLE Fine (
    FineID SERIAL PRIMARY KEY,
    LoanID INTEGER NOT NULL REFERENCES Loan(LoanID) ON DELETE CASCADE,
    FineAmount DECIMAL(10, 2) NOT NULL,
    FineDate DATE DEFAULT CURRENT_DATE,
    Reason VARCHAR(255),
    Paid BOOLEAN DEFAULT FALSE,
    PaidDate DATE
);

-- 8. RESERVATION TABLE
CREATE TABLE Reservation (
    ReservationID SERIAL PRIMARY KEY,
    AssetID INTEGER NOT NULL REFERENCES Asset(AssetID) ON DELETE CASCADE,
    UserID INTEGER NOT NULL REFERENCES "User"(UserID) ON DELETE CASCADE,
    ReservationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    RequestedPickupDate DATE NOT NULL,
    Status VARCHAR(20) CHECK (Status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled')) DEFAULT 'Pending',
    Notes TEXT
);

-- ============================================================
-- CREATE INDEXES FOR PERFORMANCE
-- ============================================================

CREATE INDEX idx_asset_status ON Asset(Status);
CREATE INDEX idx_asset_room ON Asset(RoomID);
CREATE INDEX idx_asset_category ON Asset(CategoryID);
CREATE INDEX idx_loan_user ON Loan(UserID);
CREATE INDEX idx_loan_asset ON Loan(AssetID);
CREATE INDEX idx_loan_duedate ON Loan(DueDate);
CREATE INDEX idx_loan_returndate ON Loan(ReturnDate);
CREATE INDEX idx_reservation_status ON Reservation(Status);
CREATE INDEX idx_user_type ON "User"(UserType);
CREATE INDEX idx_fine_loan ON Fine(LoanID);

-- ============================================================
-- INSERT SAMPLE DATA
-- ============================================================

-- Asset Categories
INSERT INTO AssetCategory (CategoryName, Description) VALUES
('Microcontroller', 'Arduino and similar microcontroller boards'),
('Single Board Computer', 'Raspberry Pi and other SBCs'),
('Sensor Module', 'Various sensor modules and kits'),
('Multimeter', 'Digital and analog multimeters'),
('Power Supply', 'DC and AC power supplies'),
('Development Board', 'ARM and FPGA development boards'),
('Robotic Platform', 'Robotic chassis and platforms'),
('Oscilloscope Probe', 'Test and measurement probes');

-- Laboratory Rooms
INSERT INTO Room (RoomName, Building, Floor, Capacity, ContactPerson) VALUES
('IoT Lab', 'Engineering Building', 2, 30, 'Mr. J. Smith'),
('ARM Lab', 'Engineering Building', 2, 25, 'Mrs. A. Johnson'),
('Robotics Lab', 'Engineering Building', 3, 20, 'Dr. M. Patel');

-- Users (Students)
INSERT INTO "User" (StudentNumber, FirstName, LastName, Email, PhoneNumber, UserType, PasswordHash) VALUES
('25116045', 'Kailash', 'Bhyro Deyal', 'kailash.deyal@dut.ac.za', '0712345678', 'Student', '$2b$10$hashedpassword1'),
('25014682', 'Dovashen', 'Govender', 'dovashen.govender@dut.ac.za', '0712345679', 'Student', '$2b$10$hashedpassword2'),
('25033893', 'Siphelele', 'Ndzimande', 'siphelele.ndzimande@dut.ac.za', '0712345680', 'Student', '$2b$10$hashedpassword3'),
('25067628', 'Kynan', 'Poliah', 'kynan.poliah@dut.ac.za', '0712345681', 'Student', '$2b$10$hashedpassword4'),
('22493903', 'Piyush', 'Singh', 'piyush.singh@dut.ac.za', '0712345682', 'Student', '$2b$10$hashedpassword5'),
('25041441', 'Rivell', 'Venketsamy', 'rivell.venketsamy@dut.ac.za', '0712345683', 'Student', '$2b$10$hashedpassword6'),
('25000001', 'John', 'Student', 'john.student@dut.ac.za', '0712345684', 'Student', '$2b$10$hashedpassword7'),
('25000002', 'Sarah', 'Lewis', 'sarah.lewis@dut.ac.za', '0712345685', 'Student', '$2b$10$hashedpassword8');

-- Users (Technicians)
INSERT INTO "User" (StudentNumber, FirstName, LastName, Email, PhoneNumber, UserType, PasswordHash) VALUES
('TECH001', 'Ahmed', 'Hassan', 'ahmed.hassan@dut.ac.za', '0718765432', 'Technician', '$2b$10$hashedpassword9'),
('TECH002', 'Nalini', 'Sharma', 'nalini.sharma@dut.ac.za', '0718765433', 'Technician', '$2b$10$hashedpassword10'),
('ADMIN001', 'Dr.', 'Admin', 'admin@dut.ac.za', '0718765434', 'Admin', '$2b$10$hashedpassword11');

-- Assets - IoT Lab
INSERT INTO Asset (SerialNumber, AssetName, CategoryID, RoomID, Condition, AcquisitionDate, Cost, Status) VALUES
('ARD-001-2024', 'Arduino Uno R3', 1, 1, 'Good', '2024-01-15', 25.00, 'Available'),
('ARD-002-2024', 'Arduino Mega 2560', 1, 1, 'Good', '2024-01-15', 35.00, 'Available'),
('RPI-001-2024', 'Raspberry Pi 4 Model B (8GB)', 2, 1, 'Good', '2024-02-01', 85.00, 'Checked Out'),
('SEN-001-2024', 'DHT22 Temperature Sensor', 3, 1, 'New', '2024-02-15', 8.50, 'Available'),
('SEN-002-2024', 'Ultrasonic Sensor HC-SR04', 3, 1, 'Good', '2024-02-15', 4.50, 'Available'),
('MM-001-2024', 'Digital Multimeter DM-830', 4, 1, 'Fair', '2024-03-01', 15.00, 'Available'),
('PSU-001-2024', 'DC Power Supply 30V 5A', 5, 1, 'Good', '2024-03-10', 120.00, 'Available');

-- Assets - ARM Lab
INSERT INTO Asset (SerialNumber, AssetName, CategoryID, RoomID, Condition, AcquisitionDate, Cost, Status) VALUES
('STM-001-2024', 'STM32 Discovery Board', 6, 2, 'Good', '2024-01-20', 60.00, 'Available'),
('STM-002-2024', 'STM32 Discovery Board', 6, 2, 'Good', '2024-01-20', 60.00, 'Available'),
('ARM-003-2024', 'ARM Cortex-M4 Dev Board', 6, 2, 'Fair', '2024-02-10', 75.00, 'Available'),
('MM-002-2024', 'Digital Multimeter DM-830', 4, 2, 'Good', '2024-03-01', 15.00, 'Checked Out'),
('OSC-001-2024', 'Oscilloscope Probe 100MHz', 8, 2, 'Good', '2024-03-20', 45.00, 'Available');

-- Assets - Robotics Lab
INSERT INTO Asset (SerialNumber, AssetName, CategoryID, RoomID, Condition, AcquisitionDate, Cost, Status) VALUES
('ROB-001-2024', 'Robot Chassis Tracked', 7, 3, 'Good', '2024-02-01', 180.00, 'Available'),
('ROB-002-2024', 'Robot Chassis Wheeled', 7, 3, 'Good', '2024-02-05', 150.00, 'Reserved'),
('MOT-001-2024', 'DC Motor 12V with Controller', 1, 3, 'Good', '2024-02-15', 25.00, 'Available'),
('PSU-002-2024', 'DC Power Supply 12V 10A', 5, 3, 'Good', '2024-03-05', 80.00, 'Available');

-- Sample Loans (Checkout Records)
INSERT INTO Loan (AssetID, UserID, CheckoutDate, DueDate, ReturnDate, ConditionOnReturn) VALUES
(3, 1, '2026-09-01', '2026-09-08', NULL, NULL),  -- Kailash has RPI-001 checked out
(4, 2, '2026-09-10', '2026-09-17', '2026-09-15', 'Good'),  -- Dovashen borrowed sensor
(8, 3, '2026-09-05', '2026-09-12', NULL, NULL),  -- Siphelele has STM board
(9, 4, '2026-09-08', '2026-09-22', NULL, NULL);  -- Kynan has multimeter (OVERDUE)

-- Sample Reservations
INSERT INTO Reservation (AssetID, UserID, RequestedPickupDate, Status) VALUES
(2, 5, '2026-09-20', 'Pending'),  -- Piyush wants to reserve Arduino Mega
(7, 6, '2026-09-21', 'Pending'),  -- Rivell wants robotics platform
(1, 7, '2026-09-25', 'Confirmed');  -- John has confirmed reservation

-- Sample Maintenance Records
INSERT INTO Maintenance (AssetID, MaintenanceDate, ServiceType, Cost, TechnicianName, Notes) VALUES
(6, '2026-08-15', 'Battery Replacement', 20.00, 'Ahmed Hassan', 'Replaced worn out battery'),
(12, '2026-08-20', 'Cleaning and Inspection', 15.00, 'Nalini Sharma', 'General maintenance - unit in good condition');

-- Sample Fines (for overdue items)
INSERT INTO Fine (LoanID, FineAmount, FineDate, Reason, Paid) VALUES
(4, 10.00, '2026-09-15', 'Overdue return - 3 days late', FALSE);

-- ============================================================
-- CREATE VIEWS FOR COMMON QUERIES
-- ============================================================

-- View: Current Overdue Items
CREATE VIEW OverdueItems AS
SELECT 
    l.LoanID,
    u.StudentNumber,
    u.FirstName || ' ' || u.LastName AS StudentName,
    a.AssetName,
    a.SerialNumber,
    l.DueDate,
    CURRENT_DATE - l.DueDate AS OverdueDays
FROM Loan l
JOIN "User" u ON l.UserID = u.UserID
JOIN Asset a ON l.AssetID = a.AssetID
WHERE l.ReturnDate IS NULL AND l.DueDate < CURRENT_DATE
ORDER BY l.DueDate ASC;

-- View: Asset Utilization Report
CREATE VIEW AssetUtilization AS
SELECT 
    a.AssetID,
    a.SerialNumber,
    a.AssetName,
    ac.CategoryName,
    r.RoomName,
    COUNT(l.LoanID) AS TimesBorrowed,
    MAX(l.CheckoutDate) AS LastBorrowedDate,
    COALESCE(AVG(EXTRACT(DAY FROM (COALESCE(l.ReturnDate, CURRENT_DATE) - l.CheckoutDate)))::INTEGER, 0) AS AvgLoanDays
FROM Asset a
LEFT JOIN Loan l ON a.AssetID = l.AssetID
JOIN AssetCategory ac ON a.CategoryID = ac.CategoryID
JOIN Room r ON a.RoomID = r.RoomID
GROUP BY a.AssetID, a.SerialNumber, a.AssetName, ac.CategoryName, r.RoomName
ORDER BY TimesBorrowed DESC;

-- View: Student Loan Summary
CREATE VIEW StudentLoanSummary AS
SELECT 
    u.UserID,
    u.StudentNumber,
    u.FirstName || ' ' || u.LastName AS StudentName,
    COUNT(CASE WHEN l.ReturnDate IS NULL THEN 1 END) AS ActiveLoans,
    COUNT(l.LoanID) AS TotalLoans,
    SUM(CASE WHEN f.Paid = FALSE THEN f.FineAmount ELSE 0 END) AS OutstandingFines
FROM "User" u
LEFT JOIN Loan l ON u.UserID = l.UserID
LEFT JOIN Fine f ON l.LoanID = f.LoanID
WHERE u.UserType = 'Student'
GROUP BY u.UserID, u.StudentNumber, u.FirstName, u.LastName;

-- View: Inventory Status by Room
CREATE VIEW InventoryByRoom AS
SELECT 
    r.RoomID,
    r.RoomName,
    r.Building,
    COUNT(*) AS TotalAssets,
    SUM(CASE WHEN a.Status = 'Available' THEN 1 ELSE 0 END) AS AvailableCount,
    SUM(CASE WHEN a.Status = 'Checked Out' THEN 1 ELSE 0 END) AS CheckedOutCount,
    SUM(CASE WHEN a.Status = 'Reserved' THEN 1 ELSE 0 END) AS ReservedCount,
    SUM(CASE WHEN a.Status = 'Under Repair' THEN 1 ELSE 0 END) AS UnderRepairCount
FROM Room r
LEFT JOIN Asset a ON r.RoomID = a.RoomID
GROUP BY r.RoomID, r.RoomName, r.Building
ORDER BY r.RoomName;

-- ============================================================
-- GRANT PERMISSIONS (Adjust as needed for your setup)
-- ============================================================
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO web_app_user;
-- GRANT INSERT, UPDATE, DELETE ON Loan, Reservation, Fine TO web_app_user;
-- GRANT SELECT ON OverdueItems, AssetUtilization, StudentLoanSummary TO web_app_user;

-- ============================================================
-- END OF SETUP SCRIPT
-- ============================================================
