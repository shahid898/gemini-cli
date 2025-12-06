/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as url from 'node:url';
import * as path from 'node:path';

import { logger } from './logger.js';
import { main } from './agent.js';

function getModelFromArgs(): string | undefined {
  const modelArg = process.argv.find((arg) => arg.startsWith('--model='));
  if (modelArg) {
    return modelArg.split('=')[1];
  }
  const modelFlagIndex = process.argv.indexOf('--model');
  if (modelFlagIndex !== -1 && process.argv.length > modelFlagIndex + 1) {
    return process.argv[modelFlagIndex + 1];
  }
  return undefined;
}

// Check if the module is the main script being run. path.resolve() creates a
// canonical, absolute path, which avoids cross-platform issues.
const isMainModule =
  path.resolve(process.argv[1]) ===
  path.resolve(url.fileURLToPath(import.meta.url));

process.on('uncaughtException', (error) => {
  logger.error('Unhandled exception:', error);
  process.exit(1);
});

if (
  import.meta.url.startsWith('file:') &&
  isMainModule &&
  process.env['NODE_ENV'] !== 'test'
) {
  const model = getModelFromArgs();
  main(model).catch((error) => {
    logger.error('[CoreAgent] Unhandled error in main:', error);
    process.exit(1);
  });
}
