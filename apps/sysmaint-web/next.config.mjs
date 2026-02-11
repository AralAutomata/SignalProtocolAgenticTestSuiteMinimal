/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@mega/sysmaint-protocol"],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@signalapp/libsignal-client", "@mega/signal-core"]
  },
  webpack: (config, { isServer }) => {
    // Don't bundle native modules on client side
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        path: false,
        os: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        buffer: false,
        process: false,
        util: false,
        events: false,
        string_decoder: false,
        querystring: false,
        timers: false,
        dgram: false,
        dns: false,
        child_process: false,
        cluster: false,
        module: false,
        readline: false,
        repl: false,
        vm: false,
        async_hooks: false,
        perf_hooks: false,
        worker_threads: false,
        trace_events: false,
        v8: false,
        inspector: false,
        wasi: false,
        diagnostics_channel: false,
      };
    }
    
    // Externalize native modules
    config.externals = config.externals || [];
    if (Array.isArray(config.externals)) {
      config.externals.push(
        'better-sqlite3',
        '@signalapp/libsignal-client',
        '@mega/signal-core',
        '@mega/sysmaint-protocol'
      );
    }
    
    return config;
  }
};

export default nextConfig;
