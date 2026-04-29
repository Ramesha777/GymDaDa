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

function escHtml(s) {
    if (s == null || s === '') return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function showDashboard(user) {
    $('loadingGate').style.display = 'none';
    $('mainContent').style.display = 'block';
    if ($('userEmail')) $('userEmail').textContent = user.email || '';
    loadTrainerProfile(user.uid);
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

    if (name === 'members') loadMyMembers();
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
