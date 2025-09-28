import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as event_sources from "aws-cdk-lib/aws-lambda-event-sources";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. SQS Queue
    const queue = new sqs.Queue(this, "InfraQueue", {
      queueName: "fraud-transactions-queue",
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    const table = new dynamodb.Table(this, "Table", {
      tableName: "Fraud_Transactions",
      partitionKey: {
        name: "bank_id",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "transaction_id",
        type: dynamodb.AttributeType.STRING,
      },
    });
    const lambdaFunction = new lambda.Function(this, "MyFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("../lambda"),
      environment: {
        TABLE_NAME: table.tableName, // ✅ Pass table name dynamically
      },
    });

    // Grant Lambda permissions
    table.grantWriteData(lambdaFunction);
    queue.grantConsumeMessages(lambdaFunction);

    // 5. Connect SQS to Lambda
    lambdaFunction.addEventSource(
      new event_sources.SqsEventSource(queue, {
        batchSize: 10, // process up to 10 messages per batch
      })
    );
  }
}
