/** Minimal RFC 4180 CSV parse/stringify — handles quoted fields with commas,
 *  escaped quotes ("") and newlines inside quotes. */

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	let i = 0;
	const src = text.replace(/^﻿/, ''); // strip BOM
	while (i < src.length) {
		const c = src[i];
		if (inQuotes) {
			if (c === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
			} else {
				field += c;
				i++;
			}
		} else if (c === '"') {
			inQuotes = true;
			i++;
		} else if (c === ',') {
			row.push(field);
			field = '';
			i++;
		} else if (c === '\r') {
			i++;
		} else if (c === '\n') {
			row.push(field);
			field = '';
			rows.push(row);
			row = [];
			i++;
		} else {
			field += c;
			i++;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function esc(v: string): string {
	return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function stringifyCsv(rows: string[][]): string {
	return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
