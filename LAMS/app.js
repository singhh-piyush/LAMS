// LAMS front end
// Plain JavaScript, no framework. Talks to the Express API in server.js.

const API_BASE = '/api';
let currentUser = null;

// Every fetch sends the session cookie, which is how the server knows who we are.
function api(path, options) {
    return fetch(API_BASE + path, Object.assign({ credentials: 'same-origin' }, options || {}));
}

function apiJson(path, method, body) {
    return api(path, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(res => res.json());
}

// Values from the database go into innerHTML, so escape them first.
function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(value) {
    return 'R ' + (Number(value) || 0).toFixed(2);
}

function shortDate(value) {
    return value ? new Date(value).toLocaleDateString() : 'N/A';
}

// A CSS-safe version of a status or condition, e.g. "Needs Repair" -> "needs-repair"
function badgeClass(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '-');
}

// ===========================================================================
// LOGIN / LOGOUT
// ===========================================================================

function loginUser(studentNumber, password) {
    apiJson('/login', 'POST', { studentNumber: studentNumber, password: password })
        .then(data => {
            if (data.success) {
                startSession(data);
            } else {
                document.getElementById('errorMessage').textContent = data.message || 'Login failed';
            }
        })
        .catch(() => {
            document.getElementById('errorMessage').textContent =
                'Cannot reach the server. Is it running on port 3000?';
        });
}

function startSession(user) {
    currentUser = user;

    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('userName').textContent = user.name;

    const badge = document.getElementById('userTypeBadge');
    badge.textContent = user.role === 'student' ? 'STUDENT' : 'TECHNICIAN';
    badge.className = 'user-badge ' + user.role;

    loadFilters();
    setupNavigation(user.role);
}

function logout() {
    apiJson('/logout', 'POST', {}).finally(() => {
        currentUser = null;
        document.getElementById('mainApp').style.display = 'none';
        // Clear the inline style rather than setting 'block': the stylesheet makes
        // #loginPage a centred flex container, and an inline display:block would
        // override that and pin the card to the top-left corner.
        document.getElementById('loginPage').style.display = '';
        document.getElementById('studentNumber').value = '';
        document.getElementById('password').value = '';
        document.getElementById('errorMessage').textContent = '';
    });
}

// ===========================================================================
// NAVIGATION
// ===========================================================================

const ALL_SECTIONS = ['studentDashboard', 'browseAssets', 'technicianDashboard',
                      'checkoutReturn', 'inventoryMgmt', 'reports'];

function setupNavigation(role) {
    const navTabs = document.getElementById('navTabs');
    navTabs.innerHTML = '';

    // Students get no Reports tab: four of the six reports show other students'
    // names, loans and fines, so the whole section is technician-only.
    const tabs = role === 'student'
        ? [
            { id: 'studentDashboard', label: 'My Dashboard' },
            { id: 'browseAssets',     label: 'Browse Assets' },
            { id: 'inventoryMgmt',    label: 'Inventory' }
          ]
        : [
            { id: 'technicianDashboard', label: 'Technician Dashboard' },
            { id: 'checkoutReturn',      label: 'Checkout / Return' },
            { id: 'inventoryMgmt',       label: 'Inventory' },
            { id: 'reports',             label: 'Reports' }
          ];

    tabs.forEach((tab, index) => {
        const btn = document.createElement('button');
        btn.className = 'nav-btn' + (index === 0 ? ' active' : '');
        btn.textContent = tab.label;
        btn.onclick = () => switchTab(tab.id, btn);
        navTabs.appendChild(btn);
    });

    // Show the first tab for this role.
    switchTab(tabs[0].id, navTabs.firstChild);
}

function switchTab(tabId, button) {
    ALL_SECTIONS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    document.getElementById(tabId).style.display = 'block';

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (button) button.classList.add('active');

    if (tabId === 'studentDashboard')          loadStudentDashboard();
    else if (tabId === 'browseAssets')         loadAvailableAssets();
    else if (tabId === 'technicianDashboard')  loadTechnicianDashboard();
    else if (tabId === 'checkoutReturn')       loadCheckoutReturn();
    else if (tabId === 'inventoryMgmt')        loadInventory();
    else if (tabId === 'reports')              loadReportList();
}

function emptyRow(tbody, columns, message) {
    tbody.innerHTML = '<tr><td colspan="' + columns +
        '" style="text-align:center;color:#999;">' + message + '</td></tr>';
}

// ===========================================================================
// STUDENT DASHBOARD
// ===========================================================================

function loadStudentDashboard() {
    api('/student/dashboard')
        .then(res => res.json())
        .then(data => {
            document.getElementById('activeLoanCount').textContent = data.activeLoans || 0;
            document.getElementById('fineAmount').textContent = money(data.fines);
            document.getElementById('reservationCount').textContent = data.reservations || 0;
            document.getElementById('totalBorrowedCount').textContent = data.totalBorrowed || 0;

            const tbody = document.getElementById('studentLoansTable');
            tbody.innerHTML = '';

            if (!data.activeLoansList || data.activeLoansList.length === 0) {
                return emptyRow(tbody, 5, 'No active loans');
            }

            data.activeLoansList.forEach(loan => {
                const due = new Date(loan.duedate);
                const overdue = due < new Date();
                const fine = Number(loan.fineamount) || 0;

                const row = document.createElement('tr');
                row.innerHTML =
                    '<td>' + esc(loan.assetname) + '</td>' +
                    '<td>' + esc(loan.serialnumber) + '</td>' +
                    '<td>' + shortDate(loan.checkoutdate) + '</td>' +
                    '<td>' + shortDate(loan.duedate) +
                        (fine > 0 ? ' <small>(Fine: ' + money(fine) + ')</small>' : '') + '</td>' +
                    '<td>' + (overdue
                        ? '<span class="status-badge overdue">Overdue</span>'
                        : '<span class="status-badge available">On Time</span>') + '</td>';
                tbody.appendChild(row);
            });
        })
        .catch(err => console.error('Student dashboard error:', err));

    loadMyReservations();
}

// The student's own reservations: what they booked, for when, and whether it
// has been collected yet.
function loadMyReservations() {
    api('/reservations')
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('myReservationsTable');
            tbody.innerHTML = '';

            if (!Array.isArray(data) || data.length === 0) {
                return emptyRow(tbody, 5, 'You have no reservations');
            }

            data.forEach(r => {
                const row = document.createElement('tr');
                row.innerHTML =
                    '<td>' + esc(r.assetname) + '</td>' +
                    '<td>' + esc(r.serialnumber) + '</td>' +
                    '<td>' + shortDate(r.requestedpickupdate) +
                        (r.overdue_pickup ? ' <small class="late">(pickup date passed)</small>' : '') + '</td>' +
                    '<td><span class="status-badge ' + badgeClass(r.status) + '">' +
                        esc(r.status) + '</span></td>' +
                    '<td><button type="button" class="action-btn btn-cancel" ' +
                        'onclick="cancelReservation(' + r.reservationid + ')">Cancel</button></td>';
                tbody.appendChild(row);
            });
        })
        .catch(err => console.error('Reservations error:', err));
}

// ===========================================================================
// TECHNICIAN DASHBOARD
// ===========================================================================

function loadTechnicianDashboard() {
    api('/technician/dashboard')
        .then(res => res.json())
        .then(data => {
            document.getElementById('totalAssetsCount').textContent = data.totalAssets || 0;
            document.getElementById('availableCount').textContent = data.availableCount || 0;
            document.getElementById('checkedOutCount').textContent = data.checkedOutCount || 0;
            document.getElementById('overdueCount').textContent = data.overdueCount || 0;

            const tbody = document.getElementById('checkedOutTable');
            tbody.innerHTML = '';

            if (!data.checkedOutDetails || data.checkedOutDetails.length === 0) {
                return emptyRow(tbody, 8, 'Nothing is currently on loan');
            }

            data.checkedOutDetails.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML =
                    '<td>' + esc(item.assetname) + '</td>' +
                    '<td>' + esc(item.serialnumber) + '</td>' +
                    '<td>' + esc(item.studentnumber) + '</td>' +
                    '<td>' + esc(item.checkedoutto) + '</td>' +
                    '<td>' + shortDate(item.checkoutdate) + '</td>' +
                    '<td>' + shortDate(item.duedate) + '</td>' +
                    '<td>' + (item.duestatus === 'Overdue'
                        ? '<span class="status-badge overdue">Overdue</span>'
                        : '<span class="status-badge available">Active</span>') + '</td>' +
                    '<td><button type="button" class="action-btn btn-return" ' +
                        'onclick="confirmReturn(' + item.loanid + ')">Return</button></td>';
                tbody.appendChild(row);
            });
        })
        .catch(err => console.error('Technician dashboard error:', err));

    api('/overdue')
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('overdueTable');
            tbody.innerHTML = '';

            if (!Array.isArray(data) || data.length === 0) {
                return emptyRow(tbody, 7, 'Nothing overdue');
            }

            data.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML =
                    '<td>' + esc(item.loanid) + '</td>' +
                    '<td>' + esc(item.studentnumber) + '</td>' +
                    '<td>' + esc(item.studentname) + '</td>' +
                    '<td>' + esc(item.phonenumber) + '</td>' +
                    '<td>' + esc(item.assetname) + '</td>' +
                    '<td>' + shortDate(item.duedate) +
                        ' <small>(' + esc(item.daysoverdue) + ' days)</small></td>' +
                    '<td>' + money(item.fineamount) + '</td>';
                tbody.appendChild(row);
            });
        })
        .catch(err => console.error('Overdue error:', err));
}

// ===========================================================================
// BROWSE ASSETS
// ===========================================================================

function loadAvailableAssets() {
    searchAssets();
}

function searchAssets() {
    const search   = document.getElementById('searchInput').value;
    const category = document.getElementById('categoryFilter').value;
    const room     = document.getElementById('roomFilter').value;

    const params = new URLSearchParams();
    if (search)   params.set('search', search);
    if (category) params.set('category', category);
    if (room)     params.set('room', room);

    api('/assets/available?' + params.toString())
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('assetsTable');
            tbody.innerHTML = '';

            if (!Array.isArray(data) || data.length === 0) {
                return emptyRow(tbody, 7, 'No available assets match that search');
            }

            data.forEach(asset => {
                const row = document.createElement('tr');
                row.innerHTML =
                    '<td>' + esc(asset.assetname) + '</td>' +
                    '<td>' + esc(asset.categoryname) + '</td>' +
                    '<td>' + esc(asset.serialnumber) + '</td>' +
                    '<td>' + esc(asset.roomname) + '</td>' +
                    '<td><span class="condition-badge ' + badgeClass(asset.condition) + '">' +
                        esc(asset.condition) + '</span></td>' +
                    '<td><span class="status-badge ' + badgeClass(asset.status) + '">' +
                        esc(asset.status) + '</span></td>' +
                    '<td><button type="button" class="action-btn btn-reserve" ' +
                        'onclick="openReservation(' + asset.assetid + ')">Reserve</button></td>';
                tbody.appendChild(row);
            });
        })
        .catch(err => console.error('Assets error:', err));
}

function resetFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('categoryFilter').value = '';
    document.getElementById('roomFilter').value = '';
    loadAvailableAssets();
}

function loadFilters() {
    api('/categories').then(res => res.json()).then(data => {
        fillSelect('categoryFilter', data, 'All Categories');
    }).catch(err => console.error('Categories error:', err));

    api('/rooms').then(res => res.json()).then(data => {
        fillSelect('roomFilter', data, 'All Labs');
    }).catch(err => console.error('Rooms error:', err));
}

function fillSelect(id, values, placeholder) {
    const select = document.getElementById(id);
    select.innerHTML = '<option value="">' + placeholder + '</option>';
    (values || []).forEach(value => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
    });
}

// ===========================================================================
// INVENTORY
// ===========================================================================

function loadInventory() {
    api('/inventory')
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('inventoryTable');
            tbody.innerHTML = '';

            if (!Array.isArray(data) || data.length === 0) {
                return emptyRow(tbody, 9, 'No assets in inventory');
            }

            data.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML =
                    '<td>' + esc(item.assetname) + '</td>' +
                    '<td>' + esc(item.categoryname) + '</td>' +
                    '<td>' + esc(item.serialnumber) + '</td>' +
                    '<td>' + esc(item.roomname) + '</td>' +
                    '<td><span class="condition-badge ' + badgeClass(item.condition) + '">' +
                        esc(item.condition) + '</span></td>' +
                    '<td><span class="status-badge ' + badgeClass(item.status) + '">' +
                        esc(item.status) + '</span></td>' +
                    '<td>' + (item.checkedoutto ? esc(item.checkedoutto) : '-') + '</td>' +
                    '<td>' + shortDate(item.checkoutdate) + '</td>' +
                    '<td>' + shortDate(item.duedate) + '</td>';
                tbody.appendChild(row);
            });
        })
        .catch(err => console.error('Inventory error:', err));
}

// ===========================================================================
// REPORTS
// ===========================================================================

// Build the list of report buttons, then run the first one.
function loadReportList() {
    api('/reports')
        .then(res => res.json())
        .then(reports => {
            const picker = document.getElementById('reportPicker');
            picker.innerHTML = '';

            reports.forEach((report, index) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'report-btn' + (index === 0 ? ' active' : '');
                btn.textContent = (index + 1) + '. ' + report.title;
                btn.onclick = () => {
                    document.querySelectorAll('.report-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    runReport(report.key);
                };
                picker.appendChild(btn);
            });

            if (reports.length > 0) runReport(reports[0].key);
        })
        .catch(err => console.error('Report list error:', err));
}

// Run one report and render its SQL above the rows it returned.
function runReport(key) {
    api('/reports/' + key)
        .then(res => res.json())
        .then(data => {
            if (data.error) return showAlert(data.error, 'error');

            document.getElementById('reportTitle').textContent = data.title;
            document.getElementById('reportNote').textContent = data.note;
            document.getElementById('reportCount').textContent =
                data.rowCount + (data.rowCount === 1 ? ' row returned' : ' rows returned');

            // The columns come back with the result, so one renderer handles
            // all six reports without hardcoding any column names.
            const head = document.getElementById('reportHead');
            head.innerHTML = '<tr>' +
                data.columns.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr>';

            const body = document.getElementById('reportBody');
            body.innerHTML = '';

            if (data.rows.length === 0) {
                return emptyRow(body, data.columns.length, 'This report returned no rows');
            }

            data.rows.forEach(row => {
                const tr = document.createElement('tr');
                tr.innerHTML = data.columns.map(c => '<td>' + formatCell(row[c]) + '</td>').join('');
                body.appendChild(tr);
            });
        })
        .catch(err => console.error('Report error:', err));
}

// Dates arrive as ISO strings; show them the way the rest of the app does.
function formatCell(value) {
    if (value === null || value === undefined) return '<em>-</em>';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
        return shortDate(value);
    }
    return esc(value);
}

// ===========================================================================
// RESERVATION
// ===========================================================================

let reservationAssetId = null;

function openReservation(assetId) {
    reservationAssetId = assetId;
    document.getElementById('reservationModal').style.display = 'block';
}

function closeModal() {
    document.getElementById('reservationModal').style.display = 'none';
    reservationAssetId = null;
}

function submitReservation() {
    const pickupDate = document.getElementById('pickupDate').value;
    if (!pickupDate) return showAlert('Please choose a pickup date', 'error');

    // The server takes the student id from the session, not from here.
    apiJson('/reservation/create', 'POST', {
        assetId: reservationAssetId,
        desiredPickupDate: pickupDate
    })
        .then(data => {
            if (data.success) {
                showAlert(data.message, 'success');
                closeModal();
                loadAvailableAssets();
            } else {
                showAlert(data.error || 'Reservation failed', 'error');
            }
        })
        .catch(() => showAlert('Reservation failed', 'error'));
}

// ===========================================================================
// CHECKOUT / RETURN (technician)
//
// The normal path is one click: the student reserved the item beforehand, so
// it appears under "Awaiting Collection" and the technician just presses Issue.
// The manual form underneath is only for a walk-in who never used the system.
// ===========================================================================

function loadCheckoutReturn() {
    loadAwaitingCollection();
    loadReturnQueue();
}

function loadAwaitingCollection() {
    api('/reservations')
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('awaitingTable');
            tbody.innerHTML = '';

            if (!Array.isArray(data) || data.length === 0) {
                return emptyRow(tbody, 6, 'Nothing is waiting to be collected');
            }

            data.forEach(r => {
                const row = document.createElement('tr');
                row.innerHTML =
                    '<td>' + esc(r.assetname) + '</td>' +
                    '<td>' + esc(r.serialnumber) + '</td>' +
                    '<td>' + esc(r.studentnumber) + '</td>' +
                    '<td>' + esc(r.reservedby) + '</td>' +
                    '<td>' + shortDate(r.requestedpickupdate) +
                        (r.overdue_pickup ? ' <small class="late">(passed)</small>' : '') + '</td>' +
                    '<td class="row-actions">' +
                        '<button type="button" class="action-btn btn-reserve" ' +
                            'onclick="issueReservation(' + r.reservationid + ')">Issue</button>' +
                        '<button type="button" class="action-btn btn-cancel" ' +
                            'onclick="cancelReservation(' + r.reservationid + ')">Cancel</button>' +
                    '</td>';
                tbody.appendChild(row);
            });
        })
        .catch(err => console.error('Awaiting collection error:', err));
}

function loadReturnQueue() {
    api('/technician/dashboard')
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('returnQueueTable');
            tbody.innerHTML = '';

            const loans = data.checkedOutDetails || [];
            if (loans.length === 0) {
                return emptyRow(tbody, 6, 'Nothing is currently on loan');
            }

            loans.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML =
                    '<td>' + esc(item.assetname) + '</td>' +
                    '<td>' + esc(item.serialnumber) + '</td>' +
                    '<td>' + esc(item.checkedoutto) + '</td>' +
                    '<td>' + shortDate(item.duedate) + '</td>' +
                    '<td>' + (item.duestatus === 'Overdue'
                        ? '<span class="status-badge overdue">Overdue</span>'
                        : '<span class="status-badge available">Active</span>') + '</td>' +
                    '<td class="row-actions">' +
                        '<select id="cond_' + item.loanid + '" class="inline-select">' +
                            '<option value="Good">Good</option>' +
                            '<option value="Like New">Like New</option>' +
                            '<option value="Fair">Fair</option>' +
                            '<option value="Damaged">Damaged</option>' +
                        '</select>' +
                        '<button type="button" class="action-btn btn-return" ' +
                            'onclick="returnWithCondition(' + item.loanid + ')">Return</button>' +
                    '</td>';
                tbody.appendChild(row);
            });
        })
        .catch(err => console.error('Return queue error:', err));
}

// One click: reservation becomes a loan, and the reservation is marked Completed.
function issueReservation(reservationId) {
    apiJson('/reservations/' + reservationId + '/issue', 'POST', {})
        .then(data => {
            if (data.success) {
                showAlert(data.message, 'success');
                refreshTechnicianViews();
            } else {
                showAlert(data.error, 'error');
            }
        })
        .catch(() => showAlert('Could not issue the reservation', 'error'));
}

function cancelReservation(reservationId) {
    if (!confirm('Cancel this reservation and put the item back on the shelf?')) return;

    apiJson('/reservations/' + reservationId + '/cancel', 'POST', {})
        .then(data => {
            if (data.success) {
                showAlert(data.message, 'success');
                if (currentUser && currentUser.role === 'technician') {
                    refreshTechnicianViews();
                } else {
                    loadStudentDashboard();
                }
            } else {
                showAlert(data.error, 'error');
            }
        })
        .catch(() => showAlert('Could not cancel the reservation', 'error'));
}

function returnWithCondition(loanId) {
    const select = document.getElementById('cond_' + loanId);
    sendReturn(loanId, select ? select.value : 'Good');
}

function confirmReturn(loanId) {
    if (confirm('Confirm return of this asset?')) {
        sendReturn(loanId, 'Good');
    }
}

function sendReturn(loanId, condition) {
    apiJson('/technician/return', 'POST', { loanId: loanId, conditionOnReturn: condition })
        .then(data => {
            if (data.success) {
                showAlert(data.message, 'success');
                refreshTechnicianViews();
            } else {
                showAlert(data.error, 'error');
            }
        })
        .catch(() => showAlert('Return failed', 'error'));
}

// Refresh whichever technician view is on screen.
function refreshTechnicianViews() {
    if (document.getElementById('technicianDashboard').style.display !== 'none') {
        loadTechnicianDashboard();
    }
    if (document.getElementById('checkoutReturn').style.display !== 'none') {
        loadCheckoutReturn();
    }
}

// ---------------------------------------------------------------------------
// Walk-in checkout: only for someone who turns up without a reservation.
// ---------------------------------------------------------------------------

function toggleWalkIn() {
    const panel = document.getElementById('walkInPanel');
    const button = document.getElementById('walkInToggle');
    const open = panel.style.display === 'block';

    panel.style.display = open ? 'none' : 'block';
    button.textContent = open ? 'Walk-in checkout (no reservation)'
                              : 'Hide walk-in checkout';
}

function processWalkIn() {
    const studentNumber = document.getElementById('techStudentNumber').value.trim();
    const assetSerial   = document.getElementById('techAssetSerial').value.trim();

    if (!studentNumber || !assetSerial) {
        return showAlert('Enter both a student number and an asset serial', 'error');
    }

    apiJson('/technician/checkout', 'POST', {
        studentNumber: studentNumber, assetSerial: assetSerial
    })
        .then(data => {
            if (data.success) {
                showAlert(data.message, 'success');
                document.getElementById('techStudentNumber').value = '';
                document.getElementById('techAssetSerial').value = '';
                refreshTechnicianViews();
            } else {
                showAlert(data.error, 'error');
            }
        })
        .catch(() => showAlert('Checkout failed', 'error'));
}

// ===========================================================================
// FORGOT PASSWORD
// ===========================================================================

function openForgotPassword() {
    document.getElementById('forgotModal').style.display = 'block';
    document.getElementById('forgotMessage').textContent = '';
}

function closeForgotPassword() {
    document.getElementById('forgotModal').style.display = 'none';
    document.getElementById('forgotEmail').value = '';
}

function submitForgotPassword() {
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) {
        document.getElementById('forgotMessage').textContent = 'Please enter your email address';
        return;
    }

    apiJson('/forgot-password', 'POST', { email: email })
        .then(data => {
            document.getElementById('forgotMessage').textContent = data.message;
            document.getElementById('forgotEmail').value = '';
        })
        .catch(() => {
            document.getElementById('forgotMessage').textContent = 'Could not reach the server';
        });
}

// ===========================================================================
// UTILITIES
// ===========================================================================

// Show/hide toggle on a password box.
function togglePassword(inputId, button) {
    const input = document.getElementById(inputId);
    const hidden = input.type === 'password';

    input.type = hidden ? 'text' : 'password';
    button.textContent = hidden ? 'Hide' : 'Show';
    button.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    input.focus();
}

function showAlert(message, type) {
    const alert = document.getElementById('appAlert');
    alert.textContent = message;
    alert.className = 'alert ' + type;
    alert.style.display = 'block';
    setTimeout(() => { alert.style.display = 'none'; }, 4000);
}

// ===========================================================================
// STARTUP
// ===========================================================================

window.addEventListener('DOMContentLoaded', () => {
    // Pickup date cannot be in the past.
    const pickup = document.getElementById('pickupDate');
    if (pickup) pickup.setAttribute('min', new Date().toISOString().split('T')[0]);

    // If a session is still active (e.g. after a page refresh), go straight in.
    api('/me')
        .then(res => res.ok ? res.json() : null)
        .then(user => { if (user) startSession(user); })
        .catch(() => { /* not logged in - stay on the login page */ });
});

window.onclick = (event) => {
    if (event.target === document.getElementById('reservationModal')) closeModal();
    if (event.target === document.getElementById('forgotModal')) closeForgotPassword();
};
