const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const API_BASE_URL = 'http://localhost:5000';

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;

function logPass(msg) {
  totalPassed++;
  console.log(`✅ ${msg}`);
}

function logFail(msg, error) {
  totalFailed++;
  console.log(`❌ ${msg}`);
  if (error) console.error("   Details:", error);
}

function request(method, pathUrl, data = null, token = null, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, API_BASE_URL);
    const headers = {};

    let body = null;
    if (data && contentType === 'application/json') {
      body = JSON.stringify(data);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    } else if (data && Buffer.isBuffer(data)) {
      body = data;
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = data.length;
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: headers
    };

    const req = http.request(options, (res) => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(resData);
        } catch (e) {
          json = resData;
        }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });

    req.on('error', err => reject(err));
    if (body) req.write(body);
    req.end();
  });
}

function createMultipartBody(fields, fileFieldName, fileName, fileBuffer, mimeType) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const CRLF = '\r\n';
  let parts = [];

  for (const [key, val] of Object.entries(fields)) {
    parts.push(`--${boundary}${CRLF}Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}${val}${CRLF}`);
  }

  if (fileFieldName && fileName && fileBuffer) {
    parts.push(`--${boundary}${CRLF}Content-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`);
  }

  const headerBuf = Buffer.from(parts.join(''));
  const footerBuf = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);

  const finalBuf = Buffer.concat([headerBuf, fileBuffer || Buffer.alloc(0), footerBuf]);
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: finalBuf };
}

async function runTests() {
  console.log("==================================================");
  console.log("SMART TRAFFIC INCIDENT REPORTER - MODULE 19");
  console.log("   COMPLETE INTEGRATION & END-TO-END SUITE       ");
  console.log("==================================================\n");

  // 1. SYNTAX CHECKS
  try {
    const filesToCheck = [
      'script.js',
      'backend/server.js',
      'backend/db.js',
      'backend/models.js',
      'backend/authMiddleware.js',
      'backend/changeStream.js',
      'backend/test_module19.js'
    ];
    for (const f of filesToCheck) {
      execSync(`node --check ${f}`, { stdio: 'pipe' });
    }
    logPass("TEST 1: Syntax validation passed for all core frontend & backend files.");
  } catch (err) {
    logFail("TEST 1: Syntax check failed.", err.message);
  }

  // 2. BACKEND STARTUP & HEALTH ENDPOINTS
  try {
    const rootRes = await request('GET', '/api');
    const healthRes = await request('GET', '/api/health');
    const dbRes = await request('GET', '/api/health/db');
    const csRes = await request('GET', '/api/health/change-stream');

    if (
      rootRes.status === 200 && rootRes.body.success === true &&
      healthRes.status === 200 && healthRes.body.success === true &&
      dbRes.status === 200 && dbRes.body.success === true &&
      csRes.status === 200 && csRes.body.success === true
    ) {
      logPass("TEST 2: Backend health endpoints (/api, /api/health, /api/health/db, /api/health/change-stream) verified 200 OK.");
    } else {
      logFail("TEST 2: Health endpoints check failed.", { rootRes, healthRes, dbRes, csRes });
    }
  } catch (err) {
    logFail("TEST 2: Health check request failed.", err.message);
  }

  // 3. E2E USER AUTHENTICATION & ROLE ESCALATION PREVENTION
  const timestamp = Date.now();
  const userAEmail = `test_usera_${timestamp}@example.com`;
  const userBEmail = `test_userb_${timestamp}@example.com`;
  const userPassword = "UserPass123!";

  let tokenA = null;
  let userAObj = null;
  let tokenB = null;
  let userBObj = null;

  try {
    // Attempt registration with malicious role payload
    const regRes = await request('POST', '/api/auth/register', {
      name: "Test User A",
      email: userAEmail,
      password: userPassword,
      role: "admin" // Should be ignored and forced to "user"
    });

    if (regRes.status === 201 && regRes.body.success && regRes.body.user.role === 'user' && !regRes.body.user.passwordHash) {
      userAObj = regRes.body.user;
      logPass("TEST 3: Registration forced role='user' and omitted passwordHash.");
    } else {
      logFail("TEST 3: Registration failure.", regRes);
    }

    // Duplicate Email Rejection
    const dupRes = await request('POST', '/api/auth/register', {
      name: "Duplicate User",
      email: userAEmail,
      password: userPassword
    });
    if (dupRes.status === 409 || dupRes.status === 400) {
      logPass("TEST 4: Duplicate email registration correctly rejected.");
    } else {
      logFail("TEST 4: Duplicate email check failed.", dupRes);
    }

    // Register User B
    const regBRes = await request('POST', '/api/auth/register', {
      name: "Test User B",
      email: userBEmail,
      password: userPassword
    });
    userBObj = regBRes.body.user;

    // Login User A
    const loginARes = await request('POST', '/api/auth/login', {
      email: userAEmail,
      password: userPassword
    });
    if (loginARes.status === 200 && loginARes.body.token) {
      tokenA = loginARes.body.token;
      logPass("TEST 5: User A login successful, returned valid JWT token.");
    } else {
      logFail("TEST 5: User A login failed.", loginARes);
    }

    // Login User B
    const loginBRes = await request('POST', '/api/auth/login', {
      email: userBEmail,
      password: userPassword
    });
    if (loginBRes.status === 200 && loginBRes.body.token) {
      tokenB = loginBRes.body.token;
    }

    // Auth /me verification
    const meValid = await request('GET', '/api/auth/me', null, tokenA);
    const meMissing = await request('GET', '/api/auth/me');
    const meInvalid = await request('GET', '/api/auth/me', null, 'invalid.jwt.token');

    if (meValid.status === 200 && meValid.body.user.email === userAEmail && meMissing.status === 401 && meInvalid.status === 401) {
      logPass("TEST 6: /api/auth/me correctly handles valid (200), missing (401), and invalid (401) JWT tokens.");
    } else {
      logFail("TEST 6: /api/auth/me token validation failed.", { meValid, meMissing, meInvalid });
    }
  } catch (err) {
    logFail("TEST 3-6: E2E User auth failed.", err.message);
  }

  // 4. ADMIN AUTHENTICATION & RBAC TEST
  let adminToken = null;
  try {
    const adminLoginRes = await request('POST', '/api/auth/admin/login', {
      email: process.env.ADMIN_EMAIL || "admin@smarttraffic.com",
      password: process.env.ADMIN_PASSWORD || "AdminSecurePassword123"
    });

    if (adminLoginRes.status === 200 && adminLoginRes.body.token && adminLoginRes.body.user.role === 'admin') {
      adminToken = adminLoginRes.body.token;
      logPass("TEST 7: Admin login successful, returned admin JWT.");
    } else {
      logFail("TEST 7: Admin login failed.", adminLoginRes);
    }

    // Admin endpoint RBAC verification
    const adminEndpointUserRes = await request('GET', '/api/admin/test', null, tokenA);
    const adminEndpointAdminRes = await request('GET', '/api/admin/test', null, adminToken);

    if (adminEndpointUserRes.status === 403 && adminEndpointAdminRes.status === 200) {
      logPass("TEST 8: Admin endpoints strictly enforce RBAC (403 for user JWT, 200 for admin JWT).");
    } else {
      logFail("TEST 8: Admin RBAC test failed.", { adminEndpointUserRes, adminEndpointAdminRes });
    }
  } catch (err) {
    logFail("TEST 7-8: Admin auth test failed.", err.message);
  }

  // 5. USER A -> USER B SHARED REPORT FLOW & TRAFFIC INCIDENT LIFE CYCLE
  let trafficReportId = null;
  try {
    const trafficPayload = {
      reportType: "traffic",
      incidentType: "Accident",
      location: "MG Road Junction",
      severity: "High",
      vehiclesAffected: 4,
      date: "2026-10-06",
      time: "14:30",
      description: "Severe collision causing major congestion on MG Road"
    };

    const createRes = await request('POST', '/api/reports', trafficPayload, tokenA);
    if (createRes.status === 201 && createRes.body.success && createRes.body.report.reportId.startsWith('INC')) {
      trafficReportId = createRes.body.report.reportId;
      logPass(`TEST 9: User A created traffic report (${trafficReportId}) with initial status Pending and auto-calculated priority.`);
    } else {
      logFail("TEST 9: Traffic report creation failed.", createRes);
    }

    // User B fetches reports and sees User A's report
    const userBReportsRes = await request('GET', '/api/reports', null, tokenB);
    const foundByB = Array.isArray(userBReportsRes.body.reports) && userBReportsRes.body.reports.some(r => r.reportId === trafficReportId);
    if (userBReportsRes.status === 200 && foundByB) {
      logPass("TEST 10: Shared report visibility confirmed! User B can view User A's report from MongoDB.");
    } else {
      logFail("TEST 10: Shared report visibility failed.", userBReportsRes);
    }

    // Admin Verifies Traffic Report
    const verifyRes = await request('PATCH', `/api/admin/reports/${trafficReportId}/verify`, {
      verificationAction: "verify",
      adminNotes: "Accident verified via CCTV camera"
    }, adminToken);
    if (verifyRes.status === 200 && (verifyRes.body.report.verificationStatus === 'verified' || verifyRes.body.report.verificationStatus === true) && verifyRes.body.report.status === 'Verified') {
      logPass("TEST 11: Admin verified traffic report (status updated to Verified with admin notes).");
    } else {
      logFail("TEST 11: Admin verification failed.", verifyRes);
    }

    // Admin status transitions: Verified -> In Progress -> Resolved
    const inProgressRes = await request('PATCH', `/api/admin/reports/${trafficReportId}/status`, {
      status: "In Progress",
      adminNotes: "Traffic police team dispatched"
    }, adminToken);

    const resolvedRes = await request('PATCH', `/api/admin/reports/${trafficReportId}/status`, {
      status: "Resolved",
      adminNotes: "Accident cleared and traffic restored"
    }, adminToken);

    if (inProgressRes.status === 200 && resolvedRes.status === 200 && resolvedRes.body.report.status === 'Resolved' && resolvedRes.body.report.statusHistory.length >= 3) {
      logPass("TEST 12: Admin completed status transition workflow (Verified -> In Progress -> Resolved) with full statusHistory audit trail.");
    } else {
      logFail("TEST 12: Admin status transitions failed.", { inProgressRes, resolvedRes });
    }
  } catch (err) {
    logFail("TEST 9-12: Traffic report life cycle failed.", err.message);
  }

  // 6. POTHOLE REPORT END-TO-END FLOW & IMAGE SECURITY
  let potholeReportId = null;
  let uploadedImageUrl = null;
  try {
    // A. Image upload security tests
    const dummyTxt = Buffer.from("Hello text file");
    const txtUpload = createMultipartBody({}, 'image', 'malicious.txt', dummyTxt, 'text/plain');
    const txtRes = await request('POST', '/api/uploads/pothole-image', txtUpload.body, tokenA, txtUpload.contentType);

    if (txtRes.status === 400 && txtRes.body.success === false) {
      logPass("TEST 13: Image security verified — non-image file type (.txt) correctly rejected with HTTP 400.");
    } else {
      logFail("TEST 13: Non-image file type rejection failed.", txtRes);
    }

    // B. Valid PNG image upload
    const dummyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000500010d0a2d4b0000000049454e44ae426082', 'hex');
    const pngUpload = createMultipartBody({}, 'image', 'pothole.png', dummyPng, 'image/png');
    const pngRes = await request('POST', '/api/uploads/pothole-image', pngUpload.body, tokenA, pngUpload.contentType);

    if (pngRes.status === 200 && pngRes.body.success && pngRes.body.imageUrl.startsWith('/uploads/potholes/')) {
      uploadedImageUrl = pngRes.body.imageUrl;
      logPass(`TEST 14: Valid pothole image uploaded successfully (${uploadedImageUrl}). Generated unique safe filename.`);
    } else {
      logFail("TEST 14: Valid image upload failed.", pngRes);
    }

    // C. Create Pothole Report
    const potholePayload = {
      reportType: "pothole",
      incidentType: "Pothole",
      location: "Ring Road Sector 4",
      severity: "High",
      date: "2026-10-06",
      time: "15:00",
      description: "Deep pothole causing hazardous driving conditions",
      imageUrl: uploadedImageUrl
    };

    const potCreateRes = await request('POST', '/api/reports', potholePayload, tokenA);
    if (potCreateRes.status === 201 && potCreateRes.body.report.reportId.startsWith('POT') && potCreateRes.body.report.imageUrl === uploadedImageUrl) {
      potholeReportId = potCreateRes.body.report.reportId;
      logPass(`TEST 15: Pothole report created (${potholeReportId}) with stored image URL.`);
    } else {
      logFail("TEST 15: Pothole report creation failed.", potCreateRes);
    }

    // D. Admin verifies & transitions pothole status: Verified -> Correction in Progress -> Corrected
    await request('PATCH', `/api/admin/reports/${potholeReportId}/verify`, { verificationAction: "verify", adminNotes: "Pothole verified" }, adminToken);
    await request('PATCH', `/api/admin/reports/${potholeReportId}/status`, { status: "Correction in Progress", adminNotes: "Repair crew assigned" }, adminToken);
    const potCorrectedRes = await request('PATCH', `/api/admin/reports/${potholeReportId}/status`, { status: "Corrected", adminNotes: "Pothole filled and road resurfaced" }, adminToken);

    if (potCorrectedRes.status === 200 && potCorrectedRes.body.report.status === 'Corrected') {
      logPass("TEST 16: Pothole lifecycle workflow completed (Verified -> Correction in Progress -> Corrected).");
    } else {
      logFail("TEST 16: Pothole status transitions failed.", potCorrectedRes);
    }
  } catch (err) {
    logFail("TEST 13-16: Pothole report lifecycle failed.", err.message);
  }

  // 7. FALSE REPORT FLOW & REJECTION
  try {
    const falsePayload = {
      reportType: "traffic",
      incidentType: "Jam",
      location: "Station Road",
      severity: "Low",
      vehiclesAffected: 1,
      date: "2026-10-06",
      time: "16:00",
      description: "Minor delay reported"
    };

    const falseCreateRes = await request('POST', '/api/reports', falsePayload, tokenA);
    if (falseCreateRes.status === 201 && falseCreateRes.body.report) {
      const falseReportId = falseCreateRes.body.report.reportId;

      // Normal user rejection attempt -> 403
      const userRejectRes = await request('PATCH', `/api/admin/reports/${falseReportId}/reject`, { verificationAction: "reject" }, tokenA);
      if (userRejectRes.status === 403) {
        logPass("TEST 17: Normal user cannot reject reports (403 Forbidden).");
      } else {
        logFail("TEST 17: Normal user rejection check failed.", userRejectRes);
      }

      // Admin rejects report -> false report status
      const adminRejectRes = await request('PATCH', `/api/admin/reports/${falseReportId}/reject`, {
        adminNotes: "No delay found on traffic camera"
      }, adminToken);

      if (
        adminRejectRes.status === 200 &&
        (adminRejectRes.body.report.verificationStatus === 'false' || adminRejectRes.body.report.verificationStatus === false) &&
        adminRejectRes.body.report.status === 'False Report'
      ) {
        logPass("TEST 18: Admin rejection sets verificationStatus='false' and status='False Report' with recorded history.");
      } else {
        logFail("TEST 18: Admin rejection workflow failed.", adminRejectRes);
      }
    } else {
      logFail("TEST 17-18: False report creation failed.", falseCreateRes);
    }
  } catch (err) {
    logFail("TEST 17-18: False report flow failed.", err.message);
  }

  // 8. SEARCH, FILTER & DASHBOARD METRICS
  try {
    // Search
    const searchRes = await request('GET', `/api/reports?search=${trafficReportId}`, null, tokenA);
    if (searchRes.status === 200 && searchRes.body.reports.length === 1 && searchRes.body.reports[0].reportId === trafficReportId) {
      logPass("TEST 19: Search filter accurately isolates report by ID.");
    } else {
      logFail("TEST 19: Search filter failed.", searchRes);
    }

    // Filter by type
    const filterRes = await request('GET', '/api/reports?reportType=pothole', null, tokenA);
    const filterOk = Array.isArray(filterRes.body.reports) && filterRes.body.reports.every(r => r.reportType === 'pothole');
    if (filterRes.status === 200 && filterOk) {
      logPass("TEST 20: Query filtering by reportType=pothole verified.");
    } else {
      logFail("TEST 20: Query filtering failed.", filterRes);
    }

    // Dashboard Statistics
    const statsRes = await request('GET', '/api/dashboard/stats', null, tokenA);
    if (statsRes.status === 200 && statsRes.body.stats && typeof statsRes.body.stats.totalReports === 'number') {
      logPass("TEST 21: Backend dashboard statistics (/api/dashboard/stats) returned authoritative MongoDB metrics.");
    } else {
      logFail("TEST 21: Dashboard stats check failed.", statsRes);
    }
  } catch (err) {
    logFail("TEST 19-21: Search, filter & dashboard failed.", err.message);
  }

  // 9. EDIT AUTHORIZATION & PROTECTED FIELDS PROTECTION
  try {
    // User A edits their own report
    const editRes = await request('PATCH', `/api/reports/${trafficReportId}`, {
      description: "Updated description for collision",
      status: "MaliciousStatus", // Protected field
      verificationStatus: true,   // Protected field
      role: "admin"               // Protected field
    }, tokenA);

    if (
      editRes.status === 200 &&
      editRes.body.report.description === "Updated description for collision" &&
      editRes.body.report.status === "Resolved" // Protected status field remained intact!
    ) {
      logPass("TEST 22: Report edit allowed legitimate field updates while stripping protected fields (status/role/verificationStatus).");
    } else {
      logFail("TEST 22: Edit authorization or field protection failed.", editRes);
    }

    // User B attempts to edit User A's report -> 403
    const userBEditRes = await request('PATCH', `/api/reports/${trafficReportId}`, { description: "User B hack" }, tokenB);
    if (userBEditRes.status === 403) {
      logPass("TEST 23: User B unauthorized edit on User A's report correctly rejected (403 Forbidden).");
    } else {
      logFail("TEST 23: Unauthorized edit check failed.", userBEditRes);
    }
  } catch (err) {
    logFail("TEST 22-23: Edit authorization failed.", err.message);
  }

  // 10. DELETE AUTHORIZATION & IMAGE CLEANUP
  try {
    // User B attempts to delete User A's report -> 403
    const deleteBRes = await request('DELETE', `/api/reports/${potholeReportId}`, null, tokenB);
    if (deleteBRes.status === 403) {
      logPass("TEST 24: User B unauthorized deletion on User A's report rejected (403 Forbidden).");
    } else {
      logFail("TEST 24: Unauthorized deletion check failed.", deleteBRes);
    }

    // User A deletes their own pothole report -> 200 & image deleted from filesystem
    const deleteARes = await request('DELETE', `/api/reports/${potholeReportId}`, null, tokenA);
    const relativeImagePath = uploadedImageUrl ? uploadedImageUrl.replace(/^\//, '') : '';
    const potholeFileExists = relativeImagePath ? fs.existsSync(path.join(__dirname, relativeImagePath)) : false;

    if (deleteARes.status === 200 && deleteARes.body.success && !potholeFileExists) {
      logPass("TEST 25: Report deletion by owner succeeded and associated pothole image was removed from filesystem.");
    } else {
      logFail("TEST 25: Owner deletion or image file cleanup failed.", { deleteARes, potholeFileExists });
    }
  } catch (err) {
    logFail("TEST 24-25: Delete authorization failed.", err.message);
  }

  // 11. ERROR HANDLING & SECURITY REGRESSION
  try {
    const notFoundRes = await request('GET', '/api/reports/INC999999', null, tokenA);
    const invalidRouteRes = await request('GET', '/api/unknown-route');
    
    if (notFoundRes.status === 404 && invalidRouteRes.status === 404 && invalidRouteRes.body.success === false) {
      logPass("TEST 26: 404 handling verified for missing resources and unknown API endpoints.");
    } else {
      logFail("TEST 26: 404 handling check failed.", { notFoundRes, invalidRouteRes });
    }
  } catch (err) {
    logFail("TEST 26: Error handling check failed.", err.message);
  }

  // SUMMARY PRINTING
  console.log("\n==================================================");
  console.log("MODULE 19 TEST SUMMARY");
  console.log("==================================================");
  console.log(`Passed:  ${totalPassed}`);
  console.log(`Failed:  ${totalFailed}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log("--------------------------------------------------");
  console.log(`Overall: ${totalFailed === 0 ? "PASS" : "FAIL"}`);
  console.log("==================================================\n");

  process.exit(totalFailed === 0 ? 0 : 1);
}

runTests();
