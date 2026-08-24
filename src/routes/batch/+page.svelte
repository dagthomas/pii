<script lang="ts">
	import { RedactorEngine } from '$lib/RedactorEngine.svelte';
	import { NordicEngine } from '$lib/nordic/NordicEngine.svelte';
	import LoadPanel from '$lib/LoadPanel.svelte';
	import { parseCsv, stringifyCsv } from '$lib/csv';

	const fast = new RedactorEngine();
	const nordic = new NordicEngine();
	let mode = $state<'fast' | 'nordic'>('fast');
	const engine = $derived(mode === 'fast' ? fast : nordic);

	$effect(() => {
		engine.start();
	});
	$effect(() => () => {
		fast.stop();
		nordic.stop();
	});

	type Phase = 'pick' | 'columns' | 'running' | 'done';
	let phase = $state<Phase>('pick');
	let fileName = $state('');
	let sourceType = $state<'csv' | 'xlsx'>('csv');
	let workbook: unknown = null; // SheetJS workbook when sourceType === 'xlsx'
	let sheetNames = $state.raw<string[]>([]);
	let chosenSheet = $state('');
	let header = $state.raw<string[]>([]);
	let rows = $state.raw<string[][]>([]);
	let selected = $state<boolean[]>([]);
	let hasHeader = $state(true);
	let useNer = $state(true);
	let done = $state(0);
	let total = $state(0);
	let cancelled = false;
	let downloadUrl = $state('');
	let outPreview = $state.raw<string[][]>([]);
	let errorMsg = $state('');

	const selectedCount = $derived(selected.filter(Boolean).length);
	const progressPct = $derived(total ? Math.round((done / total) * 100) : 0);
	const statusText = $derived(
		engine.status === 'loading'
			? engine.progress || 'loading model…'
			: engine.status === 'ready'
				? `model ready · ${engine.device === 'webgpu' ? 'your GPU (WebGPU)' : 'CPU (WASM)'}`
				: engine.status === 'error'
					? 'model unavailable — checksum detectors still active'
					: 'starting…'
	);

	const SAMPLE_CSV =
		'record_id,account,message,status\r\n' +
		'4711,Fjellkraft AS,"Hei! Kari Nordmann (fnr 12038439853) er sykmeldt. Ring 412 34 567 eller kari.nordmann@fjellkraft.no. Mvh Ola Hansen",open\r\n' +
		'4712,Nordkraft AB,"Hej! Anna Svensson (personnummer 811218-9876) kommer inte in. Ring 070-123 45 67 eller anna.svensson@nordkraft.se",open\r\n' +
		'4713,Bygg og Bo AS,"Vi bytter kontonummer til IBAN NO9386011117947. Kontakt Per Olsen på per.olsen@byggbo.no",closed\r\n' +
		'4714,Fjellkraft AS,"Sentralbord 73 90 00 00, org.nr 987 654 321 — ingen personopplysninger her",closed\r\n' +
		'4715,Havvind AS,"Timelistene til Nina Berg mangler for juli. Hun nås på 934 96 388.",open\r\n' +
		'4716,Nordkraft AB,"Kortet 4111 1111 1111 1111 ble avvist ved betaling. Kontakt Erik Lindqvist.",open\r\n' +
		'4717,Bygg og Bo AS,"Faktura sendes til faktura@byggbo.no som vanlig — dette er en rolleadresse.",closed\r\n' +
		'4718,Havvind AS,"Ny HR-kontakt er Silje Dahl, silje.dahl@havvind.no, mobil +47 481 32 856.",open\r\n';

	let sampleUrl = $state('');
	function downloadSampleUrl(): string {
		if (!sampleUrl) sampleUrl = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' }));
		return sampleUrl;
	}

	function loadText(text: string, name: string) {
		errorMsg = '';
		sourceType = 'csv';
		workbook = null;
		sheetNames = [];
		const parsed = parseCsv(text);
		adopt(parsed, name);
	}

	async function loadXlsx(buf: ArrayBuffer, name: string) {
		errorMsg = '';
		const XLSX = await import('xlsx');
		const wb = XLSX.read(buf, { type: 'array' });
		workbook = wb;
		sourceType = 'xlsx';
		sheetNames = wb.SheetNames;
		chosenSheet = wb.SheetNames[0];
		adoptSheet(name);
	}

	async function adoptSheet(name?: string) {
		const XLSX = await import('xlsx');
		const wb = workbook as import('xlsx').WorkBook;
		const ws = wb.Sheets[chosenSheet];
		const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
		adopt(aoa.map((r) => r.map((c) => String(c ?? ''))), name ?? fileName);
	}

	function adopt(parsed: string[][], name: string) {
		if (parsed.length === 0) {
			errorMsg = 'Could not parse any rows from that file.';
			return;
		}
		fileName = name;
		header = parsed[0];
		rows = parsed;
		// preselect columns whose name suggests free text
		selected = parsed[0].map((h) =>
			/message|text|body|beskrivelse|comment|kommentar|description|melding/i.test(h)
		);
		if (!selected.some(Boolean) && parsed[0].length > 0) {
			// fall back: select the widest column by content
			const widths = parsed[0].map((_, c) =>
				parsed.slice(1, 20).reduce((s, r) => s + (r[c]?.length ?? 0), 0)
			);
			selected[widths.indexOf(Math.max(...widths))] = true;
		}
		phase = 'columns';
	}

	function onFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		if (!f) return;
		const reader = new FileReader();
		if (/\.(xlsx|xls)$/i.test(f.name)) {
			reader.onload = () => void loadXlsx(reader.result as ArrayBuffer, f.name);
			reader.readAsArrayBuffer(f);
		} else {
			reader.onload = () => loadText(String(reader.result), f.name);
			reader.readAsText(f);
		}
	}

	async function run() {
		phase = 'running';
		cancelled = false;
		done = 0;
		const dataStart = hasHeader ? 1 : 0;
		const cols = selected.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
		total = (rows.length - dataStart) * cols.length;
		const out = rows.map((r) => [...r]);
		for (let r = dataStart; r < rows.length && !cancelled; r++) {
			for (const c of cols) {
				const cell = out[r][c];
				if (cell && cell.trim().length > 1) {
					out[r][c] = await engine.redactText(cell, useNer);
				}
				done++;
			}
		}
		if (cancelled) {
			phase = 'columns';
			return;
		}
		if (downloadUrl) URL.revokeObjectURL(downloadUrl);
		if (sourceType === 'xlsx') {
			const XLSX = await import('xlsx');
			const wb = workbook as import('xlsx').WorkBook;
			wb.Sheets[chosenSheet] = XLSX.utils.aoa_to_sheet(out);
			const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
			downloadUrl = URL.createObjectURL(
				new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
			);
		} else {
			const csv = stringifyCsv(out);
			downloadUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
		}
		outPreview = out.slice(0, 6);
		phase = 'done';
	}

	function reset() {
		phase = 'pick';
		fileName = '';
		outPreview = [];
	}

	const downloadName = $derived(
		fileName
			? fileName.replace(/\.(csv|xlsx|xls)$/i, '') + (sourceType === 'xlsx' ? '.redacted.xlsx' : '.redacted.csv')
			: 'redacted.csv'
	);
</script>

<svelte:head><title>Batch CSV Redactor</title></svelte:head>

<div class="page">
	<p class="eyebrow">batch mode · nothing leaves this machine</p>
	<h1>Batch CSV Redactor</h1>
	<p class="lede">
		Drop in a CSV, pick the columns that contain free text, and every cell is redacted right here in
		your browser — the file never touches a server. <a href="/">Single-text demo →</a>
	</p>

	<div class="engines" role="radiogroup" aria-label="Detection engine">
		<label class={['engchip', { on: mode === 'fast' }]}><input type="radio" bind:group={mode} value="fast" /> nordic-ner · our small model + checksums</label>
		<label class={['engchip', { on: mode === 'nordic' }]}><input type="radio" bind:group={mode} value="nordic" /> nordic-v14 · the real model (~1.9 GB, downloads once)</label>
	</div>

	<div class="status" data-state={engine.status}>{statusText}</div>

	{#if engine.status === 'loading'}
		<LoadPanel {engine} />
	{/if}

	{#if phase === 'pick'}
		<div class="card pickzone">
			<label class="filebtn" for="csvfile">Choose a CSV or Excel file</label>
			<input id="csvfile" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange={onFile} />
			<span class="or">or</span>
			<button class="chip" onclick={() => loadText(SAMPLE_CSV, 'sample-data.csv')}>Load sample rows</button>
			<button class="chip" onclick={() => { const a = document.createElement('a'); a.href = downloadSampleUrl(); a.download = 'sample-data.csv'; a.click(); }}>Download sample-data.csv</button>
			{#if errorMsg}<p class="err" role="alert">{errorMsg}</p>{/if}
		</div>
	{/if}

	{#if phase === 'columns' || phase === 'running'}
		<div class="card">
			<h2>{fileName} <span class="count">{rows.length - (hasHeader ? 1 : 0)} rows</span></h2>
			{#if sourceType === 'xlsx' && sheetNames.length > 1}
				<label class="opt">Sheet:
					<select bind:value={chosenSheet} onchange={() => void adoptSheet()} disabled={phase === 'running'}>
						{#each sheetNames as sn (sn)}<option value={sn}>{sn}</option>{/each}
					</select>
				</label>
			{/if}
			<label class="opt"><input type="checkbox" bind:checked={hasHeader} disabled={phase === 'running'} /> First row is a header</label>
			{#if mode === 'fast'}
				<label class="opt"><input type="checkbox" bind:checked={useNer} disabled={phase === 'running'} /> Use the NER model for names (slower, better)</label>
			{/if}
			<p class="colhead">Redact these columns:</p>
			<div class="cols">
				{#each header as h, i (i)}
					<label class={['col', { on: selected[i] }]}>
						<input type="checkbox" bind:checked={selected[i]} disabled={phase === 'running'} />
						{hasHeader ? h || `(column ${i + 1})` : `column ${i + 1}`}
					</label>
				{/each}
			</div>
			<div class="tablewrap" aria-label="Preview of the first rows">
				<table>
					{#if hasHeader}
						<thead><tr>{#each header as h, i (i)}<th class={{ sel: selected[i] }}>{h}</th>{/each}</tr></thead>
					{/if}
					<tbody>
						{#each rows.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 4) as r, ri (ri)}
							<tr>{#each header as _h, ci (ci)}<td class={{ sel: selected[ci] }}>{(r[ci] ?? '').slice(0, 60)}</td>{/each}</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if phase === 'columns'}
				<button class="go" onclick={run} disabled={selectedCount === 0 || engine.status === 'loading'}>
					{engine.status === 'loading' ? 'Loading model…' : `Redact ${selectedCount} column${selectedCount === 1 ? '' : 's'}`}
				</button>
				<button class="chip" onclick={reset}>Different file</button>
			{:else}
				<div class="progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin="0" aria-valuemax="100">
					<div class="bar" style:width="{progressPct}%"></div>
				</div>
				<p class="progtext">{done} / {total} cells · {progressPct}%</p>
				<button class="chip" onclick={() => (cancelled = true)}>Cancel</button>
			{/if}
		</div>
	{/if}

	{#if phase === 'done'}
		<div class="card">
			<h2>Done <span class="count">{total} cells redacted</span></h2>
			<div class="tablewrap" aria-label="Preview of the redacted rows">
				<table>
					<tbody>
						{#each outPreview as r, ri (ri)}
							<tr>{#each r as cell, ci (ci)}<td>{cell.slice(0, 80)}</td>{/each}</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<a class="go dl" href={downloadUrl} download={downloadName}>Download {downloadName}</a>
			<button class="chip" onclick={reset}>Redact another file</button>
		</div>
	{/if}

	<footer>
		<p>
			Same detectors as the <a href="/">single-text demo</a>: an in-browser NER model for names plus
			exact checksum validators (fødselsnummer, personnummer, IBAN, cards) and the production label
			policy — org numbers, switchboards and role mailboxes stay untouched. Concept demo, not the
			production <span class="mono">nordic-v14</span> model.
		</p>
	</footer>
</div>

<style>
	div.page {
		gap: var(--s-5);
	}
	.eyebrow {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0;
	}
	h1 {
		margin: 6px 0 0;
		font-size: 2.2rem;
		line-height: 1.1;
		letter-spacing: -0.01em;
	}
	.lede {
		color: var(--ink-2);
		max-width: 60ch;
	}
	a {
		color: var(--accent);
	}
	.engines {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin: 12px 0 4px;
	}
	.engchip {
		font-size: 0.82rem;
		padding: 5px 14px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--ink-2);
		cursor: pointer;
	}
	.engchip.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.engchip input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.status {
		display: inline-block;
		font-size: 0.82rem;
		padding: 4px 12px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--ink-2);
		margin: 6px 0 18px;
	}
	.status[data-state='ready'] {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 20px 22px;
		margin: 10px 0;
	}
	.pickzone {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}
	input[type='file'] {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.filebtn {
		font-weight: 600;
		font-size: 0.95rem;
		font-family: var(--font-sans);
		padding: 10px 22px;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
	}
	.filebtn:focus-within,
	.go:focus-visible,
	.chip:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.or {
		color: var(--ink-3);
		font-size: 0.85rem;
	}
	.chip {
		font-size: 0.82rem;
		padding: 5px 14px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--ink-2);
		cursor: pointer;
	}
	.chip:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.err {
		color: #b3362a;
		font-size: 0.85rem;
		width: 100%;
	}
	h2 {
		font-size: 1.1rem;
		margin: 0 0 10px;
	}
	.count {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ink-3);
		margin-left: 8px;
	}
	.opt {
		display: block;
		font-size: 0.88rem;
		color: var(--ink-2);
		margin: 4px 0;
	}
	.colhead {
		font-size: 0.78rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-3);
		margin: 14px 0 6px;
	}
	.cols {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 12px;
	}
	.col {
		font-size: 0.86rem;
		padding: 5px 12px;
		border: 1px solid var(--line);
		border-radius: 999px;
		cursor: pointer;
		color: var(--ink-2);
	}
	.col.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.tablewrap {
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: 8px;
		margin: 8px 0 14px;
	}
	table {
		border-collapse: collapse;
		font-size: 0.8rem;
		width: 100%;
	}
	th,
	td {
		padding: 6px 10px;
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
		text-align: left;
		max-width: 34ch;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	th {
		font-size: 0.7rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	.sel {
		background: var(--accent-soft);
	}
	tr:last-child td {
		border-bottom: none;
	}
	.go {
		font-weight: 600;
		font-size: 0.95rem;
		font-family: var(--font-sans);
		padding: 10px 24px;
		border-radius: 999px;
		border: none;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
		margin-right: 10px;
	}
	.go:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.dl {
		display: inline-block;
		text-decoration: none;
	}
	.progress {
		height: 10px;
		border-radius: 999px;
		background: var(--line);
		overflow: hidden;
		margin: 8px 0 6px;
	}
	.bar {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s;
	}
	@media (prefers-reduced-motion: reduce) {
		.bar {
			transition: none;
		}
	}
	.progtext {
		font-size: 0.84rem;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
	footer {
		margin-top: 40px;
		border-top: 1px solid var(--line);
		padding-top: 12px;
		font-size: 0.86rem;
		color: var(--ink-2);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 0.94em;
	}
</style>
