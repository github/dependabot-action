import * as core from '@actions/core'
import Docker, {Container} from 'dockerode'
import crypto from 'crypto'
import {
  BasicAuthCredentials,
  CertificateAuthority,
  ProxyConfig
} from './file-types'
import {ContainerService} from './container-service'
import {Credential, JobDetails} from './api-client'
import {pki} from 'node-forge'

const KEY_SIZE = 2048
const KEY_EXPIRY_YEARS = 2
const CONFIG_FILE_PATH = '/'
const CONFIG_FILE_NAME = 'config.json'
const CERT_SUBJECT = [
  {
    name: 'commonName',
    value: 'Dependabot Internal CA'
  },
  {
    name: 'organizationName',
    value: 'GitHub ic.'
  },
  {
    shortName: 'OU',
    value: 'Dependabot'
  },
  {
    name: 'countryName',
    value: 'US'
  },
  {
    shortName: 'ST',
    value: 'California'
  },
  {
    name: 'localityName',
    value: 'San Francisco'
  }
]

export class Proxy {
  container?: Container
  url: string
  cert: string

  constructor(
    private readonly docker: Docker,
    private readonly proxyImage: string
  ) {
    // TODO: this is obviously gnarly, decouple some things so we don't need to
    // initialize these as empty strings
    this.url = ''
    this.cert = ''
  }

  async run(details: JobDetails, credentials: Credential[]): Promise<void> {
    const name = `job-${details.id}-proxy`
    const config = this.buildProxyConfig(credentials, details.id)
    this.cert = config.ca.cert

    this.container = await this.createContainer(details.id, name)
    await ContainerService.storeInput(
      CONFIG_FILE_NAME,
      CONFIG_FILE_PATH,
      this.container,
      config
    )

    const stream = await this.container.attach({
      stream: true,
      stdout: true,
      stderr: true
    })
    this.container.modem.demuxStream(stream, process.stdout, process.stderr)

    this.container.start()
    this.url = `http://${config.proxy_auth.username}:${config.proxy_auth.password}@${name}:1080`
    core.info(this.url)
  }

  private buildProxyConfig(
    credentials: Credential[],
    jobID: string
  ): ProxyConfig {
    const ca = this.generateCertificateAuthority()
    const password = crypto.randomBytes(20).toString('hex')
    const proxy_auth: BasicAuthCredentials = {
      username: `${jobID}`,
      password
    }

    const config: ProxyConfig = {all_credentials: credentials, ca, proxy_auth}

    return config
  }

  private generateCertificateAuthority(): CertificateAuthority {
    const keys = pki.rsa.generateKeyPair(KEY_SIZE)
    const cert = pki.createCertificate()

    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(
      cert.validity.notBefore.getFullYear() + KEY_EXPIRY_YEARS
    )

    cert.setSubject(CERT_SUBJECT)
    cert.setIssuer(CERT_SUBJECT)
    cert.setExtensions([{name: 'basicConstraints', cA: true}])
    cert.sign(keys.privateKey)

    const pem = pki.certificateToPem(cert)
    const key = pki.privateKeyToPem(keys.privateKey)
    return {cert: pem, key}
  }

  private async createContainer(
    jobID: string,
    containerName: string
  ): Promise<Container> {
    const container = await this.docker.createContainer({
      Image: this.proxyImage,
      name: containerName,
      AttachStdout: true,
      AttachStderr: true,
      Env: [`JOB_ID=${jobID}`],
      HostConfig: {
        NetworkMode: `job-test-network` // TODO: Dynamically generate network
      }
    })

    core.info(`Created proxy container: ${container.id}`)
    return container
  }
}
