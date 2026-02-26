import type { VercelRequest } from "@vercel/node";

export interface ParsedMultipart {
  fields: Record<string, string>;
  file?: {
    filename: string;
    mimeType: string;
    buffer: Buffer;
  };
}

export async function parseMultipart(req: VercelRequest): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let fileBuffer = Buffer.alloc(0);
    let filename = "upload.bin";
    let mimeType = "application/octet-stream";

    let BusboyCtor: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      BusboyCtor = require("busboy");
    } catch (error) {
      reject(new Error("busboy is required for multipart parsing"));
      return;
    }

    const busboy = BusboyCtor({ headers: req.headers });

    busboy.on("field", (name: string, val: string) => {
      fields[name] = val;
    });

    busboy.on("file", (_name: string, stream: NodeJS.ReadableStream, info: any) => {
      filename = info?.filename || filename;
      mimeType = info?.mimeType || mimeType;
      const chunks: Buffer[] = [];

      stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.on("error", reject);
      stream.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => {
      resolve({
        fields,
        file: fileBuffer.length
          ? {
              filename,
              mimeType,
              buffer: fileBuffer,
            }
          : undefined,
      });
    });

    (req as any).pipe(busboy);
  });
}
