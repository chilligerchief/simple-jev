# Simple-JEV

Standalone classifier HTTP API using Hugging Face Transformers and PyTorch.
Classifier validation, prompt text, and response scoring come from the sibling
`common/` folder. Keep both folders in the checkout. No Open-JEV or vLLM runtime
is required. The HF package includes `common` when installed/built from this repo.

## Install and run

Use Python 3.12 or newer. Install the appropriate PyTorch build for your CPU,
CUDA or ROCm environment first, then install this package in that environment:

```bash
cd /path/to/simple-jev
python -m venv .venv
source .venv/bin/activate
# Install your hardware-specific PyTorch build here.
pip install -e './hf-server[test]'
simple-jev --model /path/to/downloaded/model --device auto \
  --dtype bfloat16 --max-model-len 32768 \
  --max-batch-size 32 --max-batch-tokens 32768 --port 8000
```

Or run the file directly from the checkout:

```bash
python hf-server/hf_server.py --model /path/to/model --device cpu --dtype float32
```

After installation, `python -m hf_server` accepts the same arguments.
Choose a context limit supported by the model. CPU testing can use
`--device cpu --dtype float32`. Model IDs from Hugging Face are also accepted;
a local model directory avoids downloading weights again.

## API

See the [complete HTTP API reference](API_REFERENCE.md) for all request fields,
options, response formats, errors, limits, metrics and server arguments.

`POST /v1/classifier` and its alias `POST /v1/systemone` return non-streaming JSON.
`GET /health` reports readiness. `/docs` provides the generated API schema.
The request model must match the name/path passed to `--model`.

```json
{
  "model": "/path/to/downloaded/model",
  "messages": [{"role": "user", "content": "Mia owns a red bicycle. Her dog is named Max."}],
  "questions": {
    "color": {
      "type": "choice",
      "instructions": "What color is Mia's bicycle?",
      "criteria": {"red": null, "blue": null}
    },
    "dog": {"type": "noul", "instructions": "Is the dog named Max?"},
    "support": {
      "type": "score",
      "instructions": "How well does the context support that Mia owns a bicycle?",
      "criteria": ["Unsupported", "Supported"]
    }
  }
}
```

Supply exactly one of `messages` or `state`. State accepts text or JSON.
Chat uses the model tokenizer's chat template. Choice and score support up to
50 entries. The server defaults to 100 scoring branches per request;
`--max-request-branches` configures the limit. The shared v1 template uses exactly one branch per question. Legacy choice/score
modes and score-format switches are no longer accepted.
Invalid input returns readable 422 errors; a full queue returns 429.

Responses contain `model`, `answers`, and `usage`. Answers include confidence.
`usage.input_tokens` counts unique token prefixes once, not the entire shared
context once per question. `usage.output_tokens` is zero: this implementation
reads logits without sampling any output tokens. Set
`ENABLE_OPEN_JEV_ADVANCED_METRICS=1` to include detailed timing and metadata.
Standard completion settings such as `max_tokens` and `temperature` are ignored.

## Optional prompt formats (Transformers only)

Select a server-wide format explicitly; the default `baseline` leaves the
existing common v1 prompts and scoring unchanged:

```bash
simple-jev --model Qwen/Qwen3.8-27B --device auto \
  --classifier-prompt-policy examples_binary
```

| Model | Policy |
|---|---|
| Qwen/Qwen3.8-27B | `examples_binary` |
| Qwen/Qwen3.6-35B-A3B | `repeat_state` |
| Qwen/Qwen3.5-4B | `strict_mix_repeat2` |
| google/gemma-4-26B-A4B-it | `strict_mix_repeat2` |
| google/gemma-4-12B-it | `strict_mix_repeat2` |

- `examples_binary`: strict decision rules, worked examples, raw text/pretty
  JSON state once, and binary no/yes Noul scoring.
- `repeat_state`: the same format with an explicitly marked second state copy.
- `strict_mix_repeat2`: strict rules, the entire user block twice, and the
  evaluated nine-bin Noul wording/scoring. No extra worked-example block.

The three named policies accept **text/JSON `state` only**, not `messages`;
use `baseline` to preserve text chat turns. HF still rejects images/tools.
Choice branches prefill three fixed `[thinking]` lines through the model's native
chat template; Score/Noul branches answer directly. This does not generate
reasoning or output tokens. A template that drops the fixed prefill is rejected.
Binary Noul returns `{"type":"noul","noul":P(yes)}` in [0,1], with no nine-bin
0.01–0.99 remapping or nested rating diagnostics. Choice/Score math is unchanged.

These formats came from vLLM prompt-selection experiments. A subsequent
[477-case HF/vLLM comparison](../eval/benchmarks/hf-vllm-parity/2026-09-24/README.md)
completed all five HF GPU runs: decision agreement was 468–477/477, but numeric
parity was not exact. Qwen prompt tokens matched; the saved Gemma vLLM traces
contained one extra system-boundary space token. These are development-set
measurements, not held-out results or a throughput benchmark.
Repetition consumes additional context; the complete rendered branch remains
subject to `--max-model-len`. Advanced metadata identifies
`hf-<policy>-v1` instead of the baseline `v1` template.

This is a prompt/scoring-adapter addition only: model loading, precision, cache
reuse, batching, locking, admission and inference code are unchanged. No worker,
stream, FP8, kernel, or other performance optimizations are included. Laya keeps
its native formatting and rejects non-baseline prompt policies at startup.
Implementation: `hf_prompt_policies.py`, packaged alongside `hf_server.py`.

## Shared-prefix execution

The compiler calls `common.prepare_prompt(request, version="v1")`, assembles the
returned strings with state/chat roles, and applies the model chat template.
See [the v1 specification](../common/PROMPT_STRUCTURE_V1.md). Compile each
question, find their exact common token prefix, and run that prefix once with
`use_cache=True`. For each suffix batch, copy the prefix cache and repeat its
rows with the Transformers cache API, then score the question suffixes in
parallel. The seed cache remains unchanged. Results return in request order.

Suffixes are grouped by length, bounded by both batch size and padded suffix
token budget. Each suffix selects its own final logit position. Requests execute
serially against the model; parallelism is within each request. Prefix reuse is
within a request, with no persistent cross-request cache. The prefix itself is
one forward and is not chunked by `--max-batch-tokens`.

## Scope and validation

This reference currently accepts **text only**, including text messages.
Images, audio, video and tool calls are rejected. A multimodal model loader does
not imply multimodal input support. Models need a compatible Transformers cache
that supports copying and `reorder_cache`, a chat template, and single-token
rating/choice labels. Arbitrary model compatibility is not guaranteed.

The shared v1 prompt and scoring rules are the source of truth for the default
`baseline` format; opt-in policy differences are described above.
It does not claim exact numeric equivalence with another inference engine.
Tests compare reused-cache logits against independent full-prompt forwards for
tiny Qwen3, Qwen3.5, Gemma2 and Gemma4 models, and exercise API validation,
confidence, usage accounting and endpoint aliases. They use random local models,
without downloading weights; they do not measure answer quality.

```bash
python -m pytest -c hf-server/pyproject.toml common/tests hf-server/tests -q
```

## Laya backend

Install the optional SDK and select the backend explicitly:

```bash
pip install -e './hf-server[laya,test]'
USE_TF=0 python hf-server/hf_server.py \
  --backend laya --model convaiinnovations/laya --device cpu
# Add --subfolder multilingual or --subfolder typed-decisions for those checkpoints.
```

`--backend transformers` remains the default; existing Qwen and other causal HF
model commands are unchanged. Laya loads once per process and uses its own
encoder/option-marker format, not the common v1 assistant-prefill template.
`--revision` selects the downloaded checkpoint revision. `--device auto` lets the
SDK select CUDA, MPS, or CPU; `--dtype` and the HF suffix batching controls apply
only to Transformers. Laya uses its SDK precision policy and batches the admitted
questions together; `--max-request-branches` bounds that batch.

The endpoint and `ClassifierRequest` stay the same. Send the repository ID as
`model`, including when a subfolder is selected at startup. Text `messages` are
serialized as a list of role/content objects. Images, tools, message extras, and
raw-logit diagnostics are rejected. Context overflow is rejected before inference;
the effective limit is the smaller of `--max-model-len` and the checkpoint's native
`max_len`. Laya's native formatter still budgets/truncates question and option text
according to its own `head_max_len` rules.

Choice/score probabilities retain the SDK's temperature scaling, confidence is
the largest returned probability, and Noul is its native binary positive-class
probability (not the v1 nine-bin mapping). SDK action fields are omitted. Token
usage sums the actual per-question sequences, so repeated context is counted;
output tokens are zero. Advanced metadata identifies the format as `laya-native`.
The shared admission queue and a model lock bound concurrent work; cancellation
cannot interrupt an already running PyTorch forward.

Validation on macOS (2026-09-20): 50 common/server tests passed, including tiny
Qwen/Gemma backend regression tests and Laya adapter validation. Real weights for
`convaiinnovations/laya` and `Qwen/Qwen3.5-0.8B` both returned HTTP 200 through the
ASGI classifier route on CPU for a combined choice/score/Noul request, and rejected
an incorrect model ID with HTTP 422. Laya used 93 input tokens; Qwen used 751.
This validates integration, not accuracy: the small Qwen answered the example's
Noul question incorrectly. Direct MPS loading of Qwen crashed natively on this
Mac, so this run does not establish MPS compatibility. Laya's multilingual subfolder loading is covered by adapter tests, not real-weight
inference in this validation run. Typed Decisions extension validation is below.


### Experimental 2× Laya RoPE interpolation

For the ModernBERT Typed Decisions checkpoint:

```bash
USE_TF=0 python hf-server/hf_server.py \
  --backend laya --model convaiinnovations/laya \
  --subfolder typed-decisions --device cpu \
  --rope-factor 2 --max-model-len 2048
```

This halves full-attention and sliding-attention rotary inverse frequencies,
so position p has the original rotary angle at p/2. It doubles the checkpoint's
native sequence budget (1,024 → 2,048 here); the admission limit still respects
`--max-model-len`. It does not enlarge the sliding attention window. The flag
only supports unscaled ModernBERT RoPE and rejects other backends/architectures.
The default factor is 1, preserving existing model behavior. This is experimental:
long-input execution is not evidence of accuracy or calibration, and interpolation
also changes behavior on shorter inputs. No weights or downloaded configs are
modified; changes apply to the loaded process only.

Extension validation: all 52 tests passed. Real Typed Decisions weights with 2×
interpolation returned HTTP 200 for a 1,417-token sequence and chose the requested
refund category. An oversized sequence returned HTTP 422 at the 2,048-token limit.
This is an execution smoke test, not a long-context accuracy benchmark.


### General RoPE extension

`--rope-factor 2` enables experimental linear position interpolation for either
backend. The default is 1 (no change). Finite factors greater than 1, including
fractional factors (for example `--rope-factor 1.5`), are accepted. Rotary scaling
uses the exact factor; resulting token capacities are rounded down to integers. `--laya-rope-factor` remains a CLI alias.

```bash
python hf-server/hf_server.py \
  --model Qwen/Qwen3.5-0.8B --device cpu --dtype float32 \
  --rope-factor 2 --max-model-len 2048
```

For Transformers, the server configures the text model's native linear RoPE
implementation before loading weights, retaining theta, partial-rotation, and
multimodal-axis settings. The text positional capacity is multiplied by the
factor. Existing non-default scaling schemes and missing RoPE configuration are
rejected. Vision encoder settings are not changed. Laya retains the ModernBERT
implementation described above and doubles its checkpoint sequence budget at 2×.
`--max-model-len` remains the independent input admission limit: RoPE scaling does
not multiply this setting. These options are experimental, not a promise that
all Hugging Face architectures support extended context or retain model quality.
