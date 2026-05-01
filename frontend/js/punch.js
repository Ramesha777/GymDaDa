/**
 * Public punch kiosk — Firestore only (no auth). Barcode wedge + optional camera.
 * Doc id: day_{subjectUid}_{dateKey} — alternates check-in / check-out all day; new dateKey after midnight starts fresh.
 */
import { firebaseConfig } from './firebase-config.js';
import { isValidGymPublicId } from './gym-public-id.js';

firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();

var $ = function(id) {
    return document.getElementById(id);
};

var punchHtml5Qr = null;
var clockTimer = null;
var scanBusy = false;
var wedgeFocusTimer = null;
var okFeedbackHideTimer = null;

var DONUT_C = 2 * Math.PI * 52;

function esc(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function localDateKey(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function dayPunchDocId(uid, dateKey) {
    return 'day_' + uid + '_' + dateKey;
}

function normalizeScanPayload(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (s.indexOf('GymDD|') === 0) s = s.slice(6).trim();
    return s.trim();
}

function clearOkFeedbackHideTimer() {
    if (okFeedbackHideTimer != null) {
        clearTimeout(okFeedbackHideTimer);
        okFeedbackHideTimer = null;
    }
}

function scheduleOkFeedbackHide(delayMs) {
    clearOkFeedbackHideTimer();
    var ms = delayMs == null ? 1000 : delayMs;
    okFeedbackHideTimer = setTimeout(function() {
        okFeedbackHideTimer = null;
        clearFeedback();
    }, ms);
}

function showFeedback(kind, msg) {
    clearOkFeedbackHideTimer();
    var el = $('punchFeedback');
    if (!el) return;
    el.className = 'punch-feedback is-on punch-feedback--' + (kind === 'ok' ? 'ok' : 'err');
    el.innerHTML = msg;
}

function clearFeedback() {
    clearOkFeedbackHideTimer();
    var el = $('punchFeedback');
    if (!el) return;
    el.className = 'punch-feedback punch-feedback-placeholder';
    el.innerHTML = '';
}

function resolveSubjectFromScan(normalized) {
    if (!normalized) return Promise.resolve(null);

    if (isValidGymPublicId(normalized)) {
        return db
            .collection('gymPublicIds')
            .doc(normalized)
            .get()
            .then(function(reg) {
                if (!reg.exists) return null;
                var uid = reg.data().uid;
                if (!uid) return null;
                return loadMemberOrTrainerProfile(uid, normalized);
            });
    }

    if (normalized.length >= 10 && normalized.length <= 128) {
        return loadMemberOrTrainerProfile(normalized, '');
    }

    return Promise.resolve(null);
}

function loadMemberOrTrainerProfile(uid, gymPublicId) {
    return db
        .collection('members')
        .doc(uid)
        .get()
        .then(function(m) {
            if (m.exists) {
                var md = m.data();
                return {
                    uid: uid,
                    role: 'member',
                    gymPublicId: (md.gymPublicId && isValidGymPublicId(md.gymPublicId) ? md.gymPublicId : gymPublicId) || '',
                    displayName: (md.displayName && String(md.displayName).trim()) || md.email || 'Member',
                    email: (md.email && String(md.email)) || ''
                };
            }
            return db
                .collection('trainers')
                .doc(uid)
                .get()
                .then(function(t) {
                    if (!t.exists) return null;
                    var td = t.data();
                    return {
                        uid: uid,
                        role: 'trainer',
                        gymPublicId:
                            (td.gymPublicId && isValidGymPublicId(td.gymPublicId) ? td.gymPublicId : gymPublicId) || '',
                        displayName: (td.displayName && String(td.displayName).trim()) || td.email || 'Trainer',
                        email: (td.email && String(td.email)) || ''
                    };
                });
        });
}

function runPunchTransaction(person) {
    var dateKey = localDateKey();
    var col = db.collection('gymPunchSessions');
    var ref = col.doc(dayPunchDocId(person.uid, dateKey));
    var Fdel = firebase.firestore.FieldValue.delete();

    return db.runTransaction(function(transaction) {
        return transaction.get(ref).then(function(snap) {
            if (!snap.exists) {
                transaction.set(ref, {
                    subjectUid: person.uid,
                    role: person.role,
                    gymPublicId: person.gymPublicId || '',
                    displayName: person.displayName,
                    email: person.email || '',
                    dateKey: dateKey,
                    kioskSource: 'public',
                    currentCheckIn: firebase.firestore.FieldValue.serverTimestamp(),
                    completedVisits: []
                });
                return { action: 'in', visitNumber: 1 };
            }

            var data = snap.data();
            var completed = Array.isArray(data.completedVisits) ? data.completedVisits.slice() : [];
            var cur = data.currentCheckIn != null ? data.currentCheckIn : null;
            var isVisitModel = Array.isArray(data.completedVisits);
            var hadLegacyShape = !isVisitModel;

            if (hadLegacyShape) {
                if (data.status === 'open' && data.checkInAt) {
                    cur = data.checkInAt;
                    completed = [];
                } else if (data.status === 'completed' && data.checkInAt) {
                    cur = null;
                    completed = [
                        {
                            checkInAt: data.checkInAt,
                            checkOutAt: data.checkOutAt,
                            minutesOnSite: data.minutesOnSite
                        }
                    ];
                }
            }

            if (cur != null) {
                var cinMs = Date.now();
                if (cur && typeof cur.toMillis === 'function') cinMs = cur.toMillis();
                var mins = Math.max(0, Math.round((Date.now() - cinMs) / 60000));
                var newVisits = completed.concat([
                    {
                        checkInAt: cur,
                        checkOutAt: firebase.firestore.FieldValue.serverTimestamp(),
                        minutesOnSite: mins
                    }
                ]);

                var patch = {
                    completedVisits: newVisits,
                    currentCheckIn: null
                };

                if (hadLegacyShape && data.status === 'open') {
                    patch.status = Fdel;
                    patch.checkInAt = Fdel;
                }

                transaction.update(ref, patch);
                return { action: 'out', minutesOnSite: mins, visitNumber: newVisits.length };
            }

            if (hadLegacyShape && data.status === 'completed') {
                transaction.update(ref, {
                    currentCheckIn: firebase.firestore.FieldValue.serverTimestamp(),
                    completedVisits: completed,
                    status: Fdel,
                    checkInAt: Fdel,
                    checkOutAt: Fdel,
                    minutesOnSite: Fdel
                });
                return { action: 'in', visitNumber: completed.length + 1 };
            }

            transaction.update(ref, {
                currentCheckIn: firebase.firestore.FieldValue.serverTimestamp()
            });
            return { action: 'in', visitNumber: completed.length + 1 };
        });
    });
}

function formatHoursMins(totalMins) {
    if (totalMins == null || isNaN(totalMins)) return '—';
    var h = Math.floor(totalMins / 60);
    var m = totalMins % 60;
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
}

function processScanPayload(raw) {
    if (scanBusy) return;
    var norm = normalizeScanPayload(raw);
    if (!norm) {
        showFeedback('err', 'Empty scan. Try again.');
        return;
    }

    scanBusy = true;
    clearFeedback();
    showFeedback('ok', '<span class="text-white-50"><i class="fas fa-spinner fa-spin me-2"></i>Processing…</span>');

    resolveSubjectFromScan(norm)
        .then(function(person) {
            if (!person) {
                showFeedback(
                    'err',
                    'Unknown ID. Use your GymDD digital ID barcode/QR or a valid 6-character Gym ID.'
                );
                return null;
            }
            return runPunchTransaction(person).then(function(result) {
                return { person: person, result: result };
            });
        })
        .then(function(ctx) {
            if (!ctx) return;
            var person = ctx.person;
            var result = ctx.result;

            if (result.action === 'err') {
                showFeedback('err', esc(result.message || 'Could not punch.'));
                return;
            }

            if (result.action === 'in') {
                var vin = result.visitNumber != null ? result.visitNumber : 1;
                showFeedback(
                    'ok',
                    '<span class="punch-feedback-name">' +
                        esc(person.displayName) +
                        '</span><span class="punch-feedback-status">Check-in</span>' +
                        '<span class="punch-feedback-hint text-white-50">Visit ' +
                        esc(String(vin)) +
                        ' — you are <strong>checked in</strong>.</span>' +
                        '<span class="punch-feedback-hint text-white-50 d-block">Next scan will <strong>check you out</strong>.</span>'
                );
                scheduleOkFeedbackHide(1400);
            } else if (result.action === 'out') {
                var hm =
                    typeof result.minutesOnSite === 'number'
                        ? formatHoursMins(result.minutesOnSite)
                        : '—';
                var vout = result.visitNumber != null ? result.visitNumber : 1;
                showFeedback(
                    'ok',
                    '<span class="punch-feedback-name">' +
                        esc(person.displayName) +
                        '</span><span class="punch-feedback-status">Check-out</span>' +
                        '<span class="punch-feedback-hint text-white-50">Visit ' +
                        esc(String(vout)) +
                        ' — <strong>checked out</strong>. This visit: <strong>' +
                        esc(hm) +
                        '</strong>.</span>' +
                        '<span class="punch-feedback-hint text-white-50 d-block">Next scan will <strong>check you in</strong> again.</span>'
                );
                scheduleOkFeedbackHide(1400);
            }
        })
        .catch(function(err) {
            console.error(err);
            showFeedback('err', (err && err.message) || 'Could not record punch.');
        })
        .finally(function() {
            scanBusy = false;
            refocusWedge();
        });
}

function stopPunchQr() {
    if (!punchHtml5Qr) return;
    var inst = punchHtml5Qr;
    punchHtml5Qr = null;
    inst.stop()
        .then(function() {
            inst.clear();
        })
        .catch(function() {
            try {
                inst.clear();
            } catch (e) {
                /* ignore */
            }
        });
}

function loadHtml5QrScript(cb) {
    if (typeof Html5Qrcode !== 'undefined') {
        cb();
        return;
    }
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.async = true;
    s.onload = function() {
        cb();
    };
    s.onerror = function() {
        showFeedback('err', 'Could not load camera scanner library.');
    };
    document.body.appendChild(s);
}

function startPunchQr() {
    var hostId = 'punchQrReader';
    if (!$(hostId)) return;
    loadHtml5QrScript(function() {
        if (typeof Html5Qrcode === 'undefined') return;
        stopPunchQr();
        punchHtml5Qr = new Html5Qrcode(hostId);
        var boxHost = $(hostId);
        var boxW =
            boxHost && boxHost.clientWidth
                ? Math.min(Math.max(Math.floor(boxHost.clientWidth * 0.82), 120), 200)
                : 160;
        var qrDims = { width: boxW, height: Math.min(boxW, 200) };
        punchHtml5Qr
            .start(
                { facingMode: 'environment' },
                { fps: 8, qrbox: qrDims },
                function(decoded) {
                    stopPunchQr();
                    processScanPayload(decoded);
                },
                function() {}
            )
            .catch(function(err) {
                punchHtml5Qr = null;
                showFeedback('err', (err && err.message) || 'Camera failed.');
            });
    });
}

function updateDonutClock() {
    var now = new Date();
    var prog = $('punchDonutProg');
    if (prog) {
        var sec = now.getSeconds() + now.getMilliseconds() / 1000;
        var frac = sec / 60;
        if (!prog.getAttribute('data-dash')) {
            prog.setAttribute('data-dash', '1');
            prog.style.strokeDasharray = DONUT_C + ' ' + DONUT_C;
        }
        prog.style.strokeDashoffset = String(DONUT_C * (1 - frac));
    }
    var timeEl = $('punchClockTime');
    var dateEl = $('punchClockDate');
    if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
}

function alternativesUiOpen() {
    var m = $('punchAltModal');
    return !!(m && m.classList.contains('show'));
}

function focusShouldStayOutOfHiddenWedge() {
    var ae = document.activeElement;
    if (!ae || ae === document.body) return false;
    if (ae.id === 'punchWedgeInput') return false;
    if (alternativesUiOpen()) return true;
    if (ae.id === 'punchManualId') return true;
    var tag = (ae.nodeName || '').toLowerCase();
    if (tag === 'button' || tag === 'a' || tag === 'select' || tag === 'textarea') return true;
    if (tag === 'input' && ae.id !== 'punchWedgeInput') return true;
    return false;
}

function refocusWedge() {
    if (alternativesUiOpen()) return;
    if (focusShouldStayOutOfHiddenWedge()) return;
    var w = $('punchWedgeInput');
    if (w) w.focus();
}

function wireUi() {
    var wedge = $('punchWedgeInput');
    if (wedge) {
        wedge.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var v = wedge.value;
                wedge.value = '';
                processScanPayload(v);
            }
        });
    }

    if ($('btnPunchManual')) {
        $('btnPunchManual').addEventListener('click', function() {
            var v = $('punchManualId') ? $('punchManualId').value : '';
            processScanPayload(v);
        });
    }

    var manualEl = $('punchManualId');
    if (manualEl) {
        manualEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if ($('btnPunchManual')) $('btnPunchManual').click();
            }
        });
    }

    var altModal = $('punchAltModal');
    if (altModal) {
        altModal.addEventListener('hidden.bs.modal', function() {
            stopPunchQr();
            if ($('punchManualId')) $('punchManualId').value = '';
            refocusWedge();
        });
    }

    if ($('btnPunchStartCam')) {
        $('btnPunchStartCam').addEventListener('click', function() {
            clearFeedback();
            startPunchQr();
        });
    }
    if ($('btnPunchStopCam')) {
        $('btnPunchStopCam').addEventListener('click', function() {
            stopPunchQr();
            refocusWedge();
        });
    }

    var app = $('punchApp');
    if (app) {
        app.addEventListener(
            'pointerdown',
            function(e) {
                if (alternativesUiOpen()) return;
                var tgt = e.target;
                if (tgt.closest && tgt.closest('.punch-corner-cam')) return;
                requestAnimationFrame(function() {
                    refocusWedge();
                });
            },
            false
        );
    }

    if (!wedgeFocusTimer) {
        wedgeFocusTimer = setInterval(refocusWedge, 400);
    }
}

wireUi();
updateDonutClock();
clockTimer = setInterval(updateDonutClock, 250);
refocusWedge();

window.addEventListener('beforeunload', function() {
    stopPunchQr();
    if (wedgeFocusTimer) clearInterval(wedgeFocusTimer);
});
window.addEventListener('focus', refocusWedge);
