import * as core from '@actions/core'
import axios, {AxiosInstance} from 'axios'
import {JobParameters} from './inputs'

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

export class CredentialFetchingError extends Error {}

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
    const res: any = await this.client.get(detailsURL, {
      headers: {Authorization: this.params.jobToken}
    })
    if (res.status !== 200) {
      throw new Error(`Unexpected status code: ${res.status}`)
    }

    return res.data.data.attributes
  }

  async getCredentials(): Promise<Credential[]> {
    const credentialsURL = `/update_jobs/${this.params.jobId}/credentials`
    try {
      const res: any = await this.client.get(credentialsURL, {
        headers: {Authorization: this.params.credentialsToken}
      })

      // Mask any secrets we've just retrieved from Actions logs
      for (const credential of res.data.data.attributes.credentials) {
        if (credential.password) {
          core.setSecret(credential.password)
        }
        if (credential.token) {
          core.setSecret(credential.token)
        }
      }

      return res.data.data.attributes.credentials
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const err = error
        throw new CredentialFetchingError(
          `fetching credentials: received code ${
            err.response?.status
          }: ${JSON.stringify(err.response?.data)}`
        )
      } else {
        throw error
      }
    }
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
