import * as core from '@actions/core'
import * as httpClient from '@actions/http-client'
import {JobParameters} from './inputs'
import {TypedResponse} from '@actions/http-client/lib/interfaces'

// JobDetails are information about the repository and dependencies to be updated
export type JobDetails = {
  command?: string
  'allowed-updates': Array<{
    'dependency-type': string
  }>
  id: string
  'package-manager': string
  // Reuse Credential here since it shares many of the same fields,
  // but the job details contains no secrets
  'credentials-metadata': Credential[]
  experiments: object
}

export type JobError = {
  'error-type': string
  'error-details': {
    'action-error': string
  }
}

export type Credential = {
  type: string
  host?: string
  url?: string
  username?: string
  password?: string
  token?: string
  repo?: string
  registry?: string
  organization?: string
  'index-url'?: string
  'env-key'?: string
  'replaces-base'?: boolean
  'public-key-fingerprint'?: string
  'auth-key'?: string
}

export type Metric = {
  metric: string
  type: 'increment' | 'gauge'
  value: number
  tags: Record<string, string>
}

export type MetricsData = {
  data: Metric[]
}

export class JobDetailsFetchingError extends Error {}
export class CredentialFetchingError extends Error {}

export class ApiClient {
  private jobToken: string
  constructor(
    private readonly client: httpClient.HttpClient,
    readonly params: JobParameters,
    jobToken: string,
    private readonly credentialsToken: string
  ) {
    this.jobToken = jobToken
  }

  // We use a static unknown SHA when marking a job as complete from the action
  // to remain in parity with the existing runner.
  UnknownSha = {
    'base-commit-sha': 'unknown'
  }

  // Getter for jobToken
  getJobToken(): string {
    return this.jobToken
  }

  async getJobDetails(): Promise<JobDetails> {
    const detailsURL = `${this.params.dependabotApiUrl}/update_jobs/${this.params.jobId}/details`
    try {
      const res = await this.getJsonWithRetry<any>(detailsURL, this.jobToken)
      if (res.statusCode !== 200) {
        throw new JobDetailsFetchingError(
          `fetching job details: unexpected status code: ${
            res.statusCode
          }: ${JSON.stringify(res.result)}`
        )
      }
      if (!res.result) {
        throw new JobDetailsFetchingError(
          `fetching job details: missing response`
        )
      }

      return res.result.data.attributes
    } catch (error: unknown) {
      if (error instanceof JobDetailsFetchingError) {
        throw error
      } else if (error instanceof httpClient.HttpClientError) {
        throw new JobDetailsFetchingError(
          `fetching job details: unexpected status code: ${error.statusCode}: ${error.message}`
        )
      } else if (error instanceof Error) {
        throw new JobDetailsFetchingError(
          `fetching job details: ${error.name}: ${error.message}`
        )
      }
      throw error
    }
  }

  async getCredentials(): Promise<Credential[]> {
    const credentialsURL = `${this.params.dependabotApiUrl}/update_jobs/${this.params.jobId}/credentials`
    try {
      const res = await this.getJsonWithRetry<any>(
        credentialsURL,
        this.credentialsToken
      )

      if (res.statusCode !== 200) {
        throw new CredentialFetchingError(
          `fetching credentials: unexpected status code: ${
            res.statusCode
          }: ${JSON.stringify(res.result)}`
        )
      }
      if (!res.result) {
        throw new CredentialFetchingError(
          `fetching credentials: missing response`
        )
      }

      // Mask any secrets we've just retrieved from Actions logs
      for (const credential of res.result.data.attributes.credentials) {
        if (credential.password) {
          core.setSecret(credential.password)
        }
        if (credential.token) {
          core.setSecret(credential.token)
        }
        if (credential['auth-key']) {
          core.setSecret(credential['auth-key'])
        }
      }

      return res.result.data.attributes.credentials
    } catch (error: unknown) {
      if (error instanceof CredentialFetchingError) {
        throw error
      } else if (error instanceof httpClient.HttpClientError) {
        throw new CredentialFetchingError(
          `fetching credentials: unexpected status code: ${error.statusCode}: ${error.message}`
        )
      } else if (error instanceof Error) {
        throw new CredentialFetchingError(
          `fetching credentials: ${error.name}: ${error.message}`
        )
      }
      throw error
    }
  }

  async reportJobError(error: JobError): Promise<void> {
    const recordErrorURL = `${this.params.dependabotApiUrl}/update_jobs/${this.params.jobId}/record_update_job_error`
    const res = await this.client.postJson(
      recordErrorURL,
      {data: error},
      {
        ['Authorization']: this.jobToken
      }
    )
    if (res.statusCode !== 204) {
      throw new Error(`Unexpected status code: ${res.statusCode}`)
    }
  }

  async markJobAsProcessed(): Promise<void> {
    const markAsProcessedURL = `${this.params.dependabotApiUrl}/update_jobs/${this.params.jobId}/mark_as_processed`
    const res = await this.client.patchJson(
      markAsProcessedURL,
      {data: this.UnknownSha},
      {
        ['Authorization']: this.jobToken
      }
    )
    if (res.statusCode !== 204) {
      throw new Error(`Unexpected status code: ${res.statusCode}`)
    }
  }

  async sendMetrics(
    name: string,
    metricType: 'increment' | 'gauge',
    value: number,
    additionalTags: Record<string, string> = {}
  ): Promise<void> {
    try {
      await this.reportMetrics({
        data: [
          {
            metric: `dependabot.action.${name}`,
            type: metricType,
            value,
            tags: additionalTags
          }
        ]
      })
      core.info(
        `Successfully sent metric (dependabot.action.${name}) to remote API endpoint`
      )
    } catch (error) {
      // metrics should typically not cause critical path failure so we log the
      // failure and continue with the job
      core.warning(`Metrics reporting failed: ${(error as Error).message}`)
    }
  }

  async reportMetrics(metricsData: MetricsData): Promise<void> {
    const metricsURL = `${this.params.dependabotApiUrl}/update_jobs/${this.params.jobId}/record_metrics`
    const res = await this.client.postJson(metricsURL, metricsData, {
      ['Authorization']: this.jobToken
    })

    if (res.statusCode !== 204) {
      throw new Error(`Unexpected status code: ${res.statusCode}`)
    }
  }

  private async getJsonWithRetry<T>(
    url: string,
    token: string
  ): Promise<TypedResponse<T>> {
    let attempt = 1

    const execute = async (): Promise<TypedResponse<T>> => {
      try {
        return await this.client.getJson<T>(url, {
          ['Authorization']: token
        })
      } catch (error: unknown) {
        if (error instanceof httpClient.HttpClientError) {
          if (error.statusCode >= 500 && error.statusCode <= 599) {
            if (attempt >= 3) {
              throw error
            }
            core.warning(
              `Retrying failed request with status code: ${error.statusCode}`
            )

            // exponential backoff
            const delayMs = 1000 * 2 ** attempt
            await new Promise(resolve => setTimeout(resolve, delayMs))

            attempt++
            return execute()
          }
        }
        throw error
      }
    }

    return execute()
  }
}
