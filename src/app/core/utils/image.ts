export interface ImageUpload {
  name: string;
  dataUrl: string;
}

const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.85;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file is not a readable image.'));
    img.src = src;
  });
}

/**
 * Reads an image file and always re-encodes it on a canvas: longest edge capped at 1200px,
 * JPEG 0.85, so catalogue pictures stay small and uniform.
 */
export async function compressImage(file: File, maxDimension = MAX_DIMENSION): Promise<ImageUpload> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
  const original = await readAsDataUrl(file);
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
  const img = await loadImage(original);

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, maxDimension / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process this image in your browser.');
  ctx.fillStyle = '#ffffff'; // flatten transparent PNGs
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { name: `${baseName}.jpg`, dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY) };
}
