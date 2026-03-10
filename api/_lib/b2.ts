import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export function makeB2Client(endpoint: string): S3Client {
  const keyId = process.env.B2_KEY_ID || "";
  const applicationKey = process.env.B2_APPLICATION_KEY || "";

  if (!endpoint) {
    throw new Error("B2 endpoint is required");
  }
  if (!keyId || !applicationKey) {
    throw new Error("B2_KEY_ID and B2_APPLICATION_KEY must be set");
  }

  return new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: applicationKey,
    },
  });
}

export async function b2UploadBuffer(params: {
  endpoint: string;
  bucket: string;
  key: string;
  contentType: string;
  body: Buffer;
}) {
  const client = makeB2Client(params.endpoint);
  await client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      ContentType: params.contentType,
      Body: params.body,
    }),
  );
}
