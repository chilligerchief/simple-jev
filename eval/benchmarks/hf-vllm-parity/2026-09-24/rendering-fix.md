# Matched-token Gemma rerun after the rendering fix

Rendering is fixed in [`86d29ab`](https://github.com/featherless-ai/simple-jev/commit/86d29abde4b087b025efa86e1f01cdf0b92de678).
**Prompt parity is now exact; score/decision parity is still not exact.**
Both fresh Gemma GPU jobs succeeded with exit code zero. All 954 responses
passed source-coverage and raw-response replay audits, with no request failures.

| Model | Saved vLLM correct | HF before fix | HF after fix | Same decisions before → after |
| --- | ---: | ---: | ---: | ---: |
| Gemma4-12B-it | 427/477 | 430/477 | 427/477 | 474/477 → 473/477 |
| Gemma4-26B-A4B-it | 438/477 | 439/477 | 436/477 | 468/477 → 470/477 |

Gemma12B now matches the correct-count total, **not** all individual decisions.
Matching rendered tokens does not necessarily improve benchmark accuracy.
The fix was not selected or reverted based on the resulting scores.

## What changed

The native vLLM renderer passed message content as OpenAI text-block lists;
HF passed strings. Gemma's native template treats those representations
differently: list-form system content adds a trailing space before the turn
terminator. That explained the one-token difference in every original Gemma case.

Named HF policies now normalize content to text blocks **only at the native
chat-template boundary**. No model-name detection, hardcoded whitespace,
special token ID, or model-specific template override is used. Baseline
rendering, request/plan data, shared scoring, weights, precision, caches,
batching and inference code remain unchanged. This does not enable HF images.

Frozen-source reconstruction against original vLLM token traces confirms:

- **2,385/2,385 complete prompt-token sequences match** across all five models.
- **2,385/2,385 allowed answer-token lists match.**
- Qwen token sequences are unchanged by the fix, so only the affected Gemmas
  were rerun on GPU; Qwen's earlier GPU measurements remain separately recorded.
- Both Gemma reruns' recorded input-token counts now match vLLM on all 477 cases.

## Numeric differences remain

| Model | Mean absolute probability delta, before → after | Maximum absolute delta, before → after |
| --- | ---: | ---: |
| Gemma4-12B-it | 0.004697 → 0.003684 | 0.413337 → 0.431303 |
| Gemma4-26B-A4B-it | 0.007061 → 0.005215 | 0.900009 → 0.572239 |

The mean weights candidate-label entries equally, with Noul expanded into yes/no
probabilities. Remaining differences persist despite identical prompts; this
experiment does not isolate their cause or establish an acceptable tolerance.
Do not attribute them solely to rounding or claim backend equivalence.

Both reruns used the same pinned model revisions, explicit `strict_mix_repeat2`
policy, BF16 dtype, one MI325X each, 32,768-token context and software versions
as the [first measurement](README.md). The 477 cases are development/selection
data, not held-out evaluation. The vLLM reference was not rerun.

[rendering-fix.json](rendering-fix.json) contains per-suite counts, every changed
ID, raw Score/Noul deltas, token-replay commitments, runtime versions, successful
job IDs and evidence hashes. The original results remain in
[results.json](results.json); nothing was overwritten. Full local evidence is
under `/root/open-jev-experiments/hf-quick-parity/rendering-fix/`, which is not a
public CLI dependency.

Validation: **77 HF tests, 75 evaluation tests, 32 website tests passed**.
The source fix and derived results are published; no container rebuild or
production deployment is asserted.
