import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";

export class DataConstruct extends Construct {
  public readonly usersTable: dynamodb.Table;
  public readonly downloadsTable: dynamodb.Table;
  public readonly rateLimitsTable: dynamodb.Table;
  public readonly processedVideosBucket: s3.Bucket;
  public readonly downloadQueue: sqs.Queue;
  public readonly downloadDlq: sqs.Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // ---- Users table ----
    // No explicit tableName: RETAIN + a fixed physical name means a rolled-
    // back/deleted stack leaves an orphaned table that then collides by
    // name on the next deploy. Let CloudFormation generate a unique name.
    this.usersTable = new dynamodb.Table(this, "UsersTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.usersTable.addGlobalSecondaryIndex({
      indexName: "EmailIndex",
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ---- Downloads table ----
    this.downloadsTable = new dynamodb.Table(this, "DownloadsTable", {
      partitionKey: { name: "downloadId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.downloadsTable.addGlobalSecondaryIndex({
      indexName: "UserIndex",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "requestedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ---- Rate limiting table (per-user sliding/fixed window counters) ----
    this.rateLimitsTable = new dynamodb.Table(this, "RateLimitsTable", {
      tableName: "yt-downloader-rate-limits",
      partitionKey: { name: "rateKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---- Processed videos bucket: private, auto-expires after 1 hour ----
    this.processedVideosBucket = new s3.Bucket(this, "ProcessedVideosBucket", {
      bucketName: undefined, // let CDK generate a unique name
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // S3 lifecycle rules only support whole-day granularity, so this is a
      // 1-day backstop. The actual ~1 hour retention target is enforced by
      // the scheduled CleanupConstruct Lambda (see cleanup.ts).
      lifecycleRules: [
        {
          id: "expire-processed-videos-backstop",
          enabled: true,
          expiration: cdk.Duration.days(1),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---- Async download pipeline ----
    this.downloadDlq = new sqs.Queue(this, "DownloadDLQ", {
      queueName: "yt-downloader-download-dlq",
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.downloadQueue = new sqs.Queue(this, "DownloadQueue", {
      queueName: "yt-downloader-download-queue",
      visibilityTimeout: cdk.Duration.minutes(16), // must exceed worker Lambda timeout
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.downloadDlq,
        maxReceiveCount: 3,
      },
    });
  }
}
