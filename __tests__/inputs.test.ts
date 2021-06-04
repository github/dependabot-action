import {Context} from '@actions/github/lib/context'
import {getJobParameters, DISPATCH_EVENT_NAME} from '../src/inputs'

test('raises error on issue_comment', () => {
  const ctx = new Context()
  ctx.eventName = 'issue_comment'

  expect(getJobParameters(ctx)).toBeNull
})

test('loads repository_dispatch', () => {
  const ctx = new Context()
  ctx.eventName = 'repository_dispatch'
  ctx.payload = {
    action: DISPATCH_EVENT_NAME,
    client_payload: {
      jobID: 1,
      jobToken: 'xxx',
      credentialsToken: 'yyy'
    }
  }

  const params = getJobParameters(ctx)
  expect(params?.jobID).toEqual(1)
  expect(params?.jobToken).toEqual('xxx')
  expect(params?.credentialsToken).toEqual('yyy')
})

test('loads dynamic', () => {
  const ctx = new Context()
  ctx.eventName = 'dynamic'
  ctx.payload = {
    inputs: {
      jobID: 1,
      jobToken: 'xxx',
      credentialsToken: 'yyy'
    }
  }

  const params = getJobParameters(ctx)
  expect(params?.jobID).toEqual(1)
  expect(params?.jobToken).toEqual('xxx')
  expect(params?.credentialsToken).toEqual('yyy')
})

test('loads workflow_dispatch', () => {
  const ctx = new Context()
  ctx.eventName = 'workflow_dispatch'
  ctx.payload = {
    inputs: {
      jobID: '1',
      jobToken: 'xxx',
      credentialsToken: 'yyy'
    }
  }

  const params = getJobParameters(ctx)
  expect(params?.jobID).toEqual(1)
  expect(params?.jobToken).toEqual('xxx')
  expect(params?.credentialsToken).toEqual('yyy')
})
