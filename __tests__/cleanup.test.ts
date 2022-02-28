import * as core from '@actions/core'

import {run} from '../src/cleanup'

describe('run', () => {
  beforeEach(async () => {
    jest.spyOn(core, 'error').mockImplementation(jest.fn())
  })

  test('it does not log any errors interacting with Docker by default', async () => {
    await run()

    expect(core.error).not.toHaveBeenCalled()
  })
})
