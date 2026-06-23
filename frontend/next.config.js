const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // This app lives in a subfolder of the Hardhat project (two lockfiles).
  outputFileTracingRoot: path.join(__dirname),
};

module.exports = nextConfig;
