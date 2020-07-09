import {
  addOracleMiddleware,
  OracleArgv,
  removeHelmRelease,
  switchToContextCluster,
} from 'src/lib/oracle'
import { DestroyArgv } from '../../deploy/destroy'

export const command = 'oracle'

export const describe = 'destroy the oracle package'

type OracleDestroyArgv = DestroyArgv & OracleArgv

export const builder = addOracleMiddleware

export const handler = async (argv: OracleDestroyArgv) => {
  await switchToContextCluster(argv.celoEnv, argv.context)
  await removeHelmRelease(argv.celoEnv, argv.context)
}
