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
    loadClasses();
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
function getInitials(name, fallback) {
    var src = (name && String(name).trim()) || fallback || '';
    if (!src) return '?';
    return src.split(/\s+/).map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
}

function renderProfileAvatar(name, email, photoURL) {
    var box = $('profileAvatar');
    var initEl = $('profileAvatarInitials');
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

function loadProfile() {
    if (!currentUid) return;
    db.collection('members').doc(currentUid).get().then(function(doc) {
        if (!doc.exists) {
            if ($('profileStatus')) $('profileStatus').innerHTML = '';
            $('profEmail').value = currentUser.email;
            if ($('profileHeroEmail')) $('profileHeroEmail').textContent = currentUser.email;
            if ($('profileHeroName')) $('profileHeroName').textContent = 'New member';
            renderProfileAvatar('', currentUser.email, '');
            return;
        }
        var d = doc.data();
        memberData = d;
        $('profName').value    = d.displayName || '';
        $('profEmail').value   = d.email || currentUser.email;
        $('profPhone').value   = d.phone || '';
        $('profAddress').value = d.address || '';
        if ($('profPhotoURL')) $('profPhotoURL').value = d.photoURL || '';

        if ($('profileHeroName')) $('profileHeroName').textContent = d.displayName || 'Member';
        if ($('profileHeroEmail')) $('profileHeroEmail').textContent = d.email || currentUser.email || '';
        renderProfileAvatar(d.displayName, d.email || currentUser.email, d.photoURL);

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
        if ($('profileStatus')) $('profileStatus').innerHTML = '';
    });
}

$('profileForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var data = {
        displayName: $('profName').value.trim(),
        email: currentUser.email,
        phone: $('profPhone').value.trim(),
        address: $('profAddress').value.trim(),
        photoURL: ($('profPhotoURL') ? $('profPhotoURL').value.trim() : '')
    };
    db.collection('members').doc(currentUid).get().then(function(doc) {
        if (doc.exists) {
            return db.collection('members').doc(currentUid).update(data);
        } else {
            data.plan = 'Basic';
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            return db.collection('members').doc(currentUid).set(data);
        }
    }).then(function() {
        showAlert($('profileAlert'), 'Profile saved!', 'success');
        loadProfile();
    }).catch(function(err) { showAlert($('profileAlert'), err.message, 'danger'); });
});

var photoInput = $('profPhotoURL');
if (photoInput) {
    photoInput.addEventListener('input', function() {
        renderProfileAvatar(
            $('profName').value || (memberData && memberData.displayName),
            currentUser ? currentUser.email : '',
            photoInput.value.trim()
        );
    });
}

function showAlert(el, msg, type) {
    el.className = 'alert alert-' + type;
    el.textContent = msg;
    el.classList.remove('d-none');
    setTimeout(function() { el.classList.add('d-none'); }, 4000);
}

/** Safe HTML text */
function escapeHtml(s) {
    if (s == null || s === '') return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

/** Embed in single-quoted JS string (e.g. onclick args) */
function escapeJsString(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Safe URL for img[src] when scheme is http(s) */
function escapeAttrUrl(u) {
    if (!u || typeof u !== 'string') return '';
    var t = u.trim();
    if (!/^https?:\/\//i.test(t)) return '';
    return t.replace(/"/g, '&quot;').replace(/</g, '');
}

/* JS Date#getDay(): 0 Sunday … 6 Saturday */
var JS_WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad2(n) {
    return (n < 10 ? '0' : '') + n;
}

function formatYYYYMMDDLocal(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function parseISODateLocal(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return null;
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10) - 1;
    var day = parseInt(p[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(day)) return null;
    return new Date(y, m, day);
}

function getJsWeekdayFromISODate(iso) {
    var d = parseISODateLocal(iso);
    return d ? d.getDay() : null;
}

/** Map class schedule.day to JS weekday (0–6). Null if unknown. */
function scheduleDayToJsWeekday(dayStr) {
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

function nextOccurrenceOfWeekday(jsWeekday) {
    var today = new Date();
    var d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var cur = d.getDay();
    var diff = jsWeekday - cur;
    if (diff < 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return d;
}

/** Random 5-digit reference shown to members (10000–99999). */
function generateBookingCode() {
    return Math.floor(10000 + Math.random() * 90000);
}

/** Sort key from Firestore Timestamp or missing. */
function bookingCreatedMs(data) {
    var ts = data && data.createdAt;
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return 0;
}

function validateBookDateWeekday() {
    var hid = $('bookClassId');
    var fb = $('bookDateFeedback');
    var btn = $('btnConfirmBook');
    var inp = $('bookDate');
    if (!hid || !btn) return false;
    var wd = scheduleDayToJsWeekday(hid.dataset.scheduleDay || '');
    if (wd === null) {
        btn.disabled = true;
        if (fb) { fb.classList.add('d-none'); fb.textContent = ''; }
        return false;
    }
    var val = inp ? inp.value : '';
    if (!val) {
        if (fb) fb.classList.add('d-none');
        btn.disabled = true;
        return false;
    }
    var got = getJsWeekdayFromISODate(val);
    if (got !== wd) {
        if (fb) {
            fb.textContent = 'This class only meets on ' + JS_WEEKDAY_LABELS[wd] + '. Pick that weekday.';
            fb.classList.remove('d-none');
        }
        btn.disabled = true;
        return false;
    }
    if (fb) { fb.classList.add('d-none'); fb.textContent = ''; }
    btn.disabled = false;
    return true;
}

/* ═══════════════════════════════════════
   CLASSES
   ═══════════════════════════════════════ */
function memberClassRequestDocId(classId) {
    return currentUid + '_' + classId;
}

function submitMemberClassRequest(classId, className, trainerId, trainerName) {
    if (!currentUid || !classId || !trainerId) return;
    var rid = memberClassRequestDocId(classId);
    db.collection('memberClassRequests').doc(rid).get().then(function(doc) {
        if (doc.exists) {
            var st = doc.data().status || 'pending';
            if (st === 'pending') {
                alert('You already have a pending request for this class.');
                return null;
            }
            if (st === 'approved') {
                alert('This trainer has already approved your request.');
                return null;
            }
        }
        return db.collection('memberClassRequests').doc(rid).set({
            memberId: currentUid,
            memberName: (memberData && memberData.displayName) ? memberData.displayName.trim() : (currentUser && currentUser.email),
            memberEmail: (currentUser && currentUser.email) || '',
            classId: classId,
            className: className || '',
            trainerId: trainerId,
            trainerName: trainerName || '',
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }).then(function(res) {
        if (res === null) return;
        alert('Request sent to your trainer.');
        loadClasses();
    }).catch(function(err) {
        if (err) alert(err.message || 'Could not send request.');
    });
}

function loadClasses() {
    var grid = $('classesGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Loading classes…</div>';

    var reqByClassId = {};

    db.collection('classes').get()
        .then(function(classSnap) {
            return db.collection('memberClassRequests').where('memberId', '==', currentUid).get()
                .then(function(reqSnap) {
                    reqSnap.forEach(function(rd) {
                        var x = rd.data();
                        if (!x.classId) return;
                        reqByClassId[x.classId] = x.status || 'pending';
                    });
                    return classSnap;
                })
                .catch(function(err) {
                    console.warn('memberClassRequests (trainer-request badges skipped):', err);
                    return classSnap;
                });
        })
        .then(function(snap) {

        grid.innerHTML = '';
        var docs = [];
        snap.forEach(function(doc) {
            var c = doc.data();
            var st = c.status || 'active';
            if (st !== 'active') return;
            docs.push(doc);
        });
        if (!docs.length) {
            grid.innerHTML = '<div class="col-12 text-center text-muted py-4">No classes available yet</div>';
            return;
        }
        docs.forEach(function(doc) {
            var c = doc.data();
            var spots = (c.capacity || 0) - (c.enrolled || 0);
            var dayTxt = (c.schedule && c.schedule.day) ? c.schedule.day : '—';
            var timeTxt = (c.schedule && c.schedule.time) ? c.schedule.time : '—';
            var durTxt = (c.schedule && c.schedule.duration) ? String(c.schedule.duration) + ' min' : '';
            var metaSchedule = escapeHtml(dayTxt) + ' · ' + escapeHtml(timeTxt) +
                (durTxt ? ' · ' + escapeHtml(durTxt) : '');
            var trainerSpots = escapeHtml(c.trainerName || 'TBA') + ' · ' + spots + '/' + (c.capacity || 0);

            var tid = (c.trainerId || '').trim();
            var reqSt = reqByClassId[doc.id];
            var askHtml = '';
            if (tid) {
                if (reqSt === 'pending') {
                    askHtml =
                        '<div class="small text-warning mt-2"><i class="fas fa-clock me-1"></i>Trainer approval pending</div>';
                } else if (reqSt === 'approved') {
                    askHtml =
                        '<div class="small text-success mt-2"><i class="fas fa-check me-1"></i>Trainer approved</div>';
                } else if (reqSt === 'rejected') {
                    askHtml =
                        '<button type="button" class="btn btn-outline-warning btn-sm w-100 mt-2 member-ask-trainer-btn"' +
                        ' data-class-id="' + escapeHtml(doc.id) + '"' +
                        ' data-class-name="' + escapeHtml(c.name || '') + '"' +
                        ' data-trainer-id="' + escapeHtml(tid) + '"' +
                        ' data-trainer-name="' + escapeHtml(c.trainerName || '') + '">' +
                        '<i class="fas fa-redo me-1"></i>Ask again</button>';
                } else {
                    askHtml =
                        '<button type="button" class="btn btn-outline-light btn-sm w-100 mt-2 member-ask-trainer-btn"' +
                        ' data-class-id="' + escapeHtml(doc.id) + '"' +
                        ' data-class-name="' + escapeHtml(c.name || '') + '"' +
                        ' data-trainer-id="' + escapeHtml(tid) + '"' +
                        ' data-trainer-name="' + escapeHtml(c.trainerName || '') + '">' +
                        '<i class="fas fa-user-check me-1"></i>Ask trainer</button>';
                }
            }

            var col = document.createElement('div');
            col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';
            col.innerHTML =
                '<div class="dash-card h-100 class-card-member">' +
                    '<div class="card-body text-center">' +
                        '<div class="class-avatar"><i class="fas fa-dumbbell"></i></div>' +
                        '<h6 class="text-white fw-bold mt-2 mb-1">' + escapeHtml(c.name || 'Untitled') + '</h6>' +
                        '<span class="badge bg-info">' + escapeHtml(c.type || 'General') + '</span>' +
                        '<div class="member-meta small mt-1">' + metaSchedule + '</div>' +
                        '<div class="member-meta small">' + trainerSpots + '</div>' +
                        askHtml +
                        (spots > 0
                            ? '<button type="button" class="btn btn-primary btn-sm w-100 mt-2" onclick="openBookModal(\'' + escapeJsString(doc.id) + '\',\'' + escapeJsString(c.name || '') + '\',\'' + escapeJsString(c.trainerName || '') + '\',\'' + escapeJsString(c.trainerId || '') + '\',\'' + escapeJsString((c.schedule && c.schedule.time) ? c.schedule.time : '') + '\',\'' + escapeJsString((c.schedule && c.schedule.day) ? String(c.schedule.day) : '') + '\')">Book Now</button>'
                            : '<button type="button" class="btn btn-secondary btn-sm w-100 mt-2" disabled>Full</button>') +
                    '</div>' +
                '</div>';
            grid.appendChild(col);
        });
        }).catch(function(err) {
        console.error('classes:', err);
        grid.innerHTML = '<div class="col-12 text-center text-danger py-4">Could not load classes.</div>';
    });
}

if ($('btnRefreshClasses')) {
    $('btnRefreshClasses').addEventListener('click', loadClasses);
}

if ($('classesGrid')) {
    $('classesGrid').addEventListener('click', function(e) {
        var btn = e.target.closest('.member-ask-trainer-btn');
        if (!btn || !btn.getAttribute('data-class-id')) return;
        e.preventDefault();
        submitMemberClassRequest(
            btn.getAttribute('data-class-id'),
            btn.getAttribute('data-class-name') || '',
            btn.getAttribute('data-trainer-id') || '',
            btn.getAttribute('data-trainer-name') || ''
        );
    });
}

window.openBookModal = function(classId, className, trainerName, trainerId, time, scheduleDay) {
    var hid = $('bookClassId');
    if (!hid) return;
    hid.value = classId;
    hid.dataset.trainerId = trainerId || '';
    hid.dataset.trainerName = trainerName || '';
    hid.dataset.className = className || '';
    hid.dataset.time = time || '';
    hid.dataset.scheduleDay = scheduleDay || '';

    var titleEl = $('bookClassName');
    if (titleEl) titleEl.textContent = className + (trainerName ? ' with ' + trainerName : '');

    var wd = scheduleDayToJsWeekday(scheduleDay);
    var hint = $('bookScheduleHint');
    if (hint) {
        hint.classList.remove('d-none');
        hint.classList.remove('alert-info', 'alert-warning');
        if (wd !== null) {
            hint.classList.add('alert', 'alert-info');
            hint.textContent = 'This class meets on ' + JS_WEEKDAY_LABELS[wd] + '. You can only book a date that falls on that weekday.';
        } else {
            hint.classList.add('alert', 'alert-warning');
            hint.textContent = 'No weekday is saved for this class. Ask staff to set the schedule before booking.';
        }
    }

    var note = $('bookDateWeekdayNote');
    if (note) {
        note.textContent = wd !== null ? ('Pick any upcoming ' + JS_WEEKDAY_LABELS[wd] + '.') : '';
    }

    var todayLocal = formatYYYYMMDDLocal(new Date());
    var bd = $('bookDate');
    if (bd) {
        bd.min = todayLocal;
        if (wd !== null) {
            bd.value = formatYYYYMMDDLocal(nextOccurrenceOfWeekday(wd));
            if (bd.value < todayLocal) bd.value = todayLocal;
            if (getJsWeekdayFromISODate(bd.value) !== wd) {
                bd.value = formatYYYYMMDDLocal(nextOccurrenceOfWeekday(wd));
            }
        } else {
            bd.value = '';
        }
    }

    var fb = $('bookDateFeedback');
    if (fb) { fb.classList.add('d-none'); fb.textContent = ''; }

    validateBookDateWeekday();

    var bm = $('bookModal');
    if (bm && window.bootstrap) bootstrap.Modal.getOrCreateInstance(bm).show();
};

if ($('bookDate')) {
    $('bookDate').addEventListener('change', validateBookDateWeekday);
    $('bookDate').addEventListener('input', validateBookDateWeekday);
}

/** Canonical time string for duplicate checks (handles Firestore Timestamp / strings). */
function bookingTimeComparable(t) {
    if (t == null || t === '') return '';
    if (typeof t === 'string' || typeof t === 'number') {
        return String(t).trim().replace(/\s+/g, ' ');
    }
    if (typeof t === 'object') {
        if (typeof t.toDate === 'function') {
            try {
                var d = t.toDate();
                return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            } catch (e) { /* ignore */ }
        }
        if (typeof t.seconds === 'number') {
            try {
                var d2 = new Date(t.seconds * 1000);
                return String(d2.getHours()).padStart(2, '0') + ':' + String(d2.getMinutes()).padStart(2, '0');
            } catch (e2) { /* ignore */ }
        }
    }
    return String(t).trim().replace(/\s+/g, ' ');
}

/** One Firestore doc per member + class + date + time — prevents double-book races. */
function bookingSlotDocId(memberId, classId, date, timeComparable) {
    var t = (timeComparable || '').replace(/:/g, '-').replace(/\//g, '_');
    if (!t) t = 'na';
    return memberId + '_' + classId + '_' + date + '_' + t;
}

function duplicateBookingErr() {
    var e = new Error('DUPLICATE_BOOKING');
    e.code = 'DUPLICATE_BOOKING';
    return e;
}

function classFullErr() {
    var e = new Error('CLASS_FULL');
    e.code = 'CLASS_FULL';
    return e;
}

$('btnConfirmBook').addEventListener('click', function() {
    var classId = $('bookClassId').value;
    var date = $('bookDate').value;
    if (!date) { alert('Please select a date.'); return; }

    var ds = $('bookClassId').dataset;
    var wd = scheduleDayToJsWeekday(ds.scheduleDay || '');
    if (wd === null) {
        alert('This class does not have a valid weekday in its schedule. Please contact the gym.');
        return;
    }
    if (!validateBookDateWeekday() || getJsWeekdayFromISODate(date) !== wd) {
        alert('Booking date must be a ' + JS_WEEKDAY_LABELS[wd] + ' for this class.');
        return;
    }

    var bookingCode = generateBookingCode();
    var timeRaw = ds.time || '';
    var wantTime = bookingTimeComparable(timeRaw);
    var slotId = bookingSlotDocId(currentUid, classId, date, wantTime);

    var booking = {
        memberId: currentUid,
        memberName: memberData.displayName || currentUser.email,
        memberEmail: currentUser.email,
        trainerId: ds.trainerId || '',
        trainerName: ds.trainerName || '',
        classId: classId,
        className: ds.className || '',
        scheduleDay: ds.scheduleDay || '',
        date: date,
        time: timeRaw,
        slotKey: slotId,
        bookingCode: bookingCode,
        status: 'confirmed',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    var btnBook = $('btnConfirmBook');
    btnBook.disabled = true;

    db.collection('bookings').where('memberId', '==', currentUid).get()
        .then(function(snap) {
            var duplicate = false;
            snap.forEach(function(doc) {
                var b = doc.data();
                if ((b.status || '') === 'cancelled') return;
                if (b.classId !== classId || b.date !== date) return;
                if (bookingTimeComparable(b.time) !== wantTime) return;
                duplicate = true;
            });
            if (duplicate) throw duplicateBookingErr();

            return db.runTransaction(function(transaction) {
                var ref = db.collection('bookings').doc(slotId);
                var classRef = db.collection('classes').doc(classId);
                return transaction.get(ref).then(function(docSnap) {
                    if (docSnap.exists) {
                        var st = docSnap.data().status || '';
                        if (st !== 'cancelled') throw duplicateBookingErr();
                    }
                    return transaction.get(classRef).then(function(classSnap) {
                        if (!classSnap.exists) {
                            throw new Error('This class is no longer available.');
                        }
                        var cd = classSnap.data();
                        var cap = cd.capacity != null ? cd.capacity : 0;
                        var enr = cd.enrolled != null ? cd.enrolled : 0;
                        if (cap > 0 && enr >= cap) throw classFullErr();

                        transaction.set(ref, booking);
                        transaction.update(classRef, {
                            enrolled: firebase.firestore.FieldValue.increment(1)
                        });
                        var lookupRef = db.collection('bookingLookups').doc(String(bookingCode));
                        transaction.set(lookupRef, {
                            bookingId: slotId,
                            memberId: currentUid,
                            trainerId: ds.trainerId || '',
                            trainerName: ds.trainerName || '',
                            className: ds.className || '',
                            date: date,
                            time: timeRaw
                        });
                    });
                });
            });
        })
        .then(function() {
            if ($('bookModal') && bootstrap.Modal.getInstance($('bookModal'))) {
                bootstrap.Modal.getInstance($('bookModal')).hide();
            }
            if (typeof window.showBookingConfirmation === 'function') {
                window.showBookingConfirmation(bookingCode, {
                    className: ds.className || '',
                    date: date,
                    time: timeRaw
                });
            } else {
                alert('Booking confirmed. Your reference number is ' + bookingCode + '.');
            }
            loadClasses();
            loadBookings();
            switchSection('bookings');
        })
        .catch(function(err) {
            if (err && err.code === 'DUPLICATE_BOOKING') {
                alert('You already have an active booking for this class on this date at this time.');
                return;
            }
            if (err && err.code === 'CLASS_FULL') {
                alert('This class is full. Try another date or class.');
                return;
            }
            if (err) alert(err.message || 'Booking failed.');
        })
        .finally(function() {
            btnBook.disabled = false;
        });
});

/* ═══════════════════════════════════════
   TRAINERS
   ═══════════════════════════════════════ */
var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var currentTrainerDetailId = null;
var currentTrainerDetailName = '';

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

function slotSummaryForDay(dayVal) {
    if (dayVal == null || dayVal === '') return '—';
    if (typeof dayVal === 'object' && dayVal.available === false) return 'Off';
    var labels = collectSlotLabels(dayVal);
    if (labels.length) return labels.join(', ');
    return '—';
}

function formatTrainerAvailabilityHtml(avail) {
    if (!avail || typeof avail !== 'object') {
        return '<p class="text-muted small mb-0">No weekly schedule saved yet.</p>';
    }
    var html = '<div class="trainer-avail-list">';
    DAYS.forEach(function(day) {
        var dayVal = avail[day] || avail[day.toLowerCase()];
        html +=
            '<div class="trainer-avail-row">' +
                '<span class="text-muted">' + escapeHtml(day.slice(0, 3)) + '</span>' +
                '<span>' + escapeHtml(slotSummaryForDay(dayVal)) + '</span>' +
            '</div>';
    });
    html += '</div>';
    return html;
}

function trainerDetailAvatarHtml(name, email, photoURL) {
    var initials = getInitials(name, email);
    var ph = photoURL && String(photoURL).trim();
    var hasPhoto = ph && /^https?:\/\//i.test(ph);
    if (hasPhoto) {
        return (
            '<div class="trainer-detail-avatar">' +
                '<img src="' + escapeAttrUrl(ph) + '" alt="" onerror="this.remove();this.parentNode.textContent=\'' +
                escapeJsString(initials) + '\'">' +
            '</div>'
        );
    }
    return '<div class="trainer-detail-avatar">' + escapeHtml(initials) + '</div>';
}

function getTrainerDetailModal() {
    var el = $('trainerDetailModal');
    if (!el || !window.bootstrap) return null;
    return bootstrap.Modal.getOrCreateInstance(el);
}

function openTrainerDetailModal(trainerId) {
    if (!trainerId) return;
    currentTrainerDetailId = trainerId;
    var body = $('trainerDetailBody');
    var mt = $('tdModalTitle');
    body.innerHTML = '<p class="text-muted text-center py-4 mb-0"><i class="fas fa-spinner fa-spin me-2"></i>Loading trainer…</p>';
    if (mt) mt.innerHTML = '<i class="fas fa-user-tie me-2 text-info"></i>Trainer';

    var trainerRef = db.collection('trainers').doc(trainerId);
    var classesQuery = db.collection('classes').where('trainerId', '==', trainerId);

    Promise.all([trainerRef.get(), classesQuery.get()])
        .then(function(results) {
            var tDoc = results[0];
            var classesSnap = results[1];

            if (!tDoc.exists) {
                body.innerHTML = '<p class="text-danger mb-0">Trainer not found.</p>';
                return;
            }
            var t = tDoc.data();
            if ((t.approvalStatus || '') !== 'approved') {
                body.innerHTML = '<p class="text-muted mb-0">This trainer is not available.</p>';
                return;
            }

            var name = (t.displayName || t.email || 'Trainer').trim();
            currentTrainerDetailName = name;
            if (mt) mt.innerHTML = '<i class="fas fa-user-tie me-2 text-info"></i>' + escapeHtml(name);

            var classNames = [];
            classesSnap.forEach(function(doc) {
                var c = doc.data();
                if ((c.status || 'active') !== 'active') return;
                if (c.name) classNames.push(c.name);
            });

            var expNum = t.experience;
            var expLine = expNum != null && expNum !== ''
                ? escapeHtml(String(expNum)) + ' years experience'
                : '<span class="text-muted">—</span>';

            var availHtml = formatTrainerAvailabilityHtml(t.availability || t.weeklyAvailability);

            var classesHtml = '';
            if (!classNames.length) {
                classesHtml = '<p class="text-muted small mb-0">No classes assigned yet.</p>';
            } else {
                classesHtml = classNames.map(function(nm) {
                    return '<span class="trainer-class-pill">' + escapeHtml(nm) + '</span>';
                }).join('');
            }

            body.innerHTML =
                '<div class="trainer-detail-hero">' +
                    trainerDetailAvatarHtml(name, t.email, t.photoURL) +
                    '<div class="trainer-detail-meta">' +
                        '<h6>' + escapeHtml(name) + '</h6>' +
                        '<p class="text-muted mb-1"><i class="fas fa-star me-1 text-warning"></i>' + expLine + '</p>' +
                        (t.specialization ? '<p class="text-muted small mb-0">' + escapeHtml(t.specialization) + '</p>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="trainer-detail-section">' +
                    '<h6>Assigned classes</h6>' +
                    classesHtml +
                '</div>' +
                '<div class="trainer-detail-section">' +
                    '<h6>Weekly availability</h6>' +
                    availHtml +
                '</div>';

            var m = getTrainerDetailModal();
            if (m) m.show();
        })
        .catch(function(err) {
            body.innerHTML = '<p class="text-danger mb-0">Could not load trainer.</p>';
            console.error(err);
        });
}

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
            var tid = doc.id;
            var t = doc.data();
            var label = (t.displayName || t.email || 'Trainer').trim();
            var initials = (label || 'T').split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
            var hasPhoto = t.photoURL && /^https?:\/\//i.test(String(t.photoURL).trim());
            var avatar = hasPhoto
                ? '<div class="trainer-avatar"><img src="' + escapeAttrUrl(String(t.photoURL).trim()) + '" alt="' + escapeHtml(label) + '" onerror="this.parentNode.textContent=\'' + escapeJsString(initials) + '\'"></div>'
                : '<div class="trainer-avatar">' + escapeHtml(initials) + '</div>';
            var bio = (t.bio || '').trim();
            if (bio.length > 90) bio = bio.substring(0, 90) + '…';
            var col = document.createElement('div');
            col.className = 'col-6 col-md-4 col-lg-3';
            var card = document.createElement('div');
            card.className = 'dash-card trainer-browse-card trainer-card-clickable h-100';
            card.setAttribute('role', 'button');
            card.tabIndex = 0;
            card.setAttribute('data-trainer-id', tid);
            card.setAttribute('aria-label', 'View details for ' + label);
            var body = document.createElement('div');
            body.className = 'card-body text-center';
            body.innerHTML =
                avatar +
                '<h6 class="text-white fw-bold trainer-browse-title">' + escapeHtml(label) + '</h6>' +
                '<span class="badge bg-info mb-1">' + escapeHtml(t.specialization || 'General') + '</span>' +
                '<p class="trainer-browse-meta mb-1">' + (t.experience || 0) + ' yrs experience</p>' +
                '<p class="trainer-browse-bio text-muted mb-0">' + escapeHtml(bio || '—') + '</p>';
            card.appendChild(body);
            col.appendChild(card);
            grid.appendChild(col);
        });
    });
}

$('btnRefreshTrainers').addEventListener('click', loadTrainers);

var trainersGridEl = $('trainersGrid');
if (trainersGridEl) {
    trainersGridEl.addEventListener('click', function(e) {
        var card = e.target.closest('.trainer-card-clickable');
        if (!card || !card.dataset.trainerId) return;
        openTrainerDetailModal(card.dataset.trainerId);
    });
    trainersGridEl.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var card = e.target.closest('.trainer-card-clickable');
        if (!card || !card.dataset.trainerId) return;
        e.preventDefault();
        openTrainerDetailModal(card.dataset.trainerId);
    });
}

var btnOpenBookSession = $('btnOpenBookSession');
if (btnOpenBookSession) {
    btnOpenBookSession.addEventListener('click', function() {
        if (!currentTrainerDetailId) return;
        var detailEl = $('trainerDetailModal');
        var bookEl = $('trainerBookSessionModal');
        var tbsTrainerId = $('tbsTrainerId');
        var tbsTrainerLabel = $('tbsTrainerLabel');
        var tbsDate = $('tbsDate');
        var tbsTime = $('tbsTime');
        var tbsReason = $('tbsReason');
        var tbsAlert = $('tbsAlert');
        if (!detailEl || !bookEl || !tbsTrainerId || !tbsTrainerLabel) return;

        tbsTrainerId.value = currentTrainerDetailId;
        tbsTrainerLabel.textContent = 'Session with ' + currentTrainerDetailName;
        var today = new Date().toISOString().split('T')[0];
        tbsDate.min = today;
        tbsDate.value = '';
        if (tbsTime) tbsTime.value = '';
        if (tbsReason) tbsReason.value = '';
        if (tbsAlert) {
            tbsAlert.classList.add('d-none');
            tbsAlert.textContent = '';
        }

        function afterHidden() {
            detailEl.removeEventListener('hidden.bs.modal', afterHidden);
            if (window.bootstrap && bookEl) {
                bootstrap.Modal.getOrCreateInstance(bookEl).show();
            }
        }
        detailEl.addEventListener('hidden.bs.modal', afterHidden);
        var dm = bootstrap.Modal.getInstance(detailEl);
        if (dm) dm.hide();
        else afterHidden();
    });
}

var btnSubmitSessionRequest = $('btnSubmitSessionRequest');
if (btnSubmitSessionRequest) {
    btnSubmitSessionRequest.addEventListener('click', function() {
        var tid = $('tbsTrainerId') && $('tbsTrainerId').value;
        var dateEl = $('tbsDate');
        var timeEl = $('tbsTime');
        var reasonEl = $('tbsReason');
        var tbsAlert = $('tbsAlert');
        var date = dateEl ? dateEl.value : '';
        var time = timeEl ? timeEl.value : '';
        var reason = reasonEl ? String(reasonEl.value || '').trim() : '';

        if (!tid || !date || !time || !reason) {
            if (tbsAlert) {
                tbsAlert.className = 'alert alert-danger py-2 small';
                tbsAlert.textContent = 'Please fill in date, time, and why you want this session.';
                tbsAlert.classList.remove('d-none');
            }
            return;
        }

        btnSubmitSessionRequest.disabled = true;
        db.collection('trainerSessionRequests').add({
            memberId: currentUid,
            memberName: memberData && memberData.displayName ? memberData.displayName : (currentUser && currentUser.email),
            memberEmail: currentUser && currentUser.email,
            trainerId: tid,
            trainerName: currentTrainerDetailName,
            preferredDate: date,
            preferredTime: time,
            reason: reason,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function() {
            var bm = $('trainerBookSessionModal') && bootstrap.Modal.getInstance($('trainerBookSessionModal'));
            if (bm) bm.hide();
            alert('Your session request was submitted. The trainer will get back to you.');
        }).catch(function(err) {
            if (tbsAlert) {
                tbsAlert.className = 'alert alert-danger py-2 small';
                tbsAlert.textContent = err.message || 'Could not submit request.';
                tbsAlert.classList.remove('d-none');
            }
        }).then(function() {
            btnSubmitSessionRequest.disabled = false;
        });
    });
}

/* ═══════════════════════════════════════
   BOOKINGS
   ═══════════════════════════════════════ */
function loadBookings() {
    var tbody = $('bookingsBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Loading…</td></tr>';

    db.collection('bookings').where('memberId', '==', currentUid).get()
        .then(function(snap) {
            var rows = [];
            snap.forEach(function(doc) {
                rows.push({ id: doc.id, data: doc.data() });
            });
            rows.sort(function(a, b) {
                return bookingCreatedMs(b.data) - bookingCreatedMs(a.data);
            });

            tbody.innerHTML = '';
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No bookings yet. Browse classes to book!</td></tr>';
                return;
            }
            rows.forEach(function(row) {
                var b = row.data;
                var statusColors = { confirmed: 'success', cancelled: 'secondary', completed: 'info' };
                var refDisplay = b.bookingCode != null && b.bookingCode !== ''
                    ? escapeHtml(String(b.bookingCode))
                    : '<span class="text-muted">—</span>';
                var codeRaw = (b.bookingCode != null && b.bookingCode !== '') ? String(b.bookingCode) : '';

                var tr = document.createElement('tr');
                if (codeRaw) {
                    tr.classList.add('bookings-row-clickable');
                    tr.setAttribute('data-booking-code', codeRaw);
                    tr.setAttribute('data-booking-class', b.className || '');
                    tr.setAttribute('data-booking-date', b.date || '');
                    tr.setAttribute('data-booking-time', b.time || '');
                    tr.tabIndex = 0;
                    tr.setAttribute('role', 'button');
                    tr.setAttribute('aria-label', 'Show QR code for booking reference ' + codeRaw);
                }

                var actionsHtml = '—';
                if (b.status === 'confirmed') {
                    if (b.sessionStarted === true) {
                        actionsHtml =
                            '<span class="small text-success"><i class="fas fa-check-circle me-1"></i>Completed</span>';
                    } else {
                        actionsHtml =
                            '<button type="button" class="btn btn-sm btn-outline-danger btn-cancel-booking" data-booking-id="' +
                            escapeHtml(row.id) + '" data-booking-class="' + escapeHtml(b.className || '') +
                            '"><i class="fas fa-times me-1"></i>Cancel</button>';
                    }
                } else if (b.status === 'cancelled') {
                    actionsHtml =
                        '<button type="button" class="btn btn-sm btn-outline-secondary btn-delete-cancelled-booking" data-booking-id="' +
                        escapeHtml(row.id) + '" data-booking-class="' + escapeHtml(b.className || '') +
                        '" title="Remove from your list"><i class="fas fa-trash-alt me-1"></i>Delete</button>';
                }

                tr.innerHTML =
                    '<td class="fw-semibold">' + refDisplay + '</td>' +
                    '<td>' + escapeHtml(b.className || '—') + '</td>' +
                    '<td>' + escapeHtml(b.trainerName || '—') + '</td>' +
                    '<td>' + escapeHtml(b.date || '—') + '</td>' +
                    '<td>' + escapeHtml(b.time || '—') + '</td>' +
                    '<td><span class="badge bg-' + (statusColors[b.status] || 'secondary') + '">' + escapeHtml(b.status || '—') + '</span></td>' +
                    '<td>' + actionsHtml + '</td>';
                tbody.appendChild(tr);
            });
        })
        .catch(function(err) {
            console.error(err);
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Could not load bookings.</td></tr>';
        });
}

window.cancelBooking = function(bookingId, meta) {
    meta = meta || {};
    if (!bookingId) return;
    if (!confirm('Cancel this booking?')) return;

    var bref = db.collection('bookings').doc(bookingId);

    db.runTransaction(function(transaction) {
        return transaction.get(bref).then(function(bsnap) {
            if (!bsnap.exists) throw new Error('Booking not found.');
            var b = bsnap.data();
            if (b.memberId !== currentUid) throw new Error('Permission denied.');
            if ((b.status || '') !== 'confirmed') throw new Error('This booking is already cancelled.');

            var cid = (b.classId || '').trim();
            if (!cid) {
                transaction.update(bref, { status: 'cancelled' });
                return;
            }
            var cref = db.collection('classes').doc(cid);
            return transaction.get(cref).then(function(csnap) {
                transaction.update(bref, { status: 'cancelled' });
                if (csnap.exists) {
                    var curEnr = csnap.data().enrolled != null ? csnap.data().enrolled : 0;
                    if (curEnr > 0) {
                        transaction.update(cref, {
                            enrolled: firebase.firestore.FieldValue.increment(-1)
                        });
                    }
                }
            });
        });
    })
        .then(function() {
            loadBookings();
            loadClasses();
            if (typeof window.showBookingCancelledConfirmation === 'function') {
                window.showBookingCancelledConfirmation({ className: meta.className || '' });
            }
        })
        .catch(function(err) { alert(err.message || 'Could not cancel booking.'); });
};

window.deleteCancelledBooking = function(bookingId) {
    if (!bookingId) return;
    if (!confirm('Remove this cancelled booking from your list? This cannot be undone.')) return;

    db.collection('bookings').doc(bookingId).get().then(function(doc) {
        if (!doc.exists) throw new Error('Booking not found.');
        var d = doc.data();
        if (d.memberId !== currentUid) throw new Error('Permission denied.');
        if ((d.status || '') !== 'cancelled') throw new Error('Only cancelled bookings can be removed.');
        if (d.sessionStarted === true) throw new Error('This booking cannot be deleted after the session was started.');
        var code = d.bookingCode;
        var ops = [db.collection('bookings').doc(bookingId).delete()];
        if (code != null && code !== '') {
            ops.push(db.collection('bookingLookups').doc(String(code)).delete());
        }
        return Promise.all(ops);
    })
        .then(function() {
            loadBookings();
        })
        .catch(function(err) { alert(err.message || 'Could not delete booking.'); });
};

$('btnRefreshBookings').addEventListener('click', loadBookings);

(function bindBookingsTableInteractions() {
    var tbody = $('bookingsBody');
    if (!tbody) return;

    tbody.addEventListener('click', function(e) {
        var delBtn = e.target.closest('.btn-delete-cancelled-booking');
        if (delBtn) {
            e.stopPropagation();
            var did = delBtn.getAttribute('data-booking-id');
            if (did) window.deleteCancelledBooking(did);
            return;
        }
        var cancelBtn = e.target.closest('.btn-cancel-booking');
        if (cancelBtn) {
            e.stopPropagation();
            var bid = cancelBtn.getAttribute('data-booking-id');
            var bcls = cancelBtn.getAttribute('data-booking-class') || '';
            if (bid) window.cancelBooking(bid, { className: bcls });
            return;
        }
        var tr = e.target.closest('tr.bookings-row-clickable');
        if (!tr || typeof window.showBookingConfirmation !== 'function') return;
        var code = tr.getAttribute('data-booking-code');
        if (!code) return;
        window.showBookingConfirmation(code, {
            className: tr.getAttribute('data-booking-class') || '',
            date: tr.getAttribute('data-booking-date') || '',
            time: tr.getAttribute('data-booking-time') || ''
        });
    });

    tbody.addEventListener('keydown', function(e) {
        var tr = e.target.closest('tr.bookings-row-clickable');
        if (!tr || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        if (typeof window.showBookingConfirmation !== 'function') return;
        var code = tr.getAttribute('data-booking-code');
        if (!code) return;
        window.showBookingConfirmation(code, {
            className: tr.getAttribute('data-booking-class') || '',
            date: tr.getAttribute('data-booking-date') || '',
            time: tr.getAttribute('data-booking-time') || ''
        });
    });
})();
