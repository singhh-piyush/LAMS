// Minimal .env loader.
// Deliberately hand-written rather than pulling in the 'dotenv' package, to
// keep the dependency list short. Reads KEY=value lines, ignores blanks and
// # comments, and never overwrites a variable that is already set.
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
    const target = file || path.join(__dirname, '.env');
    if (!fs.existsSync(target)) return;

    for (const rawLine of fs.readFileSync(target, 'utf8').split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const eq = line.indexOf('=');
        if (eq === -1) continue;

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();

        // strip surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (!(key in process.env)) process.env[key] = value;
    }
}

module.exports = { loadEnv };
