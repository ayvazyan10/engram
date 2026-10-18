import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { NeuralBrain, embed, switchEmbeddingModel } from '../src/index.ts';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const TOP_K = 10;

interface Question {
  question_id: string;
  question_type: string;
  question: string;
  answer_session_ids: string[];
  haystack_session_ids: string[];
  haystack_sessions: { role: string; content: string }[][];
}

interface Recall {
  'recall@1': number;
  'recall@5': number;
  'recall@10': number;
}

interface Evaluation {
  type: string;
  recall: Recall;
  storeMs: number;
  searchMs: number;
}

interface Result {
  dataset: { source: string; file: string; path: string };
  model: string;
  topK: number;
  counts: { total: number; abstention: number; eligible: number; evaluated: number };
  overall: Recall;
  byType: Record<string, Recall & { count: number }>;
  latency: { storeMsMean: number; searchMsMean: number };
  wallSeconds: number;
}

function options() {
  const { values } = parseArgs({
    options: { limit: { type: 'string' }, data: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: false,
  });
  const limit = values.limit === undefined ? Infinity : Number(values.limit);
  if (values.limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  if (!values.data) throw new Error('--data <longmemeval_s_cleaned.json> is required (see docs/BENCHMARKS.md)');
  return { limit, data: values.data, out: values.out };
}

async function storeHaystack(brain: NeuralBrain, question: Question): Promise<void> {
  const inputs = question.haystack_sessions.flatMap((session, index) => {
    const sessionId = question.haystack_session_ids[index];
    if (sessionId === undefined) throw new Error(`Missing session id: ${question.question_id}/${index}`);
    return session.map((turn) => ({
      type: 'episodic' as const,
      content: `${turn.role}: ${turn.content}`,
      sessionId,
    }));
  });
  await brain.storeBatch(inputs);
}

async function evaluate(question: Question): Promise<Evaluation> {
  const directory = await mkdtemp(join(tmpdir(), 'engram-longmemeval-'));
  let brain: NeuralBrain | undefined;
  try {
    brain = new NeuralBrain({
      dbPath: join(directory, 'memory.sqlite'),
      indexPath: join(directory, 'memory.index'),
      defaultSource: 'longmemeval',
      contradictionConfig: { enabled: false },
      reflection: { enabled: false },
    });
    await brain.initialize();
    const storeStart = performance.now();
    await storeHaystack(brain, question);
    const storeMs = performance.now() - storeStart;
    const searchStart = performance.now();
    // Disable the API's similarity cutoff to evaluate the full top 10 ranking.
    const hits = await brain.search(question.question, { topK: TOP_K, threshold: -1 });
    const searchMs = performance.now() - searchStart;
    const relevant = new Set(question.answer_session_ids);
    const firstHit = hits.findIndex(hit => hit.sessionId !== null && relevant.has(hit.sessionId));
    return {
      type: question.question_type,
      recall: {
        'recall@1': Number(firstHit >= 0 && firstHit < 1),
        'recall@5': Number(firstHit >= 0 && firstHit < 5),
        'recall@10': Number(firstHit >= 0 && firstHit < 10),
      },
      storeMs,
      searchMs,
    };
  } finally {
    try {
      brain?.shutdown();
    } finally {
      // Also removes SQLite -wal/-shm sidecars and the persisted vector index.
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function meanRecall(evaluations: Evaluation[]): Recall {
  const sum: Recall = { 'recall@1': 0, 'recall@5': 0, 'recall@10': 0 };
  for (const { recall } of evaluations) {
    sum['recall@1'] += recall['recall@1'];
    sum['recall@5'] += recall['recall@5'];
    sum['recall@10'] += recall['recall@10'];
  }
  const count = evaluations.length || 1;
  return {
    'recall@1': sum['recall@1'] / count,
    'recall@5': sum['recall@5'] / count,
    'recall@10': sum['recall@10'] / count,
  };
}

function summarize(evaluations: Evaluation[]) {
  const byType: Result['byType'] = {};
  for (const type of new Set(evaluations.map(item => item.type))) {
    const group = evaluations.filter(item => item.type === type);
    byType[type] = { count: group.length, ...meanRecall(group) };
  }
  const count = evaluations.length || 1;
  return {
    overall: meanRecall(evaluations),
    byType,
    latency: {
      storeMsMean: evaluations.reduce((sum, item) => sum + item.storeMs, 0) / count,
      searchMsMean: evaluations.reduce((sum, item) => sum + item.searchMs, 0) / count,
    },
  };
}

function printSummary(result: Result): void {
  const rows = [['overall', { count: result.counts.evaluated, ...result.overall }] as const,
    ...Object.entries(result.byType)];
  const width = Math.max('question_type'.length, ...rows.map(([type]) => type.length));
  console.log(`\nLongMemEval retrieval | ${result.model} | topK=${result.topK}`);
  console.log(`${'question_type'.padEnd(width)}  count  recall@1  recall@5  recall@10`);
  for (const [type, row] of rows) {
    const recalls = [row['recall@1'], row['recall@5'], row['recall@10']]
      .map(value => `${(value * 100).toFixed(2)}%`.padStart(8)).join('  ');
    console.log(`${type.padEnd(width)}  ${String(row.count).padStart(5)}  ${recalls}`);
  }
  console.log(`Questions evaluated: ${result.counts.evaluated}; abstentions excluded: ${result.counts.abstention}`);
  console.log(`Mean store latency: ${result.latency.storeMsMean.toFixed(2)} ms/question`);
  console.log(`Mean search latency: ${result.latency.searchMsMean.toFixed(2)} ms/question`);
  console.log(`Wall time: ${result.wallSeconds.toFixed(2)} s`);
}

async function main(): Promise<void> {
  const start = performance.now();
  const args = options();
  const questions = JSON.parse(await readFile(args.data, 'utf8')) as Question[];
  const eligible = questions.filter(question => !question.question_id.endsWith('_abs'));
  const selected = eligible.slice(0, args.limit);
  if (selected.length === 0) throw new Error('No non-abstention questions to evaluate');
  // Configure the same Transformers module used by core; never fetch a model.
  const { env } = await import('@xenova/transformers');
  env.allowRemoteModels = false;
  switchEmbeddingModel(MODEL);
  // Fail before creating databases if the local model is unavailable. Loading
  // belongs to wall time, not the per-question store/search latency means.
  await embed('LongMemEval retrieval benchmark warmup');
  const evaluations: Evaluation[] = [];
  for (const question of selected) {
    evaluations.push(await evaluate(question));
    console.error(`[${evaluations.length}/${selected.length}] ${question.question_id}`);
  }
  const result: Result = {
    dataset: { source: 'xiaowu0162/longmemeval-cleaned', file: 'longmemeval_s_cleaned.json', path: args.data },
    model: MODEL,
    topK: TOP_K,
    counts: {
      total: questions.length,
      abstention: questions.length - eligible.length,
      eligible: eligible.length,
      evaluated: evaluations.length,
    },
    ...summarize(evaluations),
    wallSeconds: (performance.now() - start) / 1000,
  };
  if (args.out) await writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`);
  printSummary(result);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
