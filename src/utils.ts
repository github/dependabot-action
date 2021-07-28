import {DependencyFile} from './file-types'

const base64Decode = (str: string): string =>
  Buffer.from(str, 'base64').toString('binary')

export const base64DecodeDependencyFile = (
  file: DependencyFile
): DependencyFile => {
  const fileCopy = JSON.parse(JSON.stringify(file))
  fileCopy.content = base64Decode(fileCopy.content)
  return fileCopy
}
