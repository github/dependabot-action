import {AxiosInstance} from 'axios'

// JobParameters are the parameters to execute a job
export class JobParameters {
  constructor(
    public jobID: number,
    public jobToken: string,
    public credentialsToken: string
  ) {}
}

// JobDetails are information about the repository and dependencies to be updated
export type JobDetails = {
  'allowed-updates': {
    'dependency-type': string
  }[]
  'package-manager': PackageManager
}

export enum PackageManager {
  NpmAndYarn = 'npm_and_yarn'
}

export class DependabotAPI {
  constructor(
    private readonly client: AxiosInstance,
    private readonly params: JobParameters
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
}
