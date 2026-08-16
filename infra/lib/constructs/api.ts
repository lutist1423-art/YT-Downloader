import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";

export interface ApiConstructProps {
  usersTable: dynamodb.ITable;
  downloadsTable: dynamodb.ITable;
  rateLimitsTable: dynamodb.ITable;
  processedVideosBucket: s3.IBucket;
  userCookiesBucket: s3.IBucket;
  downloadQueue: sqs.IQueue;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  adminPool: cognito.IUserPool;
  adminPoolClient: cognito.IUserPoolClient;
  corsAllowOrigins: string[];
}

const BACKEND_SRC = path.join(__dirname, "../../../backend/src/handlers");
const DEPS_LOCK_FILE = path.join(__dirname, "../../../backend/package-lock.json");

export class ApiConstruct extends Construct {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const commonEnv = {
      USERS_TABLE_NAME: props.usersTable.tableName,
      DOWNLOADS_TABLE_NAME: props.downloadsTable.tableName,
      RATE_LIMITS_TABLE_NAME: props.rateLimitsTable.tableName,
      DOWNLOAD_QUEUE_URL: props.downloadQueue.queueUrl,
      PROCESSED_VIDEOS_BUCKET_NAME: props.processedVideosBucket.bucketName,
      USER_COOKIES_BUCKET_NAME: props.userCookiesBucket.bucketName,
      CORS_ALLOW_ORIGIN: props.corsAllowOrigins[0],
    };

    const makeFn = (name: string, entryFile: string) =>
      new lambda.NodejsFunction(this, name, {
        entry: path.join(BACKEND_SRC, entryFile),
        handler: "handler",
        runtime: Runtime.NODEJS_22_X,
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        depsLockFilePath: DEPS_LOCK_FILE,
        environment: commonEnv,
        logRetention: logs.RetentionDays.TWO_WEEKS,
      });

    // ---- User-facing Lambdas ----
    const getMeFn = makeFn("GetMeFn", "getMe.ts");
    props.usersTable.grantReadData(getMeFn);

    const createDownloadFn = makeFn("CreateDownloadFn", "createDownload.ts");
    props.usersTable.grantReadWriteData(createDownloadFn);
    props.downloadsTable.grantWriteData(createDownloadFn);
    props.rateLimitsTable.grantReadWriteData(createDownloadFn);
    props.downloadQueue.grantSendMessages(createDownloadFn);

    const listDownloadsFn = makeFn("ListDownloadsFn", "listDownloads.ts");
    props.downloadsTable.grantReadData(listDownloadsFn);

    const getDownloadFn = makeFn("GetDownloadFn", "getDownload.ts");
    props.downloadsTable.grantReadData(getDownloadFn);
    props.processedVideosBucket.grantRead(getDownloadFn);

    const uploadCookiesFn = makeFn("UploadCookiesFn", "uploadCookies.ts");
    props.userCookiesBucket.grantPut(uploadCookiesFn);
    props.usersTable.grantWriteData(uploadCookiesFn);

    const deleteCookiesFn = makeFn("DeleteCookiesFn", "deleteCookies.ts");
    props.userCookiesBucket.grantDelete(deleteCookiesFn);
    props.usersTable.grantWriteData(deleteCookiesFn);

    // ---- Admin Lambdas ----
    const adminListUsersFn = makeFn("AdminListUsersFn", "adminListUsers.ts");
    props.usersTable.grantReadData(adminListUsersFn);

    const adminSetCreditsFn = makeFn("AdminSetCreditsFn", "adminSetCredits.ts");
    props.usersTable.grantReadWriteData(adminSetCreditsFn);

    const adminListUserDownloadsFn = makeFn("AdminListUserDownloadsFn", "adminListUserDownloads.ts");
    props.downloadsTable.grantReadData(adminListUserDownloadsFn);

    // ---- HTTP API ----
    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "yt-downloader-api",
      corsPreflight: {
        allowOrigins: props.corsAllowOrigins,
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        maxAge: cdk.Duration.hours(1),
      },
    });

    const userAuthorizer = new authorizers.HttpUserPoolAuthorizer("UserAuthorizer", props.userPool, {
      userPoolClients: [props.userPoolClient],
      identitySource: ["$request.header.Authorization"],
    });

    const adminAuthorizer = new authorizers.HttpUserPoolAuthorizer("AdminAuthorizer", props.adminPool, {
      userPoolClients: [props.adminPoolClient],
      identitySource: ["$request.header.Authorization"],
    });

    // User routes
    this.httpApi.addRoutes({
      path: "/me",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("GetMeInt", getMeFn),
      authorizer: userAuthorizer,
    });
    this.httpApi.addRoutes({
      path: "/downloads",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("CreateDownloadInt", createDownloadFn),
      authorizer: userAuthorizer,
    });
    this.httpApi.addRoutes({
      path: "/downloads",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("ListDownloadsInt", listDownloadsFn),
      authorizer: userAuthorizer,
    });
    this.httpApi.addRoutes({
      path: "/downloads/{id}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("GetDownloadInt", getDownloadFn),
      authorizer: userAuthorizer,
    });
    this.httpApi.addRoutes({
      path: "/me/cookies",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("UploadCookiesInt", uploadCookiesFn),
      authorizer: userAuthorizer,
    });
    this.httpApi.addRoutes({
      path: "/me/cookies",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new integrations.HttpLambdaIntegration("DeleteCookiesInt", deleteCookiesFn),
      authorizer: userAuthorizer,
    });

    // Admin routes
    this.httpApi.addRoutes({
      path: "/admin/users",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("AdminListUsersInt", adminListUsersFn),
      authorizer: adminAuthorizer,
    });
    this.httpApi.addRoutes({
      path: "/admin/users/{userId}/credits",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration("AdminSetCreditsInt", adminSetCreditsFn),
      authorizer: adminAuthorizer,
    });
    this.httpApi.addRoutes({
      path: "/admin/users/{userId}/downloads",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("AdminListUserDownloadsInt", adminListUserDownloadsFn),
      authorizer: adminAuthorizer,
    });
  }
}
