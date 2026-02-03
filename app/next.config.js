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
        '@aztec/accounts/schnorr': 'commonjs @aztec/accounts/schnorr',
        '@aztec/accounts/ecdsa': 'commonjs @aztec/accounts/ecdsa',
        '@aztec/aztec.js/fee': 'commonjs @aztec/aztec.js/fee',
        '@aztec/foundation': 'commonjs @aztec/foundation',
        '@aztec/circuits.js': 'commonjs @aztec/circuits.js',
        '@aztec/protocol-contracts': 'commonjs @aztec/protocol-contracts',
      });
    }

    return config;
  },
  // Allow external packages needed by Aztec - handle them on server-side
  experimental: {
    serverComponentsExternalPackages: [
      '@aztec/aztec.js',
      '@aztec/accounts',
      '@aztec/foundation',
      '@aztec/circuits.js',
      '@aztec/protocol-contracts',
    ],
  },
};

module.exports = nextConfig;
