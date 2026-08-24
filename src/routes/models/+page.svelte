<svelte:head><title>The models · Nordic PII</title></svelte:head>

<main>
	<p class="eyebrow">the models</p>
	<h1>Three tools, one training pipeline</h1>
	<p class="lede">
		Every model here was trained on the <strong>same data</strong> — synthetic Nordic HR/support text
		(checksum-valid IDs, names from national statistics) plus 1,300 hand-labelled real tickets — under the
		<strong>same label policy</strong>. They differ only in size, speed, and where they run.
	</p>

	<div class="tablewrap">
		<table>
			<thead>
				<tr><th>Model</th><th>Based on</th><th class="n">Size</th><th class="n">Accuracy*</th><th>Runs on</th></tr>
			</thead>
			<tbody>
				<tr>
					<td><b>nordic-v9</b><br /><span class="s">flagship</span></td>
					<td>OpenAI <span class="mono">privacy-filter</span> (1.4B MoE)</td>
					<td class="n">1.84 GB<br /><span class="s">951 MB server</span></td>
					<td class="n">F1 0.86–0.93<br /><span class="s">weaker lowercased</span></td>
					<td>Server (CPU/GPU) · browser (WebGPU)</td>
				</tr>
				<tr>
					<td><b>nordic-ner</b><br /><span class="s">our own small model</span></td>
					<td>DistilBERT multilingual (135M)</td>
					<td class="n">135 MB<br /><span class="s">int8 ONNX</span></td>
					<td class="n">F1 0.95<br /><span class="s">0.94 lowercased</span></td>
					<td>Browser (WebGPU/WASM) · any CPU</td>
				</tr>
				<tr>
					<td><b>Checksum detectors</b><br /><span class="s">no ML</span></td>
					<td>Pure algorithms</td>
					<td class="n">~2 KB</td>
					<td class="n">Exact</td>
					<td>Anywhere, instantly</td>
				</tr>
			</tbody>
		</table>
	</div>
	<p class="fn">*Span-F1 on blind real tickets never seen in training. The two models use different eval granularities, so treat these as ballpark, not a head-to-head — see notes below.</p>

	<h2>When to use what</h2>

	<div class="cards">
		<div class="card">
			<div class="pin">Best for local batch — CSV & Excel</div>
			<h3>nordic-ner</h3>
			<p>
				Our own 135 MB model. Small enough to load fast and run on any laptop GPU or CPU, yet it scored
				<b>0.95 span-F1</b> on blind tickets — and <b>0.94 on the same tickets lowercased</b>,
				after a case-augmented retrain. This is the one for
				<strong>redacting whole spreadsheets locally</strong> — drop in a CSV or Excel file, redact every
				cell in the browser, download it back, and <strong>nothing ever leaves the machine</strong>. Perfect
				for cleaning exports before they go to a vendor, an LLM, or a shared drive.
			</p>
		</div>
		<div class="card">
			<div class="pin">Best for maximum accuracy</div>
			<h3>nordic-v9</h3>
			<p>
				The 1.4B flagship, fine-tuned from OpenAI's privacy-filter. Most robust on the hardest cases —
				first names mid-sentence, unusual formats, tricky prose. Use it in the <strong>server pipeline</strong>
				(scrubbing tickets before an LLM sees them, ~16 ms/ticket on a GPU) or in the browser when you want
				the best possible detection and can spend the one-time 1.9 GB download.
			</p>
		</div>
		<div class="card">
			<div class="pin">Always on, alongside either</div>
			<h3>Checksum detectors</h3>
			<p>
				Not AI at all — exact algorithms that <em>validate</em> identifiers: fødselsnummer (mod-11),
				personnummer (Luhn), IBAN (mod-97), payment cards (Luhn). Zero false positives on the things they
				catch, instant, tiny. They run in <strong>both</strong> browser engines to lock down structured PII
				that a neural model might phrase-match imperfectly, while deliberately leaving org numbers and
				switchboards alone.
			</p>
		</div>
	</div>

	<h2>The short version</h2>
	<ul class="pick">
		<li><strong>Cleaning a CSV/Excel export on your own machine?</strong> → <b>nordic-ner</b> (fast, local, all nine types).</li>
		<li><strong>Scrubbing tickets in a server pipeline before an LLM?</strong> → <b>nordic-v9</b> on the server.</li>
		<li><strong>Need certainty on IDs, phones, IBANs?</strong> → <b>checksum detectors</b> — always running under both.</li>
		<li><strong>Want the best detection with zero infrastructure?</strong> → <b>nordic-v9</b> in the browser (WebGPU).</li>
	</ul>

	<div class="note">
		<strong>Honest caveat on the numbers.</strong> The blind sets of real tickets contain
		<strong>no address, url or secret spans at all</strong> — so these scores really cover the six
		types that do appear (person, phone, e-mail, national id, account number, date). Address
		accuracy is only measured on held-out <em>synthetic</em> text, where the case-augmented retrain
		took lowercase addresses from 0.41 to 0.99. nordic-ner's figure is measured at token-span
		granularity; nordic-v9's 0.86–0.93 are character-exact spans on (partly different) blind sets,
		and nordic-v9 has <em>not</em> had the case-augmented retrain yet, so it is still the weaker of
		the two on lowercase input. The small model is
		genuinely strong — remarkably so for its size — but the 1.4B flagship remains more robust on the messiest
		real-world prose. Both were validated only on tickets they never trained on.
	</div>

	<p class="foot">
		Curious how the in-browser models run with zero data leaving your machine?
		<a href="/how-it-works">How it works →</a>
	</p>
</main>

<style>
	:root {
		--paper: #f2f4f1; --card: #fff; --ink: #171a18; --ink-2: #4a544d; --ink-3: #79837c;
		--rule: #d8ddd8; --accent: #188a4f; --accent-soft: #e2f0e7;
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--paper: #151815; --card: #1f2420; --ink: #e8ece8; --ink-2: #aeb8b0; --ink-3: #7e8880;
			--rule: #2e352f; --accent: #2fa067; --accent-soft: #1c3227;
		}
	}
	:global(body) { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.6 system-ui, sans-serif; }
	main { max-width: 74ch; margin: 0 auto; padding: 48px 20px 90px; }
	.eyebrow { font-family: ui-monospace, monospace; font-size: 0.74rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin: 0; }
	h1 { margin: 8px 0 0; font-size: 2.2rem; line-height: 1.1; letter-spacing: -0.01em; }
	h2 { font-size: 1.4rem; margin: 46px 0 12px; padding-top: 22px; border-top: 1px solid var(--rule); }
	h3 { margin: 4px 0 6px; font-size: 1.1rem; }
	.lede { color: var(--ink-2); }
	a { color: var(--accent); }
	.mono { font-family: ui-monospace, monospace; font-size: 0.92em; }
	.s { font-size: 0.76rem; color: var(--ink-3); }
	.tablewrap { overflow-x: auto; border: 1px solid var(--rule); border-radius: 12px; background: var(--card); margin: 18px 0 6px; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
	th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--rule); vertical-align: top; }
	th { font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-3); }
	td.n, th.n { font-variant-numeric: tabular-nums; }
	tr:last-child td { border-bottom: none; }
	.fn { font-size: 0.8rem; color: var(--ink-3); }
	.cards { display: grid; gap: 14px; margin: 14px 0; }
	.card { background: var(--card); border: 1px solid var(--rule); border-radius: 12px; padding: 16px 18px; }
	.card p { margin: 0; font-size: 0.94rem; }
	.pin { display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--accent); background: var(--accent-soft); padding: 3px 10px; border-radius: 999px; margin-bottom: 8px; }
	.pick { padding-left: 18px; }
	.pick li { margin: 8px 0; }
	.pick b { color: var(--accent); }
	.note { border-left: 3px solid var(--accent); background: var(--card); border-radius: 0 10px 10px 0; padding: 12px 18px; margin: 20px 0; font-size: 0.92rem; color: var(--ink-2); }
	.foot { margin-top: 40px; border-top: 1px solid var(--rule); padding-top: 14px; color: var(--ink-2); }
</style>
