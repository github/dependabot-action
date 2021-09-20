import {AxiosInstance} from 'axios'

// JobParameters are the parameters to execute a job
export class JobParameters {
  constructor(
    readonly jobId: number,
    readonly jobToken: string,
    readonly credentialsToken: string,
    readonly dependabotApiUrl: string,
    readonly dependabotApiDockerUrl: string
  ) {}
}

// JobDetails are information about the repository and dependencies to be updated
export type JobDetails = {
  'allowed-updates': {
    'dependency-type': string
  }[]
  id: string
  'package-manager': string
}

export type JobError = {
  'error-type': string
  'error-details': {
    'action-error': string
  }
}

export type Credential = {
  type: string
  host: string
  username?: string
  password?: string
  token?: string
}

export class ApiClient {
  constructor(
    private readonly client: AxiosInstance,
    readonly params: JobParameters
  ) {}

  // We use a static unknown SHA when marking a job as complete from the action
  // to remain in parity with the existing runner.
  UnknownSha = {
    'base-commit-sha': 'unknown'
  }

  async getJobDetails(): Promise<JobDetails> {
    const detailsURL = `/update_jobs/${this.params.jobId}/details`
    const res = await this.client.get(detailsURL, {
      headers: {Authorization: this.params.jobToken}
    })
    if (res.status !== 200) {
      throw new Error(`Unexpected status code: ${res.status}`)
    }

    return res.data.data.attributes
  }

  async getCredentials(): Promise<Credential[]> {
    const credentialsURL = `/update_jobs/${this.params.jobId}/credentials`
    const res = await this.client.get(credentialsURL, {
      headers: {Authorization: this.params.credentialsToken}
    })
    if (res.status !== 200) {
      throw new Error(`Unexpected status code: ${res.status}`)
    }

    return res.data.data.attributes.credentials
  }

  async reportJobError(error: JobError): Promise<void> {
    const recordErrorURL = `/update_jobs/${this.params.jobId}/record_update_job_error`
    const res = await this.client.post(
      recordErrorURL,
      {data: error},
      {
        headers: {Authorization: this.params.jobToken}
      }
    )
    if (res.status !== 204) {
      throw new Error(`Unexpected status code: ${res.status}`)
    }
  }

  async markJobAsProcessed(): Promise<void> {
    const markAsProcessedURL = `/update_jobs/${this.params.jobId}/mark_as_processed`
    const res = await this.client.patch(
      markAsProcessedURL,
      {data: this.UnknownSha},
      {
        headers: {Authorization: this.params.jobToken}
      }
    )
    if (res.status !== 204) {
      throw new Error(`Unexpected status code: ${res.status}`)
    }
  }
}
