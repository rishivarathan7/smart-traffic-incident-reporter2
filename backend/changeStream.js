/**
 * MongoDB Change Stream Service for Smart Traffic Incident Reporter (Module 17)
 * 
 * Listens to MongoDB database changes on the 'reports' collection and triggers
 * Socket.IO realtime events for connected clients.
 */

const { getDb } = require('./db');

let changeStreamInstance = null;
const idToReportMap = new Map(); // Maps ObjectId string -> { reportId, reportType }

/**
 * Extracts the last changedBy user ID from the statusHistory array if present.
 * @param {Object} doc 
 * @returns {string}
 */
function extractLastChangedBy(doc) {
  if (doc && Array.isArray(doc.statusHistory) && doc.statusHistory.length > 0) {
    const lastEntry = doc.statusHistory[doc.statusHistory.length - 1];
    if (lastEntry && lastEntry.changedBy) {
      return lastEntry.changedBy;
    }
  }
  return doc.reporterId || 'system';
}

/**
 * Starts the MongoDB Change Stream on the 'reports' collection.
 * @param {Object} io - Socket.IO server instance created in server.js
 * @returns {Promise<Object>} The active Change Stream instance
 */
async function startReportChangeStream(io) {
  if (!io) {
    throw new Error("Socket.IO instance is required to start Change Stream service.");
  }

  const db = getDb();
  if (!db) {
    throw new Error("Database is not connected. Connect to MongoDB before starting Change Stream.");
  }

  if (changeStreamInstance) {
    return changeStreamInstance;
  }

  const reportsCollection = db.collection('reports');

  // Pre-populate initial ID map from existing reports for reliable delete tracking
  try {
    const existingDocs = await reportsCollection.find({}, { projection: { _id: 1, reportId: 1, reportType: 1 } }).toArray();
    existingDocs.forEach(doc => {
      idToReportMap.set(String(doc._id), {
        reportId: doc.reportId || String(doc._id),
        reportType: doc.reportType || 'traffic'
      });
    });
  } catch (mapErr) {
    console.warn("Initial report mapping notice:", mapErr.message);
  }

  const pipeline = [
    {
      $match: {
        operationType: { $in: ['insert', 'update', 'replace', 'delete'] }
      }
    }
  ];

  const options = {
    fullDocument: 'updateLookup',
    fullDocumentBeforeChange: 'whenAvailable'
  };

  changeStreamInstance = reportsCollection.watch(pipeline, options);
  console.log("MongoDB Change Stream service started on 'reports' collection");

  changeStreamInstance.on('change', (change) => {
    try {
      const opType = change.operationType;

      if (opType === 'insert') {
        const doc = change.fullDocument || {};
        if (doc._id) {
          idToReportMap.set(String(doc._id), {
            reportId: doc.reportId || String(doc._id),
            reportType: doc.reportType || 'traffic'
          });
        }

        const safeCreatedReport = {
          reportId: doc.reportId || '',
          reportType: doc.reportType || 'traffic',
          incidentType: doc.incidentType || (doc.reportType === 'pothole' ? 'Pothole' : 'Traffic Incident'),
          location: doc.location || '',
          priority: doc.priority || 'Medium',
          status: doc.status || 'Pending',
          verificationStatus: doc.verificationStatus || 'pending',
          reporterId: doc.reporterId || '',
          createdAt: doc.createdAt || new Date(),
          updatedAt: doc.updatedAt || new Date()
        };

        io.emit("report:created", safeCreatedReport);
        io.emit("dashboard:refresh", { timestamp: new Date().toISOString() });

      } else if (opType === 'update' || opType === 'replace') {
        const doc = change.fullDocument || {};
        if (doc._id) {
          idToReportMap.set(String(doc._id), {
            reportId: doc.reportId || String(doc._id),
            reportType: doc.reportType || 'traffic'
          });
        }

        const updatedFields = (change.updateDescription && change.updateDescription.updatedFields) || {};
        const reportId = doc.reportId || (change.documentKey ? String(change.documentKey._id) : '');

        if (updatedFields.hasOwnProperty('verificationStatus')) {
          io.emit("report:verification-updated", {
            reportId,
            verificationStatus: doc.verificationStatus || updatedFields.verificationStatus,
            status: doc.status || updatedFields.status,
            changedBy: extractLastChangedBy(doc)
          });
          io.emit("dashboard:refresh", { timestamp: new Date().toISOString() });

        } else if (updatedFields.hasOwnProperty('status')) {
          io.emit("report:status-updated", {
            reportId,
            status: doc.status || updatedFields.status,
            changedBy: extractLastChangedBy(doc),
            verificationStatus: doc.verificationStatus
          });
          io.emit("dashboard:refresh", { timestamp: new Date().toISOString() });

        } else {
          const safeUpdatedReport = {
            reportId: doc.reportId || '',
            reportType: doc.reportType || 'traffic',
            incidentType: doc.incidentType || (doc.reportType === 'pothole' ? 'Pothole' : 'Traffic Incident'),
            location: doc.location || '',
            priority: doc.priority || 'Medium',
            status: doc.status || 'Pending',
            verificationStatus: doc.verificationStatus || 'pending',
            reporterId: doc.reporterId || '',
            createdAt: doc.createdAt || new Date(),
            updatedAt: doc.updatedAt || new Date()
          };

          io.emit("report:updated", safeUpdatedReport);
          io.emit("dashboard:refresh", { timestamp: new Date().toISOString() });
        }

      } else if (opType === 'delete') {
        const _idStr = change.documentKey ? String(change.documentKey._id) : '';
        const cachedInfo = idToReportMap.get(_idStr) || {};
        const beforeDoc = change.fullDocumentBeforeChange || {};

        const reportId = beforeDoc.reportId || cachedInfo.reportId || _idStr;
        const reportType = beforeDoc.reportType || cachedInfo.reportType || 'traffic';

        idToReportMap.delete(_idStr);

        io.emit("report:deleted", {
          reportId,
          reportType
        });
        io.emit("dashboard:refresh", { timestamp: new Date().toISOString() });
      }
    } catch (handlerErr) {
      console.error("Error processing Change Stream event:", handlerErr.message);
    }
  });

  changeStreamInstance.on('error', (error) => {
    console.error("MongoDB Change Stream error:", error.message);
    stopReportChangeStream();

    // Safe reconnect attempt after 3 seconds
    setTimeout(() => {
      if (getDb()) {
        startReportChangeStream(io).catch(err => {
          console.error("Failed to restart Change Stream after error:", err.message);
        });
      }
    }, 3000);
  });

  return changeStreamInstance;
}

/**
 * Safely stops the Change Stream listener.
 */
async function stopReportChangeStream() {
  if (changeStreamInstance) {
    try {
      await changeStreamInstance.close();
    } catch (e) {}
    changeStreamInstance = null;
  }
}

/**
 * Returns whether Change Stream is currently active.
 * @returns {boolean}
 */
function isChangeStreamRunning() {
  return changeStreamInstance !== null;
}

module.exports = {
  startReportChangeStream,
  stopReportChangeStream,
  isChangeStreamRunning
};
