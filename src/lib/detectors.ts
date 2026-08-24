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

/** Nordic street-name endings, for the compound case: "Kirkegata", "granittveien",
 *  "Storgatan". Only tested against words of 6+ characters, so a short everyday word
 *  can never match on its own here. */
const COMPOUND_SUFFIXES = [
	'gate', 'gaten', 'gata', 'gatan', 'vei', 'veien', 'veg', 'vegen', 'väg', 'vägen',
	'vej', 'vejen', 'plass', 'plassen', 'plats', 'platsen', 'alle', 'allé', 'alleen', 'alléen',
	'allén', 'gang', 'gangen', 'sti', 'stien', 'brygge', 'brygga', 'bryggen', 'terrasse',
	'terrassen', 'tun', 'tunet', 'jorde', 'jordet', 'sving', 'svingen', 'bakke', 'bakken',
	'haug', 'haugen', 'krok', 'kroken', 'lia', 'lien', 'åsen', 'asen', 'ring', 'ringen',
	'kai', 'kaien', 'kaia', 'mo', 'moen', 'torg', 'torget', 'park', 'parken', 'hage', 'hagen',
	'felt', 'feltet', 'dal', 'dalen', 'holme', 'holmen', 'strand', 'stranda', 'stranden',
	'kolle', 'kollen', 'topp', 'toppen', 'skog', 'skogen', 'smau', 'smauet', 'voll', 'vollen',
	'eng', 'engen', 'løkka', 'lokka', 'grend', 'grenda', 'myr', 'myra', 'berg', 'berget',
	'marka', 'stubben', 'porten', 'veita', 'bru', 'brua'
];

/** The much smaller set that may stand alone as its own word after a name
 *  ("Karl Johans gate 1", "Bjørnsons vei 12"). Everyday Norwegian words are excluded
 *  even though they are valid street endings in a compound: "ring", "gang", "alle",
 *  "sti", "kai", "park" and friends would turn "Ring 412 34 567" into an address. */
const STANDALONE_SUFFIXES = new Set([
	'gate', 'gata', 'gatan', 'gaten', 'vei', 'veien', 'veg', 'vegen', 'väg', 'vägen', 'vej',
	'plass', 'plassen', 'plats', 'allé', 'alléen', 'brygge', 'bryggen', 'terrasse', 'torg', 'torget'
]);

const SUFFIX_TAIL = new RegExp(`(?:${COMPOUND_SUFFIXES.join('|')})$`, 'iu');

/** Words that must not be swallowed into a street name when scanning leftwards. */
const ADDRESS_STOP = new Set(
	// "per" and "bo" are omitted on purpose — they are common Nordic given names, and a
	// street named after a person ("Per Olsens gate 1") must keep the whole name in the span.
	('i på pa til fra av med ved hos om for under over etter før for mellom uten mot gjennom ' +
		'er var vare være bor bodde heter ligger flyttet flytte flytter sender send sendt post poste ' +
		'og eller men som at nar når det den de denne dette disse en et ei min din sin var vår deres hans hennes ' +
		'jeg du han hun vi dere adresse adressen adresser ny nye gamle her der hjemme jobb kontor ' +
		'och att med av till fran från pa på hos utan mot bor ar är var vid').split(/\s+/).filter(Boolean)
);

/** A word token. It may contain "." / "-" / "'" internally ("St. Olavs", "Lars-Erik") but must
 *  not end on one — otherwise a sentence-final "sykmeldt." reads as adjacent to the next word
 *  and gets pulled into a street name. */
const WORD_RE = /[\p{L}\p{N}](?:[\p{L}\p{N}.'’\-]*[\p{L}\p{N}])?/gu;
const HOUSE_NUMBER = /^\d{1,4}[a-zæøåäöA-ZÆØÅÄÖ]?$/;
/** ", 0157 Oslo" (NO/DK) or ", 111 51 Stockholm" (SE), optionally a two-word city. */
const POSTAL_CITY = /^\s*,?\s*(?:\d{4}|\d{3}\s?\d{2})\s+\p{L}{2,}(?:[ \-]\p{L}{2,}){0,2}/u;

/** Street addresses, found without a model and without regard to letter case.
 *  Both models are cased and miss lowercase addresses entirely; this closes that hole. */
export function detectAddresses(text: string): Span[] {
	const toks = [...text.matchAll(WORD_RE)].map((m) => ({
		w: m[0],
		s: m.index,
		e: m.index + m[0].length
	}));
	const out: Span[] = [];
	let consumedUpTo = -1;

	for (let i = 0; i < toks.length; i++) {
		if (i <= consumedUpTo) continue;
		const word = toks[i].w.toLowerCase();
		const standalone = STANDALONE_SUFFIXES.has(word);
		const compound = !standalone && word.length >= 6 && SUFFIX_TAIL.test(word);
		if (!standalone && !compound) continue;

		const num = toks[i + 1];
		if (!num || !HOUSE_NUMBER.test(num.w)) continue;
		if (!/^[ \u00a0]?$/.test(text.slice(toks[i].e, num.s))) continue; // only a space may separate them

		// walk left over at most two name words, never crossing punctuation
		let start = toks[i].s;
		let nameWords = 0;
		for (let j = i - 1; j >= 0 && nameWords < 2; j--) {
			if (!/^[ \u00a0]$/.test(text.slice(toks[j].e, toks[j + 1].s))) break;
			if (ADDRESS_STOP.has(toks[j].w.toLowerCase())) break;
			if (/^\d/.test(toks[j].w)) break;
			start = toks[j].s;
			nameWords++;
		}
		if (standalone && nameWords === 0) continue; // a bare "vei 2" is not an address

		let end = num.e;
		const tail = POSTAL_CITY.exec(text.slice(end));
		if (tail) end += tail[0].length;

		out.push({ start, end, label: 'address', source: 'pattern' });
		while (consumedUpTo + 1 < toks.length && toks[consumedUpTo + 1].s < end) consumedUpTo++;
	}
	return out;
}

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

	spans.push(...detectAddresses(text));

	return spans;
}

/** Merge overlapping spans.
 *  Same label -> union them (a checksum span and a model span for one identifier, or two
 *  half-detected fragments of one name, should redact as a single run of text).
 *  Different labels -> the more reliable source wins: checksum > pattern > ner, longer first. */
export function mergeSpans(all: Span[]): Span[] {
	const rank = { checksum: 3, pattern: 2, ner: 1 } as const;

	// pass 1: union overlapping spans that carry the same label
	const byLabel = new Map<Label, Span[]>();
	for (const s of all) {
		const list = byLabel.get(s.label) ?? [];
		list.push(s);
		byLabel.set(s.label, list);
	}
	const unioned: Span[] = [];
	for (const [label, list] of byLabel) {
		list.sort((a, b) => a.start - b.start || a.end - b.end);
		let cur: Span | null = null;
		for (const s of list) {
			if (cur && s.start <= cur.end) {
				cur.end = Math.max(cur.end, s.end);
				if (rank[s.source] > rank[cur.source]) cur.source = s.source;
			} else {
				if (cur) unioned.push(cur);
				cur = { start: s.start, end: s.end, label, source: s.source };
			}
		}
		if (cur) unioned.push(cur);
	}

	// pass 2: resolve cross-label overlaps
	const sorted = unioned.sort(
		(a, b) => rank[b.source] - rank[a.source] || b.end - b.start - (a.end - a.start)
	);
	const kept: Span[] = [];
	for (const s of sorted) {
		if (!kept.some((k) => s.start < k.end && s.end > k.start)) kept.push(s);
	}
	return kept.sort((a, b) => a.start - b.start);
}
