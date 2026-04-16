const { spawnSync } = require('node:child_process');

const args = [
  'run',
  'github.com/golangci/golangci-lint/cmd/golangci-lint@v1.64.8',
  'run',
  '--timeout=5m',
];

const environment = {
  ...process.env,
  GOTOOLCHAIN: 'go1.25.8+auto',
};

const result = spawnSync('go', args, {
  stdio: 'inherit',
  env: environment,
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);