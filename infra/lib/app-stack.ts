import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { AuthConstruct } from "./constructs/auth";
import { DataConstruct } from "./constructs/data";
import { ApiConstruct } from "./constructs/api";
import { WorkerConstruct } from "./constructs/worker";
import { FrontendConstruct } from "./constructs/frontend";
import { CicdConstruct } from "./constructs/cicd";
import { CleanupConstruct } from "./constructs/cleanup";

export interface AppStackProps extends cdk.StackProps {
  domainName: string;
  parentHostedZoneDomain: string;
  certificate: acm.ICertificate;
  githubRepo: string;
  githubBranch: string;
  githubOidcProviderExists: boolean;
}

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const corsAllowOrigins = [`https://${props.domainName}`, "http://localhost:5173"];

    const data = new DataConstruct(this, "Data");

    const auth = new AuthConstruct(this, "Auth", {
      usersTable: data.usersTable,
    });

    const api = new ApiConstruct(this, "Api", {
      usersTable: data.usersTable,
      downloadsTable: data.downloadsTable,
      rateLimitsTable: data.rateLimitsTable,
      processedVideosBucket: data.processedVideosBucket,
      userCookiesBucket: data.userCookiesBucket,
      downloadQueue: data.downloadQueue,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      adminPool: auth.adminPool,
      adminPoolClient: auth.adminPoolClient,
      corsAllowOrigins,
    });

    const worker = new WorkerConstruct(this, "Worker", {
      usersTable: data.usersTable,
      downloadsTable: data.downloadsTable,
      processedVideosBucket: data.processedVideosBucket,
      userCookiesBucket: data.userCookiesBucket,
      downloadQueue: data.downloadQueue,
    });

    new CleanupConstruct(this, "Cleanup", {
      processedVideosBucket: data.processedVideosBucket,
      maxAgeMinutes: 60,
    });

    const frontend = new FrontendConstruct(this, "Frontend", {
      domainName: props.domainName,
      parentHostedZoneDomain: props.parentHostedZoneDomain,
      certificate: props.certificate,
    });

    const cicd = new CicdConstruct(this, "Cicd", {
      githubRepo: props.githubRepo,
      githubBranch: props.githubBranch,
      siteBucket: frontend.siteBucket,
      distribution: frontend.distribution,
      deployRegions: [this.region, "us-east-1"],
      githubOidcProviderExists: props.githubOidcProviderExists,
    });

    // Stack-scoped outputs (stable, predictable names - safe to reference
    // from README/scripts/CI). Nested constructs also emit their own
    // CfnOutputs for local debugging, but those get CDK-generated hash
    // suffixes and should not be relied on externally.
    new cdk.CfnOutput(this, "ApiEndpoint", { value: api.httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "UserPoolIdOut", { value: auth.userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientIdOut", { value: auth.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "AdminPoolIdOut", { value: auth.adminPool.userPoolId });
    new cdk.CfnOutput(this, "AdminPoolClientIdOut", { value: auth.adminPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "SiteBucketNameOut", { value: frontend.siteBucket.bucketName });
    new cdk.CfnOutput(this, "DistributionIdOut", { value: frontend.distribution.distributionId });
    new cdk.CfnOutput(this, "FrontendDeployRoleArnOut", { value: cicd.frontendDeployRole.roleArn });
    new cdk.CfnOutput(this, "InfraDeployRoleArnOut", { value: cicd.infraDeployRole.roleArn });
    new cdk.CfnOutput(this, "CookiesSecretNameOut", { value: worker.cookiesSecret.secretName });
  }
}
