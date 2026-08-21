import { readIntegerEnv, readStringEnv } from './env.ts'
import { readStdin, writeStdout } from './io.ts'
import { judgeJson } from './openrouter.ts'
import { f1Score } from './summary.ts'

type JsonObject = Record<string, unknown>
type AnswerType = 'Single Answer' | 'Set Answer' | string

interface GraderInput {
  trial: {
    task: { prompts: string[]; metadata?: JsonObject }
    result: { message?: string; status: string }
  }
}

interface CorrectnessDetail {
  expected: string
  found: boolean
  explanation?: string
}

interface NormalizedJudgeResult {
  details: CorrectnessDetail[]
  excessiveAnswers: string[]
  rationale: string
}

export interface AnswerScore {
  score: number
  pass: boolean
  correctCount: number
  expectedCount: number
  excessiveCount: number
}

const SYSTEM_PROMPT = `You are a strict but fair DeepSearchQA answer grader.
Compare the candidate answer to the gold answer. Grade semantic correctness, not exact wording.
Do not reward citations, style, or extra explanation. Do not use outside knowledge except to judge equivalence.
Return only strict JSON with these fields:
{
  "Correctness Details": [{"expected": "required gold answer part", "found": true/false, "explanation": "short reason"}],
  "Excessive Answers": ["incorrect extra answer parts only"],
  "Rationale": "brief summary"
}`

if (import.meta.main) {
  const input = (await readStdin()) as GraderInput
  writeStdout(await gradeFromInput(input))
}

export async function gradeFromInput(input: GraderInput): Promise<object> {
  const metadata = input.trial.task.metadata ?? {}
  const expected = metadata.expected_answer
  if (expected === null || expected === undefined || String(expected).trim() === '') {
    return {
      pass: false,
      score: 0,
      reasoning: 'No expected_answer metadata was available; row is ungradable and excluded from adjusted metrics.',
      outcome: { gradable: false, reason: 'missing_expected_answer' },
    }
  }

  const answerType = String(metadata.answer_type ?? 'Set Answer') as AnswerType
  const model = readStringEnv('JUDGE_MODEL', 'deepseek/deepseek-v4-flash-0731')
  const fallbackModel = readStringEnv('JUDGE_FALLBACK_MODEL', 'qwen/qwen3.6-flash')
  const timeoutMs = readIntegerEnv('JUDGE_TIMEOUT_MS', 180_000, 1)
  const user = buildJudgePrompt({
    question: input.trial.task.prompts.join('\n\n'),
    answerType,
    expectedAnswer: String(expected),
    candidateAnswer: input.trial.result.message ?? '',
  })

  let usedModel = model
  let fallbackReason: string | undefined
  let judged: NormalizedJudgeResult
  try {
    judged = await judgeWithModel(model, user, timeoutMs)
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : String(error)
    usedModel = fallbackModel
    judged = await judgeWithModel(fallbackModel, user, timeoutMs)
  }

  const answerScore = scoreJudgeResult(judged)
  return {
    pass: answerScore.pass,
    score: answerScore.score,
    reasoning:
      judged.rationale ||
      `Correct ${answerScore.correctCount}/${answerScore.expectedCount}; excessive ${answerScore.excessiveCount}.`,
    outcome: {
      gradable: true,
      model: usedModel,
      fallbackFrom: fallbackReason ? model : null,
      fallbackReason: fallbackReason ?? null,
      correctCount: answerScore.correctCount,
      expectedCount: answerScore.expectedCount,
      excessiveCount: answerScore.excessiveCount,
      correctnessDetails: judged.details,
      excessiveAnswers: judged.excessiveAnswers,
    },
  }
}

export function scoreJudgeResult(judged: NormalizedJudgeResult): AnswerScore {
  const expectedCount = judged.details.length
  const correctCount = judged.details.filter((detail) => detail.found).length
  const excessiveCount = judged.excessiveAnswers.length
  const score = f1Score(correctCount, expectedCount, excessiveCount)
  return { score, pass: score >= 0.8, correctCount, expectedCount, excessiveCount }
}

function buildJudgePrompt(params: {
  question: string
  answerType: AnswerType
  expectedAnswer: string
  candidateAnswer: string
}): string {
  const excessivePolicy =
    params.answerType === 'Single Answer'
      ? 'For Single Answer tasks, list an excessive answer only when the candidate gives an extra competing or contradictory final answer. Harmless context is not excessive.'
      : 'For Set Answer tasks, list any extra item that the candidate presents as part of the final answer but is not in the gold answer.'
  return JSON.stringify(
    {
      instruction: excessivePolicy,
      question: params.question,
      answer_type: params.answerType,
      gold_answer: params.expectedAnswer,
      candidate_answer: params.candidateAnswer,
    },
    null,
    2,
  )
}

async function judgeWithModel(model: string, user: string, timeoutMs: number): Promise<NormalizedJudgeResult> {
  const raw = await judgeJson<unknown>({ model, system: SYSTEM_PROMPT, user, timeoutMs })
  return normalizeJudgeResult(raw)
}

function normalizeJudgeResult(raw: unknown): NormalizedJudgeResult {
  const object = asObject(raw)
  if (!object) throw new Error('judge did not return an object')
  const detailsRaw = object['Correctness Details'] ?? object.correctnessDetails ?? object.correctness_details
  const excessiveRaw = object['Excessive Answers'] ?? object.excessiveAnswers ?? object.excessive_answers
  const details = normalizeDetails(detailsRaw)
  const excessiveAnswers = normalizeStringList(excessiveRaw)
  const rationale =
    typeof object.Rationale === 'string'
      ? object.Rationale
      : typeof object.rationale === 'string'
        ? object.rationale
        : ''
  if (details.length === 0) throw new Error('judge returned no Correctness Details')
  return { details, excessiveAnswers, rationale }
}

function normalizeDetails(raw: unknown): CorrectnessDetail[] {
  if (Array.isArray(raw))
    return raw.map(normalizeDetail).filter((detail): detail is CorrectnessDetail => detail !== undefined)
  const object = asObject(raw)
  if (!object) return []
  return Object.entries(object)
    .map(([expected, value]) => {
      if (typeof value === 'boolean') return { expected, found: value }
      const detail = asObject(value)
      if (!detail) return undefined
      return {
        expected,
        found: Boolean(detail.found ?? detail.correct),
        explanation: typeof detail.explanation === 'string' ? detail.explanation : undefined,
      }
    })
    .filter((detail): detail is CorrectnessDetail => detail !== undefined)
}

function normalizeDetail(raw: unknown): CorrectnessDetail | undefined {
  const object = asObject(raw)
  if (!object) return undefined
  const expected =
    typeof object.expected === 'string' ? object.expected : typeof object.answer === 'string' ? object.answer : ''
  const found = object.found
  if (!expected || typeof found !== 'boolean') return undefined
  return { expected, found, explanation: typeof object.explanation === 'string' ? object.explanation : undefined }
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((value) => String(value).trim()).filter(Boolean)
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined
}
