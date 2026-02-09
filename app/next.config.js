/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Handle node: protocol imports for Aztec SDK
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };

    // Handle WebAssembly
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Externalize Aztec packages on server-side to avoid import assertions issues
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        '@aztec/aztec.js': 'commonjs @aztec/aztec.js',
        '@aztec/accounts': 'commonjs @aztec/accounts',
        '@aztec/accounts/defaults': 'commonjs @aztec/accounts/defaults',
        '@aztec/accounts/schnorr': 'commonjs @aztec/accounts/schnorr',
        '@aztec/accounts/ecdsa': 'commonjs @aztec/accounts/ecdsa',
        '@aztec/aztec.js/fee': 'commonjs @aztec/aztec.js/fee',
        '@aztec/foundation': 'commonjs @aztec/foundation',
        '@aztec/circuits.js': 'commonjs @aztec/circuits.js',
        '@aztec/protocol-contracts': 'commonjs @aztec/protocol-contracts',
        '@aztec/native': 'commonjs @aztec/native',
        '@aztec/bb.js': 'commonjs @aztec/bb.js',
        '@aztec/bb-prover': 'commonjs @aztec/bb-prover',
        '@aztec/test-wallet': 'commonjs @aztec/test-wallet',
        '@aztec/test-wallet/server': 'commonjs @aztec/test-wallet/server',
        '@aztec/pxe': 'commonjs @aztec/pxe',
      });
    }

    return config;
  },
  // Allow external packages needed by Aztec - handle them on server-side
  experimental: {
    esmExternals: 'loose',
    serverComponentsExternalPackages: [
      '@aztec/aztec.js',
      '@aztec/accounts',
      '@aztec/foundation',
      '@aztec/circuits.js',
      '@aztec/protocol-contracts',
      '@aztec/native',
      '@aztec/bb.js',
      '@aztec/bb-prover',
      '@aztec/test-wallet',
      '@aztec/pxe',
    ],
  },
};

module.exports = nextConfig;
