const MAX_LENGTH = 70;

export function truncateFileName(name: string, maxLength: number = MAX_LENGTH) {
  const lastDotIndex = name.lastIndexOf('.');
  const extension = lastDotIndex !== -1 ? name.substring(lastDotIndex) : '';
  const baseName = lastDotIndex !== -1 ? name.substring(0, lastDotIndex) : name;

  if (name.length > maxLength) {
    const truncationLength = maxLength - extension.length - 3;
    return `${baseName.substring(0, truncationLength > 0 ? truncationLength : 0)}..${extension}`;
  }
  return name;
}
