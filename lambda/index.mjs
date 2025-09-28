import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  console.log("📥 Received event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const transaction = JSON.parse(record.body);
    console.log("🚩 Processing flagged transaction:", transaction);

    // ✅ Add a timestamp for audit purposes
    const timestamp = new Date().toISOString();

    // Prepare DynamoDB item
    const params = {
      TableName: process.env.TABLE_NAME,
      Item: {
        bank_id: { S: transaction.bank_id || "default-bank" }, // fallback if not passed
        transaction_id: { S: transaction.transaction_id },
        amount: { N: transaction.amount.toString() },
        transaction_type: { S: transaction.transaction_type },
        status: { S: "flagged" },
        timestamp: { S: timestamp }, // ✅ ISO8601 timestamp for logs
      },
    };

    try {
      await ddb.send(new PutItemCommand(params));
      console.log(
        "✅ Saved transaction to DynamoDB:",
        transaction.transaction_id
      );
    } catch (err) {
      console.error("❌ Failed to save to DynamoDB:", err);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify("Processed successfully"),
  };
};
