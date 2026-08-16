import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";

export interface CertStackProps extends cdk.StackProps {
  domainName: string;
  parentHostedZoneDomain: string;
}

/**
 * CloudFront requires its ACM certificate to live in us-east-1, regardless of
 * which region the rest of the stack is deployed to. This stack is always
 * deployed to us-east-1 and its certificate ARN is passed cross-region into
 * the main AppStack (which owns the CloudFront distribution).
 */
export class CertStack extends cdk.Stack {
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, "ParentHostedZone", {
      domainName: props.parentHostedZoneDomain,
    });

    this.certificate = new acm.Certificate(this, "SiteCertificate", {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    new cdk.CfnOutput(this, "CertificateArn", {
      value: this.certificate.certificateArn,
    });
  }
}
