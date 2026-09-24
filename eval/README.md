# Endpoint evaluations

Run benchmarks against a Jev-compatible classifier endpoint accepting `model`,
`questions`, and either `state` (text) or image-bearing `messages` (vision).
Python 3.10+; the runner and offline tests use only the standard library.
Models run on the endpoint, so the evaluator needs no GPU.

## Run

From the repository root:

```sh
python3 eval/run.py \
  --endpoint http://localhost:8000/v1/classifier \
  --model YOUR_MODEL \
  --suite eval/suites/english/semif-authored.json \
  --output eval/results/first-run
```

Repeat `--suite` to run multiple benchmarks. For authentication, set a bearer key
in your environment and pass `--key-env JEV_API_KEY`. Use a new output directory
for each run. The included SemIf fixture needs no preparation; other datasets may.

## Portable presets and full reproduction

| Preset | Selection |
| --- | --- |
| `quick` | 231 native JevBench + 144 Authored + 102 TypeSafe = 477 decisions |
| `decision` | 20 English suites, covering the 26 matched decision items |
| `full-text` | 65 non-overlapping text suites: 86,747 input examples |
| `vision` | Seven configurations: 63,372 questions |
| `full` | `full-text` plus `vision`, without duplicate parent/child suites |

The full selections are pinned in `full-suites.json`. They retain the historical
BigCloneBench and ToolRet Web exclusions. The larger catalog also includes
opt-in suites and disjoint category partitions; **do not run every manifest**
or mix `quick` with the full JevBench tier suites, which reuse the same decisions.
The 477 cases were used for prompt development/selection, not held-out testing.

```sh
# No network, credentials, model, or dataset downloads needed to inspect a plan.
python3 eval/run.py --preset quick --list
python3 eval/run.py --preset full --list

# Build TypeSafe first using the verified upstream snapshots described below.
python3 eval/run.py --preset quick \
  --endpoint http://localhost:8000/v1/classifier --model YOUR_MODEL \
  --delay 0 --output eval/results/model-quick

# After preparing ALL selected datasets, substitute decision/full-text/vision/full.
python3 eval/run.py --preset decision \
  --endpoint http://localhost:8000/v1/classifier --model YOUR_MODEL \
  --workers 4 --delay 0 --output eval/results/model-decision

# Replays saved raw responses, checks exact source/ID coverage, and rescores offline.
python3 eval/audit.py --run eval/results/model-decision --preset decision

# Reproduce the equal-item decision aggregate, retaining native report metrics.
python3 eval/compare.py --mode decision \
  --report Model=eval/results/model-decision/report.json \
  --output eval/results/decision-comparison.json
```

`--list` reports dataset-file presence, **not** validation or asset completeness.
Execution validates all selected data/images before sending requests. Missing
sources fail explicitly; there is no synthetic replacement, silent truncation,
or silent suite skipping. Preparation commands and dataset-specific optional
packages are documented in [notes/README.md](notes/README.md). TypeSafe source
records and large downloaded text/image corpora are deliberately not bundled;
obtain them under their upstream terms. The authored and native public JevBench
fixtures are included and need no preparation.

Start the model server separately, with an explicit startup prompt policy. The
runner neither picks policies from model names nor installs runtime hooks. See
[HF startup configuration](../hf-server/README.md). Record the model revision,
policy, server revision, precision, and hardware in a non-secret JSON object and
optionally pass `--deployment-info FILE`; this is saved provenance, **not** a
server configuration request or verification of the remote deployment. Resume
requires identical supplied metadata, evaluator dependencies, data and settings.

Use an endpoint capable of the selected protocol: native Choice/Score/Noul,
image-bearing messages for vision, sufficient untruncated context, and (for
some full-suite ranking tasks) up to 255 candidates. The stock HF classifier's
50-candidate limit is **not** raised by this port; HF named policies currently
support text/state requests only. A backend capacity rejection is a failure,
not permission to shrink the benchmark. Do not point bulk runs at the limited
public demo. No GPU accuracy run, backend parity claim, or performance change
is part of this tooling migration.

`compare.py --mode quick` pools the 477 decisions; `--mode decision` uses the
26 matched English items; `--mode text` reports the 54 matched knowledge,
decision and ranking items separately. `--mode vision` averages the seven
per-question accuracies and preserves native MME points/POPE F1 separately.
Repeat `--report NAME=PATH` for models. Comparisons reject missing items,
failures, incomplete coverage, and mismatched question counts. They check
**report metadata**, not raw evidence: run `audit.py` first for every model.
Historical Jev references under `benchmarks/` are not new endpoint measurements.
The 26-item decision **comparison** contains 21,364 input examples and 33,099
scored questions; multi-label tasks account for the difference. The `decision`
preset keeps the mixed CodeMMLU parent intact for honest project-wide coverage,
so it also executes 11,501 CodeMMLU knowledge examples, excluded from that
aggregate (32,865 input examples executed in total).

Private cloud submission, saved job handles, experiment-only backend patches,
model caches and raw run archives are not required or copied. HTTP concurrency,
resume and repair work locally against separately managed endpoints. Historical
archive paths in benchmark provenance identify old evidence, not dependencies
of the portable CLI. See [migration provenance](PORTING.md).

## Prepare and browse

```sh
python3 eval/prepare.py --help
python3 eval/prepare.py knowledge --help
python3 eval/catalog.py                    # Our category splits
python3 eval/catalog.py --view project     # Named benchmark projects
python3 eval/catalog.py --write-doc        # Generate both catalogs in notes/
```

Converters download only when explicitly requested and never call models.
See the [benchmark notes](notes/README.md) for sources and preparation commands.

## Results

Runs save predictions, scoring inputs, provenance, and per-suite summaries.
`by-category.md` and `by-project.md` provide the two reporting views. Full project
scores are recomputed from examples, not averages of category scores.

```sh
python3 eval/report.py --run eval/results/first-run --view project
```

See [reporting](notes/REPORTING.md) for coverage, partial runs, and combining runs.

## Layout

| Path | Purpose |
| --- | --- |
| `run.py`, `retry.py`, `report.py` | Execute, resume, repair and report HTTP evaluations |
| `presets.py`, `full-suites.json` | Frozen quick/full selections |
| `audit.py`, `compare.py` | Replay completion evidence and compare matched metrics |
| `prepare.py`, `preparation/` | Dataset preparation CLI and converters |
| `catalog.py`, `taxonomy.json`, `suites/` | Benchmark definitions and grouping |
| `suites.py`, `adapters/` | Dataset loading, request mapping, and metrics |
| `tests/` | Offline checks |
| `notes/` | Detailed documentation and generated catalogs |
| `vendor/` | Pinned source metadata, fixtures, and upstream licenses |
| `data/` | Small committed fixtures; prepared datasets are ignored |
| `sources/`, `results/` | Ignored downloads and run artifacts |

```sh
python3 -m unittest discover -s eval -p 'test_*.py'
```

For the request contract, custom adapters, and baseline details, see the
[framework reference](notes/FRAMEWORK.md).

For long runs, `--workers 16 --delay 0.02` allows up to 16 concurrent requests,
with at least 20 ms between dispatches. Choose settings appropriate to your
endpoint. `--resume` continues an interrupted output directory with identical
settings/data, preserving every saved prediction (including failures). A malformed
partial JSONL record requires review rather than automatic deletion.

The runner pauses on authentication/billing rejection or 20 consecutive errors.
Retries apply to HTTP 429 and all HTTP 5xx server errors. Context-free questions send an
empty string for `state`, compatible with System One's non-null input contract.

Export small, tracked reports per project with `report.py --export`; see
[report storage](notes/REPORTING.md#store-benchmark-reports-in-git).

BigCloneBench is opt-in because it contains 415,416 examples. Full-run selectors
should skip manifests with `default_enabled: false`; explicit `--suite` selection
still works. Other coding benchmarks remain in the default set.

To repair saved server failures after a run finishes:

```sh
python3 eval/retry.py --run eval/results/first-run --key-env JEV_API_KEY
```

Omit `--key-env` for an unauthenticated local endpoint. Keep prepared images at
their original location for repair: saved asset bindings are restored and every
image checksum is revalidated before requests.

Only HTTP 5xx failures are retried. Successful predictions are preserved, original
failures are retained in `prior_results` and a retry journal, and scores are rebuilt.
Do not retry a run while another process is writing to it.

ToolRet Web is also disabled by default: its full candidate descriptions can exceed
32K context. ToolRet Code and Customized remain enabled; no silent truncation is applied.

## JevBench public accuracy

`jevbench-public` contains the 231 released decisions at upstream revision
`83831807458d7df424a1e53e5724f3a3ffe2cf89`: 48 easy, 72 original (public
standard-tier items), and 111 hard. The published 534-decision run also includes
held-out/imported items unavailable here; no judge-tier items are public.
This suite is the public subset, not a reproduction of that full leaderboard.

```sh
python eval/run.py --endpoint http://127.0.0.1:8000/v1/classifier \
  --model Qwen/Qwen3.5-4B --suite eval/suites/jevbench-public.json \
  --delay 0 --output eval/results/qwen35-4b-jevbench-public
```

The `jevbench-accuracy-v1` adapter preserves native choice, score and Noul
requests, including criteria order. Only state and the question's type,
instructions and criteria go to the endpoint. Labels, expected answers and
provenance stay local. It works with compatible classifier endpoints;
prompting remains endpoint-owned.

The headline is **unweighted accuracy: correct / scorable requested decisions**.
Each question counts once; no tier/family weighting, cost, speed, calibration,
or composite score is calculated. Summaries include correct counts, coverage
and accuracy by tier, family and primitive without averaging those breakdowns.
HTTP failures, context overflow and invalid distributions count wrong. All
bundled rows have gold answers; custom rows with `expected: null` are reported
as unscorable and excluded from accuracy, but still included in coverage.

Pinned upstream `scoring.py` supplies per-item semantics: choice and score use
argmax probabilities (score does **not** round the expected numeric score),
Noul maps `noul` to P(yes) and its complement to P(no). Exact ties use the
lexicographically smallest label, unlike the SemIf adapter's fixture-order tie
rule. Complete finite distributions are required, with upstream strict 0.1%
and accepted rounding 2% sum tolerances. The response's claimed choice/score
is not substituted for its distribution. There is no input truncation or RoPE
change in the evaluator.

**Published Jev 1.13.0 reference on these exact IDs: 200/231 = 86.58%.**
Easy:48/48; original:71/72; hard:81/111. Derived from upstream's public per-task
outcomes, not the weighted90.4% full-benchmark score or a new endpoint run.
`vendor/jevbench/jev-public-reference.json` records the outcomes and source hash.

The fixtures retain every original field and add only `tier`; upstream source
hashes are in `vendor/jevbench/source-manifest.json`. Pinned upstream scoring is
unmodified, with its MIT license retained. Sources:
https://github.com/fstandhartinger/jevbench/tree/83831807458d7df424a1e53e5724f3a3ffe2cf89
and `datasets/public/{easy,original,hard}.jsonl` at that revision.
