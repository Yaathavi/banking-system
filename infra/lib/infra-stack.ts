import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as event_sources from "aws-cdk-lib/aws-lambda-event-sources";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1️⃣ SQS Queue for flagged transactions
    const queue = new sqs.Queue(this, "InfraQueue", {
      queueName: "fraud-transactions-queue",
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    // 2️⃣ DynamoDB Table for storing flagged transaction logs
    const flaggedTable = new dynamodb.Table(this, "FraudTransactionsTable", {
      tableName: "Fraud_Transactions_New",
      partitionKey: { name: "bank_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "transaction_id", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.RETAIN, // don't delete data accidentally
    });

    // 2a️⃣ DynamoDB Table for running averages / user stats
    const userStatsTable = new dynamodb.Table(this, "UserStatsTable", {
      tableName: "User_Stats",
      partitionKey: { name: "account_id", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 2b️⃣ DynamoDB Table for recent logins (geo/time check)
    const recentLoginsTable = new dynamodb.Table(this, "RecentLoginsTable", {
      tableName: "Recent_Logins",
      partitionKey: { name: "account_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.NUMBER },
      timeToLiveAttribute: "ttl", // expire after 5–10 min
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3️⃣ SNS Topic for customer alerts
    const alertsTopic = new sns.Topic(this, "FraudAlertsTopic", {
      topicName: "fraud-alerts-topic",
      displayName: "Fraud Alerts for Customers",
    });

    alertsTopic.addSubscription(
      new subscriptions.EmailSubscription("yaathavi@gmail.com")
    );

    // 4️⃣ S3 Bucket + Kinesis Firehose for ML pipeline
    const firehoseBucket = new s3.Bucket(this, "FraudFirehoseBucket", {
      bucketName: `fraud-transactions-logs-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const deliveryStream = new firehose.CfnDeliveryStream(
      this,
      "FraudFirehose",
      {
        deliveryStreamType: "DirectPut",
        s3DestinationConfiguration: {
          bucketArn: firehoseBucket.bucketArn,
          roleArn: new iam.Role(this, "FirehoseRole", {
            assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
            managedPolicies: [
              iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
            ],
          }).roleArn,
        },
      }
    );

    // 5️⃣ Lambda function to process flagged transactions
    const lambdaFunction = new lambda.Function(this, "MyFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("../lambda"),
      environment: {
        TABLE_NAME: flaggedTable.tableName,
        USER_STATS_TABLE: userStatsTable.tableName,
        RECENT_LOGINS_TABLE: recentLoginsTable.tableName,
        SNS_TOPIC_ARN: alertsTopic.topicArn,
        FIREHOSE_NAME: deliveryStream.ref,
      },
    });

    // ✅ Permissions: Lambda can write to all DynamoDB tables, consume SQS, publish to SNS, write to Firehose
    flaggedTable.grantWriteData(lambdaFunction);
    userStatsTable.grantReadWriteData(lambdaFunction);
    recentLoginsTable.grantReadWriteData(lambdaFunction);
    queue.grantConsumeMessages(lambdaFunction);
    alertsTopic.grantPublish(lambdaFunction);
    lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["firehose:PutRecord", "firehose:PutRecordBatch"],
        resources: ["*"],
      })
    );

    // 🔗 Connect SQS to Lambda
    lambdaFunction.addEventSource(
      new event_sources.SqsEventSource(queue, { batchSize: 10 })
    );

    // 6️⃣ ECS Task Role for fraud-api container
    const ecsTaskRole = new iam.Role(this, "FraudApiTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description:
        "Task role for fraud-api ECS tasks to access AWS services securely",
    });

    queue.grantSendMessages(ecsTaskRole);
    ecsTaskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess")
    );
    ecsTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sns:Publish"],
        resources: [alertsTopic.topicArn],
      })
    );

    // 7️⃣ CloudWatch Alarm → triggers SNS alert if queue backlog spikes
    const queueMetric = queue.metricApproximateNumberOfMessagesVisible();
    new cw.Alarm(this, "HighQueueDepthAlarm", {
      metric: queueMetric,
      threshold: 10, // adjust as needed
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      alarmDescription:
        "Triggers if 10+ flagged transactions are waiting in SQS (potential fraud wave)",
      comparisonOperator:
        cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    }).addAlarmAction({
      bind: () => ({ alarmActionArn: alertsTopic.topicArn }),
    });

    // 🔎 Output ECS Task Role ARN for convenience
    new cdk.CfnOutput(this, "EcsTaskRoleArn", {
      value: ecsTaskRole.roleArn,
      description: "Attach this IAM role to ECS Task Definition -> Task Role",
    });

    // 🔎 Output SNS Topic ARN so you can use it in Lambda ENV
    new cdk.CfnOutput(this, "AlertsTopicArn", {
      value: alertsTopic.topicArn,
      description: "Use this ARN in Lambda or ECS to publish alerts",
    });
  }
}
