import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";

export interface CleanupConstructProps {
  processedVideosBucket: s3.IBucket;
  maxAgeMinutes?: number;
}

/**
 * Enforces the "delete processed videos after ~1 hour" requirement at
 * minute-level granularity (S3 lifecycle rules only support whole days).
 * Runs every 15 minutes and deletes any object older than maxAgeMinutes.
 */
export class CleanupConstruct extends Construct {
  constructor(scope: Construct, id: string, props: CleanupConstructProps) {
    super(scope, id);

    const backendRoot = path.join(__dirname, "../../../backend");
    const cleanupFn = new lambda.NodejsFunction(this, "CleanupFn", {
      entry: path.join(backendRoot, "src/handlers/cleanupProcessedVideos.ts"),
      projectRoot: backendRoot,
      depsLockFilePath: path.join(backendRoot, "package-lock.json"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        PROCESSED_VIDEOS_BUCKET_NAME: props.processedVideosBucket.bucketName,
        MAX_AGE_MINUTES: String(props.maxAgeMinutes ?? 60),
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    props.processedVideosBucket.grantRead(cleanupFn);
    props.processedVideosBucket.grantDelete(cleanupFn);

    new events.Rule(this, "CleanupSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(cleanupFn)],
    });
  }
}
