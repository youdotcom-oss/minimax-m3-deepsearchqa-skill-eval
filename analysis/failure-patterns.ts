// Direction 6: Synthesis of failure-success patterns across the full trajectory.
// No ClickHouse queries — this is a qualitative synthesis drawing on directions 6a, 6b, 6c,
// which run quantitative queries over graded.jsonl. Patterns, hypotheses, and candidate
// solutions are presented for each finding. Solutions map to levers in .auto/program.md when
// applicable; new candidates are noted.

const body = `## 6d. Synthesis: failure vs success — full-trajectory pattern analysis

Synthesis across three quantitative analyses (6a–6c, each a separate ClickHouse query over graded.jsonl) that measure: round-by-round profiles and assistant reasoning depth; query evolution, read repetition, and final-answer quality; search-to-read coupling, parallelism, first-round behavior, and read depth.

Each pattern below is a behavioral difference between PASS and FAIL gradable trials (K=3, 2667 trials with searches). Hypotheses and candidate solutions follow each pattern. The strongest structural signal is **trial length** — FAIL trials run 9.4–11.4 total rounds vs PASS's 5.3–7.1 — so many patterns are symptoms of persistent re-searching rather than independent failure modes.

### 6a. Round-by-round profiles and reasoning depth

See \`analysis/round-profile.ts\` for the full SQL and output.

**Round-by-round evolution:**
| Round | PASS searches | FAIL searches | PASS reads | FAIL reads | PASS pct_any_read | FAIL pct_any_read |
|-------|--------------|--------------|-----------|-----------|-------------------|-------------------|
| 1 | 2.12 | 2.16 | 0.02 | 0.02 | 2.0% | 1.6% |
| 2 | 0.76 | 0.85 | 1.03 | 1.01 | 80.8% | 80.8% |
| 3 | 1.24 | 1.24 | 0.50 | 0.60 | 43.1% | 51.9% |
| 4 | 0.98 | 1.07 | 0.61 | 0.68 | 52.6% | 59.6% |
| 5+ | 0.86 | 0.89 | 0.58 | 0.63 | 52.2% | 57.9% |

**Assistant reasoning depth by round:**
| Round | PASS avg_content_len | FAIL avg_content_len |
|-------|---------------------|---------------------|
| 1 | 138 | 138 |
| 2 | 166 | 131 |
| 3 | **643** | **413** |
| 4 | **719** | **470** |
| 5+ | **988** | **715** |

**Termination patterns:**
| | FAIL | PASS |
|---|---|---|
| avg_last_search_round | 9.43 | 5.28 |
| pct_zero_total_reads | 1.6% | **6.5%** |
| avg_reads_in_final_search_round | 0.32 | 0.27 |
| avg_gap (last_search - last_read round) | -0.24 | -0.27 |

**Pattern 1: Reasoning depth diverges at round 3.** PASS assistant messages grow richer after the initial search rounds (643→988 chars); FAIL messages stall at 413→715 — ~35% shorter from round 3 onward. Near-empty content (<50 chars) is negligible for both (<2%).

- Hypothesis A: The model loses track of accumulated findings — context saturation leads to shallower deliberation. → Candidate solution: periodic summarization of findings in the skill.
- Hypothesis B: FAIL happens first, and shallower reasoning is a *consequence*, not a cause — the model already suspects it can't answer and goes through the motions. → Harder to fix; possibly addressable with a "state what you know" checkpoint before each new search.
- Hypothesis C: PASS trials gain confidence from early reads and invest more reasoning in synthesis; FAIL trials never gain that confidence. → Candidate solution: require a confidence assessment after the first read pass (skill instruction L4-aligned).

**Pattern 2: Per-round tool intensity is nearly identical.** Both groups launch ~2 searches in round 1, ~0.8–1.2 in subsequent rounds, with ~50–80% of rounds having reads. FAIL does NOT escalate per-round search count. The volume difference is entirely from duration — FAIL runs 60% more rounds.

- Hypothesis A: FAIL trials exhaust their best queries early and then repeat with diminishing returns. → Candidate solution: stop-early (L3) — two rounds of reading without new information is enough to answer.
- Hypothesis B: The model can't find the answer because the task is intrinsically harder for this model/tool surface. → Not a lever; accept that some tasks are harder.

**Pattern 3: Zero-read trials skew PASS (6.5% vs 1.6%).** These are likely easy single-fact questions answered from parametric knowledge. → Not a failure mode; consistent with direction 2a's finding that 0-read trials score 0.97 F1 on single-fact questions.

### 6b. Query evolution, read repetition, and final-answer quality

See \`analysis/query-evolution.ts\` for the full SQL and output.

**Query evolution (3+ round trials):**
| | FAIL | PASS |
|---|---|---|
| avg_first_query_len | 66.3 | 64.9 |
| avg_last_query_len | 79.4 | 72.8 |
| avg_len_change | **+13.1** | **+8.0** |
| avg_round_span | **11.21** | **6.96** |
| pct_last_longer | 24.8% | 18.6% |

**Read repetition:**
| | FAIL | PASS |
|---|---|---|
| avg_distinct_urls | 10.4 | 6.8 |
| avg_total_reads | 11.4 | 7.2 |
| avg_repetition_ratio | 1.098 | 1.048 |
| pct_heavy_reread (ratio>1.5) | 3.7% | 2.1% |
| heavy_reread in 1-2 reads band | **5.6%** | **1.3%** |

**Final-answer quality:**
| | FAIL | PASS |
|---|---|---|
| avg_char_length | **3044** | **2672** |
| pct with Answer section | **32.1%** | **43.6%** |
| pct with Evidence section | 0.3% | 0.2% |
| pct with Sources section | 37.0% | 42.1% |
| avg_citations | 4.1 | 4.3 |
| pct_zero_citations | **15.9%** | **11.3%** |

**Pattern 4: FAIL answers are longer but less structured.** FAIL final answers average 3044 chars vs 2672 for PASS — ~14% longer. Yet they're 26% less likely to include an Answer section header (32% vs 44%) and 41% more likely to have zero citations (16% vs 11%). The Evidence section is dead: used in <0.3% of all trials.

- Hypothesis A: Verbosity substitutes for precision when the model is uncertain — it rambles instead of organizing. → Candidate solution: require Answer/Evidence/Sources structure (L5, already planned).
- Hypothesis B: The model omits the Answer section because it never converged on a clear answer — it's a symptom of the finding failure, not a formatting oversight. → Candidate solution: "if you can't find a definitive answer, state your best estimate and confidence level" (skill instruction).
- Hypothesis C: Long rambling answers may confuse the judge / make answer extraction harder, creating a self-reinforcing failure. → Candidate solution: enforce conciseness in the skill (e.g. "answer in ≤3 sentences" as a soft ceiling).

**Pattern 5: FAIL trials expand queries instead of refining them.** FAIL queries grow +13.1 chars from first to last vs +8.0 for PASS. The model is ~33% more likely to produce a last query that's much longer than the first. Common-prefix overlap is near-zero for both — the model rewrites queries entirely each round, never incrementally refining.

- Hypothesis A: The model treats each round as a fresh search problem rather than iteratively narrowing. → Candidate solution: "before searching, state what you already know and what specific gap the next query fills" (skill instruction to enforce incremental refinement).
- Hypothesis B: Expanding queries adds noise (more terms → less relevant results) rather than precision. → Candidate solution: "use 3–6 focused keywords; if results are poor, narrow, don't expand" (counter-instruction against query bloat).

**Pattern 6: Read repetition is weakly higher in FAIL, concentrated in low-read trials.** For the 1–2 reads band, FAIL = 5.6% heavy re-read vs PASS = 1.3% — a 4.3× gap. When FAIL trials read very little, they waste those few reads on the same unhelpful pages.

- Hypothesis A: The model misses its best results on the first pass and has no mechanism for triage. → Candidate solution: "after your first search, identify the 1–2 most promising URLs based on snippets before reading" (skill instruction, connects to L4 read-gate).
- Hypothesis B: The model anchors on the first domain and re-searches within it without noticing it's not yielding the answer. → Candidate solution: "if you've read two pages from the same domain and haven't found the answer, switch domains" (skill instruction).

### 6c. Search-to-read coupling, parallelism, and first-round behavior

See \`analysis/search-read-coupling.ts\` for the full SQL and output.

**Coupling (search + read in same round):**
| | FAIL | PASS |
|---|---|---|
| avg_coupled_rounds | 2.63 | 1.33 |
| avg_blind_rounds | 4.14 | 2.71 |
| pct_coupled | **38.8%** | **32.9%** |
| pct_blind | 61.2% | 67.1% |

**Parallelism:**
| | FAIL | PASS |
|---|---|---|
| pct_parallel (overall) | 51.5% | 49.7% |
| pct_parallel (1-round trials) | 83.6% | **92.6%** |
| avg_searches_per_round | 2.07 | 2.12 |

**First-round behavior:**
| | FAIL | PASS |
|---|---|---|
| avg_r1_searches | 2.18 | 2.14 |
| pct_single_search_r1 | 4.8% | **8.0%** |
| pct_has_read_in_r1 | 0.7% | 1.1% |

**Read depth by round (trials with 3+ rounds):**
| | Early (1–2) | Late (3+) |
|---|---|---|
| FAIL avg_urls_per_read | 1.51 | 1.63 |
| PASS avg_urls_per_read | 1.57 | **1.76** |
| FAIL pct_multi_url_read | 34.3% | 36.4% |
| PASS pct_multi_url_read | 35.4% | **39.5%** |

**Pattern 7: Search-to-read coupling is slightly HIGHER in FAIL, not lower.** FAIL couples 38.8% of search rounds vs PASS's 32.9%. The original hypothesis ("FAIL trials search without reading") is directly contradicted. FAIL trials do everything — search, read, couple — more, not differently.

- Hypothesis A: Coupling per se doesn't help — it's what the model does with the read that matters. → Not a lever on coupling; focus on reading effectiveness instead.
- Hypothesis B: Coupling rate is higher in FAIL because FAIL trials go deeper and coupling increases with depth (from 0% at round 1 to ~40% at 4+ rounds). The correlation is confounded by trial length. → No lever.

**Pattern 8: PASS is more parallel for short trials.** In 1-round trials, PASS = 92.6% parallel vs FAIL = 83.6% — PASS fires multiple parallel searches to saturate the first round before reading. In multi-round trials the gap narrows to ~4pp.

- Hypothesis A: Broad first-round exploration reduces the need for later rounds. → Candidate solution: skill instruction to use parallel searches in round 1 (possibly already natural behavior — the model does this ~85%+ of the time already).
- Hypothesis B: The model already saturates parallelism (avg 2.1 searches/round, close to the tool-call parallelism ceiling). → Not a lever.

**Pattern 9: PASS reads MORE URLs per call in later rounds.** PASS reads 1.76 URLs per contents call in late rounds vs FAIL's 1.63. The hypothesis that FAIL "grabs at straws" (more URLs per read) is refuted — FAIL reads MORE FREQUENTLY (7.0 reads/trial in late rounds vs 4.3) but with FEWER URLs per call. More granular, scattered reading rather than concentrated.

- Hypothesis A: FAIL reads many pages shallowly (1 URL at a time) without integrating findings across reads. → Candidate solution: "after reading 2–3 pages, pause and synthesize before reading more" (skill instruction, complements L4 read-gate).
- Hypothesis B: Granular reading is fine; the problem is reading the wrong pages, not too many. → Candidate solution: better result triage (see Pattern 6-A).

### Summary of candidate solutions by priority

Solutions that are already covered by program.md levers are marked. New candidates (not in the current program) are numbered for discussion.

| Priority | Pattern | Solution | Program lever |
|----------|---------|----------|---------------|
| High | 1 — Reasoning shallows at r3+ | Summarize findings periodically; confidence checkpoint after first read pass | L3 (stop-early), L4 (read-before-answer) |
| High | 4 — Long, unstructured fail answers | Require Answer/Evidence/Sources; "state your best estimate" when unsure | L5 (required sections) |
| High | 5 — Query expansion, not refinement | "State what you know and what gap the next query fills before each search" | New: incremental-refinement skill instruction |
| Medium | 2 — FAIL runs 60% more rounds | Stop early (L3); two rounds without new information → answer | L3 |
| Medium | 6 — Re-reading in low-read trials | Identify 1–2 most promising URLs before reading; switch domains if stuck | L4 (read-gate), New: domain-switch instruction |
| Medium | 3/8 — Zero-reads skew PASS, first-round parallels | Not a failure mode; already optimized behavior | — |
| Low | 9 — Granular reading in FAIL | "Pause and synthesize after 2–3 reads" | Complements L4 |
| Low | 7 — Coupling not differentiating | No lever — coupling is a confound of trial length | — |

### Caveats

- All patterns are **observational** across a single model (minimax-m3) × harness (Pi) × tool surface (You.com MCP). The "hypotheses" are untested and some may not transfer to other models.
- The trial-length confound is pervasive: FAIL trials are longer, so any per-trial aggregate (total reads, total searches, total couplings) is inflated for FAIL. Per-round normalization is used where possible, but residual confounding remains — longer trials may reflect intrinsically harder tasks.
- These patterns inform the auto-research \`.auto/program.md\` levers and seed ideas, but the final word is the 5-minute sample hill-climb and the full-eval validation gate, not observational correlations.`

export async function run(): Promise<string> {
  return body + '\n'
}

if (import.meta.main) await process.stdout.write(await run())
