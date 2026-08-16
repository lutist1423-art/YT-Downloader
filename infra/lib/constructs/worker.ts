import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as eventsources from "aws-cdk-lib/aws-lambda-event-sources";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";

export interface WorkerConstructProps {
  usersTable: dynamodb.ITable;
  downloadsTable: dynamodb.ITable;
  processedVideosBucket: s3.IBucket;
  downloadQueue: sqs.IQueue;
}

export class WorkerConstruct extends Construct {
  public readonly workerFn: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: WorkerConstructProps) {
    super(scope, id);

    this.workerFn = new lambda.DockerImageFunction(this, "DownloadWorkerFn", {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, "../../../worker")),
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.mebibytes(4096),
      reservedConcurrentExecutions: 2, // avoid hammering YouTube from many parallel jobs
      environment: {
        USERS_TABLE_NAME: props.usersTable.tableName,
        DOWNLOADS_TABLE_NAME: props.downloadsTable.tableName,
        PROCESSED_VIDEOS_BUCKET_NAME: props.processedVideosBucket.bucketName,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    this.workerFn.addEventSource(
      new eventsources.SqsEventSource(props.downloadQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      })
    );

    props.usersTable.grantReadWriteData(this.workerFn);
    props.downloadsTable.grantReadWriteData(this.workerFn);
    props.processedVideosBucket.grantPut(this.workerFn);
  }
}
