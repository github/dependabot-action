import {Context} from '@actions/github/lib/context'
import {getJobParameters} from '../src/inputs'

test('returns null on issue_comment', () => {
  const ctx = new Context()
  ctx.eventName = 'issue_comment'
  const params = getJobParameters(ctx)

  expect(params).toEqual(null)
})

test('loads dynamic', () => {
  const ctx = new Context()
  ctx.eventName = 'dynamic'
  ctx.payload = {
    inputs: {
      jobId: 1,
      jobToken: 'xxx',
      credentialsToken: 'yyy'
    }
  }

  const params = getJobParameters(ctx)
  expect(params?.jobId).toEqual(1)
  expect(params?.jobToken).toEqual('xxx')
  expect(params?.credentialsToken).toEqual('yyy')
})

test('loads workflow_dispatch', () => {
  const ctx = new Context()
  ctx.eventName = 'workflow_dispatch'
  ctx.payload = {
    inputs: {
      jobId: '1',
      jobToken: 'xxx',
      credentialsToken: 'yyy'
    }
  }

  const params = getJobParameters(ctx)
  expect(params?.jobId).toEqual(1)
  expect(params?.jobToken).toEqual('xxx')
  expect(params?.credentialsToken).toEqual('yyy')
})
