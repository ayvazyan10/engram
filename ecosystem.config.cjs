/**
 * PM2 process definition for running Engram in the background.
 *
 * Usage:
 *   pnpm --filter @engram-ai-memory/server build
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs engram
 *   pm2 stop engram
 *
 * Override host/port/data paths via the standard ENGRAM_* env vars
 * (see docs/CONFIGURATION.md) or a .env file of your own.
 */
module.exports = {
  apps: [
    {
      name: 'engram',
      cwd: __dirname,
      script: 'apps/server/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
