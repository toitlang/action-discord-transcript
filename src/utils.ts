// Function to sanitize filenames.
export function sanitizeFilename(name: string): string {
  const nameWithoutExtension = name.replace(/\.html$/, '');
  const sanitized = nameWithoutExtension.replace(/[^\w\s-]/gi, '-');
  return `${sanitized}.html`;
}
