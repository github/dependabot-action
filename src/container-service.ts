import * as core from '@actions/core'
import Docker, {Container} from 'dockerode'
import {pack} from 'tar-stream'
import {FileFetcherInput, FileUpdaterInput, ProxyConfig} from './config-types'
import {JobParameters} from './inputs'
import {Proxy} from './proxy'
import {outStream, errStream} from './utils'

const JOB_OUTPUT_FILENAME = 'output.json'
const JOB_OUTPUT_PATH = '/home/dependabot/dependabot-updater/output'
const JOB_INPUT_FILENAME = 'job.json'
const JOB_INPUT_PATH = `/home/dependabot/dependabot-updater`
const REPO_CONTENTS_PATH = '/home/dependabot/dependabot-updater/repo'
const CA_CERT_INPUT_PATH = '/usr/local/share/ca-certificates'
const CA_CERT_FILENAME = 'dbot-ca.crt'
const UPDATER_MAX_MEMORY = 8 * 1024 * 1024 * 1024 // 8GB in bytes

class ContainerRuntimeError extends Error {}

export const ContainerService = {
  async createUpdaterContainer(
    containerName: string,
    jobParams: JobParameters,
    docker: Docker,
    input: FileFetcherInput | FileUpdaterInput,
    outputHostPath: string,
    proxy: Proxy,
    repoHostPath: string,
    updaterCommand: string,
    updaterImage: string
  ): Promise<Container> {
    const cmd = `(echo > /etc/ca-certificates.conf) &&\
     rm -Rf /usr/share/ca-certificates/ &&\
      /usr/sbin/update-ca-certificates &&\
       $DEPENDABOT_HOME/dependabot-updater/bin/run ${updaterCommand}`

    const container = await docker.createContainer({
      Image: updaterImage,
      name: containerName,
      AttachStdout: true,
      AttachStderr: true,
      Env: [
        `DEPENDABOT_JOB_ID=${jobParams.jobId}`,
        `DEPENDABOT_JOB_TOKEN=${jobParams.jobToken}`,
        `DEPENDABOT_JOB_PATH=${JOB_INPUT_PATH}/${JOB_INPUT_FILENAME}`,
        `DEPENDABOT_OUTPUT_PATH=${JOB_OUTPUT_PATH}/${JOB_OUTPUT_FILENAME}`,
        `DEPENDABOT_REPO_CONTENTS_PATH=${REPO_CONTENTS_PATH}`,
        `DEPENDABOT_API_URL=${jobParams.dependabotApiDockerUrl}`,
        `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt`,
        `http_proxy=${proxy.url}`,
        `HTTP_PROXY=${proxy.url}`,
        `https_proxy=${proxy.url}`,
        `HTTPS_PROXY=${proxy.url}`
      ],
      Cmd: ['sh', '-c', cmd],
      HostConfig: {
        Memory: UPDATER_MAX_MEMORY,
        NetworkMode: proxy.networkName,
        Binds: [
          `${outputHostPath}:${JOB_OUTPUT_PATH}:rw`,
          `${repoHostPath}:${REPO_CONTENTS_PATH}:rw`
        ]
      }
    })

    await ContainerService.storeCert(
      CA_CERT_FILENAME,
      CA_CERT_INPUT_PATH,
      container,
      proxy.cert
    )

    await ContainerService.storeInput(
      JOB_INPUT_FILENAME,
      JOB_INPUT_PATH,
      container,
      input
    )

    core.info(`Created ${updaterCommand} container: ${container.id}`)
    return container
  },

  async storeInput(
    name: string,
    path: string,
    container: Container,
    input: FileFetcherInput | FileUpdaterInput | ProxyConfig
  ): Promise<void> {
    const tar = pack()
    tar.entry({name}, JSON.stringify(input))
    tar.finalize()
    await container.putArchive(tar, {path})
  },

  async storeCert(
    name: string,
    path: string,
    container: Container,
    cert: string
  ): Promise<void> {
    const tar = pack()
    tar.entry({name}, cert)
    tar.finalize()
    await container.putArchive(tar, {path})
  },

  async run(container: Container): Promise<boolean> {
    try {
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true
      })
      container.modem.demuxStream(
        stream,
        outStream('updater'),
        errStream('updater')
      )

      await container.start()
      const outcome = await container.wait()

      if (outcome.StatusCode === 0) {
        return true
      } else {
        throw new ContainerRuntimeError(
          `Failure running container ${container.id}`
        )
      }
    } finally {
      await container.remove({v: true})
      core.info(`Cleaned up container ${container.id}`)
    }
  }
}
