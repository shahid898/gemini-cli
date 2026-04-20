/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Task } from './agent/task.js';
import type { Config } from '@google/gemini-cli-core';
import type { ExecutionEventBus } from '@a2a-js/sdk/server';
import type { RequestContext } from '@a2a-js/sdk/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import *
as os from 'node:os';

// Mock the logger
vi.mock('./utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const sendMessageStreamSpy = vi.fn();
vi.mock('@google/gemini-cli-core', async () => {
  const actual = await vi.importActual('@google/gemini-cli-core');
  return {
    ...actual,
    GeminiClient: vi.fn().mockImplementation(() => ({
      sendMessageStream: sendMessageStreamSpy,
      addHistory: vi.fn(),
    })),
  };
});

describe('Task', () => {
  let task: Task;
  let mockConfig: Partial<Config>;
  let mockEventBus: Partial<ExecutionEventBus>;
  let tempDir: string;

  beforeEach(async () => {
    mockConfig = {
      getToolRegistry: vi.fn().mockResolvedValue({
        getTool: vi.fn(),
        getAllTools: vi.fn().mockReturnValue([]),
      }),
      getApprovalMode: vi.fn(),
      getContentGeneratorConfig: vi.fn().mockReturnValue({ model: 'gemini-pro' }),
      getModel: vi.fn().mockReturnValue('gemini-pro'),
    };

    mockEventBus = {
      publish: vi.fn(),
    };

    task = await Task.create(
      'test-task',
      'test-context',
      mockConfig as Config,
      mockEventBus as ExecutionEventBus,
    );
    
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-cli-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should not treat a URL as an image path', async () => {
    const userMessage = {
      parts: [
        {
          kind: 'text',
          text: 'Look at this image: https://example.com/image.png',
        },
      ],
    };
    const requestContext = { userMessage } as RequestContext;
    const abortSignal = new AbortController().signal;

    // Create a spy on fs.existsSync to ensure it's not called for the URL
    const existsSyncSpy = vi.spyOn(fs, 'existsSync');

    const generator = task.acceptUserMessage(requestContext, abortSignal);
    await generator.next();

    expect(existsSyncSpy).not.toHaveBeenCalled();
    expect(sendMessageStreamSpy).toHaveBeenCalledWith(
      [{ text: 'Look at this image: https://example.com/image.png' }],
      abortSignal,
      '',
    );
  });

  it('should handle a local image path and convert it to inlineData', async () => {
    const imagePath = 'test-image.png';
    const absoluteImagePath = path.join(tempDir, imagePath);
    fs.writeFileSync(absoluteImagePath, 'dummy-image-content');

    const userMessage = {
      parts: [
        {
          kind: 'text',
          text: `Here is the image: "${imagePath}"`,
        },
      ],
    };
    const requestContext = { userMessage } as RequestContext;
    const abortSignal = new AbortController().signal;

    const generator = task.acceptUserMessage(requestContext, abortSignal);
    await generator.next();

    const expectedBase64 = Buffer.from('dummy-image-content').toString('base64');

    expect(sendMessageStreamSpy).toHaveBeenCalledWith(
      [
        { text: 'Here is the image: ""' },
        {
          inlineData: {
            data: expectedBase64,
            mimeType: 'image/png',
          },
        },
      ],
      abortSignal,
      '',
    );
  });

  it('should not treat a quoted URL as an image path', async () => {
    const userMessage = {
      parts: [
        {
          kind: 'text',
          text: 'Look at this image: "https://example.com/image.png"',
        },
      ],
    };
    const requestContext = { userMessage } as RequestContext;
    const abortSignal = new AbortController().signal;

    // Create a spy on fs.existsSync to ensure it's not called for the URL
    const existsSyncSpy = vi.spyOn(fs, 'existsSync');

    const generator = task.acceptUserMessage(requestContext, abortSignal);
    await generator.next();

    expect(existsSyncSpy).not.toHaveBeenCalled();
    expect(sendMessageStreamSpy).toHaveBeenCalledWith(
      [{ text: 'Look at this image: "https://example.com/image.png"' }],
      abortSignal,
      '',
    );
  });
});
