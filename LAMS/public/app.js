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
                      'checkoutReturn', 'inventoryMgmt', 'reports', 'dataTables'];

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
            { id: 'reports',             label: 'Reports' },
            { id: 'dataTables',          label: 'Browse Tables' }
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
    else if (tabId === 'dataTables')           loadTableBrowser();
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

            renderMyFines(data.finesList);

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

// What each fine is actually for. The tile above only shows what is still owed,
// so paid fines are listed here too - otherwise a student has no record of them.
function renderMyFines(list) {
    const tbody = document.getElementById('myFinesTable');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!list || list.length === 0) {
        return emptyRow(tbody, 5, 'No fines');
    }

    list.forEach(fine => {
        const row = document.createElement('tr');
        row.innerHTML =
            '<td>' + esc(fine.assetname) + '</td>' +
            '<td>' + esc(fine.reason || '') + '</td>' +
            '<td>' + shortDate(fine.finedate) + '</td>' +
            '<td class="num">' + money(fine.fineamount) + '</td>' +
            '<td>' + (fine.paid
                ? '<span class="status-badge available">Paid ' + shortDate(fine.paiddate) + '</span>'
                : '<span class="status-badge overdue">Unpaid</span>') + '</td>';
        tbody.appendChild(row);
    });
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
                return emptyRow(tbody, 9, 'Nothing overdue');
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
                    '<td>' + money(item.fineamount) + '</td>' +
                    '<td>' + (Number(item.reminderssent) > 0
                        ? esc(item.reminderssent) + ' &middot; ' + shortDate(item.lastremindedat)
                        : 'Not yet') + '</td>' +
                    '<td><button type="button" class="action-btn btn-reserve" ' +
                        'onclick="emailStudent(' + item.loanid + ', \'' +
                        esc(item.studentname) + '\')">Email Student</button></td>';
                tbody.appendChild(row);
            });
        })
        .catch(err => console.error('Overdue error:', err));
}

// Send the student an overdue reminder. The technician confirms first, since
// this puts a message in someone's inbox.
function emailStudent(loanId, studentName) {
    if (!confirm('Send an overdue reminder to ' + studentName + '?')) return;

    apiJson('/overdue/' + loanId + '/notify', 'POST', {})
        .then(data => {
            if (data.success) {
                showAlert(data.message, 'success');
                loadTechnicianDashboard();
            } else {
                showAlert(data.error, 'error');
            }
        })
        .catch(() => showAlert('Could not send the reminder', 'error'));
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

// Assets currently in the system. A technician also gets Edit and Remove on
// each row plus the Add Asset button above the table; a student sees neither.
function loadInventory() {
    const isTechnician = currentUser && currentUser.role === 'technician';

    document.getElementById('inventoryToolbar').style.display = isTechnician ? 'flex' : 'none';
    document.getElementById('inventoryActionHeader').style.display = isTechnician ? '' : 'none';

    if (isTechnician) loadAssetLookups();

    api('/inventory')
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('inventoryTable');
            tbody.innerHTML = '';

            const columns = isTechnician ? 10 : 9;
            if (!Array.isArray(data) || data.length === 0) {
                return emptyRow(tbody, columns, 'No assets in inventory');
            }

            data.forEach(item => {
                const removed = item.status === 'Decommissioned';

                let actions = '';
                if (isTechnician) {
                    actions = '<td><div class="row-actions">' +
                        '<button type="button" class="action-btn btn-small" ' +
                            'onclick="openAssetModal(' + item.assetid + ')">Edit</button>' +
                        (removed ? '' :
                            '<button type="button" class="action-btn btn-small btn-cancel" ' +
                            'onclick="removeAsset(' + item.assetid + ', \'' +
                            esc(item.assetname) + '\')">Remove</button>') +
                        '</div></td>';
                }

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
                    '<td>' + shortDate(item.duedate) + '</td>' +
                    actions;
                tbody.appendChild(row);
            });

            inventoryCache = data;
        })
        .catch(err => console.error('Inventory error:', err));
}

// ---------------------------------------------------------------------------
// ADD / EDIT / REMOVE ASSETS (technician)
// Add and Edit share one modal: the only differences are the title, the button
// label, and whether we POST a new asset or PUT an existing one.
// ---------------------------------------------------------------------------

let inventoryCache = [];
let lookups = { categories: [], rooms: [] };
let editingAssetId = null;

function loadAssetLookups() {
    if (lookups.categories.length > 0) return;   // only fetch once per session

    api('/lookups')
        .then(res => res.json())
        .then(data => {
            lookups = data;
            fillLookup('assetCategory', data.categories, 'categoryid', 'categoryname');
            fillLookup('assetRoom', data.rooms, 'roomid', 'roomname');
        })
        .catch(err => console.error('Lookups error:', err));
}

function fillLookup(selectId, rows, valueKey, labelKey) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '';
    rows.forEach(row => {
        const opt = document.createElement('option');
        opt.value = row[valueKey];
        opt.textContent = row[labelKey];
        select.appendChild(opt);
    });
}

// assetId null means "add a new one".
function openAssetModal(assetId) {
    editingAssetId = assetId;

    const adding = assetId === null;
    document.getElementById('assetModalTitle').textContent = adding ? 'Add Asset' : 'Edit Asset';
    document.getElementById('assetModalSave').textContent = adding ? 'Add Asset' : 'Save Changes';

    if (adding) {
        document.getElementById('assetName').value = '';
        document.getElementById('assetSerial').value = '';
        document.getElementById('assetCost').value = '';
        document.getElementById('assetCondition').value = 'Good';
    } else {
        const asset = inventoryCache.find(a => a.assetid === assetId);
        if (!asset) return;

        document.getElementById('assetName').value = asset.assetname;
        document.getElementById('assetSerial').value = asset.serialnumber;
        document.getElementById('assetCondition').value = asset.condition;
        document.getElementById('assetCost').value = asset.cost == null ? '' : asset.cost;

        // Match the dropdowns by name, since the table carries names not ids.
        const category = lookups.categories.find(c => c.categoryname === asset.categoryname);
        const room = lookups.rooms.find(r => r.roomname === asset.roomname);
        if (category) document.getElementById('assetCategory').value = category.categoryid;
        if (room) document.getElementById('assetRoom').value = room.roomid;
    }

    document.getElementById('assetModal').style.display = 'block';
}

function closeAssetModal() {
    document.getElementById('assetModal').style.display = 'none';
    editingAssetId = null;
}

function saveAssetModal() {
    const body = {
        assetName:    document.getElementById('assetName').value.trim(),
        serialNumber: document.getElementById('assetSerial').value.trim(),
        categoryId:   document.getElementById('assetCategory').value,
        roomId:       document.getElementById('assetRoom').value,
        condition:    document.getElementById('assetCondition').value,
        cost:         document.getElementById('assetCost').value
    };

    if (!body.assetName || !body.serialNumber) {
        return showAlert('Enter both an asset name and a serial number', 'error');
    }

    const adding = editingAssetId === null;
    const request = adding
        ? apiJson('/assets', 'POST', body)
        : apiJson('/assets/' + editingAssetId, 'PUT', body);

    request
        .then(data => {
            if (data.success) {
                showAlert(data.message, 'success');
                closeAssetModal();
                loadInventory();
            } else {
                showAlert(data.error, 'error');
            }
        })
        .catch(() => showAlert(adding ? 'Could not add the asset' : 'Could not update the asset', 'error'));
}

// Removing an asset takes it out of circulation but keeps its loan history,
// because past loans and fines still reference it.
function removeAsset(assetId, assetName) {
    if (!confirm('Remove ' + assetName + ' from the inventory?\n\nIt can no longer be issued. Its past loans and fines are kept.')) return;

    apiJson('/assets/' + assetId + '/remove', 'POST', {})
        .then(data => {
            if (data.success) {
                showAlert(data.message, 'success');
                loadInventory();
            } else {
                showAlert(data.error, 'error');
            }
        })
        .catch(() => showAlert('Could not remove the asset', 'error'));
}

// ===========================================================================
// REPORTS
// ===========================================================================

// Reports and the table browser are separate tabs with their own markup, but a
// result set looks the same coming from either, so both draw through
// renderResult below. These say which elements to draw into.
const REPORT_VIEW = { title: 'reportTitle', count: 'reportCount',
                      head:  'reportHead',  body:  'reportBody' };
const TABLE_VIEW  = { title: 'tableTitle',  count: 'tableCount',
                      head:  'tableHead',   body:  'tableBody' };

function pickerButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'report-btn';
    btn.textContent = label;
    btn.onclick = onClick;
    return btn;
}

function setActiveButton(picker, btn) {
    picker.querySelectorAll('.report-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

// Build the list of report buttons, then run the first one.
function loadReportList() {
    api('/reports')
        .then(res => res.json())
        .then(reports => {
            const picker = document.getElementById('reportPicker');
            picker.innerHTML = '';

            let first = null;
            reports.forEach(report => {
                const btn = pickerButton(report.label, () => {
                    setActiveButton(picker, btn);
                    fetchRows('/reports/' + report.key, REPORT_VIEW,
                              'This report returned no records');
                });
                picker.appendChild(btn);
                if (!first) first = btn;
            });

            if (first) first.click();
        })
        .catch(err => console.error('Report list error:', err));
}

// ===========================================================================
// BROWSE TABLES
// ===========================================================================

let tableDefs = [];
let currentTable = null;

// The server sends each table's filters with the list, so the bar can be built
// without a second request per table.
function loadTableBrowser() {
    api('/tables')
        .then(res => res.json())
        .then(tables => {
            tableDefs = Array.isArray(tables) ? tables : [];

            const picker = document.getElementById('tablePicker');
            picker.innerHTML = '';

            let first = null;
            tableDefs.forEach(table => {
                const btn = pickerButton(table.label, () => {
                    setActiveButton(picker, btn);
                    openTable(table.key);
                });
                picker.appendChild(btn);
                if (!first) first = btn;
            });

            if (first) first.click();
        })
        .catch(err => console.error('Table list error:', err));
}

function openTable(key) {
    currentTable = key;
    buildFilterBar(tableDefs.find(t => t.key === key));
    runTableQuery();
}

// Build the filter controls for one table.
function buildFilterBar(table) {
    const bar = document.getElementById('tableFilters');
    bar.innerHTML = '';

    if (!table || !table.filters || table.filters.length === 0) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = '';

    table.filters.forEach(filter => {
        const field = document.createElement('div');
        field.className = 'filter-field';

        const label = document.createElement('label');
        label.textContent = filter.label;
        label.htmlFor = 'filter_' + filter.key;
        field.appendChild(label);

        let input;
        if (filter.type === 'select') {
            input = document.createElement('select');
            input.innerHTML = '<option value="">All</option>' +
                (filter.options || []).map(option =>
                    '<option value="' + esc(option) + '">' + esc(option) + '</option>'
                ).join('');
        } else {
            input = document.createElement('input');
            input.type = filter.type === 'date' ? 'date' : 'text';
            if (filter.placeholder) input.placeholder = filter.placeholder;
        }

        input.id = 'filter_' + filter.key;
        input.dataset.filterKey = filter.key;
        // change covers picking a date, choosing an option, and leaving or
        // pressing Enter in a text box - so the table is not re-queried on
        // every keystroke.
        input.onchange = runTableQuery;

        field.appendChild(input);
        bar.appendChild(field);
    });

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'action-btn btn-small btn-cancel';
    clear.textContent = 'Clear';
    clear.onclick = () => {
        bar.querySelectorAll('[data-filter-key]').forEach(el => { el.value = ''; });
        runTableQuery();
    };
    bar.appendChild(clear);
}

// Send whatever the filter bar currently holds. Anything left blank is left out
// of the query string, and the server then leaves that filter out of the WHERE.
function runTableQuery() {
    if (!currentTable) return;

    const parts = [];
    document.querySelectorAll('#tableFilters [data-filter-key]').forEach(el => {
        const value = el.value.trim();
        if (value !== '') {
            parts.push(encodeURIComponent(el.dataset.filterKey) + '=' + encodeURIComponent(value));
        }
    });

    fetchRows('/tables/' + currentTable + (parts.length ? '?' + parts.join('&') : ''),
              TABLE_VIEW, 'No rows match these filters');
}

// Column labels and types come back with the result, so one renderer handles
// every report and every table without hardcoding a single column name.
function fetchRows(path, view, emptyMessage) {
    api(path)
        .then(res => res.json())
        .then(data => {
            if (data.error) return showAlert(data.error, 'error');

            document.getElementById(view.title).textContent = data.title;
            document.getElementById(view.count).textContent =
                data.rowCount + (data.rowCount === 1 ? ' record' : ' records');

            // Only the fines table sends an action; reports and every other table
            // leave it null and render exactly as before.
            const action = data.action || null;
            const columnCount = data.columns.length + (action ? 1 : 0);

            const head = document.getElementById(view.head);
            head.innerHTML = '<tr>' + data.columns.map(c =>
                '<th' + (c.numeric ? ' class="num"' : '') + '>' + esc(c.name) + '</th>'
            ).join('') + (action ? '<th></th>' : '') + '</tr>';

            const body = document.getElementById(view.body);
            body.innerHTML = '';

            if (data.rows.length === 0) {
                return emptyRow(body, columnCount, emptyMessage);
            }

            data.rows.forEach(row => {
                const tr = document.createElement('tr');
                tr.innerHTML = data.columns.map(c =>
                    '<td' + (c.numeric ? ' class="num"' : '') + '>' +
                    formatCell(row[c.name], c) + '</td>'
                ).join('') + (action ? actionCell(action, row) : '');
                body.appendChild(tr);
            });
        })
        .catch(err => console.error('Result error:', err));
}

// The button at the end of an actionable row. A row that fails the enabledWhen
// test still gets a cell, so the columns stay lined up - it just has nothing in it.
function actionCell(action, row) {
    const test = action.enabledWhen;
    if (test && String(row[test.column]) !== test.equals) return '<td></td>';

    return '<td><div class="row-actions">' +
        '<button type="button" class="action-btn btn-small" onclick="' +
        esc(action.handler) + '(' + Number(row[action.idColumn]) + ')">' +
        esc(action.label) + '</button></div></td>';
}

// Mark a fine as paid, then reload the table so the row moves to Settled.
function settleFine(fineId) {
    if (!confirm('Mark this fine as paid?')) return;

    apiJson('/fines/' + fineId + '/pay', 'POST', {})
        .then(data => {
            showAlert(data.message || data.error, data.success ? 'success' : 'error');
            if (data.success) runTableQuery();
        })
        .catch(err => console.error('Settle fine error:', err));
}

// Dates arrive as ISO strings and money as numeric strings; show both the way
// the rest of the app does.
function formatCell(value, column) {
    if (value === null || value === undefined) return '&ndash;';
    if (column && column.money) return money(value);
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
                    '<td><div class="row-actions">' +
                        '<button type="button" class="action-btn btn-reserve" ' +
                            'onclick="issueReservation(' + r.reservationid + ')">Issue</button>' +
                        '<button type="button" class="action-btn btn-cancel" ' +
                            'onclick="cancelReservation(' + r.reservationid + ')">Cancel</button>' +
                    '</div></td>';
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
                    '<td><div class="row-actions">' +
                        '<select id="cond_' + item.loanid + '" class="inline-select">' +
                            '<option value="Good">Good</option>' +
                            '<option value="Like New">Like New</option>' +
                            '<option value="Fair">Fair</option>' +
                            '<option value="Damaged">Damaged</option>' +
                        '</select>' +
                        '<button type="button" class="action-btn btn-return" ' +
                            'onclick="returnWithCondition(' + item.loanid + ')">Return</button>' +
                    '</div></td>';
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
// Walk-in checkout / return, for a student who did not reserve the item.
// ---------------------------------------------------------------------------

function processTransaction() {
    const studentNumber = document.getElementById('techStudentNumber').value.trim();
    const assetSerial   = document.getElementById('techAssetSerial').value.trim();
    const operation     = document.getElementById('operationType').value;

    if (operation === 'checkout') {
        if (!studentNumber || !assetSerial) {
            return showAlert('Enter both a student number and an asset serial', 'error');
        }

        apiJson('/technician/checkout', 'POST', {
            studentNumber: studentNumber, assetSerial: assetSerial
        })
            .then(data => {
                if (data.success) {
                    showAlert(data.message, 'success');
                    clearTransactionForm();
                    refreshTechnicianViews();
                } else {
                    showAlert(data.error, 'error');
                }
            })
            .catch(() => showAlert('Checkout failed', 'error'));

    } else {
        // For a return the second field carries the loan ID.
        if (!assetSerial) {
            return showAlert('Enter the loan ID being returned', 'error');
        }
        sendReturn(assetSerial, 'Good');
    }
}

function clearTransactionForm() {
    document.getElementById('techStudentNumber').value = '';
    document.getElementById('techAssetSerial').value = '';
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

// The alert sits at the top of the page, so when the technician is working further
// down - the Awaiting Collection and Process a Return tables are both below the
// fold - a message could appear and time out again without ever being seen. It is
// scrolled into view, and an error stays put until the next action replaces it.
// Successes still clear themselves, since nothing is lost by missing one.
let alertTimer = null;

function showAlert(message, type) {
    const alert = document.getElementById('appAlert');
    alert.textContent = message;
    alert.className = 'alert ' + type;
    alert.style.display = 'block';
    alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    clearTimeout(alertTimer);
    if (type !== 'error') {
        alertTimer = setTimeout(() => { alert.style.display = 'none'; }, 4000);
    }
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
    if (event.target === document.getElementById('assetModal')) closeAssetModal();
};
