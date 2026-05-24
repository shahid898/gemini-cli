/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsSync from 'node:fs';
import * as path from 'node:path';
import type { FilePart } from '@a2a-js/sdk';

export interface InlineImagePart {
  inlineData: { data: string; mimeType: string };
}
export interface TextImageResult {
  textWithoutImageRefs: string;
  imageParts: InlineImagePart[];
}

const IMAGE_REF_REGEX =
  /'((?!https?:\/\/)[^']+\.(?:png|jpg|jpeg|webp|heic|heif))'|"((?!https?:\/\/)[^"]+\.(?:png|jpg|jpeg|webp|heic|heif))"|((?!https?:\/\/)\S+\.(?:png|jpg|jpeg|webp|heic|heif))/gi;

export function getImageMimeType(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
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

/**
 * Scan text for local image references and inline the ones that exist on disk.
 * Missing files / unsupported formats are left as literal text (never throw).
 * Throws ONLY when a referenced path escapes the workspace.
 */
export function buildInlineImagePartsFromText(
  text: string,
  workspacePath: string,
): TextImageResult {
  const imageParts: InlineImagePart[] = [];
  const textWithoutImageRefs = text.replace(
    IMAGE_REF_REGEX,
    (
      match,
      g1: string | undefined,
      g2: string | undefined,
      g3: string | undefined,
    ) => {
      if (match.includes('://')) return match; // URL — keep as text
      const refPath = g1 ?? g2 ?? g3 ?? '';
      const absolutePath = path.resolve(workspacePath, refPath);
      if (!absolutePath.startsWith(workspacePath)) {
        throw new Error(
          `File path is outside of the workspace: ${refPath}. Workspace is: ${workspacePath}`,
        );
      }
      if (!fsSync.existsSync(absolutePath)) return match; // not yet created — keep as text
      const mimeType = getImageMimeType(refPath);
      if (!mimeType) return match;
      const data = fsSync.readFileSync(absolutePath).toString('base64');
      imageParts.push({ inlineData: { data, mimeType } });
      return '';
    },
  );
  return { textWithoutImageRefs, imageParts };
}

/**
 * Persist an inbound A2A file part (bytes) into the worktree at
 * input/images/<basename> and return an inline image part. Returns null if the
 * part carries no bytes or an unsupported extension.
 */
export function inlineImageFromFilePart(
  part: FilePart,
  workspacePath: string,
): InlineImagePart | null {
  const file = part.file as {
    name?: string;
    mimeType?: string;
    bytes?: string;
  };
  if (!file || !file.bytes) return null;
  const name = path.basename(file.name ?? 'image.png');
  const mimeType = file.mimeType ?? getImageMimeType(name);
  if (!mimeType) return null;
  const destDir = path.join(workspacePath, 'input', 'images');
  fsSync.mkdirSync(destDir, { recursive: true });
  fsSync.writeFileSync(
    path.join(destDir, name),
    Buffer.from(file.bytes, 'base64'),
  );
  return { inlineData: { data: file.bytes, mimeType } };
}
