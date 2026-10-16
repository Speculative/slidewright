import type { ClipboardImage } from './element-clipboard.js';

export function clipboardImageFiles(data: DataTransfer): File[] {
  // Use items OR files: browsers commonly expose the same image in both.
  const items = Array.from(data.items)
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
  return items.length ? items : Array.from(data.files).filter(file => file.type.startsWith('image/'));
}

export async function readClipboardImage(file: File): Promise<ClipboardImage> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the pasted image.'));
    reader.onabort = () => reject(new Error('Image paste was interrupted.'));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error('The pasted image has no usable dimensions.'));
        return;
      }
      resolve({ src, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => reject(new Error('The pasted image format could not be opened.'));
    image.src = src;
  });
}
