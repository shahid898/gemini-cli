/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FilePart, FileWithBytes } from '@a2a-js/sdk';
import {
  getImageMimeType,
  buildInlineImagePartsFromText,
  inlineImageFromFilePart,
  type InlineImagePart,
} from './image-parts.js';

let ws: string;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'img-parts-'));
});
afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe('getImageMimeType', () => {
  it('maps known extensions', () => {
    expect(getImageMimeType('a.png')).toBe('image/png');
    expect(getImageMimeType('a.JPG')).toBe('image/jpeg');
  });
  it('returns undefined for unknown', () => {
    expect(getImageMimeType('a.txt')).toBeUndefined();
  });
});

describe('buildInlineImagePartsFromText', () => {
  it('inlines an existing image and strips its reference', () => {
    const dir = path.join(ws, 'input', 'images');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '19.png'), Buffer.from([1, 2, 3]));
    const r = buildInlineImagePartsFromText(
      "make a screen 'input/images/19.png'",
      ws,
    );
    expect(r.imageParts).toHaveLength(1);
    expect(r.imageParts[0].inlineData.mimeType).toBe('image/png');
    expect(r.textWithoutImageRefs).not.toContain('19.png');
  });

  it('leaves a MISSING image reference as literal text and does NOT throw', () => {
    const r = buildInlineImagePartsFromText(
      "download and save as '19.png'",
      ws,
    );
    expect(r.imageParts).toHaveLength(0);
    expect(r.textWithoutImageRefs).toContain("'19.png'");
  });

  it('skips URLs', () => {
    const r = buildInlineImagePartsFromText('see https://x.com/a.png now', ws);
    expect(r.imageParts).toHaveLength(0);
    expect(r.textWithoutImageRefs).toContain('https://x.com/a.png');
  });

  it('throws when the path escapes the workspace', () => {
    expect(() =>
      buildInlineImagePartsFromText("'../../etc/secret.png'", ws),
    ).toThrow(/outside of the workspace/);
  });

  it('throws when a sibling directory shares the workspace prefix', () => {
    // ws is e.g. /tmp/img-parts-XXXX; target /tmp/img-parts-XXXX-sibling/x.png
    const rel = path.join('..', `${path.basename(ws)}-sibling`, 'x.png');
    expect(() => buildInlineImagePartsFromText(`'${rel}'`, ws)).toThrow(
      /outside of the workspace/,
    );
  });
});

describe('inlineImageFromFilePart', () => {
  it('writes bytes to input/images/<name> and returns an inlineData part', () => {
    const bytes = Buffer.from([9, 8, 7]).toString('base64');
    const part: FilePart = {
      kind: 'file',
      file: { name: '19.png', mimeType: 'image/png', bytes } as FileWithBytes,
    };
    const res = inlineImageFromFilePart(part, ws);
    expect(res).not.toBeNull();
    expect((res as InlineImagePart).inlineData.data).toBe(bytes);
    const written = fs.readFileSync(path.join(ws, 'input', 'images', '19.png'));
    expect(Array.from(written)).toEqual([9, 8, 7]);
  });

  it('sanitizes a traversal filename to its basename', () => {
    const bytes = Buffer.from([1]).toString('base64');
    const part: FilePart = {
      kind: 'file',
      file: { name: '../../evil.png', bytes } as FileWithBytes,
    };
    inlineImageFromFilePart(part, ws);
    expect(fs.existsSync(path.join(ws, 'input', 'images', 'evil.png'))).toBe(
      true,
    );
  });

  it('returns null for an unsupported extension', () => {
    const part: FilePart = {
      kind: 'file',
      file: { name: 'a.txt', bytes: 'AAA=' } as FileWithBytes,
    };
    expect(inlineImageFromFilePart(part, ws)).toBeNull();
  });
});
