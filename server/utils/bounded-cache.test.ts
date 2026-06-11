import { describe, it, expect } from 'vitest'
import { capMapSize } from './bounded-cache'

describe('capMapSize', () => {
  it('超過上限時淘汰最舊（最先插入）的 entry', () => {
    const map = new Map<string, number>()
    map.set('a', 1)
    map.set('b', 2)
    map.set('c', 3)
    capMapSize(map, 2)
    expect(map.size).toBe(2)
    expect(map.has('a')).toBe(false)
    expect(map.has('b')).toBe(true)
    expect(map.has('c')).toBe(true)
  })

  it('未超過上限時不動作', () => {
    const map = new Map([['a', 1]])
    capMapSize(map, 5)
    expect(map.size).toBe(1)
  })
})
