const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { MongoClient } = require('mongodb');

// Retrieve MongoDB URI and Database Name from process.env
const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'smart_traffic_incident_reporter';

let client;
let db;

/**
 * Connects to MongoDB Atlas and selects the database.
 * @returns {Promise<Db>} The connected MongoDB database instance.
 */
async function connectToDatabase() {
  if (db) {
    return db;
  }

  if (!uri || uri === 'PASTE_YOUR_MONGODB_ATLAS_CONNECTION_STRING_HERE') {
    const errorMsg = 'MONGODB_URI is not properly configured in .env file.';
    console.error(`MongoDB connection error: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  let attempts = 0;
  while (attempts < 5) {
    try {
      client = new MongoClient(uri, {
        tls: true,
        serverSelectionTimeoutMS: 10000
      });
      await client.connect();
      db = client.db(dbName);
      console.log('MongoDB connected successfully');
      return db;
    } catch (error) {
      attempts++;
      if (client) {
        try { await client.close(); } catch (e) {}
      }
      if (attempts >= 5) {
        console.error('MongoDB connection error:', error.message);
        throw error;
      }
      console.warn(`MongoDB connection attempt ${attempts} failed (${error.message}). Retrying in 1.5s...`);
      await new Promise(res => setTimeout(res, 1500));
    }
  }
}

/**
 * Returns the active database instance.
 * @returns {Db|null}
 */
function getDb() {
  return db;
}

module.exports = {
  connectToDatabase,
  getDb
};
