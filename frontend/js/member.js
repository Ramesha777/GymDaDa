import { firebaseConfig } from './firebase-config.js';
firebase.initializeApp(firebaseConfig);

var auth = firebase.auth();
var db   = firebase.firestore();
var $ = function(id) { return document.getElementById(id); };

var currentUid = null;
var currentUser = null;
var memberData = null;

/* ═══════════════════════════════════════
   AUTH GATE
   ═══════════════════════════════════════ */
auth.onAuthStateChanged(function(user) {
    if (!user || !user.emailVerified) {
        window.location.href = 'login.html';
        return;
    }
    currentUid = user.uid;
    currentUser = user;

    db.collection('users').doc(user.uid).get().then(function(uDoc) {
        if (uDoc.exists) {
            var role = uDoc.data().role;
            if (role === 'admin')   { window.location.href = 'admin.html'; return; }
            if (role === 'trainer') { window.location.href = 'trainer.html'; return; }
        }
        return db.collection('members').doc(user.uid).get();
    }).then(function(doc) {
        if (doc === undefined) return;
        memberData = doc.exists ? doc.data() : {};
        showDashboard(user);
    }).catch(function() { window.location.href = 'login.html'; });
});

function showDashboard(user) {
    $('loadingGate').style.display = 'none';
    $('mainContent').style.display = 'block';
    $('userEmail').textContent = user.email;
    loadProfile();
}

$('btnLogout').addEventListener('click', function() {
    auth.signOut().then(function() { window.location.href = 'login.html'; });
});

/* ═══════════════════════════════════════
   SIDEBAR NAVIGATION
   ═══════════════════════════════════════ */
var sidebarLinks = document.querySelectorAll('.sidebar-nav a[data-section]');
var sections = document.querySelectorAll('.member-section');
var titles = {
    profile:  '<i class="fas fa-user me-2"></i>My Profile',
    classes:  '<i class="fas fa-dumbbell me-2"></i>Available Classes',
    trainers: '<i class="fas fa-chalkboard-teacher me-2"></i>Our Trainers',
    bookings: '<i class="fas fa-calendar-check me-2"></i>My Bookings'
};

sidebarLinks.forEach(function(link) {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        switchSection(this.getAttribute('data-section'));
        closeSidebar();
    });
});

function switchSection(name) {
    sidebarLinks.forEach(function(a) { a.classList.remove('active'); });
    sections.forEach(function(s) { s.classList.remove('active'); });
    var lnk = document.querySelector('[data-section="' + name + '"]');
    if (lnk) lnk.classList.add('active');
    var sec = $('sec-' + name);
    if (sec) sec.classList.add('active');
    $('topbarTitle').innerHTML = titles[name] || name;

    if (name === 'classes')  loadClasses();
    if (name === 'trainers') loadTrainers();
    if (name === 'bookings') loadBookings();
}

var sidebar = $('sidebar');
var overlay = $('sidebarOverlay');
$('menuToggle').addEventListener('click', function() { sidebar.classList.add('open'); overlay.classList.add('open'); });
function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }
$('sidebarClose').addEventListener('click', closeSidebar);
overlay.addEventListener('click', closeSidebar);

/* ═══════════════════════════════════════
   PROFILE
   ═══════════════════════════════════════ */
function loadProfile() {
    if (!currentUid) return;
    db.collection('members').doc(currentUid).get().then(function(doc) {
        if (!doc.exists) {
            $('profileStatus').innerHTML = '<span class="badge bg-secondary">New — fill in your details</span>';
            $('profEmail').value = currentUser.email;
            return;
        }
        var d = doc.data();
        memberData = d;
        $('profName').value    = d.displayName || '';
        $('profEmail').value   = d.email || currentUser.email;
        $('profPhone').value   = d.phone || '';
        $('profAddress').value = d.address || '';

        var planLabel = d.plan || '—';
        if (d.planPeriod) planLabel += ' (' + (d.planPeriod === 'yearly' ? 'Yearly' : 'Monthly') + ')';
        var planBadge = '';
        if (d.planStatus === 'active') {
            planBadge = ' <span class="badge bg-success ms-2">Active</span>';
        } else if (d.planStatus === 'expired') {
            planBadge = ' <span class="badge bg-secondary ms-2">Expired</span>';
        } else if (d.planId) {
            planBadge = ' <span class="badge bg-warning ms-2">Inactive</span>';
        }
        $('profPlan').innerHTML = planLabel + planBadge;
        var status = d.approvalStatus || 'pending';
        var colors = { approved: 'success', pending: 'warning', rejected: 'danger' };
        $('profileStatus').innerHTML =
            '<span class="badge bg-' + (colors[status] || 'secondary') + '">' +
            status.charAt(0).toUpperCase() + status.slice(1) + '</span>';
    });
}

$('profileForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var data = {
        displayName: $('profName').value.trim(),
        email: currentUser.email,
        phone: $('profPhone').value.trim(),
        address: $('profAddress').value.trim()
    };
    db.collection('members').doc(currentUid).get().then(function(doc) {
        if (doc.exists) {
            return db.collection('members').doc(currentUid).update(data);
        } else {
            data.approvalStatus = 'pending';
            data.plan = 'Basic';
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            return db.collection('members').doc(currentUid).set(data);
        }
    }).then(function() {
        showAlert($('profileAlert'), 'Profile saved!', 'success');
        loadProfile();
    }).catch(function(err) { showAlert($('profileAlert'), err.message, 'danger'); });
});

function showAlert(el, msg, type) {
    el.className = 'alert alert-' + type;
    el.textContent = msg;
    el.classList.remove('d-none');
    setTimeout(function() { el.classList.add('d-none'); }, 4000);
}

/* ═══════════════════════════════════════
   CLASSES
   ═══════════════════════════════════════ */
function loadClasses() {
    var grid = $('classesGrid');
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Loading classes…</div>';

    db.collection('classes').where('status', '==', 'active').get().then(function(snap) {
        grid.innerHTML = '';
        if (snap.empty) {
            grid.innerHTML = '<div class="col-12 text-center text-muted py-4">No classes available yet</div>';
            return;
        }
        snap.forEach(function(doc) {
            var c = doc.data();
            var spots = (c.capacity || 0) - (c.enrolled || 0);
            var schedTxt = (c.schedule && c.schedule.day ? c.schedule.day : '—') +
                ' at ' + (c.schedule && c.schedule.time ? c.schedule.time : '—');
            var dur = c.schedule && c.schedule.duration ? c.schedule.duration + ' min' : '';

            var col = document.createElement('div');
            col.className = 'col-md-6 col-lg-4';
            col.innerHTML =
                '<div class="dash-card h-100">' +
                    '<div class="card-body">' +
                        '<div class="d-flex justify-content-between align-items-start mb-2">' +
                            '<h6 class="text-white fw-bold mb-0">' + (c.name || 'Untitled') + '</h6>' +
                            '<span class="badge bg-info">' + (c.type || 'General') + '</span>' +
                        '</div>' +
                        '<p class="text-muted small mb-2">' + (c.description || '') + '</p>' +
                        '<div class="small text-muted mb-2">' +
                            '<i class="fas fa-calendar me-1"></i>' + schedTxt +
                            (dur ? ' <i class="fas fa-hourglass-half ms-2 me-1"></i>' + dur : '') +
                        '</div>' +
                        '<div class="small text-muted mb-3">' +
                            '<i class="fas fa-user-tie me-1"></i>' + (c.trainerName || 'TBA') +
                            '<span class="ms-2"><i class="fas fa-users me-1"></i>' + spots + '/' + (c.capacity || 0) + ' spots</span>' +
                        '</div>' +
                        (spots > 0
                            ? '<button class="btn btn-primary btn-sm w-100" onclick="openBookModal(\'' + doc.id + '\',\'' + escHtml(c.name) + '\',\'' + escHtml(c.trainerName || '') + '\',\'' + (c.trainerId || '') + '\',\'' + (c.schedule && c.schedule.time ? c.schedule.time : '') + '\')">Book Now</button>'
                            : '<button class="btn btn-secondary btn-sm w-100" disabled>Full</button>') +
                    '</div>' +
                '</div>';
            grid.appendChild(col);
        });
    });
}

function escHtml(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

$('btnRefreshClasses').addEventListener('click', loadClasses);

window.openBookModal = function(classId, className, trainerName, trainerId, time) {
    $('bookClassId').value = classId;
    $('bookClassName').textContent = className + (trainerName ? ' with ' + trainerName : '');
    $('bookClassId').dataset.trainerId = trainerId;
    $('bookClassId').dataset.trainerName = trainerName;
    $('bookClassId').dataset.className = className;
    $('bookClassId').dataset.time = time;
    var today = new Date();
    $('bookDate').min = today.toISOString().split('T')[0];
    $('bookDate').value = '';
    new bootstrap.Modal($('bookModal')).show();
};

$('btnConfirmBook').addEventListener('click', function() {
    var classId = $('bookClassId').value;
    var date = $('bookDate').value;
    if (!date) { alert('Please select a date.'); return; }

    var ds = $('bookClassId').dataset;
    var booking = {
        memberId: currentUid,
        memberName: memberData.displayName || currentUser.email,
        memberEmail: currentUser.email,
        trainerId: ds.trainerId || '',
        trainerName: ds.trainerName || '',
        classId: classId,
        className: ds.className || '',
        date: date,
        time: ds.time || '',
        status: 'confirmed',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection('bookings').add(booking).then(function() {
        bootstrap.Modal.getInstance($('bookModal')).hide();
        loadClasses();
        switchSection('bookings');
    }).catch(function(err) { alert(err.message); });
});

/* ═══════════════════════════════════════
   TRAINERS
   ═══════════════════════════════════════ */
function loadTrainers() {
    var grid = $('trainersGrid');
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Loading trainers…</div>';

    db.collection('trainers').where('approvalStatus', '==', 'approved').get().then(function(snap) {
        grid.innerHTML = '';
        if (snap.empty) {
            grid.innerHTML = '<div class="col-12 text-center text-muted py-4">No trainers available yet</div>';
            return;
        }
        snap.forEach(function(doc) {
            var t = doc.data();
            var label = (t.displayName || t.email || 'Trainer').trim();
            var initials = (label || 'T').split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
            var col = document.createElement('div');
            col.className = 'col-md-6 col-lg-4';
            var card = document.createElement('div');
            card.className = 'dash-card h-100';
            var body = document.createElement('div');
            body.className = 'card-body text-center';
            body.innerHTML =
                '<div class="trainer-avatar">' + initials + '</div>' +
                '<h6 class="text-white fw-bold mt-3">' + escHtml(label) + '</h6>' +
                '<span class="badge bg-info mb-2">' + escHtml(t.specialization || 'General') + '</span>' +
                '<p class="text-muted small mb-1">' + (t.experience || 0) + ' years experience</p>' +
                '<p class="text-muted small mb-0">' + escHtml(t.bio || '') + '</p>';
            card.appendChild(body);
            col.appendChild(card);
            grid.appendChild(col);
        });
    });
}

$('btnRefreshTrainers').addEventListener('click', loadTrainers);

/* ═══════════════════════════════════════
   BOOKINGS
   ═══════════════════════════════════════ */
function loadBookings() {
    var tbody = $('bookingsBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Loading…</td></tr>';

    db.collection('bookings').where('memberId', '==', currentUid).orderBy('createdAt', 'desc').get()
        .then(function(snap) {
            tbody.innerHTML = '';
            if (snap.empty) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No bookings yet. Browse classes to book!</td></tr>';
                return;
            }
            snap.forEach(function(doc) {
                var b = doc.data();
                var statusColors = { confirmed: 'success', cancelled: 'secondary', completed: 'info' };
                var tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + (b.className || '—') + '</td>' +
                    '<td>' + (b.trainerName || '—') + '</td>' +
                    '<td>' + (b.date || '—') + '</td>' +
                    '<td>' + (b.time || '—') + '</td>' +
                    '<td><span class="badge bg-' + (statusColors[b.status] || 'secondary') + '">' + (b.status || '—') + '</span></td>' +
                    '<td>' +
                        (b.status === 'confirmed'
                            ? '<button class="btn btn-sm btn-outline-danger" onclick="cancelBooking(\'' + doc.id + '\')"><i class="fas fa-times me-1"></i>Cancel</button>'
                            : '—') +
                    '</td>';
                tbody.appendChild(tr);
            });
        });
}

window.cancelBooking = function(bookingId) {
    if (!confirm('Cancel this booking?')) return;
    db.collection('bookings').doc(bookingId).update({ status: 'cancelled' })
        .then(function() { loadBookings(); });
};

$('btnRefreshBookings').addEventListener('click', loadBookings);
