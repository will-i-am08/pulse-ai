/** Lab uploads go through a Vercel function (≈4.5MB body). Phone photos blow that. */

const MAX_EDGE = 1600;
const MAX_BYTES = 850_000;
const JPEG_QUALITY = 0.82;

export async function compressLabFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    out.push(await compressLabFile(file));
  }
  return out;
}

async function compressLabFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || /gif|svg/i.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let quality = JPEG_QUALITY;
    let blob = await canvasToJpeg(canvas, quality);
    while (blob.size > MAX_BYTES && quality > 0.5) {
      quality -= 0.08;
      blob = await canvasToJpeg(canvas, quality);
    }
    if (blob.size >= file.size && scale === 1) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("jpeg encode failed"));
        else resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}
