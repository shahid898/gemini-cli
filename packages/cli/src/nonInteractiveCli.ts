/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, ToolCallRequestInfo } from '@google/gemini-cli-core';
import {
  executeToolCall,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  parseAndFormatApiError,
  FatalInputError,
  FatalTurnLimitedError,
} from '@google/gemini-cli-core';
import type { Content, Part } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';

// Function to convert a file to a base64 encoded string
function fileToGenerativePart(filePath: string): Part {
  const mimeType = getMimeType(filePath);
  if (!mimeType) {
    throw new FatalInputError(`Unsupported image format: ${filePath}`);
  }
  return {
    inlineData: {
      data: fs.readFileSync(filePath).toString('base64'),
      mimeType,
    },
  };
}

function getMimeType(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    default:
      return undefined;
  }
}

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
  imagePaths?: string[],
): Promise<void> {
  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
  });

  try {
    consolePatcher.patch();
    // Handle EPIPE errors when the output is piped to a command that closes early.
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Exit gracefully if the pipe is closed.
        process.exit(0);
      }
    });

    const geminiClient = config.getGeminiClient();

    const abortController = new AbortController();

    const { processedQuery, shouldProceed } = await handleAtCommand({
      query: input,
      config,
      addItem: (_item, _timestamp) => 0,
      onDebugMessage: () => {},
      messageId: Date.now(),
      signal: abortController.signal,
    });

    if (!shouldProceed || !processedQuery) {
      // An error occurred during @include processing (e.g., file not found).
      // The error message is already logged by handleAtCommand.
      throw new FatalInputError(
        'Exiting due to an error processing the @ command.',
      );
    }

    const textPart: Part = { text: processedQuery as string };
    const imageParts: Part[] = (imagePaths || []).map(fileToGenerativePart);

    let currentMessages: Content[] = [
      { role: 'user', parts: [textPart, ...imageParts] },
    ];

    let turnCount = 0;
    while (true) {
      turnCount++;
      if (
        config.getMaxSessionTurns() >= 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        throw new FatalTurnLimitedError(
          'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
      }
      const toolCallRequests: ToolCallRequestInfo[] = [];

      const responseStream = geminiClient.sendMessageStream(
        currentMessages[0]?.parts || [],
        abortController.signal,
        prompt_id,
      );

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        if (event.type === GeminiEventType.Content) {
          process.stdout.write(event.value);
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          toolCallRequests.push(event.value);
        }
      }

      if (toolCallRequests.length > 0) {
        const toolResponseParts: Part[] = [];
        for (const requestInfo of toolCallRequests) {
          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            abortController.signal,
          );

          if (toolResponse.error) {
            console.error(
              `Error executing tool ${requestInfo.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
            );
          }

          if (toolResponse.responseParts) {
            toolResponseParts.push(...toolResponse.responseParts);
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        process.stdout.write('\n'); // Ensure a final newline
        return;
      }
    }
  } catch (error) {
    console.error(
      parseAndFormatApiError(
        error,
        config.getContentGeneratorConfig()?.authType,
      ),
    );
    throw error;
  } finally {
    consolePatcher.cleanup();
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}