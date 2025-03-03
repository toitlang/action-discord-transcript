// Copyright (C) 2025 Toit language
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

// Function to sanitize filenames.
export function sanitizeFilename(name: string): string {
  const nameWithoutExtension = name.replace(/\.html$/, '');
  const sanitized = nameWithoutExtension.replace(/[^\w\s-]/gi, '-');
  return `${sanitized}.html`;
}
