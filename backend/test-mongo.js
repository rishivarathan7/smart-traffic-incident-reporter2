require("dotenv").config();

const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.MONGODB_URI, {
    tls: true,
    serverSelectionTimeoutMS: 10000
});

async function testConnection() {
    try {
        console.log("Testing MongoDB connection...");

        await client.connect();

        await client.db(process.env.DB_NAME).command({ ping: 1 });

        console.log("SUCCESS: MongoDB connection is working!");
    } catch (error) {
        console.log("FAILED: MongoDB connection failed.");
        console.log("Error name:", error.name);
        console.log("Error message:", error.message);

        if (error.cause) {
            console.log("Cause:", error.cause.message);
        }
    } finally {
        await client.close();
    }
}

testConnection();