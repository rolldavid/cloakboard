import localConfig from '../../../config/local-network.json';
import devnetConfig from '../../../config/devnet.json';
import testnetConfig from '../../../config/testnet.json';
import mainnetConfig from '../../../config/mainnet.json';

type Environment = 'local' | 'devnet' | 'testnet' | 'mainnet';

interface NetworkConfig {
  name: string;
  environment: Environment;
  network: {
    nodeUrl: string;
    l1RpcUrl: string;
    l1ChainId: number;
  };
  settings: {
    skipLocalNetwork: boolean;
    version: string;
  };
  timeouts: {
    deployTimeout: number;
    txTimeout: number;
    waitTimeout: number;
  };
  sponsoredFpcAddress?: string;
}

const configs: Record<Environment, NetworkConfig> = {
  local: localConfig as NetworkConfig,
  devnet: devnetConfig as NetworkConfig,
  testnet: testnetConfig as NetworkConfig,
  mainnet: mainnetConfig as NetworkConfig,
};

export function getConfig(env?: Environment): NetworkConfig {
  const environment = env || (process.env.AZTEC_ENV as Environment) || 'local';
  return configs[environment];
}

export function getTimeouts(env?: Environment) {
  return getConfig(env).timeouts;
}

export function getNetworkUrl(env?: Environment): string {
  return getConfig(env).network.nodeUrl;
}

export function getSponsoredFpcAddress(env?: Environment): string | undefined {
  return getConfig(env).sponsoredFpcAddress;
}
