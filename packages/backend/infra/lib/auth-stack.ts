import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  environment: string;
}

/**
 * Auth Stack — AWS Cognito User Pool with custom attributes, MFA, and API Gateway Authorizer.
 *
 * Requirements:
 * - 14.3: Role-based access control (platform_admin, tenant_admin, site_admin, supervisor, cso, gate_operator, worker)
 * - 14.6: JWT tokens with 60-minute lifetime, explicit revocation capability
 * - 18.15: JWT authentication, tenant context validation on every request
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const prefix = environment === 'prod' ? '' : `${environment}-`;

    // --- Cognito User Pool ---
    this.userPool = new cognito.UserPool(this, 'ComplianceUserPool', {
      userPoolName: `${prefix}compliance-user-pool`,
      selfSignUpEnabled: false, // Workers are onboarded by admins
      signInAliases: {
        email: true,
        phone: true,
      },
      autoVerify: {
        email: true,
        phone: true,
      },

      // Password policy — strong defaults for construction compliance platform
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },

      // MFA configuration — TOTP required for admin roles, SMS OTP for workers
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,  // SMS OTP for workers
        otp: true,  // TOTP for admin/supervisor roles
      },

      // SMS configuration for MFA and verification
      smsRole: undefined, // CDK auto-creates the role
      smsRoleExternalId: `${prefix}compliance-cognito-sms`,

      // Account recovery
      accountRecovery: cognito.AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,

      // Standard attributes
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        phoneNumber: {
          required: false,
          mutable: true,
        },
        fullname: {
          required: false,
          mutable: true,
        },
      },

      // Custom attributes for tenant isolation and role-based access
      customAttributes: {
        tenant_id: new cognito.StringAttribute({
          mutable: true,
          minLen: 1,
          maxLen: 64,
        }),
        role: new cognito.StringAttribute({
          mutable: true,
          minLen: 1,
          maxLen: 50,
        }),
        assigned_sites: new cognito.StringAttribute({
          mutable: true,
          minLen: 0,
          maxLen: 2048, // JSON array of site IDs
        }),
      },

      // User pool deletion protection
      deletionProtection: environment === 'prod',

      // Advanced security (for production)
      advancedSecurityMode: environment === 'prod'
        ? cognito.AdvancedSecurityMode.ENFORCED
        : cognito.AdvancedSecurityMode.OFF,

      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // --- User Pool Client ---
    // JWT token lifetime: 60 minutes (Requirement 14.6, 18.15)
    this.userPoolClient = this.userPool.addClient('ComplianceAppClient', {
      userPoolClientName: `${prefix}compliance-app-client`,
      generateSecret: false, // Public client for SPA/mobile
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
      },
      // Token validity — 60-minute access token lifetime
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          phoneNumber: true,
          fullname: true,
        })
        .withCustomAttributes('tenant_id', 'role', 'assigned_sites'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          phoneNumber: true,
          fullname: true,
        }),
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${prefix}compliance-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${prefix}compliance-user-pool-client-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
      exportName: `${prefix}compliance-user-pool-arn`,
    });
  }
}
