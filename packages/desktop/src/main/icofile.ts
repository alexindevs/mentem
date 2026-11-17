/** Wraps one PNG in an .ico file. Windows reads PNG images inside icons, so nothing is re-encoded. */
export function pngToIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(1, 4); // one image
  header[6] = size >= 256 ? 0 : size; // width, 0 means 256
  header[7] = size >= 256 ? 0 : size;
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // where the image starts
  return Buffer.concat([header, png]);
}
