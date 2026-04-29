/* ═══════════════════════════════════════
   GymDD — Trainer dashboard + chat (RTDB)
   ═══════════════════════════════════════ */

import { firebaseConfig } from './firebase-config.js';

firebase.initializeApp(firebaseConfig);

var auth = firebase.auth();
var db   = firebase.firestore();
var rtdb = firebase.database();
var $ = function(id) { return document.getElementById(id); };

var currentUid = null;
var currentUser = null;
var trainerData = {};
var chatMsgUnsub = null;
var trainerClassRequestByClassId = {};
var trainerHtml5QrCode = null;

function escHtml(s) {
    if (s == null || s === '') return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

/** Same logic as member checkout — used when bumping guest-session quota at check-in. */
function trainerMemberPlanActive(d) {
    if (!d || d.planStatus !== 'active' || !d.planId) return false;
    if (!d.planExpiresAt || !d.planExpiresAt.toMillis) return true;
    return d.planExpiresAt.toMillis() > Date.now();
}

function showDashboard(user) {
    $('loadingGate').style.display = 'none';
    $('mainContent').style.display = 'block';
    if ($('userEmail')) $('userEmail').textContent = user.email || '';
    loadTrainerProfile(user.uid);
    loadTrainerOverviewStats();
    loadTrainerClasses();
}

auth.onAuthStateChanged(function(user) {
    if (!user || !user.emailVerified) {
        window.location.href = 'login.html';
        return;
    }
    currentUid = user.uid;
    currentUser = user;

    db.collection('trainers').doc(user.uid).get().then(function(doc) {
        if (!doc.exists || doc.data().approvalStatus !== 'approved') {
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
        if (chatMsgUnsub) { chatMsgUnsub(); chatMsgUnsub = null; }
        auth.signOut().then(function() { window.location.href = 'login.html'; });
    });
}

/* ─── Sidebar ─── */
var sidebarLinks = document.querySelectorAll('.sidebar-nav a[data-section]');
var sections = document.querySelectorAll('.trainer-section');
var titles = {
    overview: '<i class="fas fa-chart-pie me-2 text-info"></i>Trainer Dashboard',
    profile: '<i class="fas fa-user me-2"></i>My Profile',
    classes: '<i class="fas fa-dumbbell me-2"></i>My Classes',
    members: '<i class="fas fa-users me-2"></i>My Members',
    schedule: '<i class="fas fa-calendar-alt me-2"></i>Schedule',
    checkin: '<i class="fas fa-qrcode me-2"></i>Member Check-in',
    availability: '<i class="fas fa-clock me-2"></i>My Availability',
    chat: '<i class="fas fa-comments me-2"></i>Chat'
};

sidebarLinks.forEach(function(link) {
    link.addEventListener('click', function(e) {
        if (!this.getAttribute('data-section')) return;
        e.preventDefault();
        switchSection(this.getAttribute('data-section'));
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

    if (name !== 'checkin') stopTrainerQrScanner();

    if (name === 'members') loadMyMembers();
    if (name === 'classes') loadTrainerClasses();
    if (name === 'availability') loadAvailability();
    if (name === 'chat') openTrainerAdminChat();
}

var sidebar = $('sidebar');
var overlay = $('sidebarOverlay');
if ($('menuToggle')) {
    $('menuToggle').addEventListener('click', function() {
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

function getInitials(name, fallback) {
    var src = (name && String(name).trim()) || fallback || '';
    if (!src) return '?';
    return src.split(/\s+/).map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
}

function renderTrainerAvatar(name, email, photoURL) {
    var box = $('trainerAvatar');
    var initEl = $('trainerAvatarInitials');
    if (!box || !initEl) return;
    var initials = getInitials(name, email);
    initEl.textContent = initials;
    var existing = box.querySelector('img');
    if (existing) existing.remove();
    if (photoURL && /^https?:\/\//i.test(photoURL)) {
        var img = document.createElement('img');
        img.alt = name || 'Profile photo';
        img.src = photoURL;
        initEl.style.display = 'none';
        img.onerror = function() {
            img.remove();
            initEl.style.display = '';
        };
        box.appendChild(img);
    } else {
        initEl.style.display = '';
    }
}

function loadTrainerProfile(uid) {
    db.collection('trainers').doc(uid).get()
        .then(function(doc) {
            if (!doc.exists) return;
            trainerData = doc.data();
            var d = trainerData;
            if ($('tProfName')) $('tProfName').value = d.displayName || '';
            if ($('tProfEmail')) $('tProfEmail').value = d.email || (currentUser && currentUser.email) || '';
            if ($('tProfPhone')) $('tProfPhone').value = d.phone || '';
            if ($('tProfSpec')) $('tProfSpec').value = d.specialization || '';
            if ($('tProfExp')) $('tProfExp').value = d.experience != null ? d.experience : '';
            if ($('tProfQual')) $('tProfQual').value = d.qualifications || '';
            if ($('tProfBio')) $('tProfBio').value = d.bio || '';
            if ($('tProfPhotoURL')) $('tProfPhotoURL').value = d.photoURL || '';

            if ($('trainerHeroName')) $('trainerHeroName').textContent = d.displayName || 'Trainer';
            if ($('trainerHeroEmail')) {
                $('trainerHeroEmail').textContent = d.email || (currentUser && currentUser.email) || '';
            }
            renderTrainerAvatar(
                d.displayName,
                d.email || (currentUser && currentUser.email) || '',
                d.photoURL
            );

            var status = d.approvalStatus || 'pending';
            var colors = { approved: 'success', pending: 'warning', rejected: 'danger' };
            if ($('trainerStatus')) {
                $('trainerStatus').innerHTML =
                    '<span class="badge bg-' + (colors[status] || 'secondary') + '">' +
                    status.charAt(0).toUpperCase() + status.slice(1) + '</span>';
            }
        });
}

var trainerPhotoInput = $('tProfPhotoURL');
if (trainerPhotoInput) {
    trainerPhotoInput.addEventListener('input', function() {
        renderTrainerAvatar(
            ($('tProfName') && $('tProfName').value) || (trainerData && trainerData.displayName),
            (currentUser && currentUser.email) || '',
            trainerPhotoInput.value.trim()
        );
    });
}

var trainerForm = $('trainerProfileForm');
if (trainerForm) {
    trainerForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (!currentUid) return;
        var data = {
            displayName: $('tProfName').value.trim(),
            phone: $('tProfPhone').value.trim(),
            experience: parseInt($('tProfExp').value, 10) || 0,
            qualifications: $('tProfQual').value.trim(),
            bio: $('tProfBio').value.trim(),
            photoURL: ($('tProfPhotoURL') ? $('tProfPhotoURL').value.trim() : '')
        };

        db.collection('trainers').doc(currentUid).update(data)
            .then(function() {
                var a = $('trainerAlert');
                if (a) {
                    a.className = 'alert alert-success';
                    a.textContent = 'Profile updated!';
                    a.classList.remove('d-none');
                }
                loadTrainerProfile(currentUid);
            })
            .catch(function(err) {
                var a = $('trainerAlert');
                if (a) {
                    a.className = 'alert alert-danger';
                    a.textContent = err.message;
                    a.classList.remove('d-none');
                }
            });
    });
}

/* ═══════════════════════════════════════
   AVAILABILITY (weekly schedule editor)
   ═══════════════════════════════════════ */
var DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var availabilityState = {};

function defaultAvailability() {
    var out = {};
    DAYS_OF_WEEK.forEach(function(day) {
        out[day] = { available: false, slots: [] };
    });
    return out;
}

function normalizeAvailability(raw) {
    var base = defaultAvailability();
    if (!raw || typeof raw !== 'object') return base;
    DAYS_OF_WEEK.forEach(function(day) {
        var src = raw[day];
        if (src == null) src = raw[day.toLowerCase()];
        if (src == null) return;

        if (typeof src === 'string') {
            base[day] = { available: true, slots: [{ start: src, end: '' }] };
            return;
        }
        if (typeof src !== 'object') return;

        var enabled = src.available !== false;
        var slots = [];
        var rawSlots = Array.isArray(src.slots) ? src.slots
            : Array.isArray(src.times) ? src.times
            : null;
        if (rawSlots) {
            rawSlots.forEach(function(s) {
                if (s == null) return;
                if (typeof s === 'string') {
                    slots.push({ start: s, end: '' });
                    return;
                }
                if (typeof s === 'object') {
                    var st = s.start != null ? s.start : s.from != null ? s.from : '';
                    var en = s.end != null ? s.end : s.to != null ? s.to : '';
                    slots.push({ start: String(st || ''), end: String(en || '') });
                }
            });
        }
        if (enabled && !slots.length) slots.push({ start: '09:00', end: '17:00' });
        base[day] = { available: enabled, slots: slots };
    });
    return base;
}

function showAvailAlert(msg, type) {
    var el = $('availAlert');
    if (!el) return;
    el.className = 'alert alert-' + type;
    el.textContent = msg;
    el.classList.remove('d-none');
    setTimeout(function() { el.classList.add('d-none'); }, 4000);
}

function buildSlotRow(day, idx, slot) {
    var row = document.createElement('div');
    row.className = 'avail-slot';
    row.dataset.day = day;
    row.dataset.idx = String(idx);
    row.innerHTML =
        '<input type="time" class="form-control form-control-sm avail-start" value="' + (slot.start || '') + '">' +
        '<span class="avail-to">to</span>' +
        '<input type="time" class="form-control form-control-sm avail-end" value="' + (slot.end || '') + '">' +
        '<button type="button" class="btn btn-sm btn-outline-danger avail-remove-slot" title="Remove">' +
            '<i class="fas fa-xmark"></i>' +
        '</button>';

    row.querySelector('.avail-start').addEventListener('input', function(e) {
        availabilityState[day].slots[idx].start = e.target.value;
    });
    row.querySelector('.avail-end').addEventListener('input', function(e) {
        availabilityState[day].slots[idx].end = e.target.value;
    });
    row.querySelector('.avail-remove-slot').addEventListener('click', function() {
        availabilityState[day].slots.splice(idx, 1);
        if (!availabilityState[day].slots.length) {
            availabilityState[day].slots.push({ start: '09:00', end: '17:00' });
        }
        renderAvailabilityGrid();
    });
    return row;
}

function buildDayRow(day) {
    var data = availabilityState[day];
    var row = document.createElement('div');
    row.className = 'avail-row';

    var toggleId = 'availToggle-' + day;
    var toggle = document.createElement('label');
    toggle.className = 'avail-day-toggle';
    toggle.htmlFor = toggleId;
    toggle.innerHTML =
        '<input type="checkbox" class="form-check-input" id="' + toggleId + '"' + (data.available ? ' checked' : '') + '>' +
        '<span class="avail-day-name">' + day + '</span>';
    toggle.querySelector('input').addEventListener('change', function(e) {
        availabilityState[day].available = e.target.checked;
        if (e.target.checked && !availabilityState[day].slots.length) {
            availabilityState[day].slots.push({ start: '09:00', end: '17:00' });
        }
        renderAvailabilityGrid();
    });

    var times = document.createElement('div');
    times.className = 'avail-times' + (data.available ? '' : ' disabled');

    if (!data.slots.length) {
        var hint = document.createElement('div');
        hint.className = 'text-muted small';
        hint.textContent = data.available ? 'Add a time slot below.' : 'Off — toggle to set hours.';
        times.appendChild(hint);
    } else {
        data.slots.forEach(function(slot, idx) {
            times.appendChild(buildSlotRow(day, idx, slot));
        });
    }

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-outline-primary avail-add-slot mt-1';
    addBtn.title = 'Add time slot';
    addBtn.innerHTML = '<i class="fas fa-plus me-1"></i>Add slot';
    addBtn.addEventListener('click', function() {
        availabilityState[day].slots.push({ start: '09:00', end: '17:00' });
        if (!availabilityState[day].available) availabilityState[day].available = true;
        renderAvailabilityGrid();
    });
    times.appendChild(addBtn);

    row.appendChild(toggle);
    row.appendChild(times);
    return row;
}

function renderAvailabilityGrid() {
    var grid = $('availGrid');
    if (!grid) return;
    grid.innerHTML = '';
    DAYS_OF_WEEK.forEach(function(day) {
        grid.appendChild(buildDayRow(day));
    });
}

function loadAvailability() {
    var grid = $('availGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading availability…</div>';

    var promise = currentUid
        ? db.collection('trainers').doc(currentUid).get()
        : Promise.resolve(null);

    promise.then(function(doc) {
        var raw = (doc && doc.exists) ? (doc.data().availability || doc.data().weeklyAvailability) : null;
        availabilityState = normalizeAvailability(raw);
        renderAvailabilityGrid();
    }).catch(function() {
        availabilityState = defaultAvailability();
        renderAvailabilityGrid();
        showAvailAlert('Could not load saved availability — starting fresh.', 'warning');
    });
}

function saveAvailability() {
    if (!currentUid) return;
    var payload = {};
    var hasInvalid = false;

    DAYS_OF_WEEK.forEach(function(day) {
        var d = availabilityState[day];
        var enabled = !!d.available;
        var cleanSlots = [];
        if (enabled) {
            d.slots.forEach(function(s) {
                var st = (s.start || '').trim();
                var en = (s.end || '').trim();
                if (!st && !en) return;
                if (st && en && st >= en) hasInvalid = true;
                cleanSlots.push({ start: st, end: en });
            });
        }
        payload[day] = { available: enabled && cleanSlots.length > 0, slots: cleanSlots };
    });

    if (hasInvalid) {
        showAvailAlert('Each slot needs a start time earlier than its end time.', 'danger');
        return;
    }

    var btn = $('btnSaveAvail');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Saving…'; }

    db.collection('trainers').doc(currentUid).set({ availability: payload }, { merge: true })
        .then(function() {
            showAvailAlert('Availability saved!', 'success');
            availabilityState = normalizeAvailability(payload);
            renderAvailabilityGrid();
        })
        .catch(function(err) {
            showAvailAlert(err.message || 'Failed to save availability.', 'danger');
        })
        .then(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-2"></i>Save Availability'; }
        });
}

if ($('btnSaveAvail')) {
    $('btnSaveAvail').addEventListener('click', saveAvailability);
}
if ($('btnRefreshAvail')) {
    $('btnRefreshAvail').addEventListener('click', loadAvailability);
}

/* ─── My classes (assigned by admin + requests for open slots) ─── */
function trainerClassRequestDocId(classId) {
    return classId + '_' + currentUid;
}

function formatClassScheduleTrainer(c) {
    var s = c.schedule || {};
    var day = s.day || '—';
    var time = s.time || '—';
    var dur = s.duration ? s.duration + ' min' : '';
    var parts = [day, time];
    if (dur) parts.push(dur);
    return parts.join(' · ');
}

function showClassAssignAlert(msg, type) {
    var el = $('classAssignAlert');
    if (!el) return;
    el.className = 'alert alert-' + type;
    el.textContent = msg;
    el.classList.remove('d-none');
    setTimeout(function() { el.classList.add('d-none'); }, 5000);
}

function loadTrainerOverviewStats() {
    var statEl = $('statClasses');
    if (!statEl) return;
    db.collection('classes').where('trainerId', '==', currentUid).get()
        .then(function(snap) {
            statEl.textContent = snap.size;
        })
        .catch(function() {
            statEl.textContent = '0';
        });
}

function loadTrainerClassRequestsMap() {
    return db.collection('trainerClassRequests').where('trainerId', '==', currentUid).get()
        .then(function(snap) {
            trainerClassRequestByClassId = {};
            snap.forEach(function(doc) {
                var d = doc.data();
                if (d.classId) {
                    trainerClassRequestByClassId[d.classId] = {
                        id: doc.id,
                        status: d.status || 'pending'
                    };
                }
            });
        });
}

function trainerTimestampSeconds(ts) {
    if (!ts) return 0;
    if (typeof ts.seconds === 'number') return ts.seconds;
    if (typeof ts.toMillis === 'function') return Math.floor(ts.toMillis() / 1000);
    return 0;
}

function formatTrainerReqDate(ts) {
    var sec = trainerTimestampSeconds(ts);
    if (!sec) return '—';
    return new Date(sec * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function resolveMemberClassRequest(docId, approved) {
    if (!docId) return;
    if (!confirm(approved ? 'Approve this member\'s request for this class?' : 'Decline this member request?')) return;
    db.collection('memberClassRequests').doc(docId).update({
        status: approved ? 'approved' : 'rejected',
        resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        resolvedBy: currentUid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function() {
        showClassAssignAlert(approved ? 'Request approved.' : 'Request declined.', approved ? 'success' : 'secondary');
        loadMemberClassRequestsForTrainer();
    }).catch(function(err) {
        showClassAssignAlert(err.message || 'Could not update request.', 'danger');
    });
}

function loadMemberClassRequestsForTrainer() {
    var tbody = $('trainerMemberRequestsBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Loading…</td></tr>';

    db.collection('memberClassRequests').where('trainerId', '==', currentUid).get()
        .then(function(snap) {
            var rows = [];
            snap.forEach(function(doc) {
                var d = doc.data();
                if ((d.status || 'pending') !== 'pending') return;
                rows.push({ id: doc.id, d: d });
            });
            rows.sort(function(a, b) {
                return trainerTimestampSeconds(b.d.createdAt) - trainerTimestampSeconds(a.d.createdAt);
            });

            tbody.innerHTML = '';
            if (!rows.length) {
                tbody.innerHTML =
                    '<tr><td colspan="4" class="text-center text-muted py-4">No pending member requests.</td></tr>';
                return;
            }

            rows.forEach(function(row) {
                var d = row.d;
                var tr = document.createElement('tr');

                var tdM = document.createElement('td');
                tdM.textContent = d.memberName || d.memberEmail || '—';

                var tdC = document.createElement('td');
                tdC.textContent = d.className || d.classId || '—';

                var tdT = document.createElement('td');
                tdT.className = 'small text-muted';
                tdT.textContent = formatTrainerReqDate(d.createdAt);

                var tdA = document.createElement('td');
                var bOk = document.createElement('button');
                bOk.type = 'button';
                bOk.className = 'btn btn-sm btn-success me-1';
                bOk.title = 'Approve';
                bOk.innerHTML = '<i class="fas fa-check"></i>';
                (function(id) {
                    bOk.addEventListener('click', function() { resolveMemberClassRequest(id, true); });
                })(row.id);

                var bNo = document.createElement('button');
                bNo.type = 'button';
                bNo.className = 'btn btn-sm btn-outline-danger';
                bNo.title = 'Decline';
                bNo.innerHTML = '<i class="fas fa-times"></i>';
                (function(id2) {
                    bNo.addEventListener('click', function() { resolveMemberClassRequest(id2, false); });
                })(row.id);

                tdA.appendChild(bOk);
                tdA.appendChild(bNo);

                tr.appendChild(tdM);
                tr.appendChild(tdC);
                tr.appendChild(tdT);
                tr.appendChild(tdA);
                tbody.appendChild(tr);
            });
        })
        .catch(function(err) {
            console.error(err);
            tbody.innerHTML =
                '<tr><td colspan="4" class="text-center text-danger py-3">Could not load member requests.</td></tr>';
        });
}

function renderTrainerClassCard(item, isAssigned) {
    var c = item.data;
    var name = c.name || 'Untitled';
    var type = c.type || '—';
    var sched = formatClassScheduleTrainer(c);
    var desc = (c.description || '').trim();
    if (desc.length > 140) desc = desc.substring(0, 140) + '…';

    var col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4';

    var inner = document.createElement('div');
    inner.className = 'dash-card h-100';

    var body = document.createElement('div');
    body.className = 'card-body';

    body.innerHTML =
        '<div class="d-flex justify-content-between align-items-start mb-2">' +
            '<h6 class="text-white fw-bold mb-0">' + escHtml(name) + '</h6>' +
            '<span class="badge bg-info">' + escHtml(type) + '</span>' +
        '</div>' +
        (desc ? '<p class="text-muted small mb-2">' + escHtml(desc) + '</p>' : '<p class="text-muted small mb-2">No description</p>') +
        '<div class="small text-muted mb-2"><i class="fas fa-calendar me-1"></i>' + escHtml(sched) + '</div>' +
        '<div class="small text-muted mb-0"><i class="fas fa-users me-1"></i>' +
            (c.enrolled || 0) + ' / ' + (c.capacity || 0) + ' enrolled</div>';

    if (isAssigned) {
        var badgeRow = document.createElement('div');
        badgeRow.className = 'mt-3';
        badgeRow.innerHTML = '<span class="badge bg-success"><i class="fas fa-check me-1"></i>Assigned to you</span>';
        body.appendChild(badgeRow);
    } else {
        var req = trainerClassRequestByClassId[item.id];
        var st = req ? req.status : null;
        var actions = document.createElement('div');
        actions.className = 'mt-3';

        if (st === 'pending') {
            actions.innerHTML = '<span class="badge bg-warning text-dark"><i class="fas fa-clock me-1"></i>Request pending admin review</span>';
        } else if (st === 'rejected') {
            actions.innerHTML =
                '<span class="badge bg-secondary me-2 mb-2">Not approved</span>' +
                '<button type="button" class="btn btn-sm btn-outline-primary request-class-btn" data-class-id="' +
                    escHtml(item.id) + '"><i class="fas fa-redo me-1"></i>Request again</button>';
        } else if (st === 'approved') {
            actions.innerHTML = '<span class="badge bg-success">Approved — reload if this still shows here.</span>';
        } else {
            actions.innerHTML =
                '<button type="button" class="btn btn-sm btn-primary request-class-btn" data-class-id="' +
                    escHtml(item.id) + '"><i class="fas fa-paper-plane me-1"></i>Request to teach</button>';
        }
        body.appendChild(actions);
    }

    inner.appendChild(body);
    col.appendChild(inner);
    return col;
}

function loadTrainerClasses() {
    var assignedGrid = $('trainerAssignedClassesGrid');
    var openGrid = $('trainerOpenClassesGrid');
    if (!assignedGrid || !openGrid) return;
    assignedGrid.innerHTML = '<div class="col-12 text-center text-muted py-4">Loading…</div>';
    openGrid.innerHTML = '<div class="col-12 text-center text-muted py-4">Loading…</div>';

    db.collection('classes').get()
        .then(function(snap) {
            return loadTrainerClassRequestsMap()
                .catch(function(err) {
                    console.warn('trainerClassRequests:', err);
                    trainerClassRequestByClassId = {};
                })
                .then(function() { return snap; });
        })
        .then(function(snap) {
        var assigned = [];
        var openList = [];

        snap.forEach(function(doc) {
            var c = doc.data();
            var st = c.status || 'active';
            if (st !== 'active') return;

            var tid = (c.trainerId || '').trim();
            if (tid === currentUid) {
                assigned.push({ id: doc.id, data: c });
            } else if (!tid) {
                openList.push({ id: doc.id, data: c });
            }
        });

        assigned.sort(function(a, b) {
            return (a.data.name || '').localeCompare(b.data.name || '');
        });
        openList.sort(function(a, b) {
            return (a.data.name || '').localeCompare(b.data.name || '');
        });

        assignedGrid.innerHTML = '';
        if (!assigned.length) {
            assignedGrid.innerHTML =
                '<div class="col-12 text-center text-muted py-4">No classes assigned to you yet. When admin assigns you as the trainer, they appear here. You can also request open classes below.</div>';
        } else {
            assigned.forEach(function(item) {
                assignedGrid.appendChild(renderTrainerClassCard(item, true));
            });
        }

        openGrid.innerHTML = '';
        if (!openList.length) {
            openGrid.innerHTML =
                '<div class="col-12 text-center text-muted py-4">There are no open classes without a trainer right now.</div>';
        } else {
            openList.forEach(function(item) {
                openGrid.appendChild(renderTrainerClassCard(item, false));
            });
        }

        loadMemberClassRequestsForTrainer();
        loadTrainerOverviewStats();
    }).catch(function(err) {
        console.error(err);
        assignedGrid.innerHTML = '<div class="col-12 text-center text-danger py-4">Could not load classes.</div>';
        openGrid.innerHTML = '';
    });
}

function submitTrainerClassRequest(classId) {
    if (!currentUid) return;
    var tname = (trainerData && trainerData.displayName) ? trainerData.displayName.trim() : '';
    if (!tname && currentUser && currentUser.email) tname = currentUser.email;
    if (!tname) tname = 'Trainer';
    var temail = (currentUser && currentUser.email) || '';

    var rid = trainerClassRequestDocId(classId);

    db.collection('classes').doc(classId).get().then(function(doc) {
        if (!doc.exists) {
            showClassAssignAlert('This class could not be found.', 'danger');
            return null;
        }
        var c = doc.data();
        var tid = (c.trainerId || '').trim();
        if (tid && tid !== currentUid) {
            showClassAssignAlert('This class already has a trainer assigned.', 'warning');
            return null;
        }
        if (tid === currentUid) {
            showClassAssignAlert('You are already assigned to this class.', 'info');
            return null;
        }

        return db.collection('trainerClassRequests').doc(rid).set({
            classId: classId,
            className: c.name || '',
            classType: c.type || '',
            trainerId: currentUid,
            trainerName: tname,
            trainerEmail: temail,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).then(function() { return true; });
    }).then(function(saved) {
        if (!saved) return;
        showClassAssignAlert('Request submitted. A gym admin will review it.', 'success');
        loadTrainerClasses();
    }).catch(function(err) {
        showClassAssignAlert(err.message || 'Could not submit request.', 'danger');
    });
}

var secClassesEl = $('sec-classes');
if (secClassesEl) {
    secClassesEl.addEventListener('click', function(e) {
        var btn = e.target.closest('.request-class-btn');
        if (!btn || !btn.getAttribute('data-class-id')) return;
        submitTrainerClassRequest(btn.getAttribute('data-class-id'));
    });
}

if ($('btnRefreshClasses')) {
    $('btnRefreshClasses').addEventListener('click', loadTrainerClasses);
}

if ($('btnRefreshOverview')) {
    $('btnRefreshOverview').addEventListener('click', loadTrainerOverviewStats);
}

/* ─── Members (from bookings) ─── */
function loadMyMembers() {
    var tbody = $('myMembersBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Loading…</td></tr>';

    db.collection('bookings').where('trainerId', '==', currentUid).get()
        .then(function(snap) {
            var map = {};
            snap.forEach(function(doc) {
                var b = doc.data();
                var mid = b.memberId;
                if (!mid) return;
                if (!map[mid]) {
                    map[mid] = {
                        name: (b.memberName && String(b.memberName).trim()) || (b.memberEmail && String(b.memberEmail).trim()) || '',
                        email: b.memberEmail || '',
                        className: b.className || '—'
                    };
                }
            });
            var keys = Object.keys(map);
            if (!keys.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No members with bookings yet.</td></tr>';
                return null;
            }
            var fetchNames = keys.map(function(memberId) {
                if (map[memberId].name) return Promise.resolve();
                return db.collection('members').doc(memberId).get().then(function(d) {
                    if (d.exists()) {
                        var x = d.data();
                        map[memberId].name = (x.displayName || x.email || memberId).trim();
                    } else {
                        map[memberId].name = memberId;
                    }
                });
            });
            return Promise.all(fetchNames).then(function() { return { keys: keys, map: map }; });
        })
        .then(function(payload) {
            if (!payload || !payload.keys || !payload.keys.length) return;
            var keys = payload.keys;
            var map = payload.map;
            tbody.innerHTML = '';
            keys.forEach(function(memberId) {
                var m = map[memberId];
                var tr = document.createElement('tr');
                var nameCell = document.createElement('td');
                nameCell.textContent = m.name || memberId;
                var emailCell = document.createElement('td');
                emailCell.textContent = m.email || '—';
                var classCell = document.createElement('td');
                classCell.textContent = m.className || '—';
                var sessCell = document.createElement('td');
                sessCell.textContent = '—';
                var actCell = document.createElement('td');
                actCell.textContent = '—';
                tr.appendChild(nameCell);
                tr.appendChild(emailCell);
                tr.appendChild(classCell);
                tr.appendChild(sessCell);
                tr.appendChild(actCell);
                tbody.appendChild(tr);
            });
        })
        .catch(function() {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Could not load members.</td></tr>';
        });
}

if ($('btnRefreshMembers')) {
    $('btnRefreshMembers').addEventListener('click', loadMyMembers);
}

/* ─── Chat with Admin (single thread at adminChats/{trainerUid}) ─── */
function openTrainerAdminChat() {
    if (chatMsgUnsub) {
        chatMsgUnsub();
        chatMsgUnsub = null;
    }

    var list = $('chatRoomsList');
    if (list) {
        list.innerHTML = '';
        var div = document.createElement('div');
        div.className = 'chat-room-item active';
        div.innerHTML =
            '<div class="chat-room-avatar">A</div>' +
            '<div class="chat-room-info">' +
                '<div class="chat-room-name">Admin</div>' +
                '<div class="chat-room-last">GymDD support</div>' +
            '</div>';
        list.appendChild(div);
    }

    if ($('chatHeaderBar')) {
        $('chatHeaderBar').innerHTML = '<span><i class="fas fa-user-shield me-2"></i>Admin</span>';
    }
    if ($('chatInputArea')) $('chatInputArea').classList.remove('d-none');

    var msgs = $('chatMessages');
    if (!msgs) return;
    msgs.innerHTML = '<div class="text-muted small p-3">Loading messages…</div>';

    var ref = rtdb.ref('adminChats/' + currentUid).orderByChild('timestamp');
    var render = function(snapshot) {
        msgs.innerHTML = '';
        if (!snapshot.exists()) {
            msgs.innerHTML = '<div class="chat-empty">No messages yet. Say hi to the admin!</div>';
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
            var who = '';
            if (!isSent && m.senderName) {
                who = '<div class="msg-sender small text-white-50 mb-1">' + escHtml(m.senderName) + '</div>';
            }
            div.innerHTML = who + escHtml(m.text || '') + '<div class="msg-time">' + time + '</div>';
            msgs.appendChild(div);
        });
        msgs.scrollTop = msgs.scrollHeight;
    };
    ref.on('value', render, function(err) {
        console.error('Chat read error:', err);
        msgs.innerHTML = '<div class="text-danger small p-3">Could not load messages.</div>';
    });
    chatMsgUnsub = function() { ref.off('value', render); };
}

function sendTrainerMessage() {
    var input = $('chatInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text || !currentUid) return;

    var msg = {
        senderId: currentUid,
        senderName: trainerData.displayName || (currentUser && currentUser.email) || 'Trainer',
        senderRole: 'trainer',
        text: text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    input.disabled = true;
    rtdb.ref('adminChats/' + currentUid).push(msg)
        .then(function() {
            input.value = '';
            input.disabled = false;
            input.focus();
        })
        .catch(function(err) {
            console.error('Send error:', err);
            alert(err.message || 'Failed to send.');
            input.disabled = false;
            input.focus();
        });
}

if ($('btnSendChat')) {
    $('btnSendChat').addEventListener('click', sendTrainerMessage);
}
if ($('chatInput')) {
    $('chatInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') sendTrainerMessage();
    });
}

/* ═══ Member check-in (reference / QR) ═══ */

function parseBookingRefFromScan(raw) {
    var s = String(raw || '').trim();
    if (s.indexOf('GymDD|') === 0) s = s.slice(6).trim();
    return s;
}

function trainerCheckinCodeKey(refRaw) {
    var s = parseBookingRefFromScan(refRaw);
    var digits = s.replace(/\s/g, '');
    if (/^\d+$/.test(digits)) return digits;
    return s;
}

function stopTrainerQrScanner() {
    if (!trainerHtml5QrCode) return;
    var inst = trainerHtml5QrCode;
    trainerHtml5QrCode = null;
    inst.stop().then(function() {
        inst.clear();
    }).catch(function() {
        try { inst.clear(); } catch (e) { /* ignore */ }
    });
}

function trainerCheckinSetResult(html) {
    var el = $('trainerCheckinResult');
    if (el) el.innerHTML = html;
}

function trainerStartQrScanner() {
    if (typeof Html5Qrcode === 'undefined') {
        alert('QR scanner library did not load. Enter the reference number manually.');
        return;
    }
    var hostId = 'trainerQrReader';
    if (!$(hostId)) return;

    stopTrainerQrScanner();
    trainerHtml5QrCode = new Html5Qrcode(hostId);
    trainerHtml5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        function(decodedText) {
            stopTrainerQrScanner();
            trainerResolveBooking(decodedText);
        },
        function() { /* frame discard */ }
    ).catch(function(err) {
        trainerHtml5QrCode = null;
        alert(err.message || 'Could not start camera. Check permissions.');
    });
}

function trainerRenderOtherTrainerNotice(L) {
    var tname = L.trainerName && String(L.trainerName).trim() ? L.trainerName : 'Another trainer';
    var tim = L.time != null && String(L.time).trim() !== '' ? String(L.time) : '—';
    trainerCheckinSetResult(
        '<div class="alert alert-warning border-0 mb-0">' +
            '<div class="fw-bold mb-2"><i class="fas fa-user-friends me-2"></i>This booking is not with you</div>' +
            '<p class="small mb-1 text-white-50">Only the assigned trainer’s name and class time are shown.</p>' +
            '<hr class="border-secondary">' +
            '<div><span class="text-muted small text-uppercase">Trainer</span><div class="fw-semibold">' + escHtml(tname) + '</div></div>' +
            '<div class="mt-2"><span class="text-muted small text-uppercase">Class time</span><div class="fw-semibold">' + escHtml(tim) + '</div></div>' +
        '</div>'
    );
}

function trainerRenderFullBooking(bookingId, b) {
    var st = (b.status || '').trim();
    var sessionOn = b.sessionStarted === true;
    var refNum = b.bookingCode != null ? String(b.bookingCode) : '—';

    var lines = [
        '<div class="mb-2"><span class="text-muted small text-uppercase">Reference</span><div class="fw-bold fs-5">' + escHtml(refNum) + '</div></div>',
        '<div class="mb-2"><span class="text-muted small text-uppercase">Member</span><div class="fw-semibold">' + escHtml(b.memberName || '—') + '</div>' +
            '<div class="small text-muted">' + escHtml(b.memberEmail || '') + '</div></div>',
        '<div class="mb-2"><span class="text-muted small text-uppercase">Class</span><div>' + escHtml(b.className || '—') + '</div></div>',
        '<div class="mb-2"><span class="text-muted small text-uppercase">When</span><div>' + escHtml(b.date || '—') + ' · ' + escHtml(b.time || '—') + '</div></div>',
        '<div class="mb-3"><span class="text-muted small text-uppercase">Status</span><div>' + escHtml(st || '—') +
            (sessionOn ? ' <span class="badge bg-success ms-1">Session started</span>' : '') + '</div></div>'
    ];

    var actions = '';
    if (st === 'confirmed' && !sessionOn) {
        actions =
            '<button type="button" class="btn btn-success w-100" id="btnTrainerStartSession" data-booking-id="' +
            escHtml(bookingId) + '"><i class="fas fa-play-circle me-2"></i>Start session</button>' +
            '<p class="small text-muted mt-2 mb-0">After you start the session, the member cannot cancel or remove this booking.</p>';
    } else if (st === 'confirmed' && sessionOn) {
        actions = '<div class="alert alert-success border-0 mb-0 py-2 small"><i class="fas fa-check me-1"></i>Session already started.</div>';
    } else if (st === 'cancelled') {
        actions = '<div class="alert alert-secondary border-0 mb-0 py-2 small">This booking was cancelled.</div>';
    }

    trainerCheckinSetResult(
        '<div class="trainer-checkin-detail">' + lines.join('') + actions + '</div>'
    );

    var btn = $('btnTrainerStartSession');
    if (btn) {
        btn.addEventListener('click', function() {
            var bid = btn.getAttribute('data-booking-id');
            if (!bid) return;
            if (!confirm('Start this session? The member will no longer be able to cancel or delete this booking.')) return;
            db.collection('bookings').doc(bid).update({
                sessionStarted: true,
                sessionStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
                sessionStartedBy: currentUid
            }).then(function() {
                return db.collection('bookings').doc(bid).get();
            }).then(function(doc) {
                if (!doc.exists) return;
                var b = doc.data();
                trainerRenderFullBooking(bid, b);
                var mid = b.memberId;
                if (!mid) return;
                return db.collection('members').doc(mid).get().then(function(mdoc) {
                    var md = mdoc.exists ? mdoc.data() : {};
                    if (trainerMemberPlanActive(md)) return null;
                    var quotaRef = db.collection('members').doc(mid).collection('bookingQuota').doc('usage');
                    return quotaRef.set({
                        completedSessions: firebase.firestore.FieldValue.increment(1)
                    }, { merge: true }).catch(function(e) {
                        console.error('bookingQuota increment failed', e);
                    });
                });
            }).catch(function(err) {
                alert(err.message || 'Could not start session.');
            });
        });
    }
}

function trainerResolveBooking(refRaw) {
    if (!currentUid) return;
    var codeKey = trainerCheckinCodeKey(refRaw);
    if (!codeKey) {
        trainerCheckinSetResult('<p class="text-warning small mb-0">Enter or scan a valid reference.</p>');
        return;
    }

    trainerCheckinSetResult('<p class="text-muted small mb-0"><i class="fas fa-spinner fa-spin me-2"></i>Looking up…</p>');

    db.collection('bookingLookups').doc(codeKey).get()
        .then(function(lsnap) {
            if (lsnap.exists) {
                var L = lsnap.data();
                var tid = (L.trainerId || '').trim();
                if (tid !== currentUid) {
                    trainerRenderOtherTrainerNotice(L);
                    return null;
                }
                return db.collection('bookings').doc(L.bookingId).get().then(function(bsnap) {
                    if (!bsnap.exists) {
                        trainerCheckinSetResult('<p class="text-danger small mb-0">Booking record missing. Ask admin.</p>');
                        return;
                    }
                    trainerRenderFullBooking(bsnap.id, bsnap.data());
                });
            }
            var num = parseInt(codeKey, 10);
            if (isNaN(num)) {
                trainerCheckinSetResult('<p class="text-warning small mb-0">No booking found for this reference.</p>');
                return null;
            }
            return db.collection('bookings').where('bookingCode', '==', num).where('trainerId', '==', currentUid).limit(1).get()
                .then(function(q) {
                    if (q.empty) {
                        trainerCheckinSetResult(
                            '<p class="text-warning small mb-0">No booking found for this reference on your account. ' +
                            'If this member trains with someone else, only their trainer name and time would appear.</p>'
                        );
                        return;
                    }
                    var doc = q.docs[0];
                    trainerRenderFullBooking(doc.id, doc.data());
                });
        })
        .catch(function(err) {
            console.error(err);
            trainerCheckinSetResult('<p class="text-danger small mb-0">' + escHtml(err.message || 'Lookup failed.') + '</p>');
        });
}

if ($('btnTrainerLookupRef')) {
    $('btnTrainerLookupRef').addEventListener('click', function() {
        var inp = $('trainerBookingRefInput');
        trainerResolveBooking(inp ? inp.value : '');
    });
}
if ($('trainerBookingRefInput')) {
    $('trainerBookingRefInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            trainerResolveBooking(this.value);
        }
    });
}
if ($('btnTrainerScanStart')) {
    $('btnTrainerScanStart').addEventListener('click', function() { trainerStartQrScanner(); });
}
if ($('btnTrainerScanStop')) {
    $('btnTrainerScanStop').addEventListener('click', function() { stopTrainerQrScanner(); });
}
