import environments from '../../public/configs/v1/env.json';

export const CURRENT_MODE = ({
  production: 'MAINNET',
  testnet: 'TESTNET',
  staging: 'DEV',
  development: 'DEV',
}[import.meta.env.MODE] ?? 'MAINNET') as 'MAINNET' | 'TESTNET' | 'DEV';

// 添加调试日志
console.log('Current Mode:', CURRENT_MODE);
console.log('Network ID:', import.meta.env.VITE_NETWORK_ID);
console.log('Available Environments:', environments.deployments[CURRENT_MODE]);

// 获取默认或指定的网络 ID
const networkId = import.meta.env.VITE_NETWORK_ID || environments.deployments[CURRENT_MODE].default;
// 安全地访问配置
const selectedConfig = environments.environments[networkId as keyof typeof environments.environments];
console.log('Environment Config:', selectedConfig);

export const isMainnet = CURRENT_MODE === 'MAINNET';
export const isTestnet = CURRENT_MODE === 'TESTNET';
export const isDev = CURRENT_MODE === 'DEV';

export const AVAILABLE_ENVIRONMENTS = environments.deployments[CURRENT_MODE];
export const CURRENT_ABACUS_DEPLOYMENT = CURRENT_MODE;
export const ENVIRONMENT_CONFIG_MAP = environments.environments;
export const TOKEN_CONFIG_MAP = environments.tokens;
export const LINKS_CONFIG_MAP = environments.links;
export const WALLETS_CONFIG_MAP = environments.wallets;
export type DydxNetwork = keyof typeof ENVIRONMENT_CONFIG_MAP;
export type DydxChainId = keyof typeof TOKEN_CONFIG_MAP;
export const DEFAULT_APP_ENVIRONMENT = AVAILABLE_ENVIRONMENTS.default as DydxNetwork;

export const STATSIG_ENVIRONMENT_TIER = ({
  production: 'production',
  testnet: 'staging',
  staging: 'development',
  development: 'development',
}[import.meta.env.MODE] ?? 'production') as 'production' | 'staging' | 'development';
