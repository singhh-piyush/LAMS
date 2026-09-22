let currentUser = null;

const API_BASE = 'http://localhost:3000/api';


// LOGIN

function loginUser(studentNumber, password, userType) {
    fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentNumber, password, userType })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentUser = {
                userId: data.userId,
                name: data.name,
                role: data.role
            };
            
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
            document.getElementById('userName').textContent = data.name;
            
            const badge = document.getElementById('userTypeBadge');
            if (data.role === 'student') {
                badge.textContent = 'STUDENT';
                badge.style.backgroundColor = '#2563eb';
            } else {
                badge.textContent = 'TECHNICIAN';
                badge.style.backgroundColor = '#dc2626';
            }
            
            setupNavigation(data.role);
            loadDashboardData(data.role);
        } else {
            document.getElementById('errorMessage').innerHTML = '❌ ' + (data.message || 'Login failed');
        }
    })
    .catch(err => {
        console.error('Login error:', err);
        document.getElementById('errorMessage').innerHTML = '❌ Connection error';
    });
}


// NAVIGATION SETUP (Role-based tabs)

function setupNavigation(role) {
    const navTabs = document.getElementById('navTabs');
    navTabs.innerHTML = '';
    
    const tabs = role === 'student' 
        ? [
            { id: 'browseAssets', label: 'Browse Assets' },
            { id: 'inventoryMgmt', label: 'Inventory' },
            { id: 'reports', label: 'Reports' }
          ]
        : [
            { id: 'technicianDashboard', label: 'Technician Dashboard' },
            { id: 'checkoutReturn', label: 'Checkout/Return' },
            { id: 'inventoryMgmt', label: 'Inventory' },
            { id: 'reports', label: 'Reports' }
          ];
    
    tabs.forEach((tab, index) => {
        const btn = document.createElement('button');
        btn.className = 'nav-btn' + (index === 0 ? ' active' : '');
        btn.textContent = tab.label;
        btn.onclick = () => switchTab(tab.id, role);
        navTabs.appendChild(btn);
    });
    
    // Hide all sections except first
    document.getElementById('studentDashboard').style.display = 'none';
    tabs.forEach(tab => {
        document.getElementById(tab.id).style.display = index === 0 ? 'block' : 'none';
    });
}


// TAB SWITCHING

function switchTab(tabId, role) {
    const sections = ['studentDashboard', 'browseAssets', 'technicianDashboard', 'checkoutReturn', 'inventoryMgmt', 'reports'];
    
    sections.forEach(sec => {
        document.getElementById(sec).style.display = 'none';
    });
    
    document.getElementById(tabId).style.display = 'block';
    
    // Update active button
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Load data for this tab
    if (tabId === 'browseAssets') {
        loadAvailableAssets();
    } else if (tabId === 'technicianDashboard') {
        loadTechnicianDashboard();
    } else if (tabId === 'inventoryMgmt') {
        loadInventory();
    } else if (tabId === 'reports') {
        loadUtilizationReport();
    }
}


// LOAD DASHBOARD DATA

function loadDashboardData(role) {
    if (role === 'student') {
        loadStudentDashboard();
    } else {
        loadTechnicianDashboard();
    }
}

/
// STUDENT DASHBOARD (Shows their actual loans & fines from database)

function loadStudentDashboard() {
    // Pass userId to get personalized data
    fetch(`${API_BASE}/student/dashboard/${currentUser.userId}`)
        .then(res => res.json())
        .then(data => {
            // Update dashboard cards
            document.getElementById('activeLoanCount').textContent = data.activeLoans || 0;
            document.getElementById('fineAmount').textContent = 'R ' + (data.fines || 0).toFixed(2);
            document.getElementById('reservationCount').textContent = data.reservations || 0;
            document.getElementById('totalBorrowedCount').textContent = data.totalBorrowed || 0;
            
            // Populate active loans table with REAL data
            const tbody = document.getElementById('studentLoansTable');
            tbody.innerHTML = '';
            
            if (data.activeLoansList && data.activeLoansList.length > 0) {
                data.activeLoansList.forEach(loan => {
                    const row = document.createElement('tr');
                    const dueDate = new Date(loan.duedate);
                    const today = new Date();
                    const isOverdue = dueDate < today;
                    
                    const overdueStatus = isOverdue 
                        ? '<span style="color: red; font-weight: bold;">Overdue</span>' 
                        : '<span style="color: green;">On Time</span>';
                    
                    const fineText = loan.fineamount > 0 
                        ? ` (Fine: R${loan.fineamount.toFixed(2)})` 
                        : '';
                    
                    row.innerHTML = `
                        <td>${loan.assetname}</td>
                        <td>${loan.serialnumber}</td>
                        <td>${new Date(loan.checkoutdate).toLocaleDateString()}</td>
                        <td>${dueDate.toLocaleDateString()}${fineText}</td>
                        <td>${overdueStatus}</td>
                    `;
                    tbody.appendChild(row);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999;">No active loans</td></tr>';
            }
        })
        .catch(err => console.error('Dashboard error:', err));
}


// TECHNICIAN DASHBOARD

function loadTechnicianDashboard() {
    fetch(`${API_BASE}/technician/dashboard`)
        .then(res => res.json())
        .then(data => {
            document.getElementById('totalAssetsCount').textContent = data.totalAssets || 0;
            document.getElementById('availableCount').textContent = data.availableCount || 0;
            document.getElementById('checkedOutCount').textContent = data.checkedOutCount || 0;
            document.getElementById('overdueCount').textContent = data.overdueCount || 0;
            
            // Populate checked out table
            const tbody = document.getElementById('checkedOutTable');
            tbody.innerHTML = '';
            
            if (data.checkedOutDetails && data.checkedOutDetails.length > 0) {
                data.checkedOutDetails.forEach(item => {
                    const row = document.createElement('tr');
                    const dueStatus = item.duestatus === 'Overdue' ? '<span style="color: red; font-weight: bold;">Overdue</span>' : 'Active';
                    row.innerHTML = `
                        <td>${item.assetname}</td>
                        <td>${item.serialnumber}</td>
                        <td>${item.studentnumber}</td>
                        <td>${item.checkedoutto}</td>
                        <td>${new Date(item.checkoutdate).toLocaleDateString()}</td>
                        <td>${new Date(item.duedate).toLocaleDateString()}</td>
                        <td>${dueStatus}</td>
                        <td>
                            <button type="button" class="action-btn btn-return" onclick="confirmReturn(${item.loanid})">Return</button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #999;">No checked out assets</td></tr>';
            }
        })
        .catch(err => console.error('Tech dashboard error:', err));
    
    // Load overdue items
    fetch(`${API_BASE}/overdue`)
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('overdueTable');
            tbody.innerHTML = '';
            
            if (data && data.length > 0) {
                data.forEach(item => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${item.loanid}</td>
                        <td>${item.studentnumber}</td>
                        <td>${item.studentname}</td>
                        <td>${item.assetname}</td>
                        <td>${new Date(item.duedate).toLocaleDateString()}</td>
                        <td>R ${item.fineamount || 0}</td>
                    `;
                    tbody.appendChild(row);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #999;">No overdue loans</td></tr>';
            }
        })
        .catch(err => console.error('Overdue error:', err));
}


// BROWSE AVAILABLE ASSETS (Student view)

function loadAvailableAssets() {
    searchAssets();
}

function searchAssets() {
    const search = document.getElementById('searchInput').value;
    const category = document.getElementById('categoryFilter').value;
    const room = document.getElementById('roomFilter').value;
    
    let url = `${API_BASE}/assets/available?`;
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (category) url += `category=${encodeURIComponent(category)}&`;
    if (room) url += `room=${encodeURIComponent(room)}&`;
    
    fetch(url)
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('assetsTable');
            tbody.innerHTML = '';
            
            if (data && data.length > 0) {
                data.forEach(asset => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${asset.assetname}</td>
                        <td>${asset.categoryname || 'N/A'}</td>
                        <td>${asset.serialnumber}</td>
                        <td>${asset.roomname || 'N/A'}</td>
                        <td><span class="condition-badge ${asset.condition.toLowerCase()}">${asset.condition}</span></td>
                        <td><span class="status-badge available">${asset.status}</span></td>
                        <td>
                            <button type="button" class="action-btn btn-reserve" onclick="openReservation(${asset.assetid})">Reserve</button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #999;">No assets found</td></tr>';
            }
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
    // Load categories
    fetch(`${API_BASE}/categories`)
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('categoryFilter');
            data.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                select.appendChild(opt);
            });
        })
        .catch(err => console.error('Categories error:', err));
    
    // Load rooms
    fetch(`${API_BASE}/rooms`)
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('roomFilter');
            data.forEach(room => {
                const opt = document.createElement('option');
                opt.value = room;
                opt.textContent = room;
                select.appendChild(opt);
            });
        })
        .catch(err => console.error('Rooms error:', err));
}


// INVENTORY MANAGEMENT

function loadInventory() {
    fetch(`${API_BASE}/inventory`)
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('inventoryTable');
            tbody.innerHTML = '';
            
            if (data && data.length > 0) {
                data.forEach(item => {
                    const row = document.createElement('tr');
                    const checkedOutTo = item.checkedoutto || 'N/A';
                    const checkoutDate = item.checkoutdate ? new Date(item.checkoutdate).toLocaleDateString() : 'N/A';
                    const dueDate = item.duedate ? new Date(item.duedate).toLocaleDateString() : 'N/A';
                    
                    row.innerHTML = `
                        <td>${item.assetname}</td>
                        <td>${item.categoryname || 'N/A'}</td>
                        <td>${item.serialnumber}</td>
                        <td>${item.roomname || 'N/A'}</td>
                        <td><span class="condition-badge ${item.condition.toLowerCase()}">${item.condition}</span></td>
                        <td><span class="status-badge ${item.status.toLowerCase().replace(' ', '-')}">${item.status}</span></td>
                        <td>${checkedOutTo}</td>
                        <td>${checkoutDate}</td>
                        <td>${dueDate}</td>
                        <td>
                            <button type="button" class="action-btn btn-small" onclick="editAsset(${item.assetid})">Edit</button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: #999;">No assets in inventory</td></tr>';
            }
        })
        .catch(err => console.error('Inventory error:', err));
}


// UTILIZATION REPORTS

function loadUtilizationReport() {
    fetch(`${API_BASE}/reports/utilization`)
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('utilizationTable');
            tbody.innerHTML = '';
            
            if (data && data.length > 0) {
                data.forEach(item => {
                    const row = document.createElement('tr');
                    const lastBorrowed = item.lastborrowed 
                        ? new Date(item.lastborrowed).toLocaleDateString() 
                        : 'Never';
                    
                    row.innerHTML = `
                        <td>${item.assetname}</td>
                        <td>${item.categoryname || 'N/A'}</td>
                        <td>${item.roomname || 'N/A'}</td>
                        <td>${item.timesborrowed}</td>
                        <td>${lastBorrowed}</td>
                        <td>${item.timesborrowed > 0 ? Math.round(item.timesborrowed / 7) + ' weeks avg' : 'N/A'}</td>
                    `;
                    tbody.appendChild(row);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #999;">No utilization data</td></tr>';
            }
        })
        .catch(err => console.error('Reports error:', err));
}


// RESERVATION

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
    
    if (!pickupDate) {
        alert('Please select a pickup date');
        return;
    }
    
    fetch(`${API_BASE}/reservation/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            studentId: currentUser.userId,
            assetId: reservationAssetId,
            desiredPickupDate: pickupDate
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            showAlert('✅ ' + data.message, 'success');
            closeModal();
            loadAvailableAssets();
        } else {
            showAlert('❌ ' + data.error, 'error');
        }
    })
    .catch(err => {
        console.error('Reservation error:', err);
        showAlert('❌ Failed to create reservation', 'error');
    });
}


// CHECKOUT/RETURN (Technician)

    function processTransaction() {
    const studentNumber = document.getElementById('techStudentNumber').value.trim();
    const assetSerial = document.getElementById('techAssetSerial').value.trim();
    const operationType = document.getElementById('operationType').value;
    
    console.log('Checkout attempt - Student:', studentNumber, 'Asset:', assetSerial);
    
    if (!studentNumber || !assetSerial || !operationType) {
        alert('Please fill in all fields');
        return;
    }
    
    if (operationType === 'checkout') {
        fetch(`${API_BASE}/technician/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                studentNumber,
                assetSerial,
                technicianId: currentUser.userId
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showAlert('✅ ' + data.message, 'success');
                document.getElementById('techStudentNumber').value = '';
                document.getElementById('techAssetSerial').value = '';
                loadTechnicianDashboard();
            } else {
                showAlert('❌ ' + data.error, 'error');
            }
        })
        .catch(err => {
            console.error('Checkout error:', err);
            showAlert('❌ Checkout failed', 'error');
        });
    } else {
        const loanId = assetSerial;
        fetch(`${API_BASE}/technician/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loanId })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showAlert('✅ ' + data.message, 'success');
                document.getElementById('techStudentNumber').value = '';
                document.getElementById('techAssetSerial').value = '';
                loadTechnicianDashboard();
            } else {
                showAlert('❌ ' + data.error, 'error');
            }
        })
        .catch(err => {
            console.error('Return error:', err);
            showAlert('❌ Return failed', 'error');
        });
    }
}

function confirmReturn(loanId) {
    if (confirm('Confirm return of this asset?')) {
        fetch(`${API_BASE}/technician/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loanId })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showAlert('✅ Asset returned successfully', 'success');
                loadTechnicianDashboard();
            } else {
                showAlert('❌ ' + data.error, 'error');
            }
        })
        .catch(err => {
            console.error('Return error:', err);
            showAlert('❌ Return failed', 'error');
        });
    }
}


// UTILITIES

function showAlert(message, type) {
    const alert = document.getElementById('appAlert');
    alert.textContent = message;
    alert.className = 'alert ' + type;
    alert.style.display = 'block';
    
    setTimeout(() => {
        alert.style.display = 'none';
    }, 4000);
}

function editAsset(assetId) {
    alert('Edit feature coming soon');
}

function logout() {
    currentUser = null;
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginPage').style.display = 'block';
    document.getElementById('studentNumber').value = '';
    document.getElementById('password').value = '';
    document.getElementById('userType').value = '';
    document.getElementById('errorMessage').innerHTML = '';
}


// INITIALIZE

window.addEventListener('DOMContentLoaded', () => {
    loadFilters();
    
    // Set min date for pickup to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('pickupDate').setAttribute('min', today);
});

// Close modal when clicking outside
window.onclick = (event) => {
    const modal = document.getElementById('reservationModal');
    if (event.target === modal) {
        closeModal();
    }
};
