import {
  CombinerEndpoint,
  DisableDomainRequest,
  DisableDomainResponse,
  ErrorMessage,
  getSignerEndpoint,
  SignerEndpoint,
} from '@celo/phone-number-privacy-common'
import AbortController from 'abort-controller'
import { Request, Response } from 'express'
import { respondWithError } from '../../common/error-utils'
import { OdisConfig, VERSION } from '../../config'
import { CombinerService, SignerResponseWithStatus } from '../combiner.service'
import { IInputService } from '../input.interface'

interface DomainDisableResponseWithStatus extends SignerResponseWithStatus {
  url: string
  res: DisableDomainResponse
  status: number
}

export class DomainDisableService extends CombinerService {
  protected endpoint: CombinerEndpoint
  protected signerEndpoint: SignerEndpoint
  protected responses: DomainDisableResponseWithStatus[]

  public constructor(config: OdisConfig, protected inputService: IInputService) {
    super(config, inputService)
    this.endpoint = CombinerEndpoint.DISABLE_DOMAIN
    this.signerEndpoint = getSignerEndpoint(this.endpoint)
    this.responses = []
  }

  protected async handleSuccessResponse(
    _request: Request<{}, {}, DisableDomainRequest>,
    data: string,
    status: number,
    url: string,
    controller: AbortController
  ): Promise<void> {
    const res = JSON.parse(data)

    if (!res.success) {
      this.logger.error({ error: res.error, signer: url }, 'Signer responded with error')
      throw new Error(`Signer request to ${url}/${this.signerEndpoint} request failed`)
    }

    this.logger.info({ signer: url }, `Signer request successful`)
    this.responses.push({ url, res, status })

    if (this.responses.length >= this.threshold) {
      controller.abort()
    }
  }

  protected async combineSignerResponses(
    _request: Request<{}, {}, DisableDomainRequest>,
    response: Response<any>
  ): Promise<void> {
    if (this.responses.length >= this.threshold) {
      response.json({ success: true, version: VERSION })
      return
    }

    respondWithError(
      response,
      this.getMajorityErrorCode() ?? 500,
      ErrorMessage.THRESHOLD_DISABLE_DOMAIN_FAILURE,
      this.logger
    )
  }
}