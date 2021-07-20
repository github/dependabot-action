import {AxiosInstance} from 'axios'

// JobParameters are the parameters to execute a job
export class JobParameters {
  constructor(
    readonly jobID: number,
    readonly jobToken: string,
    readonly credentialsToken: string,
    readonly dependabotAPI: string
  ) {}
}

export enum PackageManager {
  NpmAndYarn = 'npm_and_yarn'
}

// JobDetails are information about the repository and dependencies to be updated
export type JobDetails = {
  'allowed-updates': {
    'dependency-type': string
  }[]
  id: string
  'package-manager': PackageManager
}

export type Credential = {
  type: string
  host: string
  username?: string
  password?: string
  token?: string
}

export class DependabotAPI {
  constructor(
    private readonly client: AxiosInstance,
    readonly params: JobParameters
  ) {}

  async getJobDetails(): Promise<JobDetails> {
    const detailsURL = `/update_jobs/${this.params.jobID}/details`
    const res = await this.client.get(detailsURL, {
      headers: {Authorization: this.params.jobToken}
    })
    if (res.status !== 200) {
      throw new Error(`Unexpected status code: ${res.status}`)
    }

    return res.data.data.attributes
  }

  async getCredentials(): Promise<Credential[]> {
    const detailsURL = `/update_jobs/${this.params.jobID}/credentials`
    const res = await this.client.get(detailsURL, {
      headers: {Authorization: this.params.credentialsToken}
    })
    if (res.status !== 200) {
      throw new Error(`Unexpected status code: ${res.status}`)
    }

    return res.data.data.attributes.credentials
  }
}
