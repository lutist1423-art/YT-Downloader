import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as eventsources from "aws-cdk-lib/aws-lambda-event-sources";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";

export interface WorkerConstructProps {
  usersTable: dynamodb.ITable;
  downloadsTable: dynamodb.ITable;
  processedVideosBucket: s3.IBucket;
  userCookiesBucket: s3.IBucket;
  downloadQueue: sqs.IQueue;
}

export class WorkerConstruct extends Construct {
  public readonly workerFn: lambda.DockerImageFunction;
  public readonly cookiesSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: WorkerConstructProps) {
    super(scope, id);

    // YouTube increasingly blocks datacenter/cloud IPs with a "Sign in to
    // confirm you're not a bot" error unless yt-dlp presents cookies from an
    // authenticated browser session. This starts as an empty placeholder;
    // an operator must populate it after deploy (see README) with a real
    // exported cookies.txt for downloads to work reliably.
    // Temporarily DESTROY (was RETAIN) as part of a full project teardown.
    this.cookiesSecret = new secretsmanager.Secret(this, "YoutubeCookiesSecret", {
      description:
        "Netscape-format cookies.txt content from an authenticated YouTube session, used by yt-dlp to avoid bot-check blocks.",
      secretStringValue: cdk.SecretValue.unsafePlainText(
        "# PLACEHOLDER - replace with a real exported cookies.txt (see README)\n"
      ),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.workerFn = new lambda.DockerImageFunction(this, "DownloadWorkerFn", {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, "../../../worker")),
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.mebibytes(4096),
      environment: {
        USERS_TABLE_NAME: props.usersTable.tableName,
        DOWNLOADS_TABLE_NAME: props.downloadsTable.tableName,
        PROCESSED_VIDEOS_BUCKET_NAME: props.processedVideosBucket.bucketName,
        USER_COOKIES_BUCKET_NAME: props.userCookiesBucket.bucketName,
        COOKIES_SECRET_ARN: this.cookiesSecret.secretArn,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    this.cookiesSecret.grantRead(this.workerFn);
    props.userCookiesBucket.grantRead(this.workerFn);

    this.workerFn.addEventSource(
      new eventsources.SqsEventSource(props.downloadQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
        // Caps concurrent invocations from this queue without reserving
        // account-wide Lambda concurrency (avoids hammering YouTube from
        // many parallel jobs, and works even on accounts with a small
        // total concurrency quota).
        maxConcurrency: 2,
      })
    );

    props.usersTable.grantReadWriteData(this.workerFn);
    props.downloadsTable.grantReadWriteData(this.workerFn);
    props.processedVideosBucket.grantPut(this.workerFn);
  }
}
