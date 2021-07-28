import {base64DecodeDependencyFile} from '../src/utils'

describe('base64DecodeDependencyFile', () => {
  test('clones the dependency file', () => {
    const dependencyFile = {
      name: 'package.json',
      content: 'dGVzdCBzdHJpbmc=',
      directory: '/',
      type: 'file',
      support_file: false,
      content_encoding: 'utf-8',
      deleted: false,
      operation: 'add'
    }

    const decoded = base64DecodeDependencyFile(dependencyFile)
    expect(decoded.content).toEqual('test string')
    expect(dependencyFile.content).toEqual('dGVzdCBzdHJpbmc=')
  })
})
