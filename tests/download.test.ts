import { describe, expect, test } from 'bun:test'

describe('HF artifact download CLI', () => {
  test('dry-run plans the default public dataset artifacts without trajectories', async () => {
    const proc = Bun.spawn(['python3', 'scripts/download.py', '--dry-run'], {
      cwd: `${import.meta.dir}/..`,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HF_DATASET_REPO: '', HF_REVISION: '', DATA_DIR: '' },
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    const plan = JSON.parse(stdout)
    expect(plan.repo_id).toBe('youdotcom/minimax-m3-deepsearchqa-skill-eval')
    expect(plan.revision).toBe('main')
    expect(plan.files.map((file: { remote: string }) => file.remote)).toEqual([
      'summary.json',
      'prompts.jsonl',
      'graded.jsonl',
    ])
  })

  test('non-dry-run download requires confirmation or --yes', async () => {
    const proc = Bun.spawn(['python3', 'scripts/download.py'], {
      cwd: `${import.meta.dir}/..`,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HF_DATASET_REPO: '', HF_REVISION: '', DATA_DIR: '' },
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exitCode).toBe(1)
    expect(stdout).toContain('About to download')
    expect(stdout).toContain('Refusing to download without confirmation')
    expect(stderr).toContain('Download cancelled.')
  })
})
