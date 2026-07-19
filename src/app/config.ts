import { readFileSync } from 'node:fs';
import { type Config, type Credentials, configSchema } from '../core/types.js';

export function loadConfig(path: string): Config {
  return configSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function loadCredentials(config: Config, onSkip: (message: string) => void): Credentials[] {
  const loaded: Credentials[] = [];
  for (const { name, envPrefix } of config.accounts) {
    const username = process.env[`${envPrefix}_USERNAME`];
    const password = process.env[`${envPrefix}_PASSWORD`];
    if (!username || !password) {
      onSkip(`account "${name}" skipped: ${envPrefix}_USERNAME / ${envPrefix}_PASSWORD not set`);
      continue;
    }
    loaded.push({ name, username, password });
  }
  if (loaded.length === 0) throw new Error('no account credentials configured in .env');
  return loaded;
}
