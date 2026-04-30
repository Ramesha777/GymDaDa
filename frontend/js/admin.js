/* ═══════════════════════════════════════
   GymDD — Admin dashboard (card-grid + modals)
   ═══════════════════════════════════════ */

import { firebaseConfig } from './firebase-config.js';

firebase.initializeApp(firebaseConfig);

var auth = firebase.auth();
var db   = firebase.firestore();
var rtdb = firebase.database();
var $ = function(id) { return document.getElementById(id); };

var currentUid = null;
var currentUser = null;
var chatMessagesUnsub = null;
var approvedTrainerNames = {};

var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ─── Caches for grids (used for search/filter and modal lookup) ─── */
var allMembersCache = [];
var allMembersById = {};
var allTrainersCache = [];
var allTrainersById = {};
var allClassesCache = [];
var allClassesById = {};

var adminClassLogWeekOffset = 0;


var memberDetailModalInstance = null;
var trainerDetailModalInstance = null;
var classDetailModalInstance = null;
var currentMemberDetailId = null;
var currentTrainerDetailId = null;
var currentClassDetailId = null;

var adminHtml5QrCode = null;

/* ─── Helpers ─── */
function escHtml(s) {
    if (s == null || s === '') return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function tsSeconds(ts) {
    if (!ts) return 0;
    if (typeof ts.seconds === 'number') return ts.seconds;
    if (ts.toMillis) return Math.floor(ts.toMillis() / 1000);
    return 0;
}

function tsToDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') {
        try { return ts.toDate(); } catch (e) { /* ignore */ }
    }
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    if (typeof ts === 'number') return new Date(ts);
    if (typeof ts === 'string') {
        var d = new Date(ts);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

function formatDate(ts) {
    var d = tsToDate(ts);
    if (!d) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getInitials(name, fallback) {
    var src = (name && String(name).trim()) || fallback || '';
    if (!src) return '?';
    return src.split(/\s+/).map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
}

function avatarHtml(name, email, photoURL, sizeClass) {
    var initials = getInitials(name, email);
    var cls = 'user-avatar' + (sizeClass ? ' ' + sizeClass : '');
    if (photoURL && /^https?:\/\//i.test(photoURL)) {
        return '<div class="' + cls + '">' +
            '<img src="' + escHtml(photoURL) + '" alt="' + escHtml(name || 'avatar') + '" ' +
            'onerror="this.parentNode.textContent=\'' + initials + '\'"></div>';
    }
    return '<div class="' + cls + '">' + initials + '</div>';
}

function bigAvatarInto(boxId, initialsId, name, email, photoURL) {
    var box = $(boxId);
    var ini = $(initialsId);
    if (!box || !ini) return;
    var initials = getInitials(name, email);
    ini.textContent = initials;
    var existing = box.querySelector('img');
    if (existing) existing.remove();
    if (photoURL && /^https?:\/\//i.test(photoURL)) {
        var img = document.createElement('img');
        img.alt = name || 'avatar';
        img.src = photoURL;
        ini.style.display = 'none';
        img.onerror = function() {
            img.remove();
            ini.style.display = '';
        };
        box.appendChild(img);
    } else {
        ini.style.display = '';
    }
}

/* ─── Auth + boot ─── */
function showDashboard(user) {
    $('loadingGate').style.display = 'none';
    $('mainContent').style.display = 'block';
    if ($('adminEmail')) $('adminEmail').textContent = user.email || '';
    loadOverviewStats();
    loadAllMembers();
    loadTrainerApplications();
    loadClassesAdmin();
    populateTrainerSelect();
}

function ensureAdmin(user) {
    var uid = user.uid;
    return db.collection('admins').doc(uid).get().then(function(d) {
        if (d.exists) return true;
        return db.collection('users').doc(uid).get().then(function(u) {
            return u.exists && u.data().role === 'admin';
        });
    });
}

auth.onAuthStateChanged(function(user) {
    if (!user || !user.emailVerified) {
        window.location.href = 'login.html';
        return;
    }
    currentUid = user.uid;
    currentUser = user;
    ensureAdmin(user).then(function(ok) {
        if (!ok) {
            window.location.href = 'login.html';
            return;
        }
        showDashboard(user);
    }).catch(function() {
        window.location.href = 'login.html';
    });
});

if ($('btnLogout')) {
    $('btnLogout').addEventListener('click', function() {
        auth.signOut().then(function() { window.location.href = 'login.html'; });
    });
}

/* ─── Sidebar ─── */
var sidebarLinks = document.querySelectorAll('.sidebar-nav a[data-section]');
var sections = document.querySelectorAll('.admin-section');
var titles = {

    overview: '<i class="fas fa-chart-pie me-2 text-info"></i>Dashboard',

    members: '<i class="fas fa-users me-2"></i>All Members',

    trainers: '<i class="fas fa-chalkboard-teacher me-2"></i>Trainer Applications',

    trainerAvail: '<i class="fas fa-calendar-check me-2"></i>Trainer Schedules',

    classTracking: '<i class="fas fa-clipboard-check me-2"></i>Weekly class log',

    classes: '<i class="fas fa-dumbbell me-2"></i>Classes',

    checkin: '<i class="fas fa-qrcode me-2"></i>Booking check-in',

    chat: '<i class="fas fa-comments me-2"></i>Chat'

};

sidebarLinks.forEach(function(link) {
    link.addEventListener('click', function(e) {
        var sec = this.getAttribute('data-section');
        if (!sec) return;
        e.preventDefault();
        switchSection(sec);
        closeSidebar();
    });
});

function switchSection(name) {
    if (name !== 'checkin') stopAdminQrScanner();
    sidebarLinks.forEach(function(a) { a.classList.remove('active'); });
    sections.forEach(function(s) { s.classList.remove('active'); });
    var lnk = document.querySelector('.sidebar-nav a[data-section="' + name + '"]');
    if (lnk) lnk.classList.add('active');
    var sec = $('sec-' + name);
    if (sec) sec.classList.add('active');
    if ($('topbarTitle')) $('topbarTitle').innerHTML = titles[name] || name;

    if (name === 'trainerAvail') loadTrainerAvailability();
    if (name === 'classTracking') {
        populateAdminClassLogTrainerFilter();
        loadAdminTrainerClassTracking();
    }

    if (name === 'classes') loadClassesAdmin();
    if (name === 'chat') loadAdminChatTrainers();
}

var sidebar = $('sidebar');
var overlay = $('sidebarOverlay');
if ($('menuToggleAdmin')) {
    $('menuToggleAdmin').addEventListener('click', function() {
        sidebar.classList.add('open');
        overlay.classList.add('open');
    });
}
function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
}
if ($('sidebarClose')) $('sidebarClose').addEventListener('click', closeSidebar);
if (overlay) overlay.addEventListener('click', closeSidebar);

/* ─── Firestore: ordered fetch w/ fallback ─── */
function fetchMembersOrdered() {
    return db.collection('members').orderBy('createdAt', 'desc').get()
        .catch(function() { return db.collection('members').get(); })
        .then(function(snap) {
            var rows = [];
            snap.forEach(function(d) { rows.push(d); });
            rows.sort(function(a, b) { return tsSeconds(b.data().createdAt) - tsSeconds(a.data().createdAt); });
            return rows;
        });
}

function fetchTrainersOrdered() {
    return db.collection('trainers').orderBy('createdAt', 'desc').get()
        .catch(function() { return db.collection('trainers').get(); })
        .then(function(snap) {
            var rows = [];
            snap.forEach(function(d) { rows.push(d); });
            rows.sort(function(a, b) { return tsSeconds(b.data().createdAt) - tsSeconds(a.data().createdAt); });
            return rows;
        });
}

/* ─── Overview stats + recent pending trainer apps ─── */
function loadOverviewStats() {
    db.collection('members').get().then(function(snap) {
        if ($('statTotal')) $('statTotal').textContent = snap.size;
    });

    db.collection('trainers').get().then(function(snap) {
        var total = 0, approved = 0, pending = 0;
        snap.forEach(function(doc) {
            total++;
            var st = doc.data().approvalStatus || 'pending';
            if (st === 'approved') approved++;
            else if (st === 'pending') pending++;
        });
        if ($('statTrainers')) $('statTrainers').textContent = total;
        if ($('statApprovedTrainers')) $('statApprovedTrainers').textContent = approved;
        if ($('statPendingTrainers')) $('statPendingTrainers').textContent = pending;
    });

    db.collection('classes').get().then(function(snap) {
        if ($('statClasses')) $('statClasses').textContent = snap.size;
    }).catch(function() {
        if ($('statClasses')) $('statClasses').textContent = '0';
    });

    var grid = $('overviewPendingGrid');
    if (grid) {
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Loading…</div>';

    db.collection('trainers').where('approvalStatus', '==', 'pending').get()
        .then(function(snap) {
            var rows = [];
            snap.forEach(function(doc) {
                var item = { id: doc.id, data: doc.data() };
                rows.push(item);
                allTrainersById[doc.id] = item;
            });
            rows.sort(function(a, b) { return tsSeconds(b.data.createdAt) - tsSeconds(a.data.createdAt); });
            var top = rows.slice(0, 12);

            if ($('overviewPendingCount')) {
                $('overviewPendingCount').textContent = '(' + rows.length + ')';
            }

            grid.innerHTML = '';
            if (!top.length) {
                grid.innerHTML = '<div class="col-12 text-center text-muted py-4">No pending trainer applications</div>';
                return;
            }

            top.forEach(function(item) {
                var d = item.data;
                var name = d.displayName || '—';
                var initials = getInitials(name, d.email);
                var hasPhoto = d.photoURL && /^https?:\/\//i.test(d.photoURL);
                var avatar = hasPhoto
                    ? '<div class="trainer-avatar"><img src="' + escHtml(d.photoURL) + '" alt="' + escHtml(name) + '" onerror="this.parentNode.textContent=\'' + initials + '\'"></div>'
                    : '<div class="trainer-avatar">' + initials + '</div>';

                var col = document.createElement('div');
                col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';
                col.innerHTML =
                    '<div class="dash-card h-100 member-card" tabindex="0" data-id="' + item.id + '">' +
                        '<div class="card-body text-center">' +
                            avatar +
                            '<h6 class="text-white fw-bold mt-2 mb-1">' + escHtml(name) + '</h6>' +
                            '<span class="badge bg-info">' + escHtml(d.specialization || '—') + '</span>' +
                            '<div class="mt-1"><span class="badge bg-warning">Pending</span></div>' +
                        '</div>' +
                    '</div>';
                var card = col.querySelector('.member-card');
                card.addEventListener('click', function() { openTrainerDetailModal(item.id); });
                card.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openTrainerDetailModal(item.id);
                    }
                });
                grid.appendChild(col);
            });
        })
        .catch(function() {
            grid.innerHTML = '<div class="col-12 text-center text-danger py-4">Could not load pending trainers.</div>';
        });
    }

    loadOverviewClassTrainerRequests();
}

function loadOverviewClassTrainerRequests() {
    var tbody = $('overviewClassRequestsBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Loading…</td></tr>';

    db.collection('trainerClassRequests').where('status', '==', 'pending').get()
        .then(function(snap) {
            var rows = [];
            snap.forEach(function(doc) {
                rows.push({ id: doc.id, d: doc.data() });
            });
            rows.sort(function(a, b) {
                return tsSeconds(b.d.createdAt || b.d.updatedAt) - tsSeconds(a.d.createdAt || a.d.updatedAt);
            });

            if ($('overviewClassReqCount')) {
                $('overviewClassReqCount').textContent = '(' + rows.length + ')';
            }

            tbody.innerHTML = '';
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No pending trainer class requests</td></tr>';
                return;
            }

            rows.forEach(function(row) {
                var d = row.d;
                var tr = document.createElement('tr');
                var dateStr = formatDate(d.createdAt);

                var approveBtn = document.createElement('button');
                approveBtn.type = 'button';
                approveBtn.className = 'btn btn-sm btn-success me-1';
                approveBtn.title = 'Assign trainer to this class';
                approveBtn.innerHTML = '<i class="fas fa-check"></i>';
                approveBtn.addEventListener('click', function() {
                    approveTrainerClassRequest(row.id, d.classId, d.trainerId);
                });

                var rejectBtn = document.createElement('button');
                rejectBtn.type = 'button';
                rejectBtn.className = 'btn btn-sm btn-outline-danger';
                rejectBtn.title = 'Reject';
                rejectBtn.innerHTML = '<i class="fas fa-times"></i>';
                rejectBtn.addEventListener('click', function() {
                    rejectTrainerClassRequest(row.id);
                });

                var tdAct = document.createElement('td');
                tdAct.appendChild(approveBtn);
                tdAct.appendChild(rejectBtn);

                var tdClass = document.createElement('td');
                tdClass.textContent = d.className || d.classId || '—';
                var tdType = document.createElement('td');
                tdType.className = 'small';
                tdType.textContent = d.classType || '—';
                var tdTn = document.createElement('td');
                tdTn.textContent = d.trainerName || '—';
                var tdEm = document.createElement('td');
                tdEm.className = 'small';
                tdEm.textContent = d.trainerEmail || '—';
                var tdDt = document.createElement('td');
                tdDt.className = 'small';
                tdDt.textContent = dateStr;

                tr.appendChild(tdClass);
                tr.appendChild(tdType);
                tr.appendChild(tdTn);
                tr.appendChild(tdEm);
                tr.appendChild(tdDt);
                tr.appendChild(tdAct);

                tbody.appendChild(tr);
            });
        })
        .catch(function() {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Could not load class requests.</td></tr>';
        });
}

function approveTrainerClassRequest(reqDocId, classId, trainerUid) {
    if (!classId || !trainerUid) return;
    if (!confirm('Assign this trainer to this class? Their availability should align with the class schedule.')) return;

    db.collection('trainerClassRequests').doc(reqDocId).get().then(function(reqSnap) {
        if (!reqSnap.exists) throw new Error('Request no longer exists.');
        var d = reqSnap.data();
        var tName = d.trainerName || '';

        var batch = db.batch();
        batch.update(db.collection('classes').doc(classId), {
            trainerId: trainerUid,
            trainerName: tName,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        batch.update(db.collection('trainerClassRequests').doc(reqDocId), {
            status: 'approved',
            resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return batch.commit();
    }).then(function() {
        loadOverviewStats();
        loadClassesAdmin();
        populateTrainerSelect();
        loadTrainerAvailability();
    }).catch(function(err) {
        alert(err.message || 'Could not approve request.');
    });
}

function rejectTrainerClassRequest(reqDocId) {
    if (!confirm('Reject this class assignment request?')) return;
    db.collection('trainerClassRequests').doc(reqDocId).update({
        status: 'rejected',
        resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function() {
        loadOverviewStats();
    }).catch(function(err) {
        alert(err.message || 'Could not reject request.');
    });
}

if ($('btnRefreshOverview')) {
    $('btnRefreshOverview').addEventListener('click', loadOverviewStats);
}
if ($('btnRefreshClassRequests')) {
    $('btnRefreshClassRequests').addEventListener('click', loadOverviewClassTrainerRequests);
}

/* ─── All members (card grid + search + detail modal) ─── */
function loadAllMembers() {
    var grid = $('allMembersGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Loading members…</div>';

    fetchMembersOrdered().then(function(rows) {
        allMembersCache = [];
        allMembersById = {};
        rows.forEach(function(doc) {
            var item = { id: doc.id, data: doc.data() };
            allMembersCache.push(item);
            allMembersById[doc.id] = item;
        });
        renderMembersGrid();
    }).catch(function() {
        grid.innerHTML = '<div class="col-12 text-center text-danger py-4">Could not load members.</div>';
    });
}

function renderMembersGrid() {
    var grid = $('allMembersGrid');
    if (!grid) return;
    var q = ($('memberSearch') && $('memberSearch').value || '').trim().toLowerCase();

    var filtered = allMembersCache.filter(function(item) {
        if (!q) return true;
        var name = (item.data.displayName || '').toLowerCase();
        return name.indexOf(q) !== -1;
    });

    if ($('memberCount')) $('memberCount').textContent = '(' + filtered.length + ')';

    grid.innerHTML = '';
    if (!filtered.length) {
        grid.innerHTML = '<div class="col-12 text-center text-muted py-4">' +
            (q ? 'No members match "' + escHtml(q) + '".' : 'No members yet.') + '</div>';
        return;
    }

    filtered.forEach(function(item) {
        var d = item.data;
        var name = d.displayName || '—';
        var initials = getInitials(name, d.email);
        var hasPhoto = d.photoURL && /^https?:\/\//i.test(d.photoURL);
        var avatar = hasPhoto
            ? '<div class="trainer-avatar"><img src="' + escHtml(d.photoURL) + '" alt="' + escHtml(name) + '" onerror="this.parentNode.textContent=\'' + initials + '\'"></div>'
            : '<div class="trainer-avatar">' + initials + '</div>';

        var col = document.createElement('div');
        col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';
        col.innerHTML =
            '<div class="dash-card h-100 member-card" tabindex="0" data-id="' + item.id + '">' +
                '<div class="card-body text-center">' +
                    avatar +
                    '<h6 class="text-white fw-bold mt-2 mb-1">' + escHtml(name) + '</h6>' +
                    '<span class="badge bg-info">' + escHtml(d.plan || '—') + '</span>' +
                '</div>' +
            '</div>';
        var card = col.querySelector('.member-card');
        card.addEventListener('click', function() { openMemberDetailModal(item.id); });
        card.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openMemberDetailModal(item.id);
            }
        });
        grid.appendChild(col);
    });
}

if ($('memberSearch')) {
    $('memberSearch').addEventListener('input', renderMembersGrid);
}
if ($('btnRefreshAll')) {
    $('btnRefreshAll').addEventListener('click', loadAllMembers);
}

function getMemberDetailModal() {
    var el = $('memberDetailModal');
    if (!el || !window.bootstrap) return null;
    if (typeof bootstrap.Modal.getOrCreateInstance === 'function') {
        memberDetailModalInstance = bootstrap.Modal.getOrCreateInstance(el);
    } else if (!memberDetailModalInstance) {
        memberDetailModalInstance = new bootstrap.Modal(el);
    }
    return memberDetailModalInstance;
}

function openMemberDetailModal(memberId) {
    var item = allMembersById[memberId];
    if (!item) return;
    currentMemberDetailId = memberId;
    var d = item.data;
    var name = d.displayName || '—';
    var email = d.email || '—';

    bigAvatarInto('mdAvatar', 'mdInitials', name, email, d.photoURL);
    if ($('mdName')) $('mdName').textContent = name;
    if ($('mdSubtitle')) {
        $('mdSubtitle').textContent =
            (d.plan ? d.plan : 'No plan') +
            (d.planPeriod ? ' · ' + (d.planPeriod === 'yearly' ? 'Yearly' : 'Monthly') : '');
    }
    if ($('mdEmail')) $('mdEmail').textContent = email;
    if ($('mdPhone')) $('mdPhone').textContent = d.phone || '—';
    if ($('mdJoin')) $('mdJoin').textContent = formatDate(d.createdAt);
    if ($('mdPlanType')) {
        $('mdPlanType').innerHTML =
            (d.plan ? '<span class="badge bg-info">' + escHtml(d.plan) + '</span>' : '—') +
            (d.planPeriod ? ' <span class="badge bg-secondary ms-1">' + (d.planPeriod === 'yearly' ? 'Yearly' : 'Monthly') + '</span>' : '');
    }
    if ($('mdPlanStart')) $('mdPlanStart').textContent = formatDate(d.planActivatedAt);
    if ($('mdPlanEnd')) $('mdPlanEnd').textContent = formatDate(d.planExpiresAt);

    var bar = $('mdProgressBar');
    var rem = $('mdRemaining');
    if (bar && rem) {
        bar.classList.remove('warn', 'expired');
        bar.style.width = '0%';
        var start = tsToDate(d.planActivatedAt);
        var end = tsToDate(d.planExpiresAt);
        if (!end) {
            rem.textContent = d.planStatus === 'active' ? 'Active' : 'No active membership';
        } else {
            var now = new Date();
            var totalMs = (start && end) ? (end.getTime() - start.getTime()) : 0;
            var remainingMs = end.getTime() - now.getTime();
            if (remainingMs <= 0) {
                bar.classList.add('expired');
                bar.style.width = '100%';
                rem.textContent = 'Expired ' + Math.ceil(-remainingMs / (1000 * 60 * 60 * 24)) + ' day(s) ago';
            } else {
                var daysLeft = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
                var pct = totalMs > 0 ? Math.min(100, Math.max(0, ((totalMs - remainingMs) / totalMs) * 100)) : 0;
                if (daysLeft <= 7) bar.classList.add('warn');
                bar.style.width = pct.toFixed(1) + '%';
                rem.textContent = daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' remaining';
            }
        }
    }

    var m = getMemberDetailModal();
    if (m) m.show();
}

if ($('btnDeleteMemberFromModal')) {
    $('btnDeleteMemberFromModal').addEventListener('click', function() {
        if (!currentMemberDetailId) return;
        if (!confirm('Delete this member permanently?')) return;
        db.collection('members').doc(currentMemberDetailId).delete()
            .then(function() {
                var m = getMemberDetailModal();
                if (m) m.hide();
                currentMemberDetailId = null;
                loadAllMembers();
                loadOverviewStats();
            })
            .catch(function(err) { alert(err.message); });
    });
}

/* ─── Trainer applications (card grid + search + filter + modal) ─── */
function loadTrainerApplications() {
    var grid = $('trainerAppsGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Loading trainers…</div>';

    fetchTrainersOrdered().then(function(rows) {
        allTrainersCache = [];
        allTrainersById = {};
        rows.forEach(function(doc) {
            var item = { id: doc.id, data: doc.data() };
            allTrainersCache.push(item);
            allTrainersById[doc.id] = item;
        });
        renderTrainersGrid();
    }).catch(function() {
        grid.innerHTML = '<div class="col-12 text-center text-danger py-4">Could not load trainers.</div>';
    });
}

function renderTrainersGrid() {
    var grid = $('trainerAppsGrid');
    if (!grid) return;
    var q = ($('trainerSearch') && $('trainerSearch').value || '').trim().toLowerCase();
    var statusFilter = ($('trainerStatusFilter') && $('trainerStatusFilter').value) || '';

    var filtered = allTrainersCache.filter(function(item) {
        var d = item.data;
        var st = d.approvalStatus || 'pending';
        if (statusFilter && st !== statusFilter) return false;
        if (q) {
            var name = (d.displayName || '').toLowerCase();
            if (name.indexOf(q) === -1) return false;
        }
        return true;
    });

    if ($('trainerCount')) $('trainerCount').textContent = '(' + filtered.length + ')';

    grid.innerHTML = '';
    if (!filtered.length) {
        grid.innerHTML = '<div class="col-12 text-center text-muted py-4">' +
            (q || statusFilter ? 'No trainers match the filter.' : 'No trainer applications yet.') + '</div>';
        return;
    }

    var statusColors = { approved: 'success', pending: 'warning', rejected: 'danger' };

    filtered.forEach(function(item) {
        var d = item.data;
        var name = d.displayName || '—';
        var initials = getInitials(name, d.email);
        var st = d.approvalStatus || 'pending';
        var hasPhoto = d.photoURL && /^https?:\/\//i.test(d.photoURL);
        var avatar = hasPhoto
            ? '<div class="trainer-avatar"><img src="' + escHtml(d.photoURL) + '" alt="' + escHtml(name) + '" onerror="this.parentNode.textContent=\'' + initials + '\'"></div>'
            : '<div class="trainer-avatar">' + initials + '</div>';

        var col = document.createElement('div');
        col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';
        col.innerHTML =
            '<div class="dash-card h-100 member-card" tabindex="0" data-id="' + item.id + '">' +
                '<div class="card-body text-center">' +
                    avatar +
                    '<h6 class="text-white fw-bold mt-2 mb-1">' + escHtml(name) + '</h6>' +
                    '<span class="badge bg-info">' + escHtml(d.specialization || '—') + '</span>' +
                    '<div class="mt-1"><span class="badge bg-' + (statusColors[st] || 'secondary') + '">' +
                        st.charAt(0).toUpperCase() + st.slice(1) + '</span></div>' +
                '</div>' +
            '</div>';
        var card = col.querySelector('.member-card');
        card.addEventListener('click', function() { openTrainerDetailModal(item.id); });
        card.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openTrainerDetailModal(item.id);
            }
        });
        grid.appendChild(col);
    });
}

if ($('trainerSearch')) {
    $('trainerSearch').addEventListener('input', renderTrainersGrid);
}
if ($('trainerStatusFilter')) {
    $('trainerStatusFilter').addEventListener('change', renderTrainersGrid);
}
if ($('btnRefreshTrainers')) {
    $('btnRefreshTrainers').addEventListener('click', loadTrainerApplications);
}

function getTrainerDetailModal() {
    var el = $('trainerDetailModal');
    if (!el || !window.bootstrap) return null;
    if (typeof bootstrap.Modal.getOrCreateInstance === 'function') {
        trainerDetailModalInstance = bootstrap.Modal.getOrCreateInstance(el);
    } else if (!trainerDetailModalInstance) {
        trainerDetailModalInstance = new bootstrap.Modal(el);
    }
    return trainerDetailModalInstance;
}

function openTrainerDetailModal(trainerId) {
    var item = allTrainersById[trainerId];
    if (!item) return;
    currentTrainerDetailId = trainerId;
    var d = item.data;
    var name = d.displayName || '—';
    var email = d.email || '—';
    var st = d.approvalStatus || 'pending';
    var statusColors = { approved: 'success', pending: 'warning', rejected: 'danger' };

    bigAvatarInto('tdAvatar', 'tdInitials', name, email, d.photoURL);
    if ($('tdName')) $('tdName').textContent = name;
    if ($('tdSubtitle')) {
        $('tdSubtitle').textContent = (d.specialization || 'Trainer') +
            (d.experience != null ? ' · ' + d.experience + ' yrs experience' : '');
    }
    if ($('tdEmail')) $('tdEmail').textContent = email;
    if ($('tdPhone')) $('tdPhone').textContent = d.phone || '—';
    if ($('tdSpec')) $('tdSpec').textContent = d.specialization || '—';
    if ($('tdExp')) $('tdExp').textContent = d.experience != null ? d.experience + ' year(s)' : '—';
    if ($('tdApplied')) $('tdApplied').textContent = formatDate(d.createdAt);
    if ($('tdStatus')) {
        $('tdStatus').innerHTML = '<span class="badge bg-' + (statusColors[st] || 'secondary') + '">' +
            st.charAt(0).toUpperCase() + st.slice(1) + '</span>';
    }
    if ($('tdQual')) $('tdQual').textContent = d.qualifications || '—';
    if ($('tdBio')) $('tdBio').textContent = d.bio || '—';

    var btnApprove = $('btnApproveTrainerFromModal');
    var btnReject = $('btnRejectTrainerFromModal');
    if (btnApprove) btnApprove.classList.toggle('d-none', st === 'approved');
    if (btnReject) btnReject.classList.toggle('d-none', st === 'rejected' || st === 'approved');

    var m = getTrainerDetailModal();
    if (m) m.show();
}

function setTrainerStatus(uid, status) {
    return db.collection('trainers').doc(uid).update({ approvalStatus: status })
        .then(function() {
            loadTrainerApplications();
            loadOverviewStats();
            populateTrainerSelect();
            loadTrainerAvailability();
        });
}

window.approveTrainer = function(uid) { setTrainerStatus(uid, 'approved'); };
window.rejectTrainer = function(uid) { setTrainerStatus(uid, 'rejected'); };
window.deleteTrainer = function(uid) {
    if (!confirm('Delete this trainer permanently?')) return;
    db.collection('trainers').doc(uid).delete()
        .then(function() {
            loadTrainerApplications();
            loadOverviewStats();
            populateTrainerSelect();
            loadTrainerAvailability();
        });
};

if ($('btnApproveTrainerFromModal')) {
    $('btnApproveTrainerFromModal').addEventListener('click', function() {
        if (!currentTrainerDetailId) return;
        setTrainerStatus(currentTrainerDetailId, 'approved').then(function() {
            var m = getTrainerDetailModal();
            if (m) m.hide();
        });
    });
}
if ($('btnRejectTrainerFromModal')) {
    $('btnRejectTrainerFromModal').addEventListener('click', function() {
        if (!currentTrainerDetailId) return;
        setTrainerStatus(currentTrainerDetailId, 'rejected').then(function() {
            var m = getTrainerDetailModal();
            if (m) m.hide();
        });
    });
}
if ($('btnDeleteTrainerFromModal')) {
    $('btnDeleteTrainerFromModal').addEventListener('click', function() {
        if (!currentTrainerDetailId) return;
        if (!confirm('Delete this trainer permanently?')) return;
        db.collection('trainers').doc(currentTrainerDetailId).delete()
            .then(function() {
                var m = getTrainerDetailModal();
                if (m) m.hide();
                currentTrainerDetailId = null;
                loadTrainerApplications();
                loadOverviewStats();
                populateTrainerSelect();
                loadTrainerAvailability();
            })
            .catch(function(err) { alert(err.message); });
    });
}

/* ─── Trainer availability cards (kept original list view) ─── */
function timePartDisplay(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (typeof v === 'object') {
        if (typeof v.toDate === 'function') {
            try { return v.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
            catch (e) { /* ignore */ }
        }
        if (typeof v.seconds === 'number') {
            try { return new Date(v.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
            catch (e2) { /* ignore */ }
        }
    }
    return String(v);
}

function formatSlotLabel(s) {
    if (s == null || s === '') return '';
    if (typeof s === 'string' || typeof s === 'number') return String(s);
    if (typeof s !== 'object') return String(s);
    var a = s.start != null ? s.start : s.from != null ? s.from : s.begin;
    var b = s.end != null ? s.end : s.to != null ? s.to : s.until;
    var at = timePartDisplay(a);
    var bt = timePartDisplay(b);
    if (at && bt) return at + ' – ' + bt;
    if (at) return at;
    if (s.label != null && String(s.label).trim() !== '') return String(s.label);
    if (s.time != null && s.time !== '') {
        var tt = timePartDisplay(s.time);
        return tt || String(s.time);
    }
    return '';
}

function collectSlotLabels(dayData) {
    if (dayData == null) return [];
    if (typeof dayData === 'string' || typeof dayData === 'number') return [String(dayData)];
    if (typeof dayData !== 'object') return [];
    if (dayData.available === false) return [];
    var slots = dayData.slots != null ? dayData.slots : dayData.times != null ? dayData.times : null;
    if (Array.isArray(slots)) {
        return slots.map(formatSlotLabel).filter(function(x) { return x && String(x).trim() !== ''; });
    }
    if (typeof slots === 'string') return slots.trim() ? [slots] : [];
    if (slots && typeof slots === 'object' && !Array.isArray(slots)) {
        var keys = Object.keys(slots);
        var boolMap = keys.length && keys.every(function(k) {
            var v = slots[k];
            return v === true || v === false || v === 1 || v === 0;
        });
        if (boolMap) return keys.filter(function(k) { return !!slots[k]; });
        var indexKeys = keys.length && keys.every(function(k) { return /^\d+$/.test(k); });
        if (indexKeys) {
            return keys.sort(function(a, b) { return Number(a) - Number(b); })
                .map(function(k) { return formatSlotLabel(slots[k]); })
                .filter(function(x) { return x && String(x).trim() !== ''; });
        }
    }
    var one = formatSlotLabel(dayData);
    return one ? [one] : [];
}

function formatDaySlots(dayData) {
    if (dayData == null) return '<span class="time-chip off">—</span>';
    if (typeof dayData === 'string') return '<span class="time-chip">' + escHtml(dayData) + '</span>';
    if (typeof dayData === 'object' && dayData.available === false) return '<span class="time-chip off">Off</span>';
    var labels = collectSlotLabels(dayData);
    if (!labels.length) return '<span class="time-chip off">Not set</span>';
    return labels.map(function(l) {
        return '<span class="time-chip">' + escHtml(l) + '</span>';
    }).join(' ');
}

function loadTrainerAvailability() {
    var grid = $('trainerAvailGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="text-center text-muted py-4">Loading…</div>';

    db.collection('trainers').where('approvalStatus', '==', 'approved').get()
        .then(function(snap) {
            grid.innerHTML = '';
            if (snap.empty) {
                grid.innerHTML = '<div class="text-center text-muted py-4">No approved trainers yet.</div>';
                return;
            }
            snap.forEach(function(doc) {
                var d = doc.data();
                var avail = d.availability || d.weeklyAvailability || null;
                var card = document.createElement('div');
                card.className = 'trainer-avail-card';
                var header = document.createElement('div');
                header.className = 'trainer-avail-card-header';
                header.innerHTML =
                    '<span class="trainer-avail-name">' + escHtml(d.displayName || 'Trainer') + '</span>' +
                    '<span class="badge bg-secondary">' + escHtml(d.specialization || '—') + '</span>';
                var body = document.createElement('div');
                body.className = 'trainer-avail-card-body';
                var week = document.createElement('div');
                week.className = 'trainer-avail-week';

                if (!avail || typeof avail !== 'object') {
                    var row = document.createElement('div');
                    row.className = 'trainer-avail-day unavailable';
                    row.innerHTML = '<span class="day-label">·</span><span class="text-muted small">No weekly schedule saved yet.</span>';
                    week.appendChild(row);
                } else {
                    DAYS.forEach(function(day) {
                        var rowEl = document.createElement('div');
                        var dayVal = avail[day] || avail[day.toLowerCase()];
                        var has = dayVal != null && dayVal !== '' && dayVal !== false;
                        if (has && typeof dayVal === 'object' && dayVal.available === false) has = false;
                        rowEl.className = 'trainer-avail-day' + (has ? ' available' : ' unavailable');
                        rowEl.innerHTML =
                            '<span class="day-label">' + day.slice(0, 3) + '</span>' +
                            '<div class="d-flex flex-wrap gap-1">' + formatDaySlots(dayVal) + '</div>';
                        week.appendChild(rowEl);
                    });
                }
                body.appendChild(week);
                card.appendChild(header);
                card.appendChild(body);
                grid.appendChild(card);
            });
        })
        .catch(function() {
            grid.innerHTML = '<div class="text-center text-danger py-4">Could not load availability.</div>';
        });
}

if ($('btnRefreshTrainerAvail')) {
    $('btnRefreshTrainerAvail').addEventListener('click', loadTrainerAvailability);
}

/* ─── Classes (card grid + search + filter + modal) ─── */
var classModalInstance = null;

function getClassModal() {
    var el = $('classModal');
    if (!el || !window.bootstrap) return null;
    if (typeof bootstrap.Modal.getOrCreateInstance === 'function') {
        classModalInstance = bootstrap.Modal.getOrCreateInstance(el);
    } else if (!classModalInstance) {
        classModalInstance = new bootstrap.Modal(el);
    }
    return classModalInstance;
}

function getClassDetailModal() {
    var el = $('classDetailModal');
    if (!el || !window.bootstrap) return null;
    if (typeof bootstrap.Modal.getOrCreateInstance === 'function') {
        classDetailModalInstance = bootstrap.Modal.getOrCreateInstance(el);
    } else if (!classDetailModalInstance) {
        classDetailModalInstance = new bootstrap.Modal(el);
    }
    return classDetailModalInstance;
}

function populateTrainerSelect() {
    var sel = $('classTrainer');
    if (!sel) return Promise.resolve();
    var v = sel.value;
    sel.innerHTML = '<option value="">— None —</option>';
    approvedTrainerNames = {};
    return db.collection('trainers').where('approvalStatus', '==', 'approved').get().then(function(snap) {
        snap.forEach(function(doc) {
            var d = doc.data();
            var name = d.displayName || d.email || doc.id;
            approvedTrainerNames[doc.id] = name;
            var opt = document.createElement('option');
            opt.value = doc.id;
            opt.textContent = name + (d.specialization ? ' (' + d.specialization + ')' : '');
            sel.appendChild(opt);
        });
        if (v) sel.value = v;
    });
}

function loadClassesAdmin() {
    var grid = $('classesGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Loading classes…</div>';

    db.collection('classes').get()
        .then(function(snap) {
            allClassesCache = [];
            allClassesById = {};
            snap.forEach(function(doc) {
                var item = { id: doc.id, data: doc.data() };
                allClassesCache.push(item);
                allClassesById[doc.id] = item;
            });
            allClassesCache.sort(function(a, b) {
                return tsSeconds(b.data.createdAt) - tsSeconds(a.data.createdAt);
            });
            renderClassesGrid();
        })
        .catch(function() {
            grid.innerHTML = '<div class="col-12 text-center text-danger py-4">Could not load classes.</div>';
        });
}

function renderClassesGrid() {
    var grid = $('classesGrid');
    if (!grid) return;
    var q = ($('classSearch') && $('classSearch').value || '').trim().toLowerCase();
    var statusFilter = ($('classStatusFilter') && $('classStatusFilter').value) || '';

    var filtered = allClassesCache.filter(function(item) {
        var c = item.data;
        var st = c.status || 'active';
        if (statusFilter && st !== statusFilter) return false;
        if (q) {
            var hay = ((c.name || '') + ' ' + (c.type || '')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    });

    if ($('classCount')) $('classCount').textContent = '(' + filtered.length + ')';

    grid.innerHTML = '';
    if (!filtered.length) {
        grid.innerHTML = '<div class="col-12 text-center text-muted py-4">' +
            (q || statusFilter ? 'No classes match the filter.' : 'No classes yet. Add one to get started.') + '</div>';
        return;
    }

    var statusColors = { active: 'success', cancelled: 'secondary', draft: 'warning' };

    filtered.forEach(function(item) {
        var c = item.data;
        var st = c.status || 'active';
        var dayTxt = c.schedule && c.schedule.day ? c.schedule.day : '—';
        var timeTxt = c.schedule && c.schedule.time ? c.schedule.time : '—';

        var col = document.createElement('div');
        col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';
        col.innerHTML =
            '<div class="dash-card h-100 member-card" tabindex="0" data-id="' + item.id + '">' +
                '<div class="card-body text-center">' +
                    '<div class="class-avatar"><i class="fas fa-dumbbell"></i></div>' +
                    '<h6 class="text-white fw-bold mt-2 mb-1">' + escHtml(c.name || 'Untitled') + '</h6>' +
                    '<span class="badge bg-info">' + escHtml(c.type || '—') + '</span>' +
                    '<div class="member-meta small mt-1">' + escHtml(dayTxt) + ' · ' + escHtml(timeTxt) + '</div>' +
                    '<div class="mt-1"><span class="badge bg-' + (statusColors[st] || 'secondary') + '">' + escHtml(st) + '</span></div>' +
                '</div>' +
            '</div>';
        var card = col.querySelector('.member-card');
        card.addEventListener('click', function() { openClassDetailModal(item.id); });
        card.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openClassDetailModal(item.id);
            }
        });
        grid.appendChild(col);
    });
}

if ($('classSearch')) {
    $('classSearch').addEventListener('input', renderClassesGrid);
}
if ($('classStatusFilter')) {
    $('classStatusFilter').addEventListener('change', renderClassesGrid);
}

function openClassDetailModal(classId) {
    var item = allClassesById[classId];
    if (!item) return;
    currentClassDetailId = classId;
    var c = item.data;
    var st = c.status || 'active';
    var statusColors = { active: 'success', cancelled: 'secondary', draft: 'warning' };

    if ($('cdName')) $('cdName').textContent = c.name || 'Untitled';
    if ($('cdSubtitle')) $('cdSubtitle').textContent = (c.type || '—');
    if ($('cdType')) $('cdType').innerHTML = '<span class="badge bg-info">' + escHtml(c.type || '—') + '</span>';
    if ($('cdStatus')) $('cdStatus').innerHTML = '<span class="badge bg-' + (statusColors[st] || 'secondary') + '">' + escHtml(st) + '</span>';
    if ($('cdDay')) $('cdDay').textContent = (c.schedule && c.schedule.day) || '—';
    if ($('cdTime')) $('cdTime').textContent = (c.schedule && c.schedule.time) || '—';
    if ($('cdDuration')) $('cdDuration').textContent = (c.schedule && c.schedule.duration) ? c.schedule.duration + ' min' : '—';
    if ($('cdTrainer')) $('cdTrainer').textContent = c.trainerName || '—';

    var cap = c.capacity || 0;
    var enr = c.enrolled || 0;
    if ($('cdCapacity')) $('cdCapacity').textContent = enr + ' / ' + cap;
    var bar = $('cdProgressBar');
    if (bar) {
        bar.classList.remove('warn', 'expired');
        var pct = cap > 0 ? Math.min(100, (enr / cap) * 100) : 0;
        bar.style.width = pct.toFixed(1) + '%';
        if (pct >= 100) bar.classList.add('expired');
        else if (pct >= 80) bar.classList.add('warn');
    }
    if ($('cdDesc')) $('cdDesc').textContent = c.description || '—';

    var m = getClassDetailModal();
    if (m) m.show();
}

if ($('btnDeleteClassFromModal')) {
    $('btnDeleteClassFromModal').addEventListener('click', function() {
        if (!currentClassDetailId) return;
        if (!confirm('Delete this class?')) return;
        db.collection('classes').doc(currentClassDetailId).delete()
            .then(function() {
                var m = getClassDetailModal();
                if (m) m.hide();
                currentClassDetailId = null;
                loadClassesAdmin();
                loadOverviewStats();
            });
    });
}
if ($('btnEditClassFromModal')) {
    $('btnEditClassFromModal').addEventListener('click', function() {
        if (!currentClassDetailId) return;
        var m = getClassDetailModal();
        if (m) m.hide();
        window.editClass(currentClassDetailId);
    });
}

window.editClass = function(id) {
    populateTrainerSelect().then(function() {
        return db.collection('classes').doc(id).get();
    }).then(function(doc) {
        if (!doc || !doc.exists) return;
        var c = doc.data();
        $('classEditId').value = id;
        if ($('classModalTitle')) $('classModalTitle').textContent = 'Edit Class';
        $('className').value = c.name || '';
        $('classType').value = c.type || 'Strength';
        $('classDesc').value = c.description || '';
        var s = c.schedule || {};
        $('classDay').value = s.day || 'Monday';
        $('classTime').value = s.time || '';
        $('classDuration').value = s.duration || 60;
        $('classTrainer').value = c.trainerId || '';
        $('classCapacity').value = c.capacity != null ? c.capacity : 20;
        updateTrainerAvailPreview();
        var m = getClassModal();
        if (m) m.show();
    });
};

function openAddClassModal() {
    $('classEditId').value = '';
    if ($('classModalTitle')) $('classModalTitle').textContent = 'Add Class';
    $('className').value = '';
    $('classType').value = 'Strength';
    $('classDesc').value = '';
    $('classDay').value = 'Monday';
    $('classTime').value = '';
    $('classDuration').value = 60;
    $('classTrainer').value = '';
    $('classCapacity').value = 20;
    if ($('trainerAvailPreview')) {
        $('trainerAvailPreview').classList.add('d-none');
        $('trainerAvailPreview').innerHTML = '';
    }
    populateTrainerSelect().then(function() {
        var m = getClassModal();
        if (m) m.show();
    });
}

function updateTrainerAvailPreview() {
    var prev = $('trainerAvailPreview');
    if (!prev) return;
    var tid = $('classTrainer').value;
    if (!tid) {
        prev.classList.add('d-none');
        prev.innerHTML = '';
        return;
    }
    db.collection('trainers').doc(tid).get().then(function(doc) {
        if (!doc.exists) {
            prev.classList.add('d-none');
            return;
        }
        var d = doc.data();
        var avail = d.availability || d.weeklyAvailability;
        prev.classList.remove('d-none');
        if (!avail || typeof avail !== 'object') {
            prev.innerHTML = '<div class="avail-preview-title">Trainer schedule</div><p class="text-muted small mb-0">No saved availability for this trainer.</p>';
            return;
        }
        var html = '<div class="avail-preview-title">Trainer schedule (summary)</div><div class="avail-preview-days">';
        DAYS.forEach(function(day) {
            var dv = avail[day] || avail[day.toLowerCase()];
            html += '<div class="avail-preview-day"><strong>' + day.slice(0, 3) + '</strong> <span class="avail-preview-slotwrap">' +
                (dv != null && dv !== '' && dv !== false ? formatDaySlots(dv) : '—') + '</span></div>';
        });
        html += '</div>';
        prev.innerHTML = html;
    });
}

if ($('btnAddClass')) {
    $('btnAddClass').addEventListener('click', function() { openAddClassModal(); });
}
if ($('btnRefreshClasses')) {
    $('btnRefreshClasses').addEventListener('click', loadClassesAdmin);
}
if ($('classTrainer')) {
    $('classTrainer').addEventListener('change', updateTrainerAvailPreview);
}
if ($('btnSaveClass')) {
    $('btnSaveClass').addEventListener('click', function() {
        var name = $('className').value.trim();
        if (!name) { alert('Please enter a class name.'); return; }
        var tid = $('classTrainer').value;
        var tname = tid ? (approvedTrainerNames[tid] || '') : '';
        if (tid && !tname) {
            tname = $('classTrainer').selectedOptions[0]
                ? $('classTrainer').selectedOptions[0].textContent.split('(')[0].trim()
                : '';
        }
        var payload = {
            name: name,
            type: $('classType').value,
            description: ($('classDesc').value || '').trim(),
            schedule: {
                day: $('classDay').value,
                time: $('classTime').value || '',
                duration: parseInt($('classDuration').value, 10) || 60
            },
            trainerId: tid || '',
            trainerName: tname || '',
            capacity: parseInt($('classCapacity').value, 10) || 20,
            enrolled: 0,
            status: 'active',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        var editId = $('classEditId').value;
        var p = editId
            ? db.collection('classes').doc(editId).set(payload, { merge: true })
            : db.collection('classes').add(
                Object.assign({}, payload, { createdAt: firebase.firestore.FieldValue.serverTimestamp() })
            );

        p.then(function() {
            var m = getClassModal();
            if (m) m.hide();
            loadClassesAdmin();
            loadOverviewStats();
        }).catch(function(err) { alert(err.message); });
    });
}

/* ─── Admin chat ─── */
var activeChatTrainerId = null;
var activeChatTrainerName = '';

function detachAdminChatListeners() {
    if (chatMessagesUnsub) {
        chatMessagesUnsub();
        chatMessagesUnsub = null;
    }
}

function loadAdminChatTrainers() {
    detachAdminChatListeners();
    var list = $('chatRoomsList');
    if (!list) return;
    list.innerHTML = '<div class="text-center text-muted small p-3">Loading trainers…</div>';

    db.collection('trainers').where('approvalStatus', '==', 'approved').get()
        .then(function(snap) {
            list.innerHTML = '';
            if (snap.empty) {
                list.innerHTML = '<div class="text-center text-muted small p-3">No approved trainers yet.</div>';
                return;
            }
            var rows = [];
            snap.forEach(function(doc) {
                var d = doc.data();
                rows.push({
                    id: doc.id,
                    name: (d.displayName || d.email || 'Trainer').trim(),
                    spec: d.specialization || '',
                    photoURL: d.photoURL || ''
                });
            });
            rows.sort(function(a, b) { return a.name.localeCompare(b.name); });
            rows.forEach(function(t) {
                var initials = (t.name || 'T').split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
                var hasPhoto = t.photoURL && /^https?:\/\//i.test(t.photoURL);
                var avatar = hasPhoto
                    ? '<div class="chat-room-avatar"><img src="' + escHtml(t.photoURL) + '" alt="' + escHtml(t.name) + '" onerror="this.parentNode.textContent=\'' + initials + '\'"></div>'
                    : '<div class="chat-room-avatar">' + escHtml(initials) + '</div>';
                var div = document.createElement('div');
                div.className = 'chat-room-item' + (activeChatTrainerId === t.id ? ' active' : '');
                div.dataset.trainerId = t.id;
                div.innerHTML =
                    avatar +
                    '<div class="chat-room-info">' +
                        '<div class="chat-room-name">' + escHtml(t.name) +
                            (t.spec ? ' <span class="chat-spec-badge">' + escHtml(t.spec) + '</span>' : '') +
                        '</div>' +
                        '<div class="chat-room-last">Tap to open conversation</div>' +
                    '</div>';
                div.addEventListener('click', function() {
                    openAdminTrainerChat(t.id, t.name);
                });
                list.appendChild(div);
            });
        })
        .catch(function(err) {
            console.error('Load trainers error:', err);
            list.innerHTML = '<div class="text-danger small p-3">Could not load trainers.</div>';
        });
}

function openAdminTrainerChat(trainerUid, trainerName) {
    detachAdminChatListeners();
    activeChatTrainerId = trainerUid;
    activeChatTrainerName = trainerName || 'Trainer';

    if ($('chatHeaderBar')) {
        $('chatHeaderBar').innerHTML = '<span><i class="fas fa-user-tie me-2"></i>' + escHtml(activeChatTrainerName) + '</span>';
    }
    if ($('chatInputArea')) $('chatInputArea').classList.remove('d-none');

    document.querySelectorAll('#chatRoomsList .chat-room-item').forEach(function(el) {
        el.classList.toggle('active', el.dataset.trainerId === trainerUid);
    });

    var msgs = $('chatMessages');
    if (!msgs) return;
    msgs.innerHTML = '<div class="text-muted small p-3">Loading messages…</div>';

    var ref = rtdb.ref('adminChats/' + trainerUid).orderByChild('timestamp');
    var render = function(snapshot) {
        msgs.innerHTML = '';
        if (!snapshot.exists()) {
            msgs.innerHTML = '<div class="chat-empty">No messages yet. Say hi!</div>';
            return;
        }
        var arr = [];
        snapshot.forEach(function(c) { arr.push(c.val()); });
        arr.sort(function(a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
        arr.forEach(function(m) {
            var div = document.createElement('div');
            var isSent = m.senderId === currentUid;
            div.className = 'chat-msg ' + (isSent ? 'sent' : 'received');
            var time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            var who = !isSent && m.senderName ? '<div class="msg-sender small text-white-50 mb-1">' + escHtml(m.senderName) + '</div>' : '';
            div.innerHTML = who + escHtml(m.text || '') + '<div class="msg-time">' + time + '</div>';
            msgs.appendChild(div);
        });
        msgs.scrollTop = msgs.scrollHeight;
    };
    ref.on('value', render, function(err) {
        console.error('Chat read error:', err);
        msgs.innerHTML = '<div class="text-danger small p-3">Could not load messages.</div>';
    });
    chatMessagesUnsub = function() { ref.off('value', render); };
}

function sendAdminChatMessage() {
    var input = $('chatInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text || !activeChatTrainerId) return;

    var msg = {
        senderId: currentUid,
        senderName: (currentUser && currentUser.email) || 'Admin',
        senderRole: 'admin',
        text: text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    input.disabled = true;
    rtdb.ref('adminChats/' + activeChatTrainerId).push(msg)
        .then(function() {
            input.value = '';
            input.disabled = false;
            input.focus();
        })
        .catch(function(err) {
            console.error('Send error:', err);
            alert(err.message || 'Failed to send message.');
            input.disabled = false;
            input.focus();
        });
}

if ($('btnSendChat')) {
    $('btnSendChat').addEventListener('click', sendAdminChatMessage);
}
if ($('chatInput')) {
    $('chatInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') sendAdminChatMessage();
    });
}

/* ═══ Admin booking check-in (QR / reference — same payload as trainer) ═══ */

function parseAdminBookingRefFromScan(raw) {
    var s = String(raw || '').trim();
    if (s.indexOf('GymDD|') === 0) s = s.slice(6).trim();
    return s;
}

function adminCheckinCodeKey(refRaw) {
    var s = parseAdminBookingRefFromScan(refRaw);
    var digits = s.replace(/\s/g, '');
    if (/^\d+$/.test(digits)) return digits;
    return s;
}

function stopAdminQrScanner() {
    if (!adminHtml5QrCode) return;
    var inst = adminHtml5QrCode;
    adminHtml5QrCode = null;
    inst.stop().then(function() {
        inst.clear();
    }).catch(function() {
        try { inst.clear(); } catch (e) { /* ignore */ }
    });
}

function adminCheckinSetResult(html) {
    var el = $('adminCheckinResult');
    if (el) el.innerHTML = html;
}

function adminStartQrScanner() {
    if (typeof Html5Qrcode === 'undefined') {
        alert('QR scanner library did not load. Enter the reference number manually.');
        return;
    }
    var hostId = 'adminQrReader';
    if (!$(hostId)) return;

    stopAdminQrScanner();
    adminHtml5QrCode = new Html5Qrcode(hostId);
    adminHtml5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        function(decodedText) {
            stopAdminQrScanner();
            adminResolveBooking(decodedText);
        },
        function() { /* frame discard */ }
    ).catch(function(err) {
        adminHtml5QrCode = null;
        alert(err.message || 'Could not start camera. Check permissions.');
    });
}

function adminRenderBookingDetail(bookingId, b) {
    var st = (b.status || '').trim();
    var sessionOn = b.sessionStarted === true;
    var refNum = b.bookingCode != null ? String(b.bookingCode) : '—';

    var summary =
        '<div class="admin-checkin-highlight border border-secondary rounded p-3 mb-3 bg-dark bg-opacity-25">' +
            '<div class="row g-2">' +
                '<div class="col-sm-6">' +
                    '<span class="text-muted small text-uppercase d-block">Class</span>' +
                    '<div class="fw-bold">' + escHtml(b.className || '—') + '</div>' +
                '</div>' +
                '<div class="col-sm-6">' +
                    '<span class="text-muted small text-uppercase d-block">Trainer</span>' +
                    '<div class="fw-bold">' + escHtml(b.trainerName || '—') + '</div>' +
                '</div>' +
                '<div class="col-sm-6">' +
                    '<span class="text-muted small text-uppercase d-block">Date</span>' +
                    '<div class="fw-semibold">' + escHtml(b.date || '—') + '</div>' +
                '</div>' +
                '<div class="col-sm-6">' +
                    '<span class="text-muted small text-uppercase d-block">Class time</span>' +
                    '<div class="fw-semibold">' + escHtml(b.time || '—') + '</div>' +
                '</div>' +
            '</div>' +
        '</div>';

    var lines = [
        '<div class="mb-2"><span class="text-muted small text-uppercase">Reference</span><div class="fw-bold fs-5">' + escHtml(refNum) + '</div></div>',
        '<div class="mb-2"><span class="text-muted small text-uppercase">Member</span><div class="fw-semibold">' + escHtml(b.memberName || '—') + '</div>' +
            '<div class="small text-muted">' + escHtml(b.memberEmail || '') + '</div></div>',
        '<div class="mb-3"><span class="text-muted small text-uppercase">Status</span><div>' + escHtml(st || '—') +
            (sessionOn ? ' <span class="badge bg-success ms-1">Session started</span>' : '') + '</div></div>'
    ];

    adminCheckinSetResult(
        '<div class="admin-checkin-detail">' + summary + lines.join('') + '</div>'
    );
}

function adminResolveBooking(refRaw) {
    if (!currentUid) return;
    var codeKey = adminCheckinCodeKey(refRaw);
    if (!codeKey) {
        adminCheckinSetResult('<p class="text-warning small mb-0">Enter or scan a valid reference.</p>');
        return;
    }

    adminCheckinSetResult('<p class="text-muted small mb-0"><i class="fas fa-spinner fa-spin me-2"></i>Looking up…</p>');

    db.collection('bookingLookups').doc(codeKey).get()
        .then(function(lsnap) {
            if (lsnap.exists) {
                var L = lsnap.data();
                return db.collection('bookings').doc(L.bookingId).get().then(function(bsnap) {
                    if (!bsnap.exists) {
                        adminCheckinSetResult('<p class="text-danger small mb-0">Booking record missing.</p>');
                        return;
                    }
                    adminRenderBookingDetail(bsnap.id, bsnap.data());
                });
            }
            var num = parseInt(codeKey, 10);
            if (isNaN(num)) {
                adminCheckinSetResult('<p class="text-warning small mb-0">No booking found for this reference.</p>');
                return null;
            }
            return db.collection('bookings').where('bookingCode', '==', num).limit(1).get()
                .then(function(q) {
                    if (q.empty) {
                        adminCheckinSetResult('<p class="text-warning small mb-0">No booking found for this reference.</p>');
                        return;
                    }
                    var doc = q.docs[0];
                    adminRenderBookingDetail(doc.id, doc.data());
                });
        })
        .catch(function(err) {
            console.error(err);
            adminCheckinSetResult('<p class="text-danger small mb-0">' + escHtml(err.message || 'Lookup failed.') + '</p>');
        });
}

if ($('btnAdminLookupRef')) {
    $('btnAdminLookupRef').addEventListener('click', function() {
        var inp = $('adminBookingRefInput');
        adminResolveBooking(inp ? inp.value : '');
    });
}
if ($('adminBookingRefInput')) {
    $('adminBookingRefInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            adminResolveBooking(this.value);
        }
    });
}
if ($('btnAdminScanStart')) {
    $('btnAdminScanStart').addEventListener('click', function() { adminStartQrScanner(); });
}
if ($('btnAdminScanStop')) {
    $('btnAdminScanStop').addEventListener('click', function() { stopAdminQrScanner(); });
}

/* ═══ Weekly trainer class log (Firestore: trainerClassCompletions) ═══ */
function adminPad2(n) {
    return (n < 10 ? '0' : '') + n;
}

function adminFormatYMD(d) {
    return d.getFullYear() + '-' + adminPad2(d.getMonth() + 1) + '-' + adminPad2(d.getDate());
}

function adminParseISODateLocal(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return null;
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10) - 1;
    var day = parseInt(p[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(day)) return null;
    return new Date(y, m, day);
}

function adminStartOfWeekMonday(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = x.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
}

function adminEndOfWeekSunday(monday) {
    var d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
    d.setDate(d.getDate() + 6);
    return d;
}

function adminScheduleDayToJsWeekday(dayStr) {
    if (dayStr == null || dayStr === '') return null;
    var k = String(dayStr).trim().toLowerCase().replace(/\./g, '');
    var map = {
        sun: 0, sunday: 0,
        mon: 1, monday: 1,
        tue: 2, tues: 2, tuesday: 2,
        wed: 3, weds: 3, wednesday: 3,
        thu: 4, thur: 4, thurs: 4, thursday: 4,
        fri: 5, friday: 5,
        sat: 6, saturday: 6
    };
    if (map[k] !== undefined) return map[k];
    var short = k.slice(0, 3);
    if (map[short] !== undefined) return map[short];
    return null;
}

function adminSessionDateForClassInWeek(weekMonday, scheduleDayRaw) {
    var wd = adminScheduleDayToJsWeekday(scheduleDayRaw);
    if (wd === null) return null;
    var i;
    for (i = 0; i < 7; i++) {
        var d = new Date(weekMonday.getFullYear(), weekMonday.getMonth(), weekMonday.getDate());
        d.setDate(d.getDate() + i);
        if (d.getDay() === wd) return adminFormatYMD(d);
    }
    return null;
}

function adminClassCompletionDocId(classId, sessionDate) {
    return classId + '_' + sessionDate;
}

function adminPrettySessionDate(sessionDateIso) {
    var d = adminParseISODateLocal(sessionDateIso);
    return d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : sessionDateIso;
}

function populateAdminClassLogTrainerFilter() {
    var sel = $('adminClassLogTrainerFilter');
    if (!sel) return;
    var keep = sel.value || '';
    fetchTrainersOrdered().then(function(rows) {
        sel.innerHTML = '<option value="">All trainers</option>';
        rows.forEach(function(doc) {
            var d = doc.data();
            if ((d.approvalStatus || '') !== 'approved') return;
            var opt = document.createElement('option');
            opt.value = doc.id;
            opt.textContent = (d.displayName || d.email || doc.id).trim();
            sel.appendChild(opt);
        });
        sel.value = keep;
        if (sel.value !== keep) sel.value = '';
    });
}

function adminEffectiveSessionStatus(d) {
    if (!d || typeof d !== 'object') return 'pending';
    var st = String(d.sessionStatus || '').trim().toLowerCase();
    if (st === 'completed' || st === 'cancelled' || st === 'delayed' || st === 'missed') return st;
    if (d.completedAt) return 'completed';
    return 'pending';
}

function adminSessionStatusBadgeHtml(st) {
    switch (st) {
        case 'completed':
            return '<span class="badge bg-success">Completed</span>';
        case 'missed':
            return '<span class="badge bg-danger">Missed</span>';
        case 'cancelled':
            return '<span class="badge bg-secondary">Cancel</span>';
        case 'delayed':
            return '<span class="badge bg-warning text-dark">Delay</span>';
        default:
            return '<span class="badge bg-secondary text-dark">Pending</span>';
    }
}

function adminTimestampSeconds(ts) {
    if (!ts) return 0;
    if (typeof ts.seconds === 'number') return ts.seconds;
    if (typeof ts.toMillis === 'function') return Math.floor(ts.toMillis() / 1000);
    return 0;
}

function adminFormatCompletedTime(ts) {
    var sec = adminTimestampSeconds(ts);
    if (!sec) return '—';
    var d = new Date(sec * 1000);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function appendAdminClassLogRow(tbody, trainerName, className, sessionDateIso, scheduleTimeStr, comp, orphanTip) {
    var st = adminEffectiveSessionStatus(comp);
    var noteRaw = comp && comp.notes ? String(comp.notes).trim() : '';
    var noteDisplay = orphanTip
        ? (noteRaw ? escHtml(noteRaw) + ' ' : '') + '<small class="text-muted">' + escHtml(orphanTip) + '</small>'
        : noteRaw
          ? escHtml(noteRaw.length > 120 ? noteRaw.slice(0, 117) + '…' : noteRaw)
          : '—';

    var completedCell = '—';
    if (st === 'completed' && comp && comp.completedAt) {
        completedCell = escHtml(adminFormatCompletedTime(comp.completedAt));
    }

    var dayCell = escHtml(adminPrettySessionDate(sessionDateIso));
    if (scheduleTimeStr && String(scheduleTimeStr).trim()) {
        dayCell += '<br><small class="text-muted">' + escHtml(String(scheduleTimeStr).trim()) + '</small>';
    }

    var classCell = escHtml(className || '—');

    var tr = document.createElement('tr');
    tr.innerHTML =
        '<td>' + escHtml(trainerName) + '</td>' +
        '<td>' + classCell + '</td>' +
        '<td>' + dayCell + '</td>' +
        '<td>' + adminSessionStatusBadgeHtml(st) + '</td>' +
        '<td class="small text-muted font-monospace">' + completedCell + '</td>' +
        '<td class="small">' + noteDisplay + '</td>';
    tbody.appendChild(tr);
}

function loadAdminTrainerClassTracking() {
    var tbody = $('adminClassTrackingBody');
    var lbl = $('adminClassLogWeekLabel');
    var selFilter = $('adminClassLogTrainerFilter');
    var filterTid = selFilter ? (selFilter.value || '').trim() : '';
    if (!tbody) return;

    var base = new Date();
    var mon = adminStartOfWeekMonday(base);
    mon.setDate(mon.getDate() + adminClassLogWeekOffset * 7);
    var sun = adminEndOfWeekSunday(mon);
    var w0 = adminFormatYMD(mon);
    var w1 = adminFormatYMD(sun);

    if (lbl) {
        lbl.textContent =
            mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
            ' – ' +
            sun.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    tbody.innerHTML =
        '<tr><td colspan="6" class="text-center text-muted py-4">Loading weekly log…</td></tr>';

    Promise.all([
        db.collection('classes').get(),
        db.collection('trainerClassCompletions')
            .where('sessionDate', '>=', w0)
            .where('sessionDate', '<=', w1)
            .get()
    ])
        .then(function(parts) {
            var snapClasses = parts[0];
            var snapComp = parts[1];
            var compById = {};
            snapComp.forEach(function(doc) {
                compById[doc.id] = doc.data();
            });
            var usedComp = {};

            tbody.innerHTML = '';

            snapClasses.forEach(function(doc) {
                var c = doc.data();
                if ((c.status || 'active') !== 'active') return;
                var tid = (c.trainerId || '').trim();
                if (!tid) return;
                if (filterTid && tid !== filterTid) return;
                var sessionDate = adminSessionDateForClassInWeek(mon, (c.schedule || {}).day);
                if (!sessionDate) return;
                var did = adminClassCompletionDocId(doc.id, sessionDate);
                usedComp[did] = true;
                var comp = compById[did];
                var tnm = ((c.trainerName || '').trim() || '(set trainer name on class)');
                appendAdminClassLogRow(
                    tbody,
                    tnm,
                    (c.name || '').trim(),
                    sessionDate,
                    (c.schedule || {}).time || '',
                    comp || null,
                    ''
                );
            });

            snapComp.forEach(function(doc) {
                if (usedComp[doc.id]) return;
                var d = doc.data();
                var tid = (d.trainerId || '').trim();
                if (filterTid && tid !== filterTid) return;
                appendAdminClassLogRow(
                    tbody,
                    (d.trainerName || '').trim() || '(trainer)',
                    d.className || d.classId || '—',
                    d.sessionDate,
                    d.time || '—',
                    d,
                    'outside current class template'
                );
            });

            if (!tbody.querySelector('tr')) {
                tbody.innerHTML =
                    '<tr><td colspan="6" class="text-muted text-center py-4">No sessions this week.</td></tr>';
            }
        })
        .catch(function(err) {
            console.error(err);
            tbody.innerHTML =
                '<tr><td colspan="6" class="text-danger text-center py-4">Could not load class log.</td></tr>';
        });
}

function bindAdminClassLogControls() {
    if ($('btnAdminClassLogPrev')) {
        $('btnAdminClassLogPrev').addEventListener('click', function() {
            adminClassLogWeekOffset--;
            loadAdminTrainerClassTracking();
        });
    }
    if ($('btnAdminClassLogNext')) {
        $('btnAdminClassLogNext').addEventListener('click', function() {
            adminClassLogWeekOffset++;
            loadAdminTrainerClassTracking();
        });
    }
    if ($('btnAdminClassLogToday')) {
        $('btnAdminClassLogToday').addEventListener('click', function() {
            adminClassLogWeekOffset = 0;
            loadAdminTrainerClassTracking();
        });
    }
    if ($('btnRefreshClassTracking')) {
        $('btnRefreshClassTracking').addEventListener('click', loadAdminTrainerClassTracking);
    }
    if ($('adminClassLogTrainerFilter')) {
        $('adminClassLogTrainerFilter').addEventListener('change', loadAdminTrainerClassTracking);
    }
}

bindAdminClassLogControls();
