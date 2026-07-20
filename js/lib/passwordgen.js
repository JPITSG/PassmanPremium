/**
 * Nextcloud - passman
 *
 * @copyright Copyright (c) 2016, Sander Brand (brantje@gmail.com)
 * @copyright Copyright (c) 2016, Marcos Zuriaga Miguel (wolfi@wolfi.es)
 * @license GNU AGPL version 3 or any later version
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// Password generation backed directly by the Web Crypto CSPRNG. The old
// ARC4-based PRNG (seeded once, then re-seeded with the clock on every
// call), its modulo-biased range reduction and the biased
// random-comparator shuffle are gone.

/**
 * Uniformly distributed random integer in [min, max], drawn from
 * crypto.getRandomValues with rejection sampling (no modulo bias).
 */
function get_random (min, max) {
    var range = max - min + 1;
    if (range <= 0) {
        return min;
    }
    var maxUnbiased = Math.floor(4294967296 / range) * range - 1;
    var buf = new Uint32Array(1);
    var x;
    do {
        window.crypto.getRandomValues(buf);
        x = buf[0];
    } while (x > maxUnbiased);
    return min + (x % range);
}

function generatePassword (r, t, n, e, o, i, p, g) {
    var _, a, s, f, d, h, u, l, c, v, w, y, m;
    if (void 0 === r && (r = 8 + get_random(0, 1)), r > 256 && (r = 256), i > 256 && (i = 256), void 0 === t && (t = !0), void 0 === n && (n = !0), void 0 === e && (e = !0), void 0 === o && (o = !1), void 0 === i && (i = 0), void 0 === p && (p = !1), void 0 === g && (g = !0), _ = 0, a = 0, s = 0, g && (_ = a = s = 1), f = [], n && _ > 0)for (d = 0; _ > d; d++)f[f.length] = "L"
    if (t && a > 0)for (d = 0; a > d; d++)f[f.length] = "U"
    if (e && i > 0)for (d = 0; i > d; d++)f[f.length] = "D"
    if (o && s > 0)for (d = 0; s > d; d++)f[f.length] = "S"
    for (; f.length < r;)f[f.length] = "A"
    // unbiased Fisher-Yates shuffle (the old random-comparator sort was biased)
    for (var si = f.length - 1; si > 0; si--) {
        var sj = get_random(0, si), st = f[si];
        f[si] = f[sj], f[sj] = st;
    }
    // with every character class disabled the combined pool stays empty —
    // fall back to lowercase rather than returning an empty password
    for (h = "", u = "abcdefghjkmnpqrstuvwxyz", p || (u += "ilo"), n && (h += u), l = "ABCDEFGHJKMNPQRSTUVWXYZ", p || (l += "ILO"), t && (h += l), c = "23456789", p || (c += "10"), e && (h += c), v = "!@#$%^&*", o && (h += v), h || (h = u), w = "", y = 0; r > y; y++) {
        switch (f[y]) {
            case"L":
                m = u;
                break;
            case"U":
                m = l;
                break;
            case"D":
                m = c;
                break;
            case"S":
                m = v;
                break;
            case"A":
                m = h
        }
        d = get_random(0, m.length - 1), w += m.charAt(d)
    }
    return w
}

function get_random_password (r, t) {
    var n;
    var pwlen, newpw;
    // printable ASCII only — 0x7F (DEL) is not a usable password character
    for ("number" != typeof r && (r = 12), "number" != typeof t && (t = 16), r > t && (n = r, r = t, t = n), pwlen = get_random(r, t), newpw = ""; newpw.length < pwlen;)newpw += String.fromCharCode(get_random(32, 126))
    return newpw
}
