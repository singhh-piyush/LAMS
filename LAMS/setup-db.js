// One-command database setup.
//
//   npm run setup-db
//
// Local PostgreSQL only. Never point this at the hosted Supabase database: the
// script starts by dropping every table, so it would wipe the live data.
//
// Creates the lams_db database if it does not exist, then runs
// lams_database_setup.sql against it. Saves doing it by hand in pgAdmin,
// and means a fresh clone on any machine is two commands.

const { loadEnv } = require('./env');
loadEnv();

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    user:     process.env.DB_USER     || 'postgres',
    host:     process.env.DB_HOST     || 'localhost',
    password: process.env.DB_PASSWORD || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10)
};
const DB_NAME = process.env.DB_NAME || 'lams_db';

// The .sql file lives one level up, next to the project document.
const SQL_FILE = fs.existsSync(path.join(__dirname, 'lams_database_setup.sql'))
    ? path.join(__dirname, 'lams_database_setup.sql')
    : path.join(__dirname, '..', 'lams_database_setup.sql');

async function main() {
    if (!fs.existsSync(SQL_FILE)) {
        console.error(`Could not find lams_database_setup.sql (looked in ${SQL_FILE})`);
        process.exit(1);
    }

    // Step 1 - create the database if needed, via the default 'postgres' database.
    const admin = new Client({ ...CONFIG, database: 'postgres' });
    try {
        await admin.connect();
    } catch (error) {
        console.error(`\nCould not connect to PostgreSQL on ${CONFIG.host}:${CONFIG.port}`);
        console.error(`  ${error.message}`);
        console.error('\nIs PostgreSQL running, and are DB_USER / DB_PASSWORD correct in .env?\n');
        process.exit(1);
    }

    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (exists.rows.length === 0) {
        await admin.query(`CREATE DATABASE ${DB_NAME}`);
        console.log(`Created database "${DB_NAME}"`);
    } else {
        console.log(`Database "${DB_NAME}" already exists - reusing it`);
    }
    await admin.end();

    // Step 2 - run the schema and seed data.
    const db = new Client({ ...CONFIG, database: DB_NAME });
    await db.connect();

    console.log('Running lams_database_setup.sql ...');
    const result = await db.query(fs.readFileSync(SQL_FILE, 'utf8'));

    // The script finishes with the row counts and the consistency check.
    const tables = Array.isArray(result) ? result.filter(r => r.rows && r.rows.length) : [result];
    for (const set of tables.slice(-2)) {
        for (const row of set.rows) console.log('  ' + Object.values(row).join(': '));
    }

    await db.end();
    console.log('\nDatabase ready. Start the server with:  npm start\n');
}

main().catch(error => {
    console.error('\nSetup failed:', error.message, '\n');
    process.exit(1);
});
