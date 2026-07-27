import { describe, it, expect } from 'vitest'
import { createDb, query, insert, DB_QUERY_MS } from '../../src/sim/roomDb'

describe('roomDb', () => {
  it('seeded feed table hits as stale', () => {
    expect(query(createDb(), 'feed')).toEqual({ hit: true, fresh: false })
  })
  it('misses unknown key', () => {
    expect(query(createDb(), 'nope')).toEqual({ hit: false, fresh: false })
  })
  it('insert makes key fresh, immutably', () => {
    const s0 = createDb()
    const s1 = insert(s0, 'feed')
    expect(query(s1, 'feed')).toEqual({ hit: true, fresh: true })
    expect(query(s0, 'feed').fresh).toBe(false)
  })
  it('query cost constant is 30ms', () => {
    expect(DB_QUERY_MS).toBe(30)
  })
})
