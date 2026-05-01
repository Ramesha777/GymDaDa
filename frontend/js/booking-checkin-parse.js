/**
 * Shared parser for booking check-in scans (admin / trainer).
 * Legacy QR:  GymDD|{numericBookingCode}
 * v2 QR:     GymDD|v2|{firebaseMemberUid}|{bookingFirestoreDocId}
 * Plain digits / other strings fall through as reference lookup keys.
 */

export function parseGymBookingCheckinRaw(raw) {
    var s = String(raw || '').trim();
    if (!s) return { kind: 'ref', codeKey: '' };

    var prefix = 'GymDD|';
    if (s.indexOf(prefix) === 0) {
        var inner = s.slice(prefix.length).trim();
        if (inner.indexOf('v2|') === 0) {
            var rest = inner.slice(3);
            var sep = rest.indexOf('|');
            if (sep > 0) {
                var memberId = rest.slice(0, sep).trim();
                var bookingId = rest.slice(sep + 1).trim();
                if (memberId && bookingId) {
                    return { kind: 'v2', memberId: memberId, bookingId: bookingId };
                }
            }
        }
        var digits = inner.replace(/\s/g, '');
        if (/^\d+$/.test(digits)) return { kind: 'ref', codeKey: digits };
        return { kind: 'ref', codeKey: inner };
    }

    var digits2 = s.replace(/\s/g, '');
    if (/^\d+$/.test(digits2)) return { kind: 'ref', codeKey: digits2 };
    return { kind: 'ref', codeKey: s };
}
