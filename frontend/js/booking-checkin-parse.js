/**
 * Shared parser for booking check-in scans (admin / trainer).
 * QR:  DaDaGym|{numericBookingCode} — legacy payloads may still use GymDD|
 * v2:  DaDaGym|v2|{firebaseMemberUid}|{bookingFirestoreDocId}
 * Plain digits / other strings fall through as reference lookup keys.
 */

/**
 * Strip BOM / line breaks (common from USB scanners); align to first brand prefix if prefixed with junk.
 */
export function normalizeBookingCheckinRaw(raw) {
    var s = String(raw || '').replace(/^\uFEFF/, '').trim();
    s = s.replace(/[\r\n\u2028\u2029\u00A0]/g, '').trim();
    var idx = s.search(/(?:DaDaGym|GymDD)\|/i);
    if (idx > 0) s = s.slice(idx);
    return s.trim();
}

export function parseGymBookingCheckinRaw(raw) {
    var s = normalizeBookingCheckinRaw(raw);
    if (!s) return { kind: 'ref', codeKey: '' };

    var m = s.match(/^(?:DaDaGym|GymDD)\|(.*)$/i);
    if (m) {
        var inner = m[1].trim();
        var v2head = inner.match(/^v2\|(.*)$/i);
        if (v2head) {
            var rest = v2head[1];
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
