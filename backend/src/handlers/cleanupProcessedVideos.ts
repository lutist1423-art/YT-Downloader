import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { s3 } from "../lib/s3";

const BUCKET = process.env.PROCESSED_VIDEOS_BUCKET_NAME as string;
const MAX_AGE_MINUTES = Number(process.env.MAX_AGE_MINUTES ?? 60);

/**
 * Scheduled (EventBridge) Lambda: deletes any object in the processed
 * videos bucket older than MAX_AGE_MINUTES. S3 lifecycle rules can't express
 * sub-day retention, so this enforces the actual ~1 hour requirement.
 */
export async function handler(): Promise<void> {
  const cutoff = Date.now() - MAX_AGE_MINUTES * 60 * 1000;
  let continuationToken: string | undefined;
  let deletedCount = 0;

  do {
    const listResult = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: continuationToken })
    );

    const expiredKeys = (listResult.Contents ?? [])
      .filter((obj) => obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff)
      .map((obj) => ({ Key: obj.Key as string }));

    if (expiredKeys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: expiredKeys, Quiet: true },
        })
      );
      deletedCount += expiredKeys.length;
    }

    continuationToken = listResult.NextContinuationToken;
  } while (continuationToken);

  console.log(`Cleanup complete: deleted ${deletedCount} expired object(s).`);
}
