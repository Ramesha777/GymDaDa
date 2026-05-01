/**
 * Booking success UI: reference number + QR code (encoded booking reference).
 * Depends on global QRCode from qrcodejs (loaded before this script in member.html).
 */
(function () {
    function clearNode(el) {
        if (!el) return;
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

    /**
     * Payload scanners see — prefix helps recognize GymDD codes.
     * v2 includes Firebase member uid + Firestore booking doc id for direct check-in lookup.
     */
    function qrPayload(bookingCode, options) {
        options = options || {};
        if (options.memberId && options.bookingId) {
            return 'GymDD|v2|' + String(options.memberId) + '|' + String(options.bookingId);
        }
        return 'GymDD|' + String(bookingCode);
    }

    /**
     * @param {string|number} bookingCode - reference stored on the booking
     * @param {{className?: string, date?: string, time?: string, memberId?: string, bookingId?: string}} [options]
     */
    window.showBookingConfirmation = function (bookingCode, options) {
        options = options || {};
        var codeEl = document.getElementById('bookingConfirmCode');
        var detailsEl = document.getElementById('bookingConfirmDetails');
        var qrHost = document.getElementById('bookingQrHost');
        var fbEl = document.getElementById('bookingQrFallback');
        var modalEl = document.getElementById('bookingConfirmModal');

        if (codeEl) codeEl.textContent = String(bookingCode);

        var parts = [];
        if (options.className) parts.push(options.className);
        if (options.date) parts.push('Date ' + options.date);
        if (options.time) parts.push(options.time);
        if (detailsEl) detailsEl.textContent = parts.length ? parts.join(' · ') : '';

        if (fbEl) {
            fbEl.classList.add('d-none');
            fbEl.textContent = '';
        }

        if (qrHost) {
            clearNode(qrHost);
            if (typeof QRCode !== 'undefined') {
                try {
                    var v2 = !!(options.memberId && options.bookingId);
                    new QRCode(qrHost, {
                        text: qrPayload(bookingCode, options),
                        width: v2 ? 240 : 192,
                        height: v2 ? 240 : 192,
                        colorDark: '#0b0b1a',
                        colorLight: '#ffffff',
                        correctLevel: v2 ? QRCode.CorrectLevel.H : QRCode.CorrectLevel.M
                    });
                } catch (err) {
                    console.error(err);
                    if (fbEl) {
                        fbEl.textContent = 'QR could not be generated — use the reference number above.';
                        fbEl.classList.remove('d-none');
                    }
                }
            } else if (fbEl) {
                fbEl.textContent = 'QR library did not load — use the reference number above.';
                fbEl.classList.remove('d-none');
            }
        }

        if (modalEl && window.bootstrap) {
            window.setTimeout(function () {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            }, 180);
        }
    };

    var bookingConfirmModal = document.getElementById('bookingConfirmModal');
    if (bookingConfirmModal) {
        bookingConfirmModal.addEventListener('hidden.bs.modal', function () {
            var qrHost = document.getElementById('bookingQrHost');
            clearNode(qrHost);
        });
    }

    /**
     * Shown after a member successfully cancels a class booking.
     * @param {{className?: string}} [options]
     */
    window.showBookingCancelledConfirmation = function (options) {
        options = options || {};
        var msgEl = document.getElementById('bookingCancelledMessage');
        var modalEl = document.getElementById('bookingCancelledModal');
        var cn = options.className && String(options.className).trim();
        if (msgEl) {
            msgEl.textContent = cn
                ? 'Your booking for "' + cn + '" has been cancelled.'
                : 'Your booking has been cancelled.';
        }
        if (modalEl && window.bootstrap) {
            window.setTimeout(function () {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            }, 100);
        }
    };
})();
