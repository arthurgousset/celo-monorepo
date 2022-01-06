import { ErrorMessage, rootLogger as logger } from '@celo/phone-number-privacy-common'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager/build/src/v1'
import config from '../config'
import { Key, KeyProviderBase } from './key-provider-base'

export class GoogleKeyProvider extends KeyProviderBase {
  public async fetchPrivateKeyFromStore(key: Key) {
    try {
      const { projectId, secretName, secretVersion } = config.keystore.google
      const client = new SecretManagerServiceClient()

      let privateKey: string
      try {
        privateKey = await this.fetch(
          client,
          projectId,
          this.getCustomKeyName(key),
          key.version.toString()
        )
      } catch (err) {
        logger.info(`Error retrieving key: ${JSON.stringify(key)}`)
        logger.error(err)
        logger.error(ErrorMessage.KEY_FETCH_ERROR)
        privateKey = await this.fetch(client, projectId, secretName, secretVersion)
      }

      this.setPrivateKey(key, privateKey)
    } catch (err) {
      logger.error(err)
      throw new Error(ErrorMessage.KEY_FETCH_ERROR)
    }
  }

  private async fetch(
    client: SecretManagerServiceClient,
    projectId: string,
    secretName: string,
    secretVersion: string
  ) {
    const secretID = `projects/${projectId}/secrets/${secretName}/versions/${secretVersion}`
    const [versionResponse] = await client.accessSecretVersion({ name: secretID })

    // Extract the payload as a string.
    const privateKey = versionResponse?.payload?.data?.toString()

    if (!privateKey) {
      throw new Error('Key is empty or undefined')
    }

    return privateKey
  }
}
