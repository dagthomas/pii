# Redactor in the Browser

Two engines, selectable on both pages, everything fully client-side:

- **Fast demo** — small multilingual NER (~65 MB) + checksum detectors (below).
- **nordic-v9** — the actual production model (custom 1.4B MoE), exported to ONNX
  with int8 expert weights (~1.9 GB, `static/models/`, downloaded once and cached),
  running via onnxruntime-web on WebGPU with WASM fallback. 99.96% token agreement
  with the server model; ~0.5 s/ticket on WebGPU after warm-up. Greedy span
  decoding (server uses Viterbi); 1,024-token cap per run. Sources in
  `src/lib/nordic/`; model rebuild: `export_onnx_q8.py` in the training repo.


SvelteKit demo of privacy redaction running **entirely in the visitor's browser**:
a multilingual NER model executes on the user's own GPU via WebGPU (WASM fallback)
through [Transformers.js], combined with checksum-validating detectors for Nordic
structured PII. No text ever leaves the machine — the page works offline once the
model (~65 MB, cached by the browser) is downloaded.

Measured on a dev box: model load from cache < 2 s, inference 150–1000 ms per
ticket on WebGPU.

## What detects what

| Category | Detector |
|---|---|
| person names | `distilbert-base-multilingual-cased-ner-hrl` (in-browser NER) |
| national IDs | fødselsnummer mod-11 + personnummer Luhn checksums |
| phones / e-mails | patterns + the production label policy (role mailboxes, switchboards and org numbers are deliberately NOT redacted) |
| IBAN / cards | mod-97 / Luhn checksums |

## Honest scope

This is **not** the production `nordic-v9` model (a custom 1.4B mixture-of-experts
network browsers can't run today — it would need an ONNX port plus custom runtime
code). Name detection here is noticeably weaker, especially on Nordic names;
the checksum detectors are exact. It demonstrates the *deployment concept* —
client-side redaction with zero data egress — not production accuracy.

## Batch mode — `/batch`

Upload a **CSV or Excel (.xlsx/.xls)** file, tick the columns that contain free
text (columns named message/text/body/… are preselected), and every cell is
redacted in-browser with a progress bar and cancel. Download comes back in the
same format (`*.redacted.csv` / `*.redacted.xlsx`; for Excel, other sheets are
preserved and a sheet picker appears for multi-sheet workbooks). A
"Load sample tickets" button and a downloadable `sample-tickets.csv` are built
in for trying it without your own data. Options: header-row toggle, NER on/off
(off = checksum/pattern detectors only, much faster for huge files).

## Develop / run

    npm install
    npm run dev          # http://localhost:5173
    npm run build && npm run preview

Structure: `src/lib/worker.ts` (model in a Web Worker), `src/lib/detectors.ts`
(pure checksum/pattern detectors + span merging), `src/lib/RedactorEngine.svelte.ts`
(reactive engine class), `src/routes/+page.svelte` (UI; `ssr = false`).

[Transformers.js]: https://github.com/huggingface/transformers.js
