import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatIso, ictToday } from './ict.js';

const LOG_DIR = join(process.cwd(), 'logs');
mkdirSync(LOG_DIR, { recursive: true });

function write(level: 'INFO' | 'WARN' | 'ERROR', message: string, context?: unknown): void {
  const line = `${new Date().toISOString()} ${level} ${message}${context !== undefined ? ' ' + JSON.stringify(context) : ''}`;
  const stream = level === 'ERROR' ? console.error : console.log;
  stream(line);
  appendFileSync(join(LOG_DIR, `${formatIso(ictToday())}.log`), line + '\n');
}

export const log = {
  info: (message: string, context?: unknown): void => write('INFO', message, context),
  warn: (message: string, context?: unknown): void => write('WARN', message, context),
  error: (message: string, context?: unknown): void => write('ERROR', message, context),
};
