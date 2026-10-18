# Benchmarks

## LongMemEval retrieval (recall@k)

### What is measured

Retrieval only. For each LongMemEval-S question, Engram stores the question's
haystack in a fresh, temporary database and asks `NeuralBrain.search(question)`
for the top 10 memories. A question is a **hit at k** if any of the top-k
memories belongs to one of the question's `answer_session_ids`.

- Each conversation turn (one `user:` or `assistant:` message) is stored as one
  episodic memory, tagged with its session id (`sessionId`).
- Abstention questions (`question_id` ending in `_abs`) are skipped, as in the
  LongMemEval paper.
- Reported: recall@1, recall@5 and recall@10, overall and per `question_type`,
  plus mean store latency and mean search latency per question.
- Search runs with `threshold: -1` so the full top-10 ranking is evaluated.
- Each question's temporary database (including SQLite `-wal`/`-shm` files and the
  vector index) is deleted after that question is evaluated.

### What is not measured

- No answer-generation LLM is involved. These numbers are **not** end-to-end QA
  accuracy and are not comparable to LongMemEval QA scores reported elsewhere.
- No reranker. Ranking is Engram's default retrieval only.

### Setup

- Dataset: LongMemEval-S cleaned, `longmemeval_s_cleaned.json` from
  <https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned>. The file is
  not stored in this repository.
- Embedding model: `Xenova/all-MiniLM-L6-v2` (384-dimensional), run locally with
  ONNX through `@xenova/transformers`. Remote model fetching is disabled during
  the benchmark, so the model must already be cached.
- Hardware: AMD Ryzen 7 5800X (8 cores / 12 threads), 31 GiB RAM, CPU only,
  WSL2 Linux.
- Runtime: Node.js v22.22.0, Engram core 0.7.0.

### Command

```sh
cd packages/core
pnpm bench:longmemeval --data /path/to/longmemeval_s_cleaned.json --out results.json
```

Flags:

- `--data <path>`: the LongMemEval JSON file.
- `--limit <N>`: evaluate only the first N non-abstention questions. This is a
  smoke-test subset, not a representative sample. The first questions in the
  file are all `single-session-user`.
- `--out <json>`: write the full result (counts, overall, per-type, latency,
  wall time) as JSON.

### Results

Full LongMemEval-S, non-abstention questions (TBD until the run completes):

| Slice | Questions | recall@1 | recall@5 | recall@10 |
|---|---:|---:|---:|---:|
| overall | TBD | TBD | TBD | TBD |
| single-session-user | TBD | TBD | TBD | TBD |
| single-session-assistant | TBD | TBD | TBD | TBD |
| single-session-preference | TBD | TBD | TBD | TBD |
| multi-session | TBD | TBD | TBD | TBD |
| temporal-reasoning | TBD | TBD | TBD | TBD |
| knowledge-update | TBD | TBD | TBD | TBD |

Latency (per question, CPU, local MiniLM): store TBD ms, search TBD ms. Wall time
for the full run: TBD.

### Caveats

- Local MiniLM-384 embeddings only. A larger or hosted embedding model will
  produce different numbers.
- No reranker and no query rewriting.
- Retrieval recall@k measures whether the evidence session is retrieved. It does
  not measure whether an answer generated from it is correct.
- Store latency includes embedding every turn sequentially, so it grows with
  haystack size and is dominated by the embedder on CPU.
- Single run, single machine. Latency numbers depend on load and hardware.
