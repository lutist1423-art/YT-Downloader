import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export interface AuthConstructProps {
  usersTable: dynamodb.ITable;
}

/**
 * Two entirely separate Cognito User Pools:
 *  - `userPool`: self-service signup for regular users, email verification,
 *    standard password-based auth + forgot-password flow. No MFA requirement.
 *  - `adminPool`: no self-signup (admins are provisioned by an operator via
 *    AdminCreateUser). TOTP MFA is REQUIRED for every admin sign-in. This is a
 *    genuinely separate identity pool/role, not a flag on a regular user.
 */
export class AuthConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly adminPool: cognito.UserPool;
  public readonly adminPoolClient: cognito.UserPoolClient;
  public readonly postConfirmationFn: lambda.NodejsFunction;

  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    // Lambda trigger that provisions the DynamoDB Users row (credits = 0)
    // the moment a new user confirms their email address.
    const backendRoot = path.join(__dirname, "../../../backend");
    this.postConfirmationFn = new lambda.NodejsFunction(this, "PostConfirmationFn", {
      entry: path.join(backendRoot, "src/handlers/postConfirmation.ts"),
      projectRoot: backendRoot,
      depsLockFilePath: path.join(backendRoot, "package-lock.json"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        USERS_TABLE_NAME: props.usersTable.tableName,
      },
    });
    props.usersTable.grantWriteData(this.postConfirmationFn);

    // ---- Regular user pool ----
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "yt-downloader-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OFF,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lambdaTriggers: {
        postConfirmation: this.postConfirmationFn,
      },
    });

    this.userPoolClient = this.userPool.addClient("UserPoolWebClient", {
      authFlows: {
        userSrp: true,
        userPassword: false,
      },
      preventUserExistenceErrors: true,
      generateSecret: false,
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ---- Admin pool (separate role, MFA mandatory) ----
    this.adminPool = new cognito.UserPool(this, "AdminPool", {
      userPoolName: "yt-downloader-admins",
      selfSignUpEnabled: false, // admins are provisioned by an operator only
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: {
        sms: false,
        otp: true, // TOTP, compatible with Google Authenticator / Authy
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.adminPoolClient = this.adminPool.addClient("AdminPoolWebClient", {
      authFlows: {
        userSrp: true,
        userPassword: false,
      },
      preventUserExistenceErrors: true,
      generateSecret: false,
      accessTokenValidity: cdk.Duration.minutes(30),
      idTokenValidity: cdk.Duration.minutes(30),
      refreshTokenValidity: cdk.Duration.hours(12),
    });

  }
}
