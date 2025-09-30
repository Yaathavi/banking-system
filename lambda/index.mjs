import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { FirehoseClient, PutRecordCommand } from "@aws-sdk/client-firehose";

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });
const sns = new SNSClient({ region: process.env.AWS_REGION });
const firehose = new FirehoseClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  console.log("📥 Received event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const transaction = JSON.parse(record.body);
    console.log("🚩 Processing flagged transaction:", transaction);

    const timestamp = Date.now(); // epoch ms
    const isoTimestamp = new Date(timestamp).toISOString();

    try {
      // 1️⃣ Save flagged transaction to Fraud_Transactions table
      await ddb.send(
        new PutItemCommand({
          TableName: process.env.TABLE_NAME,
          Item: {
            bank_id: { S: transaction.bank_id || "default-bank" },
            transaction_id: { S: transaction.transaction_id },
            amount: { N: transaction.amount.toString() },
            transaction_type: { S: transaction.transaction_type },
            status: { S: "flagged" },
            timestamp: { S: isoTimestamp },
          },
        })
      );
      console.log("✅ Saved transaction to Fraud_Transactions");

      // 2️⃣ Update User_Stats (running average, txn_count)
      if (process.env.USER_STATS_TABLE && transaction.account_id) {
        await ddb.send(
          new UpdateItemCommand({
            TableName: process.env.USER_STATS_TABLE,
            Key: { account_id: { S: transaction.account_id } },
            UpdateExpression:
              "SET txn_count = if_not_exists(txn_count, :zero) + :inc, total_amount = if_not_exists(total_amount, :zero) + :amt, avg_amount = (if_not_exists(total_amount, :zero) + :amt) / (if_not_exists(txn_count, :zero) + :inc), last_updated = :ts",
            ExpressionAttributeValues: {
              ":inc": { N: "1" },
              ":amt": { N: transaction.amount.toString() },
              ":zero": { N: "0" },
              ":ts": { S: isoTimestamp },
            },
          })
        );
        console.log("📊 Updated User_Stats");
      }

      // 3️⃣ Insert into Recent_Logins (if geo/status present)
      if (
        process.env.RECENT_LOGINS_TABLE &&
        transaction.account_id &&
        transaction.geo_region &&
        transaction.login_status
      ) {
        await ddb.send(
          new PutItemCommand({
            TableName: process.env.RECENT_LOGINS_TABLE,
            Item: {
              account_id: { S: transaction.account_id },
              timestamp: { N: timestamp.toString() },
              geo_region: { S: transaction.geo_region },
              status: { S: transaction.login_status }, // e.g. "success" / "fail"
              ttl: { N: Math.floor(timestamp / 1000 + 300).toString() }, // expire in 5 min
            },
          })
        );
        console.log("🕒 Inserted into Recent_Logins");
      }

      // 4️⃣ Publish SNS alert
      if (process.env.SNS_TOPIC_ARN) {
        await sns.send(
          new PublishCommand({
            TopicArn: process.env.SNS_TOPIC_ARN,
            Subject: "🚨 Fraud Alert Detected",
            Message: `Flagged Transaction:\nAccount: ${transaction.account_id}\nBank: ${transaction.bank_id}\nAmount: ${transaction.amount}\nType: ${transaction.transaction_type}\nID: ${transaction.transaction_id}\nTimestamp: ${isoTimestamp}`,
          })
        );
        console.log("📣 Published alert to SNS");
      }

      // 5️⃣ Stream to Firehose
      if (process.env.FIREHOSE_NAME) {
        await firehose.send(
          new PutRecordCommand({
            DeliveryStreamName: process.env.FIREHOSE_NAME,
            Record: {
              Data: Buffer.from(
                JSON.stringify({ ...transaction, timestamp: isoTimestamp }) +
                  "\n"
              ),
            },
          })
        );
        console.log("📤 Sent transaction to Kinesis Firehose");
      }
    } catch (err) {
      console.error("❌ Failed to process transaction:", err);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify("Processed successfully"),
  };
};
