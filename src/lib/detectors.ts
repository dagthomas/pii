/** Structured-PII detectors with real checksum validation — pure functions, no model needed.
 *  Mirrors the production label policy: org numbers, switchboards and role mailboxes are NOT PII. */

export type Label =
	| 'person'
	| 'national_id'
	| 'phone'
	| 'email'
	| 'account_number'
	| 'card'
	| 'address'
	| 'date'
	| 'url'
	| 'secret';

export interface Span {
	start: number;
	end: number;
	label: Label;
	source: 'checksum' | 'pattern' | 'ner';
}

/** Norwegian fødselsnummer: 11 digits, two mod-11 control digits. */
export function validFnr(d: string): boolean {
	if (!/^\d{11}$/.test(d)) return false;
	const n = [...d].map(Number);
	const k1w = [3, 7, 6, 1, 8, 9, 4, 5, 2];
	const k2w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
	const mod = (ws: number[]) => {
		const s = ws.reduce((acc, w, i) => acc + w * n[i], 0);
		const r = 11 - (s % 11);
		return r === 11 ? 0 : r;
	};
	const k1 = mod(k1w);
	if (k1 === 10 || k1 !== n[9]) return false;
	const k2 = mod(k2w);
	return k2 !== 10 && k2 === n[10];
}

/** Luhn checksum (Swedish personnummer, payment cards). */
export function luhn(digits: string): boolean {
	let sum = 0;
	let dbl = digits.length % 2 === 0;
	for (const ch of digits) {
		let v = Number(ch);
		if (dbl) {
			v *= 2;
			if (v > 9) v -= 9;
		}
		sum += v;
		dbl = !dbl;
	}
	return sum % 10 === 0;
}

/** IBAN mod-97. */
export function validIban(s: string): boolean {
	const c = s.replace(/\s/g, '').toUpperCase();
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(c)) return false;
	const rearranged = c.slice(4) + c.slice(0, 4);
	let rem = 0;
	for (const ch of rearranged) {
		const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
		for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
	}
	return rem === 1;
}

const ROLE_LOCALS = new Set([
	'post', 'support', 'info', 'hr', 'invoice', 'faktura', 'kundeservice',
	'firmapost', 'salg', 'kontakt', 'booking', 'okonomi', 'noreply', 'no-reply', 'admin'
]);

const SWITCHBOARD_CUES = /(sentralbord|switchboard|växel|vaxel|omstilling|office)\W{0,12}$/i;
const ORGNR_CUES = /(org\.?\s?nr\.?|orgnr|organisasjonsnummer|organisationsnummer|vat)\W{0,12}$/i;

function push(spans: Span[], start: number, end: number, label: Label, source: Span['source']) {
	spans.push({ start, end, label, source });
}

/** Run all structured detectors over the text. */
export function detectStructured(text: string): Span[] {
	const spans: Span[] = [];

	// e-mail (role handles excluded, per policy)
	for (const m of text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
		const local = m[0].split('@')[0].toLowerCase().replace(/\d+$/, '');
		if (!ROLE_LOCALS.has(local)) push(spans, m.index, m.index + m[0].length, 'email', 'pattern');
	}

	// national IDs: 11-digit runs -> fnr checksum
	for (const m of text.matchAll(/(?<!\d)(\d{6})\s?(\d{5})(?!\d)/g)) {
		if (validFnr(m[1] + m[2])) push(spans, m.index, m.index + m[0].length, 'national_id', 'checksum');
	}
	// Swedish personnummer: YYMMDD-XXXX / YYYYMMDD-XXXX (Luhn over 10-digit form)
	for (const m of text.matchAll(/(?<!\d)(\d{2})?(\d{6})[-+]?(\d{4})(?!\d)/g)) {
		const ten = m[2] + m[3];
		const mm = Number(ten.slice(2, 4));
		const dd = Number(ten.slice(4, 6));
		if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && luhn(ten)) {
			push(spans, m.index, m.index + m[0].length, 'national_id', 'checksum');
		}
	}

	// IBAN
	for (const m of text.matchAll(/[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}/g)) {
		if (validIban(m[0])) push(spans, m.index, m.index + m[0].length, 'account_number', 'checksum');
	}

	// payment cards (13–19 digits, Luhn)
	for (const m of text.matchAll(/(?<!\d)(?:\d[ -]?){13,19}(?<![ -])/g)) {
		const digits = m[0].replace(/[ -]/g, '');
		if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
			push(spans, m.index, m.index + m[0].length, 'card', 'checksum');
		}
	}

	// phones: +NN international or Nordic groupings (3-2-3, 2-2-2-2, 3-3-2-2, …)
	// — skip switchboard/org.nr context and date-shaped strings
	const phoneRe =
		/(?<!\d)(\+\d{2}[\s.-]?)?(\d{2,4}[\s.-]?\d{2,3}[\s.-]?\d{2,3}(?:[\s.-]?\d{2,3})?)(?!\d)/g;
	for (const m of text.matchAll(phoneRe)) {
		const digits = m[0].replace(/\D/g, '');
		if (digits.length < 8 || digits.length > 13) continue;
		if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(m[0].trim())) continue; // looks like a date
		const before = text.slice(Math.max(0, m.index - 24), m.index);
		if (SWITCHBOARD_CUES.test(before)) continue;
		if (ORGNR_CUES.test(before)) continue;
		// 9-digit bare numbers are usually org numbers in NO text — require +prefix or 8 digits
		if (!m[1] && digits.length === 9) continue;
		push(spans, m.index, m.index + m[0].length, 'phone', 'pattern');
	}

	return spans;
}

/** Merge overlapping spans: checksum > pattern > ner; longer wins within a tier. */
export function mergeSpans(all: Span[]): Span[] {
	const rank = { checksum: 3, pattern: 2, ner: 1 } as const;
	const sorted = [...all].sort(
		(a, b) => rank[b.source] - rank[a.source] || b.end - b.start - (a.end - a.start)
	);
	const kept: Span[] = [];
	for (const s of sorted) {
		if (!kept.some((k) => s.start < k.end && s.end > k.start)) kept.push(s);
	}
	return kept.sort((a, b) => a.start - b.start);
}
