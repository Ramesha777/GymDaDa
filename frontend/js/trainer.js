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

            var status = d.approvalStatus || 'pending';
            var colors = { approved: 'success', pending: 'warning', rejected: 'danger' };
            if ($('trainerStatus')) {
                $('trainerStatus').innerHTML =
                    '<span class="badge bg-' + (colors[status] || 'secondary') + '">' +
                    status.charAt(0).toUpperCase() + status.slice(1) + '</span>';
            }
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
            bio: $('tProfBio').value.trim()
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
