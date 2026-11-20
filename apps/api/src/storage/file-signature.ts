const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function startsWith(bytes: Buffer, signature: Buffer): boolean {
  return bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);
}

export function hasExpectedFileSignature(
  bytes: Buffer,
  mimeType: string,
): boolean {
  switch (mimeType) {
    case "application/pdf":
      return startsWith(bytes, Buffer.from("%PDF-"));
    case "image/jpeg":
      return startsWith(bytes, Buffer.from([0xff, 0xd8, 0xff]));
    case "image/png":
      return startsWith(bytes, PNG_SIGNATURE);
    case "image/webp":
      return (
        startsWith(bytes, Buffer.from("RIFF")) &&
        bytes.length >= 12 &&
        bytes.subarray(8, 12).equals(Buffer.from("WEBP"))
      );
    default:
      return false;
  }
}
