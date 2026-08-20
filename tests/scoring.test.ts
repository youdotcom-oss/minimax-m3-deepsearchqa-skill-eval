import { describe, expect, test } from "bun:test";
import { normalizeMessageRole } from "../src/adapter.ts";
import { scoreJudgeResult } from "../src/grader.ts";
import { collectFinalMessage } from "../src/pi-session.ts";
import { buildSummary, f1Score } from "../src/summary.ts";

describe("answer scoring", () => {
  test("computes F1 from correct, missing, and excessive answer parts", () => {
    expect(f1Score(2, 3, 1)).toBeCloseTo(2 / 3, 8);
  });

  test("passes at score >= 0.8", () => {
    const scored = scoreJudgeResult({
      details: [
        { expected: "A", found: true },
        { expected: "B", found: true },
        { expected: "C", found: true },
      ],
      excessiveAnswers: ["D"],
      rationale: "one extra",
    });
    expect(scored.score).toBeCloseTo(6 / 7, 8);
    expect(scored.pass).toBe(true);
  });

  test("penalizes excessive set-answer items", () => {
    const scored = scoreJudgeResult({
      details: [
        { expected: "A", found: true },
        { expected: "B", found: true },
      ],
      excessiveAnswers: ["C", "D"],
      rationale: "two extras",
    });
    expect(scored.score).toBeCloseTo(2 / 3, 8);
    expect(scored.pass).toBe(false);
  });
});

describe("summary metrics", () => {
  test("raw includes ungradable rows while adjusted excludes them", () => {
    const rows = [
      row("deepsearchqa-1", 0, 1, true, true),
      row("deepsearchqa-1", 1, 0.5, false, true),
      row("deepsearchqa-110", 0, 0, false, false),
    ];
    const summary = buildSummary(rows, { k: 2, model: "minimax/minimax-m3" });
    expect(summary.raw.trialCount).toBe(3);
    expect(summary.raw.taskCount).toBe(2);
    expect(summary.raw.averageScore).toBeCloseTo(0.5, 8);
    expect(summary.raw.exactPassAtK).toBeCloseTo(0.5, 8);
    expect(summary.adjusted.trialCount).toBe(2);
    expect(summary.adjusted.taskCount).toBe(1);
    expect(summary.adjusted.averageScore).toBeCloseTo(0.75, 8);
    expect(summary.adjusted.exactPassAtK).toBe(1);
    expect(summary.ungradableTrialCount).toBe(1);
  });
});

describe("adapter schema compatibility", () => {
  test("maps Pi toolResult messages to harness tool messages", () => {
    expect(normalizeMessageRole("toolResult")).toBe("tool");
    expect(normalizeMessageRole("assistant")).toBe("assistant");
    expect(normalizeMessageRole("unexpected")).toBeUndefined();
  });

  test("does not reuse stale assistant text when the final assistant turn is blank", () => {
    const session = {
      messages: [
        { role: "assistant", content: "I am still researching this." },
        { role: "toolResult", content: "tool output" },
        { role: "assistant", content: "" },
      ],
    };
    expect(collectFinalMessage(session as unknown as Parameters<typeof collectFinalMessage>[0])).toBe("");
  });
});

function row(taskId: string, trialIndex: number, score: number, pass: boolean, gradable: boolean): object {
  return {
    taskId,
    trialIndex,
    trial: { task: { metadata: { expected_answer: gradable ? "gold" : null, gradable } } },
    process: { toolCallCount: 2, failedToolCallCount: 0, errorCount: 0 },
    graderResults: [
      {
        id: "deepsearchqa-answer",
        type: "command",
        required: true,
        weight: 1,
        skipped: false,
        pass,
        score,
        reasoning: "test",
        outcome: { gradable },
      },
    ],
  };
}
