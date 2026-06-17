import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/BYD-Wallet",
  assetPrefix: "/BYD-Wallet/",
  images: { unoptimized: true },
};

export default nextConfig;
