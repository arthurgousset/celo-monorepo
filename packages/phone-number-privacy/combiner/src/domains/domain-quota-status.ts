import { isKnownDomain } from '@celo/identity/lib/odis/domains'
import {
  DomainQuotaStatusRequest,
  DomainQuotaStatusResponse,
  DomainQuotaStatusResponseSuccess,
  ErrorMessage,
  SequentialDelayDomain,
  SequentialDelayDomainOptions,
  SignerEndpoint,
  verifyDomainQuotaStatusRequestAuthenticity,
  WarningMessage,
} from '@celo/phone-number-privacy-common'
import AbortController from 'abort-controller'
import Logger from 'bunyan'
import { Request, Response } from 'firebase-functions'
import fetch, { Response as FetchResponse } from 'node-fetch'
import { performance, PerformanceObserver } from 'perf_hooks'
import { respondWithError } from '../common/error-utils'
import config, { VERSION } from '../config'

// TODO(Alec): De-dupe with get-threshold-signature
// TODO(Alec): This is still mostly a copy/paste from domain-disable
interface SignerService {
  url: string
  fallbackUrl?: string
}
interface DomainQuotaStatusRespWithStatus {
  url: string
  domainQuotaStatusResponse: DomainQuotaStatusResponseSuccess
  status: number
}

export async function handleDomainQuotaStatusReq(request: Request, response: Response) {
  const logger: Logger = response.locals.logger
  try {
    if (!isValidInput(request)) {
      respondWithError(response, 400, WarningMessage.INVALID_INPUT, logger)
      return
    }
    if (!authenticateRequest(request)) {
      respondWithError(response, 401, WarningMessage.UNAUTHENTICATED_USER, logger)
      return
    }
    logger.debug('Requesting domain quota status from signers')
    await requestDomainQuotaStatusFromSigners(request, response)
  } catch (err) {
    logger.error('Unknown error in handleDomainQuotaStatusReq')
    logger.error(err)
    respondWithError(response, 500, ErrorMessage.UNKNOWN_ERROR, logger)
  }
}

async function requestDomainQuotaStatusFromSigners(request: Request, response: Response) {
  const logger: Logger = response.locals.logger

  const successes: DomainQuotaStatusRespWithStatus[] = []
  const failures = new Set<string>()
  const errorCodes: Map<number, number> = new Map()

  const obs = new PerformanceObserver((list) => {
    const entry = list.getEntries()[0]
    logger.info({ latency: entry, signer: entry!.name }, 'Signer response latency measured')
  })
  obs.observe({ entryTypes: ['measure'], buffered: true })

  const signers: SignerService[] = JSON.parse(config.odisServices.domains.signers)
  const timeoutMs = config.odisServices.domains.timeoutMilliSeconds
  const threshold = config.keys.domains.threshold

  let timedOut = false
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const signerReqs = signers.map((service) => {
    const startMark = `Begin requestDomainQuotaStatusFromSigners ${service.url}`
    const endMark = `End requestDomainQuotaStatusFromSigners ${service.url}`
    const entryName = service.url
    performance.mark(startMark)

    return requestDomainQuotaStatus(
      service,
      request,
      controller,
      SignerEndpoint.DOMAIN_QUOTA_STATUS,
      logger
    )
      .then(async (res: FetchResponse) => {
        const data = await res.text()
        logger.info(
          { signer: service, res: data, status: res.status },
          'received requestDomainQuotaStatus response from signer'
        )
        if (res.ok) {
          await handleSuccessResponse(
            data,
            res.status,
            response,
            successes,
            service.url,
            controller,
            threshold
          )
        } else {
          handleFailedResponse(
            service,
            res.status,
            signers.length,
            failures,
            response,
            controller,
            errorCodes,
            threshold
          )
        }
      })
      .catch((err) => {
        let status: number | undefined = 500
        if (err.name === 'AbortError') {
          if (timedOut) {
            status = 408
            logger.error({ signer: service }, ErrorMessage.TIMEOUT_FROM_SIGNER)
          } else {
            // Request was cancelled, assuming it would have been successful
            status = undefined
            logger.info({ signer: service }, WarningMessage.CANCELLED_REQUEST_TO_SIGNER) // TODO(Alec)
          }
        } else {
          // TODO(Alec)
          logger.error({ signer: service }, ErrorMessage.SIGNER_DISABLE_DOMAIN_FAILURE)
        }
        logger.error(err)
        handleFailedResponse(
          service,
          status,
          signers.length,
          failures,
          response,
          controller,
          errorCodes,
          threshold
        )
      })
      .finally(() => {
        performance.mark(endMark)
        performance.measure(entryName, startMark, endMark)
      })
  })

  await Promise.all(signerReqs)
  clearTimeout(timeout)
  performance.clearMarks()
  obs.disconnect()

  // TODO(Alec)
  if (successes.length >= threshold) {
    response.json({ success: true, version: VERSION })
    return
  }

  const majorityErrorCode = getMajorityErrorCode(errorCodes, logger)
  respondWithError(
    response,
    majorityErrorCode ?? 500,
    ErrorMessage.THRESHOLD_DISABLE_DOMAIN_FAILURE, // TODO(Alec)
    logger
  )
}

async function handleSuccessResponse(
  data: string,
  status: number,
  response: Response,
  successes: DomainQuotaStatusRespWithStatus[],
  serviceUrl: string,
  controller: AbortController,
  threshold: number
) {
  const logger: Logger = response.locals.logger
  const domainQuotaStatusResponse = JSON.parse(data) as DomainQuotaStatusResponse

  if (!domainQuotaStatusResponse.success) {
    logger.error(
      {
        error: domainQuotaStatusResponse.error,
        signer: serviceUrl,
      },
      'Signer responded with error'
    )
    throw new Error('Domain quota status request failed') // TODO(Alec)
  }

  successes.push({ url: serviceUrl, domainQuotaStatusResponse, status })
  // logger.info({ signer: serviceUrl }, 'Signer successfully disabled domain')

  // TODO(Alec)
  // Send response immediately once we cross threshold
  if (successes.length >= threshold) {
    controller.abort()
  }
}

function handleFailedResponse(
  service: SignerService,
  status: number | undefined,
  signerCount: number,
  failures: Set<string>,
  response: Response,
  controller: AbortController,
  errorCodes: Map<number, number>,
  threshold: number
) {
  const logger: Logger = response.locals.logger
  if (status) {
    // Increment counter for status code by 1
    errorCodes.set(status, (errorCodes.get(status) ?? 0) + 1)
  }
  // Tracking failed request count via signer url prevents
  // double counting the same failed request by mistake
  failures.add(service.url)
  // TODO(Alec)
  const shouldFailFast = signerCount - failures.size < threshold
  logger.info(`Recieved failure from ${failures.size}/${signerCount} signers.`)
  if (shouldFailFast) {
    logger.info(
      'Not possible to reach a threshold of succesful disableDomain responses. Failing fast.'
    )
    controller.abort()
  }
}

function requestDomainQuotaStatus(
  service: SignerService,
  request: Request,
  controller: AbortController,
  endpoint: SignerEndpoint,
  logger: Logger
): Promise<FetchResponse> {
  return parameterizedSignerRequest(service.url, request, controller, endpoint, logger).catch(
    (e) => {
      logger.error(`Signer failed with primary url ${service.url}`, e)
      if (service.fallbackUrl) {
        logger.warn(`Using fallback url to call signer ${service.fallbackUrl!}`)
        return parameterizedSignerRequest(
          service.fallbackUrl!,
          request,
          controller,
          endpoint,
          logger
        )
      }
      throw e
    }
  )
}

function parameterizedSignerRequest(
  baseUrl: string,
  request: Request,
  controller: AbortController,
  endpoint: SignerEndpoint,
  logger: Logger
): Promise<FetchResponse> {
  logger.debug({ signer: baseUrl }, 'sending domain quota status request to signer')
  const url = baseUrl + endpoint
  return fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request.body),
    signal: controller.signal,
  })
}

function getMajorityErrorCode(errorCodes: Map<number, number>, logger: Logger) {
  // Ignore timeouts
  const ignoredErrorCodes = [408]
  const uniqueErrorCount = Array.from(errorCodes.keys()).filter(
    (status) => !ignoredErrorCodes.includes(status)
  ).length
  if (uniqueErrorCount > 1) {
    logger.error(
      { errorCodes: JSON.stringify([...errorCodes]) },
      ErrorMessage.INCONSISTENT_SIGNER_RESPONSES
    )
  }

  let maxErrorCode = -1
  let maxCount = -1
  errorCodes.forEach((count, errorCode) => {
    // This gives priority to the lower status codes in the event of a tie
    // because 400s are more helpful than 500s for user feedback
    if (count > maxCount || (count === maxCount && errorCode < maxErrorCode)) {
      maxCount = count
      maxErrorCode = errorCode
    }
  })
  return maxErrorCode > 0 ? maxErrorCode : null
}

function isValidInput(request: Request): boolean {
  return isKnownDomain(
    (request.body as DomainQuotaStatusRequest<SequentialDelayDomain, SequentialDelayDomainOptions>)
      .domain
  )
}

function authenticateRequest(request: Request): boolean {
  return verifyDomainQuotaStatusRequestAuthenticity(
    // TODO(Alec): Review cip40
    request.body as DomainQuotaStatusRequest<SequentialDelayDomain, SequentialDelayDomainOptions>
  )
}