/** @type {import('next').NextConfig} */
const config = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default config;
