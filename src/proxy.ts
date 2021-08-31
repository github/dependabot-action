import fs from 'fs'
import * as core from '@actions/core'
import Docker, {Container, Network} from 'dockerode'
import crypto from 'crypto'
import {
  BasicAuthCredentials,
  CertificateAuthority,
  ProxyConfig
} from './config-types'
import {ContainerService} from './container-service'
import {Credential, JobDetails} from './api-client'
import {pki} from 'node-forge'
import {outStream, errStream} from './utils'

const KEY_SIZE = 2048
const KEY_EXPIRY_YEARS = 2
const CONFIG_FILE_PATH = '/'
const CONFIG_FILE_NAME = 'config.json'
const CA_CERT_INPUT_PATH = '/usr/local/share/ca-certificates'
const CUSTOM_CA_CERT_NAME = 'custom-ca-cert.crt'
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

export type Proxy = {
  container: Container
  network: Network
  networkName: string
  url: string
  cert: string
  shutdown: () => Promise<void>
}

export class ProxyBuilder {
  constructor(
    private readonly docker: Docker,
    private readonly proxyImage: string
  ) {}

  async run(details: JobDetails, credentials: Credential[]): Promise<Proxy> {
    const name = `job-${details.id}-proxy`
    const config = this.buildProxyConfig(credentials, details.id)
    const cert = config.ca.cert

    const networkName = `job-${details.id}-network`
    const network = await this.ensureNetwork(networkName)

    const container = await this.createContainer(details.id, name, networkName)

    await ContainerService.storeInput(
      CONFIG_FILE_NAME,
      CONFIG_FILE_PATH,
      container,
      config
    )

    if (process.env.CUSTOM_CA_PATH) {
      core.info('Detected custom CA certificate, adding to proxy')

      const customCert = fs
        .readFileSync(process.env.CUSTOM_CA_PATH, 'utf8')
        .toString()
      await ContainerService.storeCert(
        CUSTOM_CA_CERT_NAME,
        CA_CERT_INPUT_PATH,
        container,
        customCert
      )
    }

    const stream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true
    })
    container.modem.demuxStream(
      stream,
      outStream('  proxy'),
      errStream('  proxy')
    )

    const url = `http://${config.proxy_auth.username}:${config.proxy_auth.password}@${name}:1080`
    return {
      container,
      network,
      networkName,
      url,
      cert,
      shutdown: async () => {
        await container.stop()
        await container.remove()
        await network.remove()
      }
    }
  }

  private async ensureNetwork(name: string): Promise<Network> {
    const networks = await this.docker.listNetworks({
      filters: JSON.stringify({name: [name]})
    })
    if (networks.length > 0) {
      return this.docker.getNetwork(networks[0].Id)
    } else {
      return await this.docker.createNetwork({Name: name})
    }
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
    containerName: string,
    networkName: string
  ): Promise<Container> {
    const container = await this.docker.createContainer({
      Image: this.proxyImage,
      name: containerName,
      AttachStdout: true,
      AttachStderr: true,
      Env: [`JOB_ID=${jobID}`],
      Cmd: [
        'sh',
        '-c',
        '/usr/sbin/update-ca-certificates && /update-job-proxy'
      ],

      HostConfig: {
        NetworkMode: networkName
      }
    })

    core.info(`Created proxy container: ${container.id}`)
    return container
  }
}
