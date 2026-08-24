/** Case normalisation for under-cased input.
 *
 *  Both models are fine-tuned on *cased* backbones (DistilBERT-multilingual-cased,
 *  o200k), so an all-lowercase ticket is out of distribution: names fragment or
 *  vanish and street names are missed entirely. The fix is a second inference pass
 *  over a truecased copy of the text.
 *
 *  The copy is built so that character offsets are IDENTICAL to the original —
 *  every replacement is one code point for one code point — which lets spans found
 *  in the truecased pass be applied to the original text without any remapping.
 */

/** Nordic function words. Capitalising these hurts: it turns "henne"/"er"/"bor"
 *  into name-shaped tokens (false positives) and breaks the prose context the
 *  model uses to recognise a street name. Measured: capitalising everything loses
 *  the address span and invents a person; skipping these keeps both.
 *
 *  Deliberately NOT listed, even though they are also function words: "per", "bo" and
 *  "andre" are common Nordic given names, and leaving them lowercase makes the model
 *  decline the whole name ("per olsen" -> "per Olsen" -> no span). A name leaking is
 *  worse than over-capitalising a preposition. */
const FUNCTION_WORDS = new Set(
	(
		// Norwegian (bokmål/nynorsk)
		'jeg du han hun den det vi dere de meg deg seg oss dem henne ham ham henne min mi mitt din ditt sin sitt vår vart våre deres hans hennes ' +
		'er var vere være blir ble bli har hadde ha kan kunne skal skulle vil ville må matte bør bor bodde budde ' +
		'heter hete jobber jobbe sitter sitte ligger ligge kommer komme kom går gå gikk gir gi ga gitt ser se sett ' +
		'ring ringer ringte kontakt kontakter send sender sendt mottatt får fa fikk gjøre gjor gjorde tar ta tok ' +
		'og eller men som at om for til fra av med ved på pa i under over etter før for mellom hos uten mot gjennom samt enn ' +
		'så sa da når nar hvis fordi siden mens enten verken både bade ' +
		'en et ei den det de denne dette disse noen noe alle ingen hver hvert mange få fa flere fleste annen annet ' +
		'ikke også ogsa bare kun nå na her der hvor hva hvem hvilken hvilket hvorfor hvordan ja nei takk ' +
		'hei hallo mvh vennlig hilsen beste med ' +
		// Swedish
		'och att med av till från fran för att har hade kan kunde ska skulle vill ville måste maste bor ' +
		'är ar var vara blir blev hos utan mot genom samt eller men som om när nar hur vad vem vilken varför varfor ' +
		'jag han hon den det vi ni de mig dig sig oss dem honom henne min din sin vår var deras hans hennes ' +
		'inte också ocksa bara endast nu här har där dar ja nej tack hej ' +
		// Danish
		'og eller men som at om til fra af med ved på pa efter før for mellem uden mod gennem ' +
		'er var være vaere bliver blev blive har havde have kan kunne skal skulle vil ville skal ' +
		'jeg du han hun den det vi I de mig dig sig os dem ham hende jer min din sin vores deres hans hendes ' +
		'ikke også ogsaa kun nu her der hvor hvad hvem hvorfor hvordan ja nej tak hej'
	)
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
);

/** Uppercase the first letter of every lowercase word that is not a Nordic
 *  function word. Returns a string with EXACTLY the same length and code-point
 *  positions as the input — any letter whose uppercase form is not a single code
 *  point (e.g. "ß" → "SS") is left alone. */
export function truecase(text: string): string {
	return text.replace(/(^|[^\p{L}\p{N}_])(\p{Ll}[\p{L}\p{M}]*)/gu, (whole, before: string, word: string) => {
		if (FUNCTION_WORDS.has(word.toLowerCase())) return whole;
		const upper = word[0].toUpperCase();
		if ([...upper].length !== 1) return whole; // would shift every later offset
		return before + upper + word.slice(1);
	});
}

/** True when the text looks under-cased enough that a truecased second pass is
 *  worth its inference cost — i.e. it has real prose in it and almost no capitals. */
export function isUndercased(text: string): boolean {
	const letters = text.match(/\p{L}/gu)?.length ?? 0;
	if (letters < 8) return false;
	const upper = text.match(/\p{Lu}/gu)?.length ?? 0;
	return upper / letters < 0.02;
}
