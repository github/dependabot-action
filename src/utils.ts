import stream, {Writable} from 'stream'
import {DependencyFile} from './config-types'

const base64Decode = (str: string): string =>
  Buffer.from(str, 'base64').toString('binary')

export const base64DecodeDependencyFile = (
  file: DependencyFile
): DependencyFile => {
  const fileCopy = JSON.parse(JSON.stringify(file))
  fileCopy.content = base64Decode(fileCopy.content)
  return fileCopy
}

export const outStream = (prefix: string): Writable => {
  return new stream.Writable({
    write(chunk, _, next) {
      process.stderr.write(`${prefix} | ${chunk.toString()}`)
      next()
    }
  })
}

export const errStream = (prefix: string): Writable => {
  return new stream.Writable({
    write(chunk, _, next) {
      process.stderr.write(`${prefix} | ${chunk.toString()}`)
      next()
    }
  })
}
