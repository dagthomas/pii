<svelte:head><title>How it works · Nordic PII</title></svelte:head>

<main>
	<p class="eyebrow">how it works</p>
	<h1>The AI runs in your browser. Nothing leaves.</h1>
	<p class="lede">
		Normally, "AI" means sending your text to a server. This page does the opposite: the model is
		downloaded <em>to</em> your browser and runs on your own hardware. Your documents, spreadsheets and
		names are never uploaded anywhere — there is no server to send them to.
	</p>

	<div class="flow" aria-hidden="true">
		<div class="node good"><div class="ic">💻</div><div class="lbl">Your browser</div><div class="sub">text + model + GPU</div></div>
		<div class="barrier"><span>no data crosses</span></div>
		<div class="node bad"><div class="ic">☁️</div><div class="lbl">Any server</div><div class="sub">never contacted</div></div>
	</div>
	<p class="cap">The only thing ever downloaded is the model file itself (once). Your text goes the other way: nowhere.</p>

	<h2>How a redaction actually happens</h2>
	<ol class="steps">
		<li><b>Download the model once.</b> On first use, the browser fetches the model file (135 MB for nordic-ner, ~1.9 GB for nordic-v14) and stores it in its local cache. Later visits reuse it — no re-download.</li>
		<li><b>Tokenise, in-page.</b> Your text is split into tokens by a tokenizer running in a background Web Worker. The text never leaves that worker.</li>
		<li><b>Run on your GPU.</b> The model executes via <span class="mono">WebGPU</span> — the browser's direct line to your graphics card — or falls back to <span class="mono">WebAssembly</span> on the CPU. Same maths a server would do, on your silicon.</li>
		<li><b>Redact and show.</b> The model labels each token as a person, phone, ID, etc.; those spans are blacked out and rendered. Nothing was transmitted at any step.</li>
	</ol>

	<h2>What makes it possible</h2>
	<div class="grid">
		<div class="cell"><div class="k">Transformers.js / ONNX Runtime Web</div><p>Libraries that run neural-network models directly in a web page, compiled to run on GPU or CPU.</p></div>
		<div class="cell"><div class="k">WebGPU</div><p>A modern browser API that gives web pages real access to the GPU — the reason a 1.4B-parameter model can run client-side in milliseconds.</p></div>
		<div class="cell"><div class="k">ONNX</div><p>An open model format. We export our PyTorch models to ONNX so the browser can load and run them unchanged.</p></div>
		<div class="cell"><div class="k">Web Workers + Cache Storage</div><p>The model runs off the main thread (the page stays responsive) and is cached locally so it downloads only once.</p></div>
	</div>

	<h2>Why this matters</h2>
	<p>
		Business documents and exports are full of personal data — names, national IDs, phone numbers. The
		safest way to scrub them is to <strong>never send them anywhere in the first place</strong>. Because the
		model runs locally:
	</p>
	<ul class="why">
		<li><strong>No data egress.</strong> Nothing to intercept, log, or leak — the text stays on the device.</li>
		<li><strong>Works offline.</strong> Once the model is cached, the page needs no network at all.</li>
		<li><strong>No per-request cost or rate limit.</strong> It's your GPU doing the work, as many times as you like.</li>
		<li><strong>Simple compliance story.</strong> "The data never left the user's browser" is the strongest possible answer to a GDPR question.</li>
	</ul>

	<div class="note">
		The trade-off: the model has to be downloaded to each browser (once), and inference speed depends on the
		visitor's hardware rather than a datacentre GPU. For bulk server-side scrubbing, the same models run on a
		backend instead. Same weights, same policy — you choose where the compute happens.
	</div>

	<p class="foot">
		Two engines are available on the <a href="/">redactor</a>, and the whole <a href="/models">model lineup</a>
		is described separately.
	</p>
</main>

<style>
	:root {
		--paper: #f2f4f1; --card: #fff; --ink: #171a18; --ink-2: #4a544d; --ink-3: #79837c;
		--rule: #d8ddd8; --accent: #188a4f; --accent-soft: #e2f0e7; --bad: #b3362a; --bad-soft: #f6e0dd;
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--paper: #151815; --card: #1f2420; --ink: #e8ece8; --ink-2: #aeb8b0; --ink-3: #7e8880;
			--rule: #2e352f; --accent: #2fa067; --accent-soft: #1c3227; --bad: #e07a6e; --bad-soft: #3b1f1b;
		}
	}
	:global(body) { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.6 system-ui, sans-serif; }
	main { max-width: 74ch; margin: 0 auto; padding: 48px 20px 90px; }
	.eyebrow { font-family: ui-monospace, monospace; font-size: 0.74rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin: 0; }
	h1 { margin: 8px 0 0; font-size: 2.2rem; line-height: 1.12; letter-spacing: -0.01em; text-wrap: balance; }
	h2 { font-size: 1.4rem; margin: 46px 0 12px; padding-top: 22px; border-top: 1px solid var(--rule); }
	.lede { color: var(--ink-2); }
	a { color: var(--accent); }
	.mono { font-family: ui-monospace, monospace; font-size: 0.92em; }
	.flow { display: flex; align-items: stretch; gap: 0; margin: 26px 0 4px; }
	.node { flex: 1; background: var(--card); border: 1px solid var(--rule); border-radius: 12px; padding: 18px; text-align: center; }
	.node.good { border-color: var(--accent); background: var(--accent-soft); }
	.node.bad { opacity: 0.6; }
	.ic { font-size: 1.8rem; }
	.lbl { font-weight: 700; margin-top: 6px; }
	.sub { font-size: 0.78rem; color: var(--ink-3); }
	.barrier { display: flex; align-items: center; justify-content: center; padding: 0 6px; position: relative; }
	.barrier::before { content: ''; position: absolute; top: 10%; bottom: 10%; width: 3px; background: repeating-linear-gradient(var(--bad), var(--bad) 6px, transparent 6px, transparent 12px); border-radius: 2px; }
	.barrier span { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 0.66rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--bad); background: var(--paper); padding: 6px 2px; font-weight: 600; }
	.cap { font-size: 0.84rem; color: var(--ink-3); }
	.steps { padding-left: 20px; }
	.steps li { margin: 12px 0; }
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
	.cell { background: var(--card); border: 1px solid var(--rule); border-radius: 12px; padding: 14px 16px; }
	.cell .k { font-weight: 700; font-size: 0.92rem; margin-bottom: 4px; }
	.cell p { margin: 0; font-size: 0.88rem; color: var(--ink-2); }
	.why { padding-left: 20px; }
	.why li { margin: 8px 0; }
	.note { border-left: 3px solid var(--accent); background: var(--card); border-radius: 0 10px 10px 0; padding: 12px 18px; margin: 22px 0; font-size: 0.92rem; color: var(--ink-2); }
	.foot { margin-top: 40px; border-top: 1px solid var(--rule); padding-top: 14px; color: var(--ink-2); }
	@media (max-width: 520px) {
		.flow { flex-direction: column; }
		.barrier { padding: 8px 0; }
		.barrier::before { top: auto; bottom: auto; left: 10%; right: 10%; height: 3px; width: auto; background: repeating-linear-gradient(90deg, var(--bad), var(--bad) 6px, transparent 6px, transparent 12px); }
		.barrier span { writing-mode: horizontal-tb; transform: none; }
	}
</style>
