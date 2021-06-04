import {Context} from '@actions/github/lib/context'
import {getInputs, DISPATCH_EVENT_NAME} from '../src/inputs'

test('raises error on issue_comment', () => {
  const ctx = new Context()
  ctx.eventName = 'issue_comment'

  expect(getInputs(ctx)).toBeNull
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

  const inputs = getInputs(ctx)
  expect(inputs?.jobID).toEqual(1)
  expect(inputs?.jobToken).toEqual('xxx')
  expect(inputs?.credentialsToken).toEqual('yyy')
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

  const inputs = getInputs(ctx)
  expect(inputs?.jobID).toEqual(1)
  expect(inputs?.jobToken).toEqual('xxx')
  expect(inputs?.credentialsToken).toEqual('yyy')
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

  const inputs = getInputs(ctx)
  expect(inputs?.jobID).toEqual(1)
  expect(inputs?.jobToken).toEqual('xxx')
  expect(inputs?.credentialsToken).toEqual('yyy')
})
