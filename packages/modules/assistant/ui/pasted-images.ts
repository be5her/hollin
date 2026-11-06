import { CHAT_IMAGE_EDGE, CHAT_IMAGE_TYPES, MAX_CHAT_IMAGE_BYTES, type ChatImageInput, type ChatImageType } from '@studio/core';

/*
 * Images pasted or dropped into Otto's composer, made ready for the model: an image the model reads
 * as it is (PNG, JPEG, GIF or WebP, no longer than `CHAT_IMAGE_EDGE` on its long edge, under the size
 * limit) is sent untouched; anything else (a 4K screenshot, a BMP, a TIFF from a scanner) is drawn
 * onto a canvas at that long edge and sent as PNG, or as JPEG on white when the PNG would be too big.
 */

/** A PNG larger than this is sent as JPEG instead, which keeps a photo well under the API's limit. */
const PNG_BUDGET = MAX_CHAT_IMAGE_BYTES * 0.6;

/** An image ready to go, with a data URL for its thumbnail. */
export interface PreparedImage extends ChatImageInput {
  id: string;
  url: string;
  width: number;
  height: number;
}

let seq = 0;

const isChatType = (type: string): type is ChatImageType => (CHAT_IMAGE_TYPES as readonly string[]).includes(type);

/** The image files a paste or a drop carries (a screenshot, a copied picture, files from the explorer). */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))), type, quality));
}

/** Reads, and when needed shrinks and re-encodes, one pasted image. Throws with a short reason when the file is no picture the window can decode. */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That clipboard item is not an image Otto can read.');
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, CHAT_IMAGE_EDGE / Math.max(width, height));
    let blob: Blob = file;
    let mimeType = file.type;
    if (!isChatType(file.type) || scale < 1 || file.size > MAX_CHAT_IMAGE_BYTES) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await toBlob(canvas, 'image/png');
      mimeType = 'image/png';
      if (blob.size > PNG_BUDGET) {
        // A photo: JPEG on white (JPEG has no transparency).
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        blob = await toBlob(canvas, 'image/jpeg', 0.88);
        mimeType = 'image/jpeg';
      }
    }
    const url = await readDataUrl(blob);
    const data = url.slice(url.indexOf(',') + 1);
    return { id: `paste-${++seq}`, mimeType: mimeType as ChatImageType, data, url: `data:${mimeType};base64,${data}`, width: Math.round(width * scale), height: Math.round(height * scale) };
  } finally {
    bitmap.close();
  }
}
