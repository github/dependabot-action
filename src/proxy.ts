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
import {Credential} from './api-client'
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
  url: () => Promise<string>
  cert: string
  shutdown: () => Promise<void>
}

export class ProxyBuilder {
  constructor(
    private readonly docker: Docker,
    private readonly proxyImage: string
  ) {}

  async run(jobId: number, credentials: Credential[]): Promise<Proxy> {
    const name = `dependabot-job-${jobId}-proxy`
    const config = this.buildProxyConfig(credentials, jobId)
    const cert = config.ca.cert

    const externalNetworkName = `dependabot-job-${jobId}-external-network`
    const externalNetwork = await this.ensureNetwork(externalNetworkName, false)

    const internalNetworkName = `dependabot-job-${jobId}-internal-network`
    const internalNetwork = await this.ensureNetwork(internalNetworkName, true)

    const container = await this.createContainer(
      jobId,
      name,
      externalNetwork,
      internalNetwork,
      internalNetworkName
    )

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

    const url = async (): Promise<string> => {
      const containerInfo = await container.inspect()

      if (containerInfo.State.Running === true) {
        const ipAddress =
          containerInfo.NetworkSettings.Networks[`${internalNetworkName}`]
            .IPAddress
        return `http://${config.proxy_auth.username}:${config.proxy_auth.password}@${ipAddress}:1080`
      } else {
        throw new Error("proxy container isn't running")
      }
    }

    return {
      container,
      network: internalNetwork,
      networkName: internalNetworkName,
      url,
      cert,
      shutdown: async () => {
        await container.stop()
        await container.remove()
        await externalNetwork.remove()
        await internalNetwork.remove()
      }
    }
  }

  private async ensureNetwork(name: string, internal = true): Promise<Network> {
    const networks = await this.docker.listNetworks({
      filters: JSON.stringify({name: [name]})
    })
    if (networks.length > 0) {
      return this.docker.getNetwork(networks[0].Id)
    } else {
      return await this.docker.createNetwork({Name: name, Internal: internal})
    }
  }

  private buildProxyConfig(
    credentials: Credential[],
    jobId: number
  ): ProxyConfig {
    const ca = this.generateCertificateAuthority()
    const password = crypto.randomBytes(20).toString('hex')
    const proxy_auth: BasicAuthCredentials = {
      username: `${jobId}`,
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
    jobId: number,
    containerName: string,
    externalNetwork: Network,
    internalNetwork: Network,
    internalNetworkName: string
  ): Promise<Container> {
    const container = await this.docker.createContainer({
      Image: this.proxyImage,
      name: containerName,
      AttachStdout: true,
      AttachStderr: true,
      Env: [`JOB_ID=${jobId}`],
      Entrypoint: [
        'sh',
        '-c',
        '/usr/sbin/update-ca-certificates && /update-job-proxy'
      ],

      HostConfig: {
        NetworkMode: internalNetworkName
      }
    })

    await externalNetwork.connect({Container: container.id})

    core.info(`Created proxy container: ${container.id}`)
    return container
  }
}
