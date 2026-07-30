import { describe, expect, it } from 'vitest'
import {
  cancelJobsFor, createJobs, dispatchJobs, enqueueJob, finishJob, runnableJobs, setDoze,
  type JobEnv,
} from '../../src/sim/jobs'

const AWAKE: JobEnv = { network: true, charging: false, idle: false, window: false }

describe('jobs', () => {
  it('starts empty and hands out increasing ids', () => {
    const s = enqueueJob(enqueueJob(createJobs(), 'chat', 'network'), 'maps', 'charging')
    expect(s.pending.map(j => j.id)).toEqual([1, 2])
    expect(s.done).toBe(0)
  })
  it('holds a job whose constraint is unmet', () => {
    const s = enqueueJob(createJobs(), 'chat', 'charging')
    expect(runnableJobs(s, AWAKE)).toEqual([])
    expect(runnableJobs(s, { ...AWAKE, charging: true })).toHaveLength(1)
  })
  it('runs nothing under Doze until a maintenance window opens', () => {
    const s = setDoze(enqueueJob(createJobs(), 'chat', 'network'), true)
    expect(runnableJobs(s, AWAKE)).toEqual([])
    expect(runnableJobs(s, { ...AWAKE, window: true })).toHaveLength(1)
  })
  it('dispatch moves runnable jobs to running, finish counts them done', () => {
    const s = dispatchJobs(enqueueJob(createJobs(), 'chat', 'network'), AWAKE)
    expect(s.pending).toEqual([])
    expect(s.running).toHaveLength(1)
    const after = finishJob(s, s.running[0].id)
    expect(after.running).toEqual([])
    expect(after.done).toBe(1)
  })
  it('finishing an unknown id changes nothing', () => {
    const s = dispatchJobs(enqueueJob(createJobs(), 'chat', 'network'), AWAKE)
    expect(finishJob(s, 999)).toBe(s)
  })
  it('process death cancels that app\'s pending and running jobs only', () => {
    let s = enqueueJob(enqueueJob(createJobs(), 'chat', 'network'), 'maps', 'network')
    s = dispatchJobs(s, AWAKE)
    s = enqueueJob(s, 'chat', 'charging')
    const after = cancelJobsFor(s, 'chat')
    expect(after.pending.every(j => j.app !== 'chat')).toBe(true)
    expect(after.running.map(j => j.app)).toEqual(['maps'])
  })
})
