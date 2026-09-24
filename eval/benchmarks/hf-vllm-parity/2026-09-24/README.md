# HF versus saved vLLM — 477-case parity measurement

**Not exact parity.** All five HF GPU runs succeeded, with 2,385 responses,
zero failed requests, and successful raw-response/coverage audits. Only Qwen4B
matched every benchmark decision. No model matched probabilities exactly.

Measured HF source: [`f70a1a4`](https://github.com/featherless-ai/simple-jev/commit/f70a1a4c90e738929d9e6aa8dd1b92fcaa71c3a7).
The vLLM side uses the saved prompt-selection runs, **not** a new simultaneous
vLLM rerun. See [results.json](results.json) for revisions, native per-suite
counts, per-ID disagreements, numeric deltas, package versions and evidence hashes.

| Model | Explicit policy | Saved vLLM correct | HF correct | Same decision |
| --- | --- | ---: | ---: | ---: |
| Qwen3.8-27B | `examples_binary` | 449/477 | 447/477 | 473/477 |
| Qwen3.6-35B-A3B | `repeat_state` | 435/477 | 431/477 | 470/477 |
| Qwen3.5-4B | `strict_mix_repeat2` | 380/477 | 380/477 | 477/477 |
| Gemma4-26B-A4B-it | `strict_mix_repeat2` | 438/477 | 439/477 | 468/477 |
| Gemma4-12B-it | `strict_mix_repeat2` | 427/477 | 430/477 | 474/477 |

Correctness and agreement are different: matching totals alone would not prove
per-question parity. Native JevBench uses its pinned scorer, including argmax
for Score (not rounding its expected value). Returned Choice fields were also
compared separately; raw numeric Score/Noul differences remain in the JSON.

## Prompt-token audit

Reconstructed every HF prompt from the frozen compiler and actual recorded
request, using the same pinned tokenizer and Transformers/tokenizers versions
as inference. Reconstructed token lengths matched HF's recorded usage. Compared
these sequences with the original vLLM experiment's saved token traces:

- **All three Qwen models:** 477/477 complete token sequences match exactly.
- **Both Gemmas:** 0/477 sequences match exactly. Every vLLM sequence contains
  precisely one additional space token (`236743`) immediately before the system
  turn terminator (`<turn|>\n<|turn>user\n`). Removing that token produces the
  reconstructed HF sequence exactly. This is a rendering difference, not merely
  a usage-accounting difference.
- Allowed answer-token IDs match in all 2,385 cases.

Consequently, the Gemma results cannot isolate backend arithmetic from prompt
rendering. The Qwen results establish that token equality alone does not guarantee
identical backend probabilities or decisions. This measurement did **not** alter
prompts or inference implementation to force matching results.

## Probability differences

Absolute differences use returned candidate probabilities; Noul is represented
as `{yes: p, no: 1-p}`. The mean below weights each candidate-label entry equally.

| Model | Mean absolute delta | Maximum absolute delta |
| --- | ---: | ---: |
| Qwen3.8-27B | 0.002100 | 0.062419 |
| Qwen3.6-35B-A3B | 0.008500 | 0.329503 |
| Qwen3.5-4B | 0.004562 | 0.131499 |
| Gemma4-26B-A4B-it | 0.007061 | 0.900009 |
| Gemma4-12B-it | 0.004697 | 0.413337 |

These are observed differences, not an accepted numeric tolerance or a claim of
calibration. Gemma's larger differences include the input-format discrepancy.

## Execution and reproduction

Each model used one AMD MI325X, BF16 weights, its exact saved vLLM model revision,
32,768-token context, and its explicit selected startup policy. HF used
Transformers 5.16.1, Accelerate 1.15.0, tokenizers 0.23.2 and the pinned ROCm image
recorded in the JSON. The HTTP client sent one request at a time with no delay
or retries; HF batching/cache/kernel code was unchanged. Runtime configuration,
source hashes, requests, raw responses, scorer replay and unique complete IDs
were retained in the local measurement archive. All five cloud jobs terminated
successfully with exit code zero; their IDs are recorded in the JSON.

The exact fixtures are 231 public JevBench + 144 Authored + 102 TypeSafe. They
were used for prompt development/selection; this is **not held-out evaluation**,
a full-suite result, a vision test, or a throughput benchmark. Website scores
remain the original vLLM results and were not replaced with these HF measurements.

To make a new HF measurement, prepare the [quick fixtures](../../../README.md),
start the [HF server](../../../../hf-server/README.md) with the listed revision,
BF16 dtype, 32,768 context and explicit policy, then run:

```sh
python3 eval/run.py --preset quick --endpoint http://127.0.0.1:8000/v1/classifier \
  --model YOUR_EXACT_SERVED_MODEL --delay 0 --workers 1 --retries 0 --timeout 300 \
  --output eval/results/hf-quick
python3 eval/audit.py --run eval/results/hf-quick --preset quick
```

Use a new output directory for each model. Reproducing the two-backend comparison
also requires the saved reference predictions/token traces, or clearly labeled
fresh vLLM runs. Raw requests, TypeSafe source records, weights and full logs are
not redistributed here; the compact evidence file contains derived metrics and
hash commitments only. The local archive is
`/root/open-jev-experiments/hf-quick-parity/` (not a CLI dependency).
