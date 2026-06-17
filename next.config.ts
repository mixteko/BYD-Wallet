import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  ...(isProd && {
    basePath: "/BYD-Wallet",
    assetPrefix: "/BYD-Wallet/",
  }),
  images: { unoptimized: true },
};

export default nextConfig;
