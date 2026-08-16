#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CertStack } from "../lib/cert-stack";
import { AppStack } from "../lib/app-stack";

const app = new cdk.App();

const domainName = app.node.tryGetContext("domainName") as string;
const parentHostedZoneDomain = app.node.tryGetContext("parentHostedZoneDomain") as string;
const githubRepo = app.node.tryGetContext("githubRepo") as string;
const githubBranch = app.node.tryGetContext("githubBranch") as string;
const awsRegion = (app.node.tryGetContext("awsRegion") as string) ?? "eu-central-1";

const account = process.env.CDK_DEFAULT_ACCOUNT;

// CloudFront certificates must live in us-east-1 regardless of where the
// rest of the app is deployed.
const certStack = new CertStack(app, "YtDownloaderCertStack", {
  env: { account, region: "us-east-1" },
  crossRegionReferences: true,
  domainName,
  parentHostedZoneDomain,
});

new AppStack(app, "YtDownloaderAppStack", {
  env: { account, region: awsRegion },
  crossRegionReferences: true,
  domainName,
  parentHostedZoneDomain,
  certificate: certStack.certificate,
  githubRepo,
  githubBranch,
});
