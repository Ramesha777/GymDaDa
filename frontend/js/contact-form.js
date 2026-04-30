/**
 * Home page Contact section — submits to Firestore `contactMessages` (admin dashboard).
 */
import { firebaseConfig } from './firebase-config.js';

var fb = typeof window !== 'undefined' ? window.firebase : null;
var db = null;

if (!fb || typeof fb.firestore !== 'function') {
    console.warn('Firebase Firestore not loaded; contact form disabled.');
} else {
    try {
        if (!fb.apps.length) fb.initializeApp(firebaseConfig);
        db = fb.firestore();
    } catch (e) {
        console.warn('Firebase init failed:', e);
    }
}

var form = document.getElementById('contactForm');
var feedback = document.getElementById('contactFormFeedback');

function showFeedback(kind, msg) {
    if (!feedback) return;
    feedback.textContent = msg || '';
    feedback.classList.remove(
        'contact-form-feedback--ok',
        'contact-form-feedback--err',
        'contact-form-feedback--idle'
    );
    if (!msg) feedback.classList.add('contact-form-feedback--idle');
    else
        feedback.classList.add(kind === 'ok' ? 'contact-form-feedback--ok' : 'contact-form-feedback--err');
}

if (form && db) {
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        var fd = new FormData(form);
        var name = (fd.get('name') || '').trim();
        var email = (fd.get('email') || '').trim();
        var phone = String(fd.get('phone') || '').trim().substring(0, 60);
        var message = (fd.get('message') || '').trim();

        if (!name.length || email.length < 5 || message.length < 1) {
            showFeedback(
                'err',
                'Please enter your name, a valid email, and a message.'
            );
            return;
        }

        var btn = document.getElementById('contactFormSubmit');
        if (btn) {
            btn.disabled = true;
            btn.dataset._label = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending…';
        }
        showFeedback('idle', '');

        db.collection('contactMessages')
            .add({
                name: name.substring(0, 200),
                email: email.substring(0, 254),
                phone: phone,
                message: message.substring(0, 5000),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            })
            .then(function() {
                form.reset();
                showFeedback(
                    'ok',
                    'Thank you — we received your message and will reply soon.'
                );
            })
            .catch(function(err) {
                console.error(err);
                showFeedback(
                    'err',
                    (err && err.message) ||
                        'Could not send right now. Please try again later or email us directly.'
                );
            })
            .finally(function() {
                if (!btn) return;
                btn.disabled = false;
                if (btn.dataset._label) btn.innerHTML = btn.dataset._label;
            });
    });
}
