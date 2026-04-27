/* ═══════════════════════════════════════
   GymDD — Login / register → dashboard redirect
   ═══════════════════════════════════════ */

import { firebaseConfig } from './firebase-config.js';

firebase.initializeApp(firebaseConfig);

var auth = firebase.auth();
var db   = firebase.firestore();

var $ = function(id) { return document.getElementById(id); };

var authGate   = $('authGate');
var postAuth   = $('postAuth');
var redirectPanel = $('redirectPanel');
var verifyPanel   = $('verifyPanel');
var trainerPendingPanel = $('trainerPendingPanel');
var userEmail  = $('userEmail');
var btnLogout  = $('btnLogout');

var loginForm      = $('loginForm');
var registerForm   = $('registerForm');
var trainerRegForm = $('trainerRegForm');
var loginTab       = $('loginTab');
var registerTab    = $('registerTab');
var trainerRegTab  = $('trainerRegTab');
var authAlert      = $('authAlert');

var allAuthForms = [loginForm, registerForm, trainerRegForm].filter(Boolean);
var allAuthTabs  = [loginTab, registerTab, trainerRegTab].filter(Boolean);

function setPostAuthPanels(showRedirect, showVerify, showTrainerPending) {
    if (redirectPanel) redirectPanel.classList.toggle('d-none', !showRedirect);
    if (verifyPanel) verifyPanel.classList.toggle('d-none', !showVerify);
    if (trainerPendingPanel) trainerPendingPanel.classList.toggle('d-none', !showTrainerPending);
}

function switchAuthTab(activeTab, activeForm) {
    if (!activeTab || !activeForm || !authAlert) return;
    allAuthTabs.forEach(function(t) { t.classList.remove('active'); });
    allAuthForms.forEach(function(f) { f.classList.add('d-none'); });
    activeTab.classList.add('active');
    activeForm.classList.remove('d-none');
    authAlert.classList.add('d-none');
}

if (loginTab && loginForm) {
    loginTab.addEventListener('click', function() { switchAuthTab(loginTab, loginForm); });
}
if (registerTab && registerForm) {
    registerTab.addEventListener('click', function() { switchAuthTab(registerTab, registerForm); });
}
if (trainerRegTab && trainerRegForm) {
    trainerRegTab.addEventListener('click', function() { switchAuthTab(trainerRegTab, trainerRegForm); });
}

if (window.location.hash === '#register' && registerTab && registerForm) {
    switchAuthTab(registerTab, registerForm);
} else if (window.location.hash === '#trainer' && trainerRegTab && trainerRegForm) {
    switchAuthTab(trainerRegTab, trainerRegForm);
}

function showAlert(el, msg, type) {
    if (!el) return;
    el.className = 'alert alert-' + type;
    el.textContent = msg;
    el.classList.remove('d-none');
}

/* ─── Auth: Login ─── */
if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var email = $('loginEmail').value.trim();
        var pass  = $('loginPass').value;
        auth.signInWithEmailAndPassword(email, pass)
            .catch(function(err) { showAlert(authAlert, err.message, 'danger'); });
    });
}

/* ─── Auth: Member Register ─── */
if (registerForm) {
    registerForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var name  = $('regName').value.trim();
        var email = $('regEmail').value.trim();
        var phone = $('regPhone').value.trim();
        var pass  = $('regPass').value;

        if (pass.length < 6) {
            showAlert(authAlert, 'Password must be at least 6 characters.', 'warning');
            return;
        }

        auth.createUserWithEmailAndPassword(email, pass)
            .then(function(cred) {
                return db.collection('members').doc(cred.user.uid).set({
                    displayName: name,
                    email: email,
                    phone: phone,
                    plan: 'Basic',
                    approvalStatus: 'pending',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }).then(function() { return cred.user.sendEmailVerification(); });
            })
            .catch(function(err) { showAlert(authAlert, err.message, 'danger'); });
    });
}

/* ─── Auth: Trainer Register ─── */
if (trainerRegForm) {
    trainerRegForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var name   = $('tRegName').value.trim();
        var email  = $('tRegEmail').value.trim();
        var phone  = $('tRegPhone').value.trim();
        var spec   = $('tRegSpecialization').value;
        var exp    = parseInt($('tRegExperience').value, 10) || 0;
        var qual   = $('tRegQualifications').value.trim();
        var bio    = $('tRegBio').value.trim();
        var pass   = $('tRegPass').value;
        var pass2  = $('tRegPassConfirm') ? $('tRegPassConfirm').value : '';

        if (pass.length < 6) {
            showAlert(authAlert, 'Password must be at least 6 characters.', 'warning');
            return;
        }
        if (pass !== pass2) {
            showAlert(authAlert, 'Passwords do not match.', 'warning');
            return;
        }

        auth.createUserWithEmailAndPassword(email, pass)
            .then(function(cred) {
                return db.collection('trainers').doc(cred.user.uid).set({
                    displayName: name,
                    email: email,
                    phone: phone,
                    specialization: spec,
                    experience: exp,
                    qualifications: qual,
                    bio: bio,
                    approvalStatus: 'pending',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }).then(function() { return cred.user.sendEmailVerification(); });
            })
            .catch(function(err) { showAlert(authAlert, err.message, 'danger'); });
    });
}

/* ─── Forgot password ─── */
var forgotPassLink = $('forgotPassLink');
var forgotPassBox  = $('forgotPassBox');
var backToLogin    = $('backToLogin');
var btnSendReset   = $('btnSendReset');
var resetAlert     = $('resetAlert');

if (forgotPassLink && loginForm && forgotPassBox) {
    forgotPassLink.addEventListener('click', function(e) {
        e.preventDefault();
        loginForm.classList.add('d-none');
        forgotPassBox.classList.remove('d-none');
        if (resetAlert) resetAlert.classList.add('d-none');
    });
}
if (backToLogin && loginForm && forgotPassBox) {
    backToLogin.addEventListener('click', function(e) {
        e.preventDefault();
        forgotPassBox.classList.add('d-none');
        loginForm.classList.remove('d-none');
    });
}
if (btnSendReset) {
    btnSendReset.addEventListener('click', function() {
        var email = $('resetEmail') ? $('resetEmail').value.trim() : '';
        if (!email) {
            showAlert(resetAlert, 'Enter your email.', 'warning');
            return;
        }
        auth.sendPasswordResetEmail(email)
            .then(function() {
                showAlert(resetAlert, 'Check your inbox for the reset link.', 'success');
            })
            .catch(function(err) {
                showAlert(resetAlert, err.message, 'danger');
            });
    });
}

/* ─── Email verification ─── */
var btnResendVerify = $('btnResendVerify');
var btnCheckVerify  = $('btnCheckVerify');
var verifyAlert     = $('verifyAlert');

if (btnResendVerify) {
    btnResendVerify.addEventListener('click', function() {
        var u = auth.currentUser;
        if (!u) return;
        u.sendEmailVerification()
            .then(function() {
                if (verifyAlert) showAlert(verifyAlert, 'Verification email sent.', 'success');
            })
            .catch(function(err) {
                if (verifyAlert) showAlert(verifyAlert, err.message, 'danger');
            });
    });
}
if (btnCheckVerify) {
    btnCheckVerify.addEventListener('click', function() {
        var u = auth.currentUser;
        if (!u) return;
        u.reload()
            .then(function() {
                if (auth.currentUser.emailVerified) {
                    routeAfterLogin(auth.currentUser);
                } else if (verifyAlert) {
                    showAlert(verifyAlert, 'Email not verified yet.', 'warning');
                }
            })
            .catch(function(err) {
                if (verifyAlert) showAlert(verifyAlert, err.message, 'danger');
            });
    });
}

function routeAfterLogin(user) {
    var uid = user.uid;
    if (postAuth) postAuth.classList.remove('d-none');

    if (!user.emailVerified) {
        setPostAuthPanels(false, true, false);
        var ve = $('verifyEmailAddr');
        if (ve) ve.textContent = user.email || '';
        return;
    }

    setPostAuthPanels(true, false, false);

    db.collection('admins').doc(uid).get()
        .then(function(adminDoc) {
            if (adminDoc.exists) {
                window.location.href = 'admin.html';
                return null;
            }
            return db.collection('users').doc(uid).get();
        })
        .then(function(uDoc) {
            if (!uDoc) return null;
            if (uDoc.exists) {
                var role = uDoc.data().role;
                if (role === 'admin') {
                    window.location.href = 'admin.html';
                    return null;
                }
                if (role === 'trainer') {
                    window.location.href = 'trainer.html';
                    return null;
                }
            }
            return db.collection('trainers').doc(uid).get();
        })
        .then(function(tDoc) {
            if (!tDoc) return;
            if (tDoc.exists) {
                var status = tDoc.data().approvalStatus;
                if (status === 'approved') {
                    window.location.href = 'trainer.html';
                    return;
                }
                setPostAuthPanels(false, false, true);
                var colors = { pending: 'warning', rejected: 'danger' };
                var label  = (status || 'pending').charAt(0).toUpperCase() + (status || 'pending').slice(1);
                var el = $('trainerPendingStatus');
                if (el) {
                    el.innerHTML =
                        '<span class="badge bg-' + (colors[status] || 'secondary') + ' fs-6">' + label + '</span>';
                }
                return;
            }
            window.location.href = 'member.html';
        })
        .catch(function(err) {
            console.error(err);
            if (authAlert) {
                authGate.classList.remove('d-none');
                if (postAuth) postAuth.classList.add('d-none');
                showAlert(authAlert, err.message || 'Could not finish sign-in. Try again.', 'danger');
            }
        });
}

/* ─── Auth state listener ─── */
auth.onAuthStateChanged(function(user) {
    if (!user) {
        if (authGate) authGate.classList.remove('d-none');
        if (postAuth) postAuth.classList.add('d-none');
        if (userEmail) userEmail.classList.add('d-none');
        if (btnLogout) btnLogout.classList.add('d-none');
        return;
    }
    if (authGate) authGate.classList.add('d-none');
    if (userEmail) {
        userEmail.textContent = user.email || '';
        userEmail.classList.remove('d-none');
    }
    if (btnLogout) btnLogout.classList.remove('d-none');
    routeAfterLogin(user);
});

if (btnLogout) {
    btnLogout.addEventListener('click', function() {
        auth.signOut();
    });
}
