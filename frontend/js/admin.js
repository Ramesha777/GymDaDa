/* ═══════════════════════════════════════
   GymDD — Admin dashboard (full sections)
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

function showDashboard(user) {
    $('loadingGate').style.display = 'none';
    $('mainContent').style.display = 'block';
    if ($('adminEmail')) $('adminEmail').textContent = user.email || '';
    loadOverviewStats();
    loadPendingMembers();
    loadAllMembers();
    loadTrainerApplications();
    populateTrainerSelect(); /* warm cache for class modal */
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
    pending: '<i class="fas fa-clock me-2 text-warning"></i>Pending Requests',
    members: '<i class="fas fa-users me-2"></i>All Members',
    trainers: '<i class="fas fa-chalkboard-teacher me-2"></i>Trainer Applications',
    trainerAvail: '<i class="fas fa-calendar-check me-2"></i>Trainer Schedules',
    classes: '<i class="fas fa-dumbbell me-2"></i>Classes',
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
    sidebarLinks.forEach(function(a) { a.classList.remove('active'); });
    sections.forEach(function(s) { s.classList.remove('active'); });
    var lnk = document.querySelector('.sidebar-nav a[data-section="' + name + '"]');
    if (lnk) lnk.classList.add('active');
    var sec = $('sec-' + name);
    if (sec) sec.classList.add('active');
    if ($('topbarTitle')) $('topbarTitle').innerHTML = titles[name] || name;

    if (name === 'trainerAvail') loadTrainerAvailability();
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

/* ─── Firestore: members list with optional orderBy fallback ─── */
function fetchMembersOrdered() {
    return db.collection('members').orderBy('createdAt', 'desc').get()
        .catch(function() {
            return db.collection('members').get();
        })
        .then(function(snap) {
            var rows = [];
            snap.forEach(function(d) { rows.push(d); });
            rows.sort(function(a, b) { return tsSeconds(b.data().createdAt) - tsSeconds(a.data().createdAt); });
            return rows;
        });
}

function fetchTrainersOrdered() {
    return db.collection('trainers').orderBy('createdAt', 'desc').get()
        .catch(function() {
            return db.collection('trainers').get();
        })
        .then(function(snap) {
            var rows = [];
            snap.forEach(function(d) { rows.push(d); });
            rows.sort(function(a, b) { return tsSeconds(b.data().createdAt) - tsSeconds(a.data().createdAt); });
            return rows;
        });
}

/* ─── Overview stats + combined pending preview ─── */
function loadOverviewStats() {
    db.collection('members').get().then(function(snap) {
        var total = 0, approved = 0, pending = 0, rejected = 0;
        snap.forEach(function(doc) {
            total++;
            var st = doc.data().approvalStatus || 'pending';
            if (st === 'approved') approved++;
            else if (st === 'pending') pending++;
            else if (st === 'rejected') rejected++;
        });
        if ($('statTotal')) $('statTotal').textContent = total;
        if ($('statApproved')) $('statApproved').textContent = approved;
        if ($('statPending')) $('statPending').textContent = pending;
        if ($('statRejected')) $('statRejected').textContent = rejected;
    });
    db.collection('trainers').get().then(function(snap) {
        if ($('statTrainers')) $('statTrainers').textContent = snap.size;
    });
    db.collection('classes').get().then(function(snap) {
        if ($('statClasses')) $('statClasses').textContent = snap.size;
    }).catch(function() {
        if ($('statClasses')) $('statClasses').textContent = '0';
    });

    var ob = $('overviewPendingBody');
    if (!ob) return;
    ob.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Loading…</td></tr>';

    var combined = [];
    db.collection('members').where('approvalStatus', '==', 'pending').limit(12).get()
        .then(function(snap) {
            snap.forEach(function(doc) {
                var d = doc.data();
                combined.push({
                    type: 'Member',
                    id: doc.id,
                    name: d.displayName || '—',
                    email: d.email || '—',
                    ts: tsSeconds(d.createdAt),
                    actions: 'member'
                });
            });
            return db.collection('trainers').where('approvalStatus', '==', 'pending').limit(12).get();
        })
        .then(function(snap) {
            snap.forEach(function(doc) {
                var d = doc.data();
                combined.push({
                    type: 'Trainer',
                    id: doc.id,
                    name: d.displayName || '—',
                    email: d.email || '—',
                    ts: tsSeconds(d.createdAt),
                    actions: 'trainer'
                });
            });
            combined.sort(function(a, b) { return b.ts - a.ts; });
            combined = combined.slice(0, 10);

            ob.innerHTML = '';
            if (!combined.length) {
                ob.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No pending requests</td></tr>';
                return;
            }
            combined.forEach(function(row) {
                var tr = document.createElement('tr');
                var dateStr = row.ts ? new Date(row.ts * 1000).toLocaleDateString() : '—';
                var btns = '';
                if (row.actions === 'member') {
                    btns =
                        '<button class="btn btn-sm btn-success me-1" onclick="approveMember(\'' + row.id + '\')"><i class="fas fa-check"></i></button>' +
                        '<button class="btn btn-sm btn-danger" onclick="rejectMember(\'' + row.id + '\')"><i class="fas fa-times"></i></button>';
                } else {
                    btns =
                        '<button class="btn btn-sm btn-success me-1" onclick="approveTrainer(\'' + row.id + '\')"><i class="fas fa-check"></i></button>' +
                        '<button class="btn btn-sm btn-danger" onclick="rejectTrainer(\'' + row.id + '\')"><i class="fas fa-times"></i></button>';
                }
                tr.innerHTML =
                    '<td>' + escHtml(row.name) + '</td>' +
                    '<td>' + escHtml(row.email) + '</td>' +
                    '<td><span class="badge bg-info">' + escHtml(row.type) + '</span></td>' +
                    '<td>' + dateStr + '</td>' +
                    '<td>' + btns + '</td>';
                ob.appendChild(tr);
            });
        });
}

if ($('btnRefreshOverview')) {
    $('btnRefreshOverview').addEventListener('click', loadOverviewStats);
}

/* ─── Pending members ─── */
function loadPendingMembers() {
    var tbody = $('pendingBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Loading…</td></tr>';

    db.collection('members').where('approvalStatus', '==', 'pending').get()
        .then(function(snap) {
            tbody.innerHTML = '';
            if (snap.empty) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No pending applications</td></tr>';
                return;
            }
            snap.forEach(function(doc) {
                var d = doc.data();
                var tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + escHtml(d.displayName || '—') + '</td>' +
                    '<td>' + escHtml(d.email || '—') + '</td>' +
                    '<td>' + escHtml(d.phone || '—') + '</td>' +
                    '<td><span class="badge bg-info">' + escHtml(d.plan || '—') + '</span></td>' +
                    '<td><span class="badge bg-warning">Pending</span></td>' +
                    '<td>' +
                        '<button class="btn btn-sm btn-success me-1" onclick="approveMember(\'' + doc.id + '\')"><i class="fas fa-check"></i></button>' +
                        '<button class="btn btn-sm btn-danger" onclick="rejectMember(\'' + doc.id + '\')"><i class="fas fa-times"></i></button>' +
                    '</td>';
                tbody.appendChild(tr);
            });
        });
}

window.approveMember = function(uid) {
    db.collection('members').doc(uid).update({ approvalStatus: 'approved' })
        .then(function() {
            loadPendingMembers();
            loadAllMembers();
            loadOverviewStats();
        });
};

window.rejectMember = function(uid) {
    db.collection('members').doc(uid).update({ approvalStatus: 'rejected' })
        .then(function() {
            loadPendingMembers();
            loadAllMembers();
            loadOverviewStats();
        });
};

if ($('btnRefreshPending')) {
    $('btnRefreshPending').addEventListener('click', loadPendingMembers);
}

/* ─── All members ─── */
function loadAllMembers() {
    var tbody = $('allMembersBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Loading…</td></tr>';

    fetchMembersOrdered().then(function(rows) {
        tbody.innerHTML = '';
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No members yet</td></tr>';
            return;
        }
        var counts = { total: 0, approved: 0, pending: 0, rejected: 0 };
        rows.forEach(function(doc) {
            var d = doc.data();
            counts.total++;
            var st = d.approvalStatus || 'pending';
            counts[st] = (counts[st] || 0) + 1;

            var statusColors = { approved: 'success', pending: 'warning', rejected: 'danger' };
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + escHtml(d.displayName || '—') + '</td>' +
                '<td>' + escHtml(d.email || '—') + '</td>' +
                '<td>' + escHtml(d.phone || '—') + '</td>' +
                '<td><span class="badge bg-info">' + escHtml(d.plan || '—') + '</span></td>' +
                '<td><span class="badge bg-' + (statusColors[st] || 'secondary') + '">' + escHtml(st) + '</span></td>' +
                '<td>' +
                    '<button class="btn btn-sm btn-outline-danger" onclick="deleteMember(\'' + doc.id + '\')" title="Delete"><i class="fas fa-trash"></i></button>' +
                '</td>';
            tbody.appendChild(tr);
        });

        if ($('statTotal')) $('statTotal').textContent = counts.total;
        if ($('statApproved')) $('statApproved').textContent = counts.approved || 0;
        if ($('statPending')) $('statPending').textContent = counts.pending || 0;
        if ($('statRejected')) $('statRejected').textContent = counts.rejected || 0;
    }).catch(function() {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Could not load members.</td></tr>';
    });
}

window.deleteMember = function(uid) {
    if (!confirm('Delete this member permanently?')) return;
    db.collection('members').doc(uid).delete()
        .then(function() {
            loadPendingMembers();
            loadAllMembers();
            loadOverviewStats();
        });
};

if ($('btnRefreshAll')) {
    $('btnRefreshAll').addEventListener('click', loadAllMembers);
}

/* ─── Trainer applications (8 columns: matches admin.html) ─── */
function loadTrainerApplications() {
    var tbody = $('trainerAppsBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Loading…</td></tr>';

    fetchTrainersOrdered().then(function(rows) {
        tbody.innerHTML = '';
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No trainer applications yet</td></tr>';
            return;
        }
        rows.forEach(function(doc) {
            var d = doc.data();
            var statusColors = { approved: 'success', pending: 'warning', rejected: 'danger' };
            var statusLabel = d.approvalStatus ? d.approvalStatus.charAt(0).toUpperCase() + d.approvalStatus.slice(1) : '—';

            var actions = '';
            if (d.approvalStatus === 'pending') {
                actions =
                    '<button class="btn btn-sm btn-success me-1" onclick="approveTrainer(\'' + doc.id + '\')"><i class="fas fa-check"></i></button>' +
                    '<button class="btn btn-sm btn-danger me-1" onclick="rejectTrainer(\'' + doc.id + '\')"><i class="fas fa-times"></i></button>';
            } else if (d.approvalStatus === 'rejected') {
                actions =
                    '<button class="btn btn-sm btn-success me-1" onclick="approveTrainer(\'' + doc.id + '\')" title="Approve"><i class="fas fa-check"></i></button>';
            }
            actions += '<button class="btn btn-sm btn-outline-danger" onclick="deleteTrainer(\'' + doc.id + '\')" title="Delete"><i class="fas fa-trash"></i></button>';

            var qualShort = (d.qualifications || '—');
            if (qualShort.length > 36) qualShort = qualShort.substring(0, 36) + '…';

            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + escHtml(d.displayName || '—') + '</td>' +
                '<td>' + escHtml(d.email || '—') + '</td>' +
                '<td>' + escHtml(d.phone || '—') + '</td>' +
                '<td><span class="badge bg-info">' + escHtml(d.specialization || '—') + '</span></td>' +
                '<td>' + escHtml(d.experience != null ? d.experience : '—') + ' yr</td>' +
                '<td class="small">' + escHtml(qualShort) + '</td>' +
                '<td><span class="badge bg-' + (statusColors[d.approvalStatus] || 'secondary') + '">' + escHtml(statusLabel) + '</span></td>' +
                '<td>' + actions + '</td>';
            tbody.appendChild(tr);
        });
    }).catch(function() {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Could not load trainers.</td></tr>';
    });
}

window.approveTrainer = function(uid) {
    db.collection('trainers').doc(uid).update({ approvalStatus: 'approved' })
        .then(function() {
            loadTrainerApplications();
            loadOverviewStats();
            populateTrainerSelect();
            loadTrainerAvailability();
        });
};

window.rejectTrainer = function(uid) {
    db.collection('trainers').doc(uid).update({ approvalStatus: 'rejected' })
        .then(function() {
            loadTrainerApplications();
            loadOverviewStats();
            populateTrainerSelect();
            loadTrainerAvailability();
        });
};

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

if ($('btnRefreshTrainers')) {
    $('btnRefreshTrainers').addEventListener('click', loadTrainerApplications);
}

/* ─── Trainer availability cards ─── */
function timePartDisplay(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (typeof v === 'object') {
        if (typeof v.toDate === 'function') {
            try {
                return v.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch (e) { /* ignore */ }
        }
        if (typeof v.seconds === 'number') {
            try {
                return new Date(v.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch (e2) { /* ignore */ }
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
    if (typeof dayData === 'string' || typeof dayData === 'number') {
        return [String(dayData)];
    }
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
        if (boolMap) {
            return keys.filter(function(k) { return !!slots[k]; });
        }
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
    if (dayData == null) {
        return '<span class="time-chip off">—</span>';
    }
    if (typeof dayData === 'string') {
        return '<span class="time-chip">' + escHtml(dayData) + '</span>';
    }
    if (typeof dayData === 'object' && dayData.available === false) {
        return '<span class="time-chip off">Off</span>';
    }
    var labels = collectSlotLabels(dayData);
    if (!labels.length) {
        return '<span class="time-chip off">Not set</span>';
    }
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
                    row.innerHTML = '<span class="day-label">·</span><span class="text-muted small">No weekly schedule saved yet. Trainers can store an <strong>availability</strong> object on their profile.</span>';
                    week.appendChild(row);
                } else {
                    DAYS.forEach(function(day) {
                        var row = document.createElement('div');
                        var dayVal = avail[day] || avail[day.toLowerCase()];
                        var has = dayVal != null && dayVal !== '' && dayVal !== false;
                        if (has && typeof dayVal === 'object' && dayVal.available === false) has = false;
                        row.className = 'trainer-avail-day' + (has ? ' available' : ' unavailable');
                        row.innerHTML =
                            '<span class="day-label">' + day.slice(0, 3) + '</span>' +
                            '<div class="d-flex flex-wrap gap-1">' + formatDaySlots(dayVal) + '</div>';
                        week.appendChild(row);
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

/* ─── Classes CRUD ─── */
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

function scheduleLabel(c) {
    var s = c.schedule || {};
    var day = s.day || '—';
    var time = s.time || '—';
    var dur = s.duration ? s.duration + ' min' : '';
    return escHtml(day + ' ' + time + (dur ? ' · ' + dur : ''));
}

function loadClassesAdmin() {
    var tbody = $('classesBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Loading…</td></tr>';

    db.collection('classes').get()
        .then(function(snap) {
            tbody.innerHTML = '';
            if (snap.empty) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No classes yet. Add one to get started.</td></tr>';
                return;
            }
            snap.forEach(function(doc) {
                var c = doc.data();
                var st = c.status || 'active';
                var stColors = { active: 'success', cancelled: 'secondary', draft: 'warning' };
                var tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + escHtml(c.name || '—') + '</td>' +
                    '<td>' + escHtml(c.type || '—') + '</td>' +
                    '<td class="small">' + scheduleLabel(c) + '</td>' +
                    '<td>' + escHtml(c.trainerName || '—') + '</td>' +
                    '<td>' + escHtml(String(c.capacity != null ? c.capacity : '—')) + '</td>' +
                    '<td><span class="badge bg-' + (stColors[st] || 'secondary') + '">' + escHtml(st) + '</span></td>' +
                    '<td>' +
                        '<button class="btn btn-sm btn-outline-light me-1" onclick="editClass(\'' + doc.id + '\')" title="Edit"><i class="fas fa-pen"></i></button>' +
                        '<button class="btn btn-sm btn-outline-danger" onclick="deleteClass(\'' + doc.id + '\')" title="Delete"><i class="fas fa-trash"></i></button>' +
                    '</td>';
                tbody.appendChild(tr);
            });
        })
        .catch(function() {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Could not load classes.</td></tr>';
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

window.deleteClass = function(id) {
    if (!confirm('Delete this class?')) return;
    db.collection('classes').doc(id).delete()
        .then(function() {
            loadClassesAdmin();
            loadOverviewStats();
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
    $('btnAddClass').addEventListener('click', function() {
        openAddClassModal();
    });
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
        if (!name) {
            alert('Please enter a class name.');
            return;
        }
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
        }).catch(function(err) {
            alert(err.message);
        });
    });
}

/* ─── Admin chat — direct admin↔trainer threads (no rooms) ─── */
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
                    spec: d.specialization || ''
                });
            });
            rows.sort(function(a, b) { return a.name.localeCompare(b.name); });
            rows.forEach(function(t) {
                var initials = (t.name || 'T').split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
                var div = document.createElement('div');
                div.className = 'chat-room-item' + (activeChatTrainerId === t.id ? ' active' : '');
                div.dataset.trainerId = t.id;
                div.innerHTML =
                    '<div class="chat-room-avatar">' + escHtml(initials) + '</div>' +
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
