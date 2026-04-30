import { firebaseConfig } from './firebase-config.js';
import { getPlan, priceFor, fakeTxnId } from './plans.js';
import { isMemberPlanActive } from './membership-utils.js';

firebase.initializeApp(firebaseConfig);
var auth = firebase.auth();
var db = firebase.firestore();

var $ = function(id) { return document.getElementById(id); };
var qs = function(sel, root) { return (root || document).querySelector(sel); };
var qsa = function(sel, root) { return (root || document).querySelectorAll(sel); };

/* ─── State ─── */
var params = new URLSearchParams(window.location.search);
var planId = params.get('plan');
var period = params.get('period') === 'yearly' ? 'yearly' : 'monthly';
var plan = planId ? getPlan(planId) : null;

var currentUser = null;     // firebase.User
var memberData = {};        // member doc data (or {} if none)
var currentMethod = 'apple';
var creditUsed = 0;         // amount of saved credit applied to current purchase
var pendingPurchase = null; // captured between Purchase → Confirm clicks
var checkoutInitDone = false;

/* ═══════════════════════════════════════
   ENTRY POINT
   ═══════════════════════════════════════ */
if (!plan) {
    showOnly('invalidState');
} else {
    initCheckout();
    auth.onAuthStateChanged(handleAuth);
}

/* ═══════════════════════════════════════
   AUTH GATE
   ═══════════════════════════════════════ */
function handleAuth(user) {
    currentUser = user;
    if (!user) { showAuthRequired(); return; }
    if (!user.emailVerified) {
        showBlocked(
            'Verify your email first',
            'We sent a verification link to <strong>' + escapeHtml(user.email) + '</strong>. ' +
            'Open it, then return here to complete your purchase.'
        );
        return;
    }

    db.collection('admins').doc(user.uid).get().then(function(adminDoc) {
        if (adminDoc.exists) {
            showBlocked('Member account required',
                'You are signed in as an <strong>admin</strong>. Sign out and use a member account to purchase a plan.');
            return;
        }

        return db.collection('users').doc(user.uid).get().then(function(uDoc) {
            if (uDoc && uDoc.exists) {
                var role = uDoc.data().role;
                if (role === 'admin' || role === 'trainer') {
                    showBlocked('Member account required',
                        'You are signed in as a <strong>' + role + '</strong>. Sign out and use a member account to purchase a plan.');
                    return;
                }
            }

            return db.collection('trainers').doc(user.uid).get().then(function(tDoc) {
                if (tDoc.exists) {
                    showBlocked('Member account required',
                        'You are signed in as a <strong>trainer</strong>. Sign out and use a member account to purchase a plan.');
                    return;
                }
                routeMember(user);
            });
        });
    }).catch(function(err) {
        console.error('Auth/role check failed', err);
        showBlocked('Unable to verify your account', err.message || 'Please try again.');
    });
}

/* ─── Once role passes, decide where to land based on existing plan ─── */
function routeMember(user) {
    setUserPill(user);

    db.collection('members').doc(user.uid).get().then(function(doc) {
        memberData = doc.exists ? (doc.data() || {}) : {};

        if (isMemberPlanActive(memberData)) {
            if (memberData.planId === plan.id) {
                showSamePlanState();
                return;
            }
            showPlanChangeConfirmState();
            return;
        }
        revealCheckout();
    }).catch(function(err) {
        // Best-effort: don't block purchase if we can't read the doc
        console.error('Failed to read member doc:', err);
        memberData = {};
        revealCheckout();
    });
}

/* ─── Show / hide top-level page sections ─── */
function showOnly(id) {
    [
        'authLoading', 'authRequired', 'authBlocked', 'invalidState',
        'samePlanState', 'planChangeConfirm', 'checkoutWrap'
    ].forEach(function(elId) {
        var el = $(elId);
        if (el) el.hidden = (elId !== id);
    });
}

function showAuthRequired() {
    if (plan) {
        $('authPlanName').textContent = plan.name + ' (' + (period === 'yearly' ? 'Yearly' : 'Monthly') + ')';
        var p = priceFor(plan, period);
        $('authPlanPrice').textContent = plan.currencySymbol + p.total.toFixed(2) +
            ' ' + (period === 'yearly' ? 'per year' : 'per month');
    }
    var nextUrl = encodeURIComponent('payment.html' + window.location.search);
    $('authSignInBtn').href = 'login.html?next=' + nextUrl;
    $('authRegisterBtn').href = 'login.html?tab=register&next=' + nextUrl;
    showOnly('authRequired');
    setUserPill(null);
}

function showBlocked(title, htmlBody) {
    $('blockedTitle').textContent = title;
    $('blockedMessage').innerHTML = htmlBody;
    showOnly('authBlocked');
    setUserPill(currentUser);
}

function showSamePlanState() {
    var label = (memberData.plan || plan.name) +
        ' (' + (memberData.planPeriod === 'yearly' ? 'Yearly' : 'Monthly') + ')';
    $('samePlanName').textContent = label;
    showOnly('samePlanState');
}

function showPlanChangeConfirmState() {
    var newP = priceFor(plan, period);
    var refund = computeRefund();

    $('currentPlanName').textContent = memberData.plan || '—';
    var curPrice = (typeof memberData.planAmountTotal === 'number')
        ? fmt(memberData.planAmountTotal)
        : '—';
    var curPeriod = memberData.planPeriod === 'yearly' ? 'per year' : 'per month';
    $('currentPlanPrice').textContent = curPrice + ' ' + curPeriod;

    var meta = 'Active';
    if (memberData.planExpiresAt && memberData.planExpiresAt.toMillis) {
        var ms = memberData.planExpiresAt.toMillis() - Date.now();
        var days = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
        meta = days + ' day' + (days === 1 ? '' : 's') + ' left';
    }
    $('currentPlanMeta').textContent = meta;

    $('newPlanName').textContent = plan.name;
    $('newPlanPrice').textContent = fmt(newP.total) + ' ' + (period === 'yearly' ? 'per year' : 'per month');

    if (refund > 0) {
        $('changeRefundText').innerHTML =
            'Your old plan still has <strong>' + fmt(refund) + '</strong> of unused value. ' +
            'After confirming the new payment you can choose to <strong>refund</strong> ' +
            'this amount or <strong>save it as credit</strong> for a future purchase.';
        $('changeRefundNote').hidden = false;
    } else {
        $('changeRefundNote').hidden = true;
    }

    showOnly('planChangeConfirm');
}

function revealCheckout() {
    updateTotals();
    showOnly('checkoutWrap');
    if (!checkoutInitDone) checkoutInitDone = true;
}

/* ─── User pill in topbar ─── */
function setUserPill(user) {
    var pill = $('payUser');
    if (!user) { pill.hidden = true; return; }
    $('payUserEmail').textContent = user.email || '';
    pill.hidden = false;
}

$('payLogoutBtn').addEventListener('click', function() { auth.signOut(); });
$('blockedLogoutBtn').addEventListener('click', function() { auth.signOut(); });

/* ═══════════════════════════════════════
   CHECKOUT INIT (UI handlers — auth-independent)
   ═══════════════════════════════════════ */
function initCheckout() {
    renderPlan();
    bindPeriodToggle();
    bindMethodTabs();
    bindCardInputs();
    bindCreditCheckbox();
    bindPurchase();
    bindModal();
    bindPlanChangeConfirm();
    bindRefundChoice();
}

function bindCreditCheckbox() {
    var chk = $('chkApplyAccountCredit');
    if (!chk) return;
    chk.addEventListener('change', function() {
        updateTotals();
    });
}

function bindPlanChangeConfirm() {
    $('btnConfirmChange').addEventListener('click', function() {
        revealCheckout();
    });
}

function renderPlan() {
    $('planName').textContent = plan.name;
    $('planBadge').textContent = plan.badge;
    $('planTagline').textContent = plan.tagline;
    $('planIdLabel').textContent = 'ID: ' + plan.id;
    $('planIcon').innerHTML = '<i class="fas ' + plan.icon + '"></i>';
    $('planIcon').style.background = hexToRgba(plan.accent, 0.16);
    $('planIcon').style.color = plan.accent;

    var featuresHtml = plan.features.map(function(f) {
        return '<li><i class="fas fa-check"></i><span>' + f + '</span></li>';
    }).join('');
    $('planFeatures').innerHTML = featuresHtml;

    qsa('.pay-period-btn').forEach(function(btn) {
        var active = btn.dataset.period === period;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    updateTotals();
}

function updateTotals() {
    var p = priceFor(plan, period);
    var availCredit = memberData && typeof memberData.planCredit === 'number' ? Math.max(0, memberData.planCredit) : 0;
    var chk = $('chkApplyAccountCredit');
    var promptBox = $('creditPromptBox');
    var promptText = $('creditPromptText');
    var promptFoot = $('creditPromptFoot');
    var wantCredit = !!(chk && chk.checked);

    if (availCredit > 0) {
        var maxApply = +(Math.min(availCredit, p.total)).toFixed(2);
        if (promptBox) promptBox.hidden = false;
        if (promptText) {
            promptText.innerHTML =
                'You have <strong>' + fmt(availCredit) + '</strong> in account credit from a previous refund or adjustment. ' +
                'Choose whether to apply it to this order (up to <strong>' + fmt(maxApply) + '</strong> for this plan).';
        }
        if (promptFoot) {
            promptFoot.textContent = wantCredit
                ? 'Applied amount cannot exceed your order total. Remaining credit stays on your account.'
                : 'Check the box to reduce what you pay now using your saved credit (up to the order total).';
        }
        creditUsed = wantCredit ? maxApply : 0;
    } else {
        if (promptBox) promptBox.hidden = true;
        if (chk) chk.checked = false;
        creditUsed = 0;
    }

    creditUsed = +creditUsed.toFixed(2);
    var totalDue = +(p.total - creditUsed).toFixed(2);

    $('sumSubtotal').textContent = fmt(p.subtotal);
    $('sumTax').textContent = fmt(p.tax);

    if (creditUsed > 0) {
        $('sumCredit').textContent = '−' + fmt(creditUsed);
        $('creditRow').hidden = false;
    } else {
        $('creditRow').hidden = true;
    }

    $('sumTotal').textContent = fmt(totalDue);
    $('sumTotalLabel').textContent = p.label;
    $('purchaseAmount').textContent = fmt(totalDue);
}

function bindPeriodToggle() {
    qsa('.pay-period-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            qsa('.pay-period-btn').forEach(function(b) {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            this.classList.add('active');
            this.setAttribute('aria-selected', 'true');
            period = this.dataset.period;

            var url = new URL(window.location.href);
            url.searchParams.set('period', period);
            window.history.replaceState({}, '', url);

            updateTotals();
        });
    });
}

function bindMethodTabs() {
    qsa('.pay-method-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            qsa('.pay-method-tab').forEach(function(t) {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            this.classList.add('active');
            this.setAttribute('aria-selected', 'true');

            currentMethod = this.dataset.method;
            qsa('.pay-panel').forEach(function(panel) {
                var match = panel.dataset.panel === currentMethod;
                panel.classList.toggle('active', match);
                panel.hidden = !match;
            });
        });
    });
}

/* ═══════════════════════════════════════
   VISA CARD INPUTS
   ═══════════════════════════════════════ */
function bindCardInputs() {
    var nameEl = $('cardName');
    var numEl = $('cardNumber');
    var expEl = $('cardExp');
    var cvvEl = $('cardCvv');

    var prevName = $('cardPreviewName');
    var prevNum = $('cardPreviewNumber');
    var prevExp = $('cardPreviewExp');

    nameEl.addEventListener('input', function() {
        prevName.textContent = this.value.trim() ? this.value.toUpperCase() : 'FULL NAME';
        clearError(this);
    });

    numEl.addEventListener('input', function() {
        var digits = this.value.replace(/\D/g, '').slice(0, 19);
        var formatted = digits.match(/.{1,4}/g);
        this.value = formatted ? formatted.join(' ') : '';
        prevNum.textContent = pad19(digits) || '•••• •••• •••• ••••';
        clearError(this);
    });

    expEl.addEventListener('input', function() {
        var d = this.value.replace(/\D/g, '').slice(0, 4);
        if (d.length >= 3) this.value = d.slice(0, 2) + '/' + d.slice(2);
        else this.value = d;
        prevExp.textContent = this.value || 'MM/YY';
        clearError(this);
    });

    cvvEl.addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '').slice(0, 4);
        clearError(this);
    });
}

function pad19(digits) {
    if (!digits) return '';
    var padded = digits.padEnd(16, '•');
    return padded.match(/.{1,4}/g).join(' ');
}

function clearError(input) {
    var field = input.closest('.pay-field');
    if (field) field.classList.remove('invalid');
    var err = qs('.pay-error[data-for="' + input.id + '"]');
    if (err) err.textContent = '';
}

function setError(inputId, message) {
    var input = $(inputId);
    if (input) {
        var field = input.closest('.pay-field');
        if (field) field.classList.add('invalid');
    }
    var err = qs('.pay-error[data-for="' + inputId + '"]');
    if (err) err.textContent = message;
}

function validateVisa() {
    var ok = true;

    var name = $('cardName').value.trim();
    if (name.length < 2) { setError('cardName', 'Please enter the cardholder name.'); ok = false; }

    var number = $('cardNumber').value.replace(/\s/g, '');
    if (!/^\d{13,19}$/.test(number)) {
        setError('cardNumber', 'Card number must be 13–19 digits.');
        ok = false;
    }

    var exp = $('cardExp').value;
    var m = exp.match(/^(\d{2})\/(\d{2})$/);
    if (!m) {
        setError('cardExp', 'Format must be MM/YY.');
        ok = false;
    } else {
        var month = parseInt(m[1], 10);
        var year = parseInt(m[2], 10) + 2000;
        var now = new Date();
        var thisYear = now.getFullYear();
        var thisMonth = now.getMonth() + 1;
        if (month < 1 || month > 12) {
            setError('cardExp', 'Invalid month.');
            ok = false;
        } else if (year < thisYear || (year === thisYear && month < thisMonth)) {
            setError('cardExp', 'Card has expired.');
            ok = false;
        }
    }

    var cvv = $('cardCvv').value;
    if (!/^\d{3,4}$/.test(cvv)) {
        setError('cardCvv', 'CVV must be 3 or 4 digits.');
        ok = false;
    }
    return ok;
}

/* ═══════════════════════════════════════
   REFUND / DOWNGRADE COMPUTATION
   ═══════════════════════════════════════ */

/**
 * Returns the prorated value left on the user's previous plan
 * (only if they are switching to a *different* active plan).
 * 0 if N/A — same plan, expired, or no plan.
 */
function computeRefund() {
    if (!isMemberPlanActive(memberData)) return 0;
    if (memberData.planId === plan.id) return 0;

    var paid = +memberData.planAmountTotal || 0;
    if (paid <= 0) return 0;

    var aMs = memberData.planActivatedAt && memberData.planActivatedAt.toMillis
        ? memberData.planActivatedAt.toMillis() : null;
    var eMs = memberData.planExpiresAt && memberData.planExpiresAt.toMillis
        ? memberData.planExpiresAt.toMillis() : null;
    if (!aMs || !eMs || eMs <= aMs) return 0;

    var nowMs = Date.now();
    if (eMs <= nowMs) return 0;
    var ratio = Math.max(0, Math.min(1, (eMs - nowMs) / (eMs - aMs)));
    return +(paid * ratio).toFixed(2);
}

function describeRefundDestination(d) {
    var meth = d.lastPaymentMethod;
    var lf = d.lastPaymentCardLastFour;
    if (meth === 'visa') {
        return lf ? 'your <strong>Visa •••• ' + escapeHtml(lf) + '</strong>'
                  : 'your saved <strong>Visa Card</strong>';
    }
    if (meth === 'apple')  return 'your <strong>Apple Pay</strong> wallet';
    if (meth === 'google') return 'your <strong>Google Pay</strong> wallet';
    return 'your <strong>original payment method</strong>';
}

/* ═══════════════════════════════════════
   PURCHASE FLOW (Purchase → Confirm → [Refund choice] → Success)
   ═══════════════════════════════════════ */
function bindPurchase() {
    $('btnPurchase').addEventListener('click', function() {
        if (!ensureSignedIn()) return;
        if (currentMethod === 'visa' && !validateVisa()) return;
        runSimulation();
    });

    qsa('[data-pay]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            if (!ensureSignedIn()) return;
            currentMethod = this.dataset.pay;
            runSimulation();
        });
    });

    $('btnConfirmPayment').addEventListener('click', confirmPayment);
}

function ensureSignedIn() {
    if (!currentUser) { showAuthRequired(); return false; }
    return true;
}

/** Step 1: spinner on Purchase btn → open modal in REVIEW mode. */
function runSimulation() {
    updateTotals();

    var btn = $('btnPurchase');
    btn.disabled = true;
    qs('.pay-btn-label', btn).hidden = true;
    qs('.pay-btn-spinner', btn).hidden = false;

    setTimeout(function() {
        btn.disabled = false;
        qs('.pay-btn-label', btn).hidden = false;
        qs('.pay-btn-spinner', btn).hidden = true;

        var methodLabels = { apple: 'Apple Pay', google: 'Google Pay', visa: 'Visa Card' };
        var price = priceFor(plan, period);
        pendingPurchase = {
            price: price,
            txn: fakeTxnId(),
            method: currentMethod,
            methodLabel: methodLabels[currentMethod] || '—',
            cardLastFour: currentMethod === 'visa'
                ? ($('cardNumber').value.replace(/\s/g, '').slice(-4) || null)
                : null,
            creditUsed: creditUsed,
            amountCharged: +(price.total - creditUsed).toFixed(2)
        };
        showReviewModal(pendingPurchase);
    }, 1200);
}

/** Step 2: User clicked "Confirm Payment". */
function confirmPayment() {
    if (!pendingPurchase) return;
    var refund = computeRefund();
    pendingPurchase.refundAmount = refund;

    if (refund > 0) {
        showRefundChoiceStep(refund);
    } else {
        runFinalize($('btnConfirmPayment'), 'none', 0);
    }
}

function bindRefundChoice() {
    $('btnRefund').addEventListener('click', function() {
        runFinalize(this, 'refund', pendingPurchase ? pendingPurchase.refundAmount : 0);
    });
    $('btnSaveCredit').addEventListener('click', function() {
        runFinalize(this, 'credit', pendingPurchase ? pendingPurchase.refundAmount : 0);
    });
}

/** Performs the Firestore write and transitions to the success state. */
function runFinalize(triggerBtn, refundChoice, refundAmount) {
    var label = qs('.pay-btn-label', triggerBtn);
    var spinner = qs('.pay-btn-spinner', triggerBtn);
    setModalError('');

    var allBtns = qsa('#actionsReview .pay-btn, #actionsRefund .pay-btn');
    allBtns.forEach(function(b) { b.disabled = true; });
    if (label) label.hidden = true;
    if (spinner) spinner.hidden = false;

    // Snapshot info that depends on OLD memberData (refund destination)
    var snapshot = {
        choice: refundChoice,
        amount: refundAmount,
        destination: (refundChoice === 'refund' && refundAmount > 0)
            ? describeRefundDestination(memberData)
            : '',
        creditUsed: creditUsed
    };

    activatePlanInFirestore(refundChoice, refundAmount).then(function() {
        if (label) label.hidden = false;
        if (spinner) spinner.hidden = true;
        allBtns.forEach(function(b) { b.disabled = false; });
        showSuccessState(snapshot);
        pendingPurchase = null;
    }).catch(function(err) {
        console.error('Activation failed:', err);
        if (label) label.hidden = false;
        if (spinner) spinner.hidden = true;
        allBtns.forEach(function(b) { b.disabled = false; });
        setModalError(err.message || 'Could not finalize. Please try again.');
    });
}

function setModalError(msg) {
    var el = $('modalError');
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.innerHTML = '<i class="fas fa-circle-exclamation"></i> ' + escapeHtml(msg);
    el.hidden = false;
}

/** Calendar month/year from checkout moment — matches “monthly / yearly” wording. */
function computeMembershipExpiryTimestamp(billingPeriod) {
    var d = new Date();
    if (billingPeriod === 'yearly') {
        d.setFullYear(d.getFullYear() + 1);
    } else {
        d.setMonth(d.getMonth() + 1);
    }
    return firebase.firestore.Timestamp.fromDate(d);
}

/**
 * Persist a row for the member dashboard purchase history table.
 */
function appendMembershipLedgerEntry(ctx) {
    if (!currentUser || !plan || !pendingPurchase) return Promise.resolve();

    var entryType = 'purchase';
    if (ctx.hadActiveAccess && ctx.previousPlanId && ctx.previousPlanId !== plan.id) {
        entryType = 'plan_change';
    }

    var rec = {
        memberId: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        type: entryType,
        planId: plan.id,
        planName: plan.name,
        period: period,
        currency: plan.currency,
        amountCharged: pendingPurchase.amountCharged,
        txnId: pendingPurchase.txn || '',
        creditUsed: typeof creditUsed === 'number' ? creditUsed : 0,
        planCreditAfter: ctx.newCredit,
        planExpiresAt: ctx.expiresAt,
        paymentSimulated: true
    };
    if (ctx.previousPlanId) rec.previousPlanId = ctx.previousPlanId;
    if (ctx.refundAmount > 0) {
        rec.refundOrCreditAmount = ctx.refundAmount;
        rec.refundChoice = ctx.refundChoice;
    }
    return db.collection('members').doc(currentUser.uid).collection('membershipPurchases').add(rec);
}

/**
 * Single source of truth for writing the active plan + refund / credit
 * bookkeeping to Firestore.  Only ever touches fields the rules permit.
 */
function activatePlanInFirestore(refundChoice, refundAmount) {
    if (!currentUser) return Promise.reject(new Error('Not signed in'));

    var ledgerCtx = {
        previousPlanId: memberData.planId || null,
        hadActiveAccess: isMemberPlanActive(memberData),
        refundChoice: refundChoice,
        refundAmount: typeof refundAmount === 'number' ? refundAmount : 0,
        newCredit: 0,
        expiresAt: null
    };

    var fullPrice = pendingPurchase.price;
    var expiresAt = computeMembershipExpiryTimestamp(period);
    ledgerCtx.expiresAt = expiresAt;

    var oldCredit = (typeof memberData.planCredit === 'number') ? memberData.planCredit : 0;
    var newCredit = oldCredit - creditUsed;
    if (refundChoice === 'credit' && refundAmount > 0) newCredit += refundAmount;
    newCredit = Math.max(0, +newCredit.toFixed(2));
    ledgerCtx.newCredit = newCredit;

    var update = {
        plan: plan.name,
        planId: plan.id,
        planStatus: 'active',
        planPeriod: period,
        planAmountSubtotal: fullPrice.subtotal,
        planAmountTotal: fullPrice.total,
        planCurrency: plan.currency,
        planActivatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        planExpiresAt: expiresAt,

        lastPaymentMethod: pendingPurchase.method,
        lastPaymentCardLastFour: pendingPurchase.cardLastFour,
        lastTransactionId: pendingPurchase.txn,
        lastPaymentAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastPaymentAmountCharged: pendingPurchase.amountCharged,
        lastCreditUsed: creditUsed,
        lastPaymentSimulated: true,

        planCredit: newCredit,

        cancelAtPeriodEnd: firebase.firestore.FieldValue.delete(),
        membershipCancelledAt: firebase.firestore.FieldValue.delete()
    };

    if (refundChoice === 'refund' && refundAmount > 0) {
        update.lastRefundAmount = refundAmount;
        update.lastRefundMethod = memberData.lastPaymentMethod || pendingPurchase.method;
        update.lastRefundCardLastFour = memberData.lastPaymentCardLastFour || null;
        update.lastRefundAt = firebase.firestore.FieldValue.serverTimestamp();
    } else if (refundChoice === 'credit' && refundAmount > 0) {
        update.lastCreditAddedAmount = refundAmount;
        update.lastCreditAddedAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    var ref = db.collection('members').doc(currentUser.uid);
    return ref.get().then(function(doc) {
        if (doc.exists) return ref.update(update);

        // Edge case — member doc didn't exist yet
        update.email = currentUser.email;
        update.displayName = currentUser.displayName || currentUser.email;
        update.approvalStatus = 'pending';
        update.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        return ref.set(update);
    }).then(function() {
        return ref.get().then(function(d) {
            memberData = d.exists ? (d.data() || {}) : {};
        });
    }).then(function() {
        return appendMembershipLedgerEntry(ledgerCtx);
    });
}

/* ═══════════════════════════════════════
   MODAL VIEW STATES
   ═══════════════════════════════════════ */
function bindModal() {
    var modal = $('resultModal');
    $('btnModalClose').addEventListener('click', closeModal);
    qs('.pay-modal-backdrop', modal).addEventListener('click', function() {
        if (!modal.classList.contains('is-success')) closeModal();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !modal.hidden && !modal.classList.contains('is-success')) {
            closeModal();
        }
    });
}

/** STEP 1 — review the simulation. */
function showReviewModal(pending) {
    var modal = $('resultModal');
    modal.classList.remove('is-success');

    var icon = $('modalIcon');
    icon.classList.remove('success');
    icon.innerHTML = '<i class="fas fa-flask"></i>';

    $('modalTitle').textContent = 'Payment Simulation';
    $('modalBody').innerHTML =
        'This is only a payment simulation.<br>' +
        'In the future, it will be replaced by an original payment system like ' +
        '<strong>Stripe</strong>.<br><br>' +
        'Review the details below, then click <strong>Confirm Payment</strong> ' +
        'to activate your membership.';

    $('recPlan').textContent = plan.name + ' (' + (period === 'yearly' ? 'Yearly' : 'Monthly') + ')';
    $('recPlanId').textContent = plan.id;
    $('recMethod').textContent = pending.methodLabel;
    $('recAmount').textContent = fmt(pending.amountCharged);
    $('recTxn').textContent = pending.txn;
    $('recStatusRow').hidden = true;

    $('refundBox').hidden = true;
    $('modalSuccessNote').hidden = true;
    $('actionsReview').hidden = false;
    $('actionsRefund').hidden = true;
    $('actionsSuccess').hidden = true;
    setModalError('');

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
}

/** STEP 2 — refund / save-credit choice (only when downgrading). */
function showRefundChoiceStep(refundAmount) {
    $('refundAmount').textContent = fmt(refundAmount);
    $('refundSub').textContent = 'Choose what to do with this amount.';
    $('refundBox').hidden = false;

    $('modalTitle').textContent = 'Unused balance from your old plan';
    $('modalBody').innerHTML =
        'Switching from <strong>' + escapeHtml(memberData.plan || 'old plan') + '</strong> ' +
        'to <strong>' + escapeHtml(plan.name) + '</strong> leaves <strong>' + fmt(refundAmount) +
        '</strong> of unused value on the old plan.<br>' +
        'Would you like a <strong>refund</strong>, or <strong>save it as credit</strong> ' +
        'for your next purchase?';

    $('actionsReview').hidden = true;
    $('actionsRefund').hidden = false;
    $('actionsSuccess').hidden = true;
}

/** STEP 3 — green tick + final messaging. */
function showSuccessState(snapshot) {
    snapshot = snapshot || { choice: 'none', amount: 0, destination: '', creditUsed: creditUsed };
    var modal = $('resultModal');
    modal.classList.add('is-success');

    var icon = $('modalIcon');
    icon.classList.add('success');
    icon.innerHTML = '<i class="fas fa-circle-check"></i>';

    $('modalTitle').textContent = 'Membership Activated!';
    $('modalBody').innerHTML =
        'Your <strong>' + escapeHtml(plan.name) + '</strong> ' +
        '(' + (period === 'yearly' ? 'Yearly' : 'Monthly') + ') membership plan ' +
        'has been activated. Please move to the <strong>dashboard</strong> ' +
        'to see your active plan.';

    var noteHtml = '';
    if (snapshot.choice === 'refund' && snapshot.amount > 0) {
        noteHtml += '<i class="fas fa-money-bill-transfer"></i><div>' +
            '<strong>Your ' + fmt(snapshot.amount) + ' will be refunded to ' + snapshot.destination + '.</strong><br>' +
            'It usually arrives within 3–5 business days.' +
            '</div>';
    } else if (snapshot.choice === 'credit' && snapshot.amount > 0) {
        noteHtml += '<i class="fas fa-piggy-bank"></i><div>' +
            '<strong>' + fmt(snapshot.amount) + ' saved as account credit.</strong><br>' +
            'It will be applied automatically on your next plan purchase.' +
            '</div>';
    }
    if (snapshot.creditUsed > 0) {
        if (noteHtml) noteHtml += '<hr style="border:0;border-top:1px solid rgba(74,222,128,0.25);margin:10px 0;">';
        noteHtml += '<i class="fas fa-coins"></i><div>' +
            '<strong>' + fmt(snapshot.creditUsed) + ' of saved credit</strong> was applied to this purchase.' +
            '</div>';
    }
    var noteEl = $('modalSuccessNote');
    if (noteHtml) {
        noteEl.innerHTML = noteHtml;
        noteEl.hidden = false;
    } else {
        noteEl.hidden = true;
    }

    $('refundBox').hidden = true;
    $('recStatusRow').hidden = false;
    $('actionsReview').hidden = true;
    $('actionsRefund').hidden = true;
    $('actionsSuccess').hidden = false;
    setModalError('');
}

function closeModal() {
    $('resultModal').hidden = true;
    document.body.style.overflow = '';
}

/* ─── Helpers ─── */
function fmt(n) {
    var sym = (plan && plan.currencySymbol) ? plan.currencySymbol : '£';
    return sym + Number(n || 0).toFixed(2);
}

function hexToRgba(hex, alpha) {
    var h = (hex || '#FF6B35').replace('#', '');
    if (h.length === 3) h = h.split('').map(function(c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
