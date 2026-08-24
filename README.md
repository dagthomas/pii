# Redactor in the Browser

Two engines, selectable on both pages, everything fully client-side:

- **Fast demo** — `nordic-ner`, our own 135 MB int8 model (DistilBERT-multilingual-cased
  fine-tuned on the same Nordic data as the flagship) + checksum detectors (below).
- **nordic-v9** — the actual production model (custom 1.4B MoE), exported to ONNX
  with int8 expert weights (~1.9 GB, `static/models/`, downloaded once and cached),
  running via onnxruntime-web on WebGPU with WASM fallback. 99.96% token agreement
  with the server model; ~0.5 s/ticket on WebGPU after warm-up. Greedy span
  decoding (server uses Viterbi); 1,024-token cap per run. Sources in
  `src/lib/nordic/`; model rebuild: `export_onnx_q8.py` in the training repo.


SvelteKit demo of privacy redaction running **entirely in the visitor's browser**:
the NER model executes on the user's own GPU via WebGPU (WASM fallback) through
[Transformers.js] / onnxruntime-web, combined with checksum-validating detectors for
Nordic structured PII. No text ever leaves the machine — the page works offline once
the model is downloaded and cached.

Measured on a dev box: model load from cache < 2 s, inference 150–1000 ms per
ticket on WebGPU.

## What detects what

| Category | Detector |
|---|---|
| person names, addresses, dates, urls, secrets | `nordic-ner` / `nordic-v9` (in-browser NER) |
| national IDs | fødselsnummer mod-11 + personnummer Luhn checksums |
| e-mails / phones | patterns + the production label policy (role mailboxes, switchboards and org numbers are deliberately NOT redacted) |
| IBAN / cards | mod-97 / Luhn checksums |

There is deliberately **no hand-written detector for names or addresses**. Checksums are
exact algorithms and are part of the product; a street-name regex would be a guess that
hides how good the model actually is. Model gaps get fixed by retraining — see below.

## Casing

Both models are fine-tuned from *cased* backbones, and the corpus was ~99% properly cased,
so all-lowercase tickets used to lose names and miss street addresses entirely.
`nordic-ner` was retrained (2026-08-24) with lowercase / sentence-case / uppercase copies
of every span-bearing training example. On the blind set of real tickets, scored both ways:

| | cased | lowercased |
|---|---|---|
| before | 0.9369 | 0.7624 |
| after | **0.9505** | **0.9408** |

Cased did not regress. `nordic-v9` has **not** had this treatment yet and is still weaker
on lowercase input.

## Honest scope

Both engines here are the real models — `nordic-ner` is our own fine-tune and `nordic-v9`
is the production 1.4B mixture-of-experts network, ported to ONNX and run on WebGPU. This
demonstrates the deployment concept *and* production accuracy.

Two caveats worth stating plainly:

- **`private_address`, `private_url` and `secret` have never been evaluated on real data.**
  Every real held-out set contains zero address spans, so the headline "F1 0.94 across all
  nine PII types" really covers the ~6 types the blind sets actually contain. The address
  numbers above the fold come from a held-out *synthetic* set.
- `nordic-v9` decodes spans greedily in the browser (the server uses Viterbi) and caps
  input at 1,024 tokens per run. `nordic-ner` windows longer input instead of truncating.

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
