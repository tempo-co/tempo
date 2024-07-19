const MAX_LENGTH = 60;

export function truncateFileName(name: string) {
  const lastDotIndex = name.lastIndexOf('.');
  const extension = lastDotIndex !== -1 ? name.substring(lastDotIndex) : '';
  const baseName = lastDotIndex !== -1 ? name.substring(0, lastDotIndex) : name;

  if (name.length > MAX_LENGTH) {
    const truncationLength = MAX_LENGTH - extension.length - 3;
    return `${baseName.substring(0, truncationLength > 0 ? truncationLength : 0)}..${extension}`;
  }
  return name;
}
