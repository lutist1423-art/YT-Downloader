import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";

export interface CicdConstructProps {
  githubRepo: string; // "owner/repo"
  githubBranch: string;
  siteBucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
  cdkQualifier?: string; // defaults to CDK's standard "hnb659fds"
  deployRegions: string[]; // regions the infra deploy role must be able to assume CDK bootstrap roles in
  /**
   * An AWS account can only have ONE IAM OIDC provider per issuer URL. If
   * this AWS account already has a `token.actions.githubusercontent.com`
   * provider registered (e.g. from another project's GitHub Actions OIDC
   * setup), set this to true to import/reuse it instead of trying to create
   * a duplicate (which fails with EntityAlreadyExistsException).
   */
  githubOidcProviderExists: boolean;
}

/**
 * Sets up federated (OIDC) trust between this AWS account and GitHub
 * Actions for the given repo, so that ongoing deploys never need long-lived
 * IAM user access keys. Two distinct roles, least privilege:
 *
 *  - FrontendDeployRole: only S3 sync on the site bucket + CloudFront
 *    invalidation. Used by deploy-frontend.yml.
 *  - InfraDeployRole: permitted only to assume the CDK bootstrap roles
 *    (deploy/file-publishing/image-publishing/lookup) that `cdk bootstrap`
 *    creates - it never holds direct service permissions itself. Used by
 *    deploy-infra.yml for `cdk deploy`.
 */
export class CicdConstruct extends Construct {
  public readonly frontendDeployRole: iam.Role;
  public readonly infraDeployRole: iam.Role;

  constructor(scope: Construct, id: string, props: CicdConstructProps) {
    super(scope, id);

    const qualifier = props.cdkQualifier ?? "hnb659fds";
    const account = cdk.Stack.of(this).account;

    const provider = props.githubOidcProviderExists
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "GithubOidcProvider",
          `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`
        )
      : new iam.OpenIdConnectProvider(this, "GithubOidcProvider", {
          url: "https://token.actions.githubusercontent.com",
          clientIds: ["sts.amazonaws.com"],
        });

    // GitHub's OIDC `sub` claim is normally "repo:{owner}/{repo}:ref:refs/heads/{branch}",
    // but repos/orgs that have enabled "include repository and owner IDs in
    // the JWT sub claim" (a rename/transfer-hardening setting) instead emit
    // "repo:{owner}@{ownerId}/{repo}@{repoId}:ref:refs/heads/{branch}". This
    // account has that setting on, so match both formats to be robust
    // either way.
    const [repoOwner, repoName] = props.githubRepo.split("/");
    const githubPrincipal = (branch: string) =>
      new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": [
            `repo:${props.githubRepo}:ref:refs/heads/${branch}`,
            `repo:${repoOwner}@*/${repoName}@*:ref:refs/heads/${branch}`,
          ],
        },
      });

    // ---- Frontend deploy role: S3 sync + CloudFront invalidation only ----
    this.frontendDeployRole = new iam.Role(this, "FrontendDeployRole", {
      roleName: "yt-downloader-github-frontend-deploy",
      assumedBy: githubPrincipal(props.githubBranch),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    props.siteBucket.grantReadWrite(this.frontendDeployRole);
    props.siteBucket.grantDelete(this.frontendDeployRole);

    this.frontendDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${account}:distribution/${props.distribution.distributionId}`,
        ],
      })
    );

    // ---- Infra deploy role: may only assume the CDK bootstrap roles ----
    this.infraDeployRole = new iam.Role(this, "InfraDeployRole", {
      roleName: "yt-downloader-github-infra-deploy",
      assumedBy: githubPrincipal(props.githubBranch),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    const bootstrapRoleArns = props.deployRegions.flatMap((region) => [
      `arn:aws:iam::${account}:role/cdk-${qualifier}-deploy-role-${account}-${region}`,
      `arn:aws:iam::${account}:role/cdk-${qualifier}-file-publishing-role-${account}-${region}`,
      `arn:aws:iam::${account}:role/cdk-${qualifier}-image-publishing-role-${account}-${region}`,
      `arn:aws:iam::${account}:role/cdk-${qualifier}-lookup-role-${account}-${region}`,
    ]);

    this.infraDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: bootstrapRoleArns,
      })
    );
  }
}
