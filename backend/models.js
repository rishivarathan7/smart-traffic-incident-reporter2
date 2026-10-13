/**
 * Database Models and Schema Definitions for Smart Traffic Incident Reporter
 * 
 * Uses the existing MongoDB database connection provided by db.js.
 */

const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

// Collection Names Constants
const USERS_COLLECTION = 'users';
const REPORTS_COLLECTION = 'reports';
const COUNTERS_COLLECTION = 'counters';

/**
 * Returns the handle for the 'users' MongoDB collection.
 * @returns {Collection}
 */
function getUsersCollection() {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not connected. Call connectToDatabase() first.');
  }
  return db.collection(USERS_COLLECTION);
}

/**
 * Returns the handle for the 'reports' MongoDB collection.
 * @returns {Collection}
 */
function getReportsCollection() {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not connected. Call connectToDatabase() first.');
  }
  return db.collection(REPORTS_COLLECTION);
}

/**
 * Generates a unique, non-reusable User ID (e.g. USR001, USR002, USR003).
 * Uses an atomic counter in MongoDB.
 * @returns {Promise<string>}
 */
async function getNextUserId() {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not connected. Call connectToDatabase() first.');
  }
  const countersCollection = db.collection(COUNTERS_COLLECTION);

  const result = await countersCollection.findOneAndUpdate(
    { _id: 'userId' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );

  const seq = result.seq || (result.value && result.value.seq) || 1;
  const paddedSeq = String(seq).padStart(3, '0');
  return `USR${paddedSeq}`;
}

/**
 * Generates a unique, non-reusable Report ID (e.g. INC001 for traffic, POT001 for pothole).
 * Uses atomic counters in MongoDB.
 * @param {string} reportType - 'traffic' or 'pothole'
 * @returns {Promise<string>}
 */
async function getNextReportId(reportType) {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not connected. Call connectToDatabase() first.');
  }
  const countersCollection = db.collection(COUNTERS_COLLECTION);
  const sequenceName = reportType === 'traffic' ? 'trafficReportId' : 'potholeReportId';
  const prefix = reportType === 'traffic' ? 'INC' : 'POT';

  const result = await countersCollection.findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );

  const seq = result.seq || (result.value && result.value.seq) || 1;
  const paddedSeq = String(seq).padStart(3, '0');
  return `${prefix}${paddedSeq}`;
}

/**
 * Initializes database collections and builds required indexes.
 * Does NOT insert any sample or fake data.
 */
async function initializeDatabase() {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not connected. Cannot initialize models and indexes.');
  }

  try {
    const usersCollection = getUsersCollection();
    const reportsCollection = getReportsCollection();

    // Create Indexes for Users Collection
    await usersCollection.createIndex({ userId: 1 }, { unique: true, name: 'idx_user_id' });
    await usersCollection.createIndex({ email: 1 }, { unique: true, name: 'idx_user_email' });

    // Create Indexes for Reports Collection
    await reportsCollection.createIndex({ reportId: 1 }, { unique: true, name: 'idx_report_id' });
    await reportsCollection.createIndex({ reporterId: 1 }, { name: 'idx_reporter_id' });
    await reportsCollection.createIndex({ reportType: 1 }, { name: 'idx_report_type' });
    await reportsCollection.createIndex({ status: 1 }, { name: 'idx_status' });
    await reportsCollection.createIndex({ verificationStatus: 1 }, { name: 'idx_verification_status' });
    await reportsCollection.createIndex({ priority: 1 }, { name: 'idx_priority' });
    await reportsCollection.createIndex({ createdAt: -1 }, { name: 'idx_created_at' });

    console.log('Database models and indexes initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database indexes:', error.message);
    throw error;
  }
}

/**
 * Initializes the default admin account from environment variables if it does not exist.
 * Idempotent setup process.
 */
async function initializeAdminAccount() {
  const adminName = process.env.ADMIN_NAME;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminName || !adminEmail || !adminPassword) {
    console.log('Admin environment variables not configured. Skipping admin initialization.');
    return;
  }

  const normalizedEmail = adminEmail.trim().toLowerCase();
  const usersCollection = getUsersCollection();

  const existingAdmin = await usersCollection.findOne({ email: normalizedEmail });

  if (existingAdmin) {
    console.log('Admin account already exists');
    return;
  }

  const userId = await getNextUserId();
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

  const newAdmin = {
    userId,
    name: adminName.trim(),
    email: normalizedEmail,
    passwordHash,
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await usersCollection.insertOne(newAdmin);
  console.log('Admin account initialized successfully');
}

/**
 * DOCUMENT SCHEMA STRUCTURE REFERENCE
 * 
 * 1. Users Document (Collection: 'users')
 * {
 *   userId: String (Unique),
 *   name: String,
 *   email: String (Unique),
 *   passwordHash: String,
 *   role: String ('user' | 'admin'),
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 * 
 * 2. Reports Document (Collection: 'reports') - Supports both Traffic and Pothole Reports
 * {
 *   reportId: String (Unique, e.g., "INC101" or "POT201"),
 *   reportType: String ('traffic' | 'pothole'),
 *   reporterId: String,
 *   incidentType: String, // e.g., "Accident", "Congestion", "Hazard"
 *   location: String,
 *   severity: String, // "low", "medium", "high"
 *   vehiclesAffected: Number,
 *   date: String,
 *   time: String,
 *   description: String,
 *   imageUrl: String | null,
 *   priority: String, // "Low", "Medium", "High"
 *   status: String,
 *   // Traffic Statuses: "Pending", "Verified", "In Progress", "Resolved", "False Report"
 *   // Pothole Statuses: "Pending Verification", "Verified", "Correction in Progress", "Corrected", "False Report"
 *   verificationStatus: String, // "pending", "verified", "false"
 *   statusHistory: [
 *     {
 *       status: String,
 *       changedBy: String,
 *       changedAt: Date | String,
 *       note: String
 *     }
 *   ],
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 */

module.exports = {
  getUsersCollection,
  getReportsCollection,
  getNextUserId,
  getNextReportId,
  initializeDatabase,
  initializeAdminAccount
};
