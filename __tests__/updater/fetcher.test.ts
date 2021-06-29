import Docker from 'dockerode'
import {runFileFetcher} from '../../src/updater/fetcher'

describe('runFileFetcher', () => {
    const docker = new Docker()

    it('should run the file fetcher', async () => {
        await runFileFetcher(docker, 'debian:buster-slim')
    })
})