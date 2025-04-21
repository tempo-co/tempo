/** Initiates a download for the given file. */
export function downloadFile(file: File) {
  if (!file) return;
  const url = URL.createObjectURL(file);

  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}
