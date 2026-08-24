import { describe, expect, test } from 'bun:test'
import { isReadOnlyQuery } from '../analysis/lib.ts'

describe('isReadOnlyQuery', () => {
  test('accepts SELECT and WITH queries, ignoring leading whitespace', () => {
    expect(isReadOnlyQuery('SELECT 1')).toBe(true)
    expect(isReadOnlyQuery('  \n SELECT 1')).toBe(true)
    expect(isReadOnlyQuery('WITH t AS (SELECT 1) SELECT * FROM t')).toBe(true)
  })

  test('rejects write statements and empty input', () => {
    expect(isReadOnlyQuery('INSERT INTO t VALUES (1)')).toBe(false)
    expect(isReadOnlyQuery('CREATE TABLE t (x Int8)')).toBe(false)
    expect(isReadOnlyQuery('DROP TABLE t')).toBe(false)
    expect(isReadOnlyQuery('')).toBe(false)
    expect(isReadOnlyQuery('   \n  ')).toBe(false)
  })
})
