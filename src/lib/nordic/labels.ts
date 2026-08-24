/** nordic-v14 label space (order = model output channels) + BIOES span assembly. */
import type { Span } from '../detectors';

export const NER_CLASS_NAMES = [
	'O',
	'B-account_number', 'I-account_number', 'E-account_number', 'S-account_number',
	'B-private_address', 'I-private_address', 'E-private_address', 'S-private_address',
	'B-private_date', 'I-private_date', 'E-private_date', 'S-private_date',
	'B-private_email', 'I-private_email', 'E-private_email', 'S-private_email',
	'B-private_person', 'I-private_person', 'E-private_person', 'S-private_person',
	'B-private_phone', 'I-private_phone', 'E-private_phone', 'S-private_phone',
	'B-private_url', 'I-private_url', 'E-private_url', 'S-private_url',
	'B-secret', 'I-secret', 'E-secret', 'S-secret',
	'B-national_id', 'I-national_id', 'E-national_id', 'S-national_id'
] as const;

const TO_DEMO_LABEL: Record<string, Span['label']> = {
	private_person: 'person',
	private_phone: 'phone',
	private_email: 'email',
	private_address: 'address',
	private_date: 'date',
	private_url: 'url',
	account_number: 'account_number',
	national_id: 'national_id',
	secret: 'secret',
	card: 'card'
};

/** Greedy BIOES stitching over per-token argmax label ids.
 *  offsets[i] = char offset where token i starts; offsets[N] = text length. */
export function stitchSpans(labelIds: number[] | Int32Array, offsets: number[], text: string): Span[] {
	const spans: Span[] = [];
	let openType: string | null = null;
	let openStart = -1;

	const close = (endTok: number) => {
		if (openType === null) return;
		let s = offsets[openStart];
		let e = offsets[endTok];
		while (s < e && /[\s,;:·|–—-]/.test(text[s])) s++;
		while (e > s && /\s/.test(text[e - 1])) e--;
		if (e > s) spans.push({ start: s, end: e, label: TO_DEMO_LABEL[openType] ?? 'person', source: 'ner' });
		openType = null;
	};

	for (let i = 0; i < labelIds.length; i++) {
		const name = NER_CLASS_NAMES[labelIds[i]] ?? 'O';
		if (name === 'O') {
			close(i);
			continue;
		}
		const prefix = name[0];
		const type = name.slice(2);
		if (prefix === 'S') {
			close(i);
			openType = type;
			openStart = i;
			close(i + 1);
		} else if (prefix === 'B') {
			close(i);
			openType = type;
			openStart = i;
		} else if (prefix === 'I' || prefix === 'E') {
			if (openType !== type) {
				close(i);
				openType = type;
				openStart = i;
			}
			if (prefix === 'E') close(i + 1);
		}
	}
	close(labelIds.length);
	return spans;
}
