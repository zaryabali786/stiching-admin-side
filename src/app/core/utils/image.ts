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

const ICON_MAX_DIMENSION = 640;
const SVG_MAX_BYTES = 600 * 1024;

/**
 * An icon / illustration for a card: unlike a photo it is not flattened onto white. A PNG, WebP or GIF keeps its transparent
 * background (re-encoded as PNG, longest edge 640px); a JPG stays a JPG; an SVG is sent untouched (the server checks it is a plain drawing).
 */
export async function prepareIcon(file: File): Promise<ImageUpload> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) {
    if (file.size > SVG_MAX_BYTES) throw new Error('This SVG is too big. Keep it under 600 KB.');
    const text = await file.text();
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
    return { name: file.name, dataUrl };
  }
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a picture.`);
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, ICON_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process this picture in your browser.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'icon';
  const jpeg = file.type === 'image/jpeg';
  return { name: `${baseName}.${jpeg ? 'jpg' : 'png'}`, dataUrl: canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9) };
}
