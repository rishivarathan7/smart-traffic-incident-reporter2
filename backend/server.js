const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');

const { connectToDatabase, getDb } = require('./db');
const { initializeDatabase, initializeAdminAccount, getUsersCollection, getReportsCollection, getNextUserId, getNextReportId } = require('./models');
const { authenticateToken, requireAdmin } = require('./authMiddleware');
const { startReportChangeStream, isChangeStreamRunning } = require('./changeStream');

// Initialize the Express application and Node HTTP Server (Module 16)
const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";

// Initialize Socket.IO Server (Module 16)
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

// Socket.IO JWT Authentication Middleware (Module 16)
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token || typeof token !== 'string') {
      const err = new Error("Authentication error: Missing token");
      err.data = { code: "MISSING_TOKEN" };
      return next(err);
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return next(new Error("Authentication error: JWT_SECRET environment variable is missing"));
    }

    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        const authErr = new Error("Authentication error: Invalid or expired token");
        authErr.data = { code: "INVALID_TOKEN" };
        return next(authErr);
      }

      socket.user = {
        userId: decoded.userId,
        role: decoded.role
      };
      next();
    });
  } catch (error) {
    next(new Error("Authentication error"));
  }
});

// Socket.IO Connection Logging (Module 16)
io.on("connection", (socket) => {
  const userId = socket.user ? socket.user.userId : "Unknown";
  console.log(`Socket connected: ${userId}`);

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${userId}`);
  });
});

// Define port (uses environment variable PORT or defaults to 5000)
const PORT = process.env.PORT || 5000;

// Middleware configuration
app.use(cors({
  origin: FRONTEND_URL,
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));          // Enable Cross-Origin Resource Sharing for frontend-backend communication
app.use(express.json());   // Parse incoming requests with JSON payloads

// Ensure upload directory backend/uploads/potholes/ exists on server startup
const uploadsPotholesDir = path.join(__dirname, 'uploads', 'potholes');
if (!fs.existsSync(uploadsPotholesDir)) {
  fs.mkdirSync(uploadsPotholesDir, { recursive: true });
}

// Serve uploaded static files securely
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer storage engine for pothole images (Module 14)
const potholeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsPotholesDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const uniqueName = `pothole_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${safeExt}`;
    cb(null, uniqueName);
  }
});

const uploadPotholeImage = multer({
  storage: potholeStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      const err = new Error('Invalid file type. Only JPEG, PNG, and WEBP images are allowed.');
      err.status = 400;
      cb(err);
    }
  }
});

// POST /api/uploads/pothole-image - Upload pothole image (Module 14)
app.post('/api/uploads/pothole-image', authenticateToken, (req, res, next) => {
  uploadPotholeImage.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: "File too large. Maximum size is 5 MB."
        });
      }
      return res.status(err.status || 400).json({
        success: false,
        message: err.message || "Image upload failed."
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided"
      });
    }

    const imageUrl = `/uploads/potholes/${req.file.filename}`;
    res.status(200).json({
      success: true,
      imageUrl
    });
  });
});

// Root API Route
app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    message: "Smart Traffic Incident Reporter API is running"
  });
});

// Health-Check Route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: "Smart Traffic Incident Reporter backend is running"
  });
});

// Database Health-Check Route
app.get('/api/health/db', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: "Database connection is unavailable"
      });
    }

    // Ping the database to verify active connection
    await db.command({ ping: 1 });

    res.status(200).json({
      success: true,
      message: "MongoDB connection is working"
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database connection is unavailable"
    });
  }
});

// Change Stream Health-Check Route (Module 17)
app.get('/api/health/change-stream', (req, res) => {
  const running = isChangeStreamRunning();
  res.status(running ? 200 : 503).json({
    success: running,
    message: running ? "Change Stream is active and running" : "Change Stream is inactive",
    isChangeStreamRunning: running
  });
});

// Helper regex for basic email validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ==========================================
// USER AUTHENTICATION ROUTES (MODULE 4)
// ==========================================

// POST /api/auth/register - Public User Registration (Always creates role = "user")
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // 1. Validation
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Name is required"
      });
    }

    if (!email || typeof email !== 'string' || email.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long"
      });
    }

    const usersCollection = getUsersCollection();

    // 2. Check for duplicate email
    const existingUser = await usersCollection.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email is already registered"
      });
    }

    // 3. Generate unique persistent User ID (USR001, USR002...)
    const userId = await getNextUserId();

    // 4. Hash password with bcryptjs
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 5. Build user document (Strictly force role: "user")
    const newUser = {
      userId,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await usersCollection.insertOne(newUser);

    // 6. Return HTTP 201 with safe user info (never expose passwordHash)
    res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        userId: newUser.userId,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login - Normal User Login
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const usersCollection = getUsersCollection();

    // Find user by email
    const user = await usersCollection.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Compare password with stored passwordHash
    const isPasswordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Generate JWT token
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET environment variable is missing.");
    }

    const token = jwt.sign(
      { userId: user.userId, role: user.role },
      secret,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me - Protected Route to get authenticated user profile
app.get('/api/auth/me', authenticateToken, async (req, res, next) => {
  try {
    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ userId: req.user.userId });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// ADMIN AUTHENTICATION & AUTHORIZATION ROUTES (MODULE 5)
// ==========================================

// POST /api/auth/admin/login - Dedicated Admin Login
app.post('/api/auth/admin/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const usersCollection = getUsersCollection();

    // Find account by email
    const user = await usersCollection.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Reject non-admin users attempting admin login
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin credentials required."
      });
    }

    // Compare password with stored passwordHash
    const isPasswordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Generate JWT token for admin
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET environment variable is missing.");
    }

    const token = jwt.sign(
      { userId: user.userId, role: user.role },
      secret,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      success: true,
      message: "Admin login successful",
      token,
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/test - Protected Admin Test Endpoint
app.get('/api/admin/test', authenticateToken, requireAdmin, async (req, res) => {
  res.status(200).json({
    success: true,
    message: "Admin authorization successful",
    user: {
      userId: req.user.userId,
      role: req.user.role
    }
  });
});

// PATCH /api/admin/reports/:reportId/verify - Admin Verify Report (Module 9)
app.patch('/api/admin/reports/:reportId/verify', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const reportId = req.params.reportId;
    if (!reportId || typeof reportId !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Report ID is required"
      });
    }

    const reportsCollection = getReportsCollection();
    const report = await reportsCollection.findOne({ reportId: reportId.trim() });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found"
      });
    }

    if (report.verificationStatus === 'verified') {
      return res.status(409).json({
        success: false,
        message: "Report is already verified"
      });
    }

    if (report.verificationStatus === 'false') {
      return res.status(409).json({
        success: false,
        message: "Report is already marked as false"
      });
    }

    if (report.verificationStatus !== 'pending') {
      return res.status(409).json({
        success: false,
        message: "Only pending reports can be verified"
      });
    }

    const now = new Date();
    const historyEntry = {
      status: "Verified",
      changedBy: req.user.userId,
      changedAt: now,
      note: "Report verified by administrator"
    };

    await reportsCollection.updateOne(
      { reportId: report.reportId },
      {
        $set: {
          verificationStatus: "verified",
          status: "Verified",
          updatedAt: now
        },
        $push: {
          statusHistory: historyEntry
        }
      }
    );

    const updatedReport = await reportsCollection.findOne({ reportId: report.reportId });

    res.status(200).json({
      success: true,
      message: "Report verified successfully",
      report: updatedReport
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/reports/:reportId/reject - Admin Reject Report (Module 9)
app.patch('/api/admin/reports/:reportId/reject', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const reportId = req.params.reportId;
    if (!reportId || typeof reportId !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Report ID is required"
      });
    }

    const reportsCollection = getReportsCollection();
    const report = await reportsCollection.findOne({ reportId: reportId.trim() });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found"
      });
    }

    if (report.verificationStatus === 'verified') {
      return res.status(409).json({
        success: false,
        message: "Report is already verified"
      });
    }

    if (report.verificationStatus === 'false') {
      return res.status(409).json({
        success: false,
        message: "Report is already marked as false"
      });
    }

    if (report.verificationStatus !== 'pending') {
      return res.status(409).json({
        success: false,
        message: "Only pending reports can be rejected"
      });
    }

    const now = new Date();
    const historyEntry = {
      status: "False Report",
      changedBy: req.user.userId,
      changedAt: now,
      note: "Report rejected as false by administrator"
    };

    await reportsCollection.updateOne(
      { reportId: report.reportId },
      {
        $set: {
          verificationStatus: "false",
          status: "False Report",
          updatedAt: now
        },
        $push: {
          statusHistory: historyEntry
        }
      }
    );

    const updatedReport = await reportsCollection.findOne({ reportId: report.reportId });

    res.status(200).json({
      success: true,
      message: "Report rejected successfully",
      report: updatedReport
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/reports/:reportId/status - Admin Development Status Change (Module 10)
app.patch('/api/admin/reports/:reportId/status', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const reportId = req.params.reportId;
    if (!reportId || typeof reportId !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Report ID is required"
      });
    }

    const { status } = req.body || {};
    if (!status || typeof status !== 'string' || status.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Status is required in request body"
      });
    }

    const requestedStatus = status.trim();
    const reportsCollection = getReportsCollection();
    const report = await reportsCollection.findOne({ reportId: reportId.trim() });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found"
      });
    }

    // 1. False Report Check (verificationStatus === "false" or status === "False Report")
    if (report.verificationStatus === 'false' || report.status === 'False Report') {
      return res.status(409).json({
        success: false,
        message: "Cannot change status of a false report"
      });
    }

    // 2. Unverified Check (verificationStatus !== "verified")
    if (report.verificationStatus !== 'verified') {
      return res.status(409).json({
        success: false,
        message: "Report must be verified by administrator before changing development status"
      });
    }

    // 3. Allowed Development Statuses Check
    const allowedTrafficStatuses = ['In Progress', 'Resolved'];
    const allowedPotholeStatuses = ['Correction in Progress', 'Corrected'];

    const reportType = (report.reportType || (report.type === 'Pothole' ? 'pothole' : 'traffic')).toLowerCase();

    let isTransitionValid = false;
    let noteText = '';

    if (reportType === 'traffic') {
      if (!allowedTrafficStatuses.includes(requestedStatus)) {
        return res.status(409).json({
          success: false,
          message: `Invalid development status '${requestedStatus}' for traffic report`
        });
      }

      if (report.status === 'Verified' && requestedStatus === 'In Progress') {
        isTransitionValid = true;
        noteText = "Report moved to In Progress by administrator";
      } else if (report.status === 'In Progress' && requestedStatus === 'Resolved') {
        isTransitionValid = true;
        noteText = "Report marked as Resolved by administrator";
      }
    } else if (reportType === 'pothole') {
      if (!allowedPotholeStatuses.includes(requestedStatus)) {
        return res.status(409).json({
          success: false,
          message: `Invalid development status '${requestedStatus}' for pothole report`
        });
      }

      if (report.status === 'Verified' && requestedStatus === 'Correction in Progress') {
        isTransitionValid = true;
        noteText = "Correction work started by administrator";
      } else if (report.status === 'Correction in Progress' && requestedStatus === 'Corrected') {
        isTransitionValid = true;
        noteText = "Pothole correction completed by administrator";
      }
    }

    if (!isTransitionValid) {
      return res.status(409).json({
        success: false,
        message: `Invalid status transition from '${report.status}' to '${requestedStatus}' for ${reportType} report`
      });
    }

    const now = new Date();
    const historyEntry = {
      status: requestedStatus,
      changedBy: req.user.userId,
      changedAt: now,
      note: noteText
    };

    await reportsCollection.updateOne(
      { reportId: report.reportId },
      {
        $set: {
          status: requestedStatus,
          updatedAt: now
        },
        $push: {
          statusHistory: historyEntry
        }
      }
    );

    const updatedReport = await reportsCollection.findOne({ reportId: report.reportId });

    res.status(200).json({
      success: true,
      message: "Status updated successfully",
      report: updatedReport
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// INCIDENT REPORT ROUTES (MODULE 6 & MODULE 7)
// ==========================================

// Priority calculation helper based on project rules
function calculatePriority(reportType, data) {
  if (reportType === 'traffic') {
    const sev = (data.severity || '').toLowerCase();
    const veh = Number(data.vehiclesAffected) || 0;
    const incType = (data.incidentType || '').toLowerCase();
    if (sev === 'high' || veh > 20 || veh >= 10) {
      return 'High';
    } else if (sev === 'medium' || veh >= 3 || incType.includes('congestion') || incType.includes('jam')) {
      return 'Medium';
    } else {
      return 'Low';
    }
  } else if (reportType === 'pothole') {
    const desc = (data.description || '').toLowerCase();
    if (desc.includes('large') || desc.includes('deep') || desc.includes('hazard') || desc.includes('danger') || desc.includes('major') || desc.includes('severe')) {
      return 'High';
    } else if (desc.includes('small') || desc.includes('minor')) {
      return 'Low';
    } else {
      return 'Medium';
    }
  }
  return 'Medium';
}

// POST /api/reports - Create Traffic or Pothole Report (Module 6)
app.post('/api/reports', authenticateToken, async (req, res, next) => {
  try {
    const body = req.body || {};

    // 1. Validate reportType
    if (!body.reportType || typeof body.reportType !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Invalid report type"
      });
    }

    const reportType = body.reportType.trim().toLowerCase();
    if (reportType !== 'traffic' && reportType !== 'pothole') {
      return res.status(400).json({
        success: false,
        message: "Invalid report type"
      });
    }

    // Common Required Fields Validation
    const { location, date, time, description } = body;

    if (!location || typeof location !== 'string' || location.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Missing required field: location"
      });
    }

    if (!date || typeof date !== 'string' || date.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Invalid date or time"
      });
    }

    if (!time || typeof time !== 'string' || time.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Invalid date or time"
      });
    }

    if (!description || typeof description !== 'string' || description.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Missing required field: description"
      });
    }

    let incidentType = null;
    let severity = null;
    let vehiclesAffected = 0;

    if (reportType === 'traffic') {
      // Traffic Specific Fields Validation
      if (!body.incidentType || typeof body.incidentType !== 'string' || body.incidentType.trim() === '') {
        return res.status(400).json({
          success: false,
          message: "Missing required field: incidentType"
        });
      }
      incidentType = body.incidentType.trim();

      if (!body.severity || typeof body.severity !== 'string') {
        return res.status(400).json({
          success: false,
          message: "Invalid severity"
        });
      }

      severity = body.severity.trim().toLowerCase();
      if (!['low', 'medium', 'high'].includes(severity)) {
        return res.status(400).json({
          success: false,
          message: "Invalid severity"
        });
      }

      if (
        body.vehiclesAffected === undefined ||
        body.vehiclesAffected === null ||
        typeof body.vehiclesAffected !== 'number' ||
        !Number.isInteger(body.vehiclesAffected) ||
        body.vehiclesAffected < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "vehiclesAffected must be a non-negative integer"
        });
      }
      vehiclesAffected = body.vehiclesAffected;
    } else {
      // Pothole defaults
      incidentType = "Pothole";
      severity = "medium";
      vehiclesAffected = 0;
    }

    // 2. Generate persistent Report ID (INCxxx or POTxxx)
    const reportId = await getNextReportId(reportType);

    // 3. Determine priority, initial status, and reporterId (strictly from authenticated req.user.userId)
    const priority = calculatePriority(reportType, { severity, vehiclesAffected, description, incidentType });
    const initialStatus = reportType === 'traffic' ? 'Pending' : 'Pending Verification';
    const reporterId = req.user.userId;

    const now = new Date();

    const initialStatusEntry = {
      status: initialStatus,
      changedBy: reporterId,
      changedAt: now,
      note: reportType === 'traffic' ? 'Report submitted' : 'Pothole report submitted'
    };

    // 4. Construct complete report document
    const newReport = {
      reportId,
      reportType,
      reporterId,
      incidentType,
      location: location.trim(),
      severity,
      vehiclesAffected,
      date: date.trim(),
      time: time.trim(),
      description: description.trim(),
      imageUrl: (body.imageUrl && typeof body.imageUrl === 'string') ? body.imageUrl.trim() : null,
      priority,
      status: initialStatus,
      verificationStatus: "pending",
      statusHistory: [initialStatusEntry],
      createdAt: now,
      updatedAt: now
    };

    const reportsCollection = getReportsCollection();
    await reportsCollection.insertOne(newReport);

    // Emit Socket.IO Realtime Events (Module 16)
    res.status(201).json({
      success: true,
      message: "Report created successfully",
      report: newReport
    });
  } catch (error) {
    console.error("Error creating report:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to create report"
    });
  }
});

// View Report Validation Constants (Module 7)
const VALID_REPORT_TYPES = ['traffic', 'pothole'];
const VALID_VERIFICATION_STATUSES = ['pending', 'verified', 'false'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];
const VALID_STATUSES = [
  'pending',
  'verified',
  'in progress',
  'resolved',
  'pending verification',
  'correction in progress',
  'corrected',
  'false report'
];

function formatPriority(p) {
  const lower = p.toLowerCase();
  if (lower === 'high') return 'High';
  if (lower === 'medium') return 'Medium';
  if (lower === 'low') return 'Low';
  return p;
}

function formatStatus(s) {
  const lower = s.trim().toLowerCase();
  const map = {
    'pending': 'Pending',
    'verified': 'Verified',
    'in progress': 'In Progress',
    'resolved': 'Resolved',
    'pending verification': 'Pending Verification',
    'correction in progress': 'Correction in Progress',
    'corrected': 'Corrected',
    'false report': 'False Report'
  };
  return map[lower] || s;
}

// ==========================================
// DASHBOARD STATISTICS & ANALYTICS API (MODULE 15)
// ==========================================

// GET /api/dashboard/stats - Dashboard Statistics & Analytics (Module 15)
app.get('/api/dashboard/stats', authenticateToken, async (req, res, next) => {
  try {
    const reportsCollection = getReportsCollection();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const statsAggregation = await reportsCollection.aggregate([
      {
        $facet: {
          total: [{ $count: "count" }],
          byReportType: [
            { $group: { _id: { $toLower: "$reportType" }, count: { $sum: 1 } } }
          ],
          byPriority: [
            { $group: { _id: { $toLower: "$priority" }, count: { $sum: 1 } } }
          ],
          byVerification: [
            { $group: { _id: { $toLower: "$verificationStatus" }, count: { $sum: 1 } } }
          ],
          byStatus: [
            { $group: { _id: "$status", count: { $sum: 1 } } }
          ],
          today: [
            { $match: { createdAt: { $gte: startOfToday } } },
            { $count: "count" }
          ],
          recent: [
            { $sort: { createdAt: -1 } },
            { $limit: 5 },
            {
              $project: {
                _id: 0,
                reportId: 1,
                reportType: 1,
                incidentType: 1,
                location: 1,
                priority: 1,
                status: 1,
                createdAt: 1,
                imageUrl: 1
              }
            }
          ]
        }
      }
    ]).toArray();

    const facetResult = (statsAggregation && statsAggregation[0]) ? statsAggregation[0] : {};

    const totalReports = (facetResult.total && facetResult.total[0]) ? facetResult.total[0].count : 0;

    const typeCounts = { traffic: 0, pothole: 0 };
    (facetResult.byReportType || []).forEach(item => {
      if (item._id && typeCounts.hasOwnProperty(item._id)) {
        typeCounts[item._id] = item.count;
      }
    });

    const priorityCounts = { high: 0, medium: 0, low: 0 };
    (facetResult.byPriority || []).forEach(item => {
      if (item._id && priorityCounts.hasOwnProperty(item._id)) {
        priorityCounts[item._id] = item.count;
      }
    });

    const verificationCounts = { pending: 0, verified: 0, false: 0 };
    (facetResult.byVerification || []).forEach(item => {
      if (item._id && verificationCounts.hasOwnProperty(item._id)) {
        verificationCounts[item._id] = item.count;
      }
    });

    const statusCounts = {
      "Pending": 0,
      "Verified": 0,
      "In Progress": 0,
      "Resolved": 0,
      "False Report": 0,
      "Pending Verification": 0,
      "Correction in Progress": 0,
      "Corrected": 0
    };
    (facetResult.byStatus || []).forEach(item => {
      if (item._id && statusCounts.hasOwnProperty(item._id)) {
        statusCounts[item._id] = item.count;
      }
    });

    const todayReports = (facetResult.today && facetResult.today[0]) ? facetResult.today[0].count : 0;

    const recentReports = (facetResult.recent || []).map(r => ({
      reportId: r.reportId || '',
      reportType: r.reportType || 'traffic',
      incidentType: r.incidentType || (r.reportType === 'pothole' ? 'Pothole' : 'Traffic Incident'),
      location: r.location || '',
      priority: r.priority || 'Medium',
      status: r.status || 'Pending',
      createdAt: r.createdAt || new Date().toISOString()
    }));

    const pendingReports = (statusCounts["Pending"] || 0) + (statusCounts["Pending Verification"] || 0);
    const verifiedReports = verificationCounts.verified || 0;
    const falseReports = verificationCounts.false || 0;
    const inProgressReports = (statusCounts["In Progress"] || 0) + (statusCounts["Correction in Progress"] || 0);
    const resolvedReports = statusCounts["Resolved"] || 0;
    const correctedReports = statusCounts["Corrected"] || 0;

    res.status(200).json({
      success: true,
      stats: {
        totalReports,
        trafficReports: typeCounts.traffic,
        potholeReports: typeCounts.pothole,
        pendingReports,
        verifiedReports,
        falseReports,
        inProgressReports,
        resolvedReports,
        correctedReports,
        highPriorityReports: priorityCounts.high,
        mediumPriorityReports: priorityCounts.medium,
        lowPriorityReports: priorityCounts.low,
        byReportType: typeCounts,
        byPriority: priorityCounts,
        byVerification: verificationCounts,
        byStatus: statusCounts,
        todayReports,
        recentReports
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports - Retrieve all reports with filters, search, and pagination (Module 7)
app.get('/api/reports', authenticateToken, async (req, res, next) => {
  try {
    const { reportType, status, verificationStatus, priority, search, page: rawPage, limit: rawLimit } = req.query;

    // 1. Pagination Validation & Parsing
    let page = 1;
    if (rawPage !== undefined) {
      const parsedPage = Number(rawPage);
      if (isNaN(parsedPage) || !Number.isInteger(parsedPage) || parsedPage <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid pagination parameters"
        });
      }
      page = parsedPage;
    }

    let limit = 20;
    if (rawLimit !== undefined) {
      const parsedLimit = Number(rawLimit);
      if (isNaN(parsedLimit) || !Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid pagination parameters"
        });
      }
      limit = Math.min(parsedLimit, 50); // Cap limit at 50
    }

    // 2. Build MongoDB Filter
    const filter = {};

    if (reportType !== undefined) {
      if (typeof reportType !== 'string') {
        return res.status(400).json({ success: false, message: "Invalid report type" });
      }
      const normReportType = reportType.trim().toLowerCase();
      if (!VALID_REPORT_TYPES.includes(normReportType)) {
        return res.status(400).json({ success: false, message: "Invalid report type" });
      }
      filter.reportType = normReportType;
    }

    if (verificationStatus !== undefined) {
      if (typeof verificationStatus !== 'string') {
        return res.status(400).json({ success: false, message: "Invalid verification status" });
      }
      const normVerStatus = verificationStatus.trim().toLowerCase();
      if (!VALID_VERIFICATION_STATUSES.includes(normVerStatus)) {
        return res.status(400).json({ success: false, message: "Invalid verification status" });
      }
      filter.verificationStatus = normVerStatus;
    }

    if (priority !== undefined) {
      if (typeof priority !== 'string') {
        return res.status(400).json({ success: false, message: "Invalid priority" });
      }
      const normPriority = priority.trim().toLowerCase();
      if (!VALID_PRIORITIES.includes(normPriority)) {
        return res.status(400).json({ success: false, message: "Invalid priority" });
      }
      filter.priority = formatPriority(normPriority);
    }

    if (status !== undefined) {
      if (typeof status !== 'string') {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      const normStatus = status.trim().toLowerCase();
      if (!VALID_STATUSES.includes(normStatus)) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      filter.status = formatStatus(normStatus);
    }

    if (search !== undefined && typeof search === 'string' && search.trim() !== '') {
      const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      filter.$or = [
        { reportId: searchRegex },
        { incidentType: searchRegex },
        { location: searchRegex },
        { description: searchRegex },
        { reporterId: searchRegex }
      ];
    }

    // 3. Query Database
    const reportsCollection = getReportsCollection();
    const total = await reportsCollection.countDocuments(filter);
    const skip = (page - 1) * limit;
    const totalPages = Math.ceil(total / limit) || 0;

    const reports = await reportsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.status(200).json({
      success: true,
      count: reports.length,
      total,
      page,
      limit,
      totalPages,
      reports
    });
  } catch (error) {
    console.error("Error fetching reports:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve reports"
    });
  }
});

// GET /api/reports/:reportId/history - Retrieve statusHistory timeline for a report (Module 11)
app.get('/api/reports/:reportId/history', authenticateToken, async (req, res, next) => {
  try {
    const { reportId } = req.params;

    if (!reportId || typeof reportId !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Invalid report ID"
      });
    }

    const reportsCollection = getReportsCollection();
    const report = await reportsCollection.findOne({ reportId: reportId.trim() });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found"
      });
    }

    let statusHistory = report.statusHistory || [];
    if (Array.isArray(statusHistory)) {
      statusHistory = statusHistory.slice().sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));
    }

    res.status(200).json({
      success: true,
      reportId: report.reportId,
      statusHistory
    });
  } catch (error) {
    console.error("Error fetching report history by ID:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve report history"
    });
  }
});

// GET /api/reports/:reportId - Retrieve a single report by reportId (Module 7 & Module 11)
app.get('/api/reports/:reportId', authenticateToken, async (req, res, next) => {
  try {
    const { reportId } = req.params;

    if (!reportId || typeof reportId !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Invalid report ID"
      });
    }

    const reportsCollection = getReportsCollection();
    const report = await reportsCollection.findOne({ reportId: reportId.trim() });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found"
      });
    }

    if (report && Array.isArray(report.statusHistory)) {
      report.statusHistory.sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));
    }

    res.status(200).json({
      success: true,
      report
    });
  } catch (error) {
    console.error("Error fetching report by ID:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve report"
    });
  }
});

// PATCH /api/reports/:reportId - Edit an existing incident/pothole report (Module 13)
app.patch('/api/reports/:reportId', authenticateToken, async (req, res, next) => {
  try {
    const { reportId } = req.params;

    if (!reportId || typeof reportId !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Invalid report ID"
      });
    }

    const reportsCollection = getReportsCollection();
    const report = await reportsCollection.findOne({ reportId: reportId.trim() });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found"
      });
    }

    // Authorization: Normal user can edit ONLY their own report. Admin can edit any report.
    if (req.user.role !== 'admin' && report.reporterId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not have permission to edit this report"
      });
    }

    const body = req.body || {};
    const reportType = (report.reportType || 'traffic').toLowerCase();

    // Validate fields if supplied
    const updateData = {};

    if (body.location !== undefined) {
      if (typeof body.location !== 'string' || body.location.trim() === '') {
        return res.status(400).json({ success: false, message: "Location must be a non-empty string" });
      }
      updateData.location = body.location.trim();
    }

    if (body.date !== undefined) {
      if (typeof body.date !== 'string' || body.date.trim() === '') {
        return res.status(400).json({ success: false, message: "Date must be a non-empty string" });
      }
      updateData.date = body.date.trim();
    }

    if (body.time !== undefined) {
      if (typeof body.time !== 'string' || body.time.trim() === '') {
        return res.status(400).json({ success: false, message: "Time must be a non-empty string" });
      }
      updateData.time = body.time.trim();
    }

    if (body.description !== undefined) {
      if (typeof body.description !== 'string' || body.description.trim() === '') {
        return res.status(400).json({ success: false, message: "Description must be a non-empty string" });
      }
      updateData.description = body.description.trim();
    }

    if (reportType === 'traffic') {
      if (body.incidentType !== undefined) {
        if (typeof body.incidentType !== 'string' || body.incidentType.trim() === '') {
          return res.status(400).json({ success: false, message: "Incident type must be a non-empty string" });
        }
        updateData.incidentType = body.incidentType.trim();
      }

      if (body.severity !== undefined) {
        if (typeof body.severity !== 'string' || !['low', 'medium', 'high'].includes(body.severity.trim().toLowerCase())) {
          return res.status(400).json({ success: false, message: "Invalid severity level" });
        }
        updateData.severity = body.severity.trim().toLowerCase();
      }

      if (body.vehiclesAffected !== undefined) {
        const veh = Number(body.vehiclesAffected);
        if (isNaN(veh) || !Number.isInteger(veh) || veh < 0) {
          return res.status(400).json({ success: false, message: "vehiclesAffected must be a non-negative integer" });
        }
        updateData.vehiclesAffected = veh;
      }
    }

    // Merge current report values with updateData to recalculate priority server-side
    const mergedReportData = {
      incidentType: updateData.incidentType !== undefined ? updateData.incidentType : report.incidentType,
      severity: updateData.severity !== undefined ? updateData.severity : report.severity,
      vehiclesAffected: updateData.vehiclesAffected !== undefined ? updateData.vehiclesAffected : report.vehiclesAffected,
      description: updateData.description !== undefined ? updateData.description : report.description,
      location: updateData.location !== undefined ? updateData.location : report.location
    };

    const newPriority = calculatePriority(reportType, mergedReportData);
    updateData.priority = newPriority;
    updateData.updatedAt = new Date();

    // Ensure protected fields are NEVER altered
    delete updateData.reportId;
    delete updateData.reporterId;
    delete updateData.status;
    delete updateData.verificationStatus;
    delete updateData.statusHistory;
    delete updateData.createdAt;
    delete updateData.role;
    delete updateData._id;
    delete updateData.passwordHash;
    delete updateData.user;

    await reportsCollection.updateOne(
      { reportId: report.reportId },
      { $set: updateData }
    );

    const updatedReport = await reportsCollection.findOne({ reportId: report.reportId });
    if (updatedReport && Array.isArray(updatedReport.statusHistory)) {
      updatedReport.statusHistory.sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));
    }

    res.status(200).json({
      success: true,
      message: "Report updated successfully",
      report: updatedReport
    });
  } catch (error) {
    console.error("Error editing report:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to edit report"
    });
  }
});

// DELETE /api/reports/:reportId - Delete an existing incident/pothole report (Module 13)
app.delete('/api/reports/:reportId', authenticateToken, async (req, res, next) => {
  try {
    const { reportId } = req.params;

    if (!reportId || typeof reportId !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Invalid report ID"
      });
    }

    const reportsCollection = getReportsCollection();
    const report = await reportsCollection.findOne({ reportId: reportId.trim() });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found"
      });
    }

    // Authorization: Normal user can delete ONLY their own report. Admin can delete any report.
    if (req.user.role !== 'admin' && report.reporterId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not have permission to delete this report"
      });
    }

    // If report has a stored image, attempt safe filesystem deletion
    if (report.imageUrl && typeof report.imageUrl === 'string' && report.imageUrl.startsWith('/uploads/potholes/')) {
      try {
        const filename = path.basename(report.imageUrl);
        const targetFilePath = path.join(uploadsPotholesDir, filename);
        // Path traversal safety check: target file must remain inside uploadsPotholesDir
        if (targetFilePath.startsWith(uploadsPotholesDir) && fs.existsSync(targetFilePath)) {
          fs.unlinkSync(targetFilePath);
        }
      } catch (fileErr) {
        console.error("Non-fatal error deleting associated image file:", fileErr.message);
      }
    }

    await reportsCollection.deleteOne({ reportId: report.reportId });

    res.status(200).json({
      success: true,
      message: "Report deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting report:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete report"
    });
  }
});

// 404 Handler for undefined API routes
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});

// Connect to MongoDB Atlas, initialize database models/indexes and admin account, then start server
async function startServer() {
  try {
    await connectToDatabase();
    await initializeDatabase();
    await initializeAdminAccount();
    try {
      await startReportChangeStream(io);
    } catch (csErr) {
      console.error("Failed to start MongoDB Change Stream:", csErr.message);
    }
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server due to database connection or initialization error.");
  }
}

startServer();

module.exports = { app, server, io, startServer };
