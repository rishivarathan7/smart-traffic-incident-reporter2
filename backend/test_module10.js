const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BASE_URL = 'http://localhost:5000/api';

async function makeRequest(endpoint, method = 'GET', body = null, token = null) {
    const url = new URL(`${BASE_URL}${endpoint}`);
    const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
    }

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, data: parsed });
            });
        });

        req.on('error', err => reject(err));

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runModule10Tests() {
    console.log("==================================================");
    console.log("   SMART TRAFFIC INCIDENT REPORTER - MODULE 10   ");
    console.log("        DEVELOPMENT / STATUS WORKFLOW TEST       ");
    console.log("==================================================\n");

    let passedTests = 0;
    const totalTests = 12;

    let adminToken = null;
    let adminUserId = null;
    let userToken = null;
    const userEmail = `mod10user_${Date.now()}@example.com`;

    // ----------------------------------------------------
    // TEST A — ADMIN LOGIN
    // ----------------------------------------------------
    try {
        const adminRes = await makeRequest('/auth/admin/login', 'POST', {
            email: process.env.ADMIN_EMAIL || "admin@smarttraffic.com",
            password: process.env.ADMIN_PASSWORD || "AdminSecurePassword123"
        });
        if (adminRes.status === 200 && adminRes.data.token && adminRes.data.user.role === 'admin') {
            adminToken = adminRes.data.token;
            adminUserId = adminRes.data.user.userId;
            console.log("✅ TEST A PASSED: Admin Login successful. Admin JWT obtained.");
            passedTests++;
        } else {
            console.error("❌ TEST A FAILED:", adminRes);
        }
    } catch (e) {
        console.error("❌ TEST A FAILED:", e.message);
    }

    // Register & login normal user for report creation & permission checks
    try {
        await makeRequest('/auth/register', 'POST', { name: "Module10 User", email: userEmail, password: "Password123!" });
        const userRes = await makeRequest('/auth/login', 'POST', { email: userEmail, password: "Password123!" });
        userToken = userRes.data.token;
    } catch (e) {
        console.error("Setup error registering normal user:", e.message);
    }

    // Helper to create traffic report
    async function createTrafficReport(description = "Traffic accident on M.G. Road") {
        const rep = await makeRequest('/reports', 'POST', {
            reportType: "traffic",
            incidentType: "Accident",
            location: "M.G. Road Junction",
            severity: "Medium",
            vehiclesAffected: 2,
            date: "2026-09-22",
            time: "10:30",
            description
        }, userToken);
        return rep.data.report;
    }

    // Helper to create pothole report
    async function createPotholeReport(description = "Deep pothole near Anna Salai") {
        const rep = await makeRequest('/reports', 'POST', {
            reportType: "pothole",
            location: "Anna Salai",
            potholeSize: "Large",
            depthEstimate: "15cm",
            trafficImpact: "High",
            date: "2026-09-22",
            time: "10:30",
            description
        }, userToken);
        return rep.data.report;
    }

    // Helper to verify report via Module 9 endpoint
    async function verifyReport(reportId) {
        await makeRequest(`/admin/reports/${reportId}/verify`, 'PATCH', { status: 'verified' }, adminToken);
    }

    // Helper to reject report via Module 9 endpoint
    async function rejectReport(reportId, reason = "False Report") {
        await makeRequest(`/admin/reports/${reportId}/reject`, 'PATCH', { rejectReason: reason }, adminToken);
    }

    // ----------------------------------------------------
    // TEST B — Traffic Verified → In Progress
    // ----------------------------------------------------
    let trafficReportB = null;
    try {
        const rep = await createTrafficReport("Test B Traffic Report");
        await verifyReport(rep.reportId);

        const res = await makeRequest(`/admin/reports/${rep.reportId}/status`, 'PATCH', { status: "In Progress" }, adminToken);
        if (res.status === 200 && res.data.report.status === "In Progress" && res.data.report.verificationStatus === "verified") {
            trafficReportB = res.data.report;
            console.log("✅ TEST B PASSED: Traffic report moved Verified → In Progress (HTTP 200).");
            passedTests++;
        } else {
            console.error("❌ TEST B FAILED:", res);
        }
    } catch (e) {
        console.error("❌ TEST B FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST C — Traffic In Progress → Resolved
    // ----------------------------------------------------
    try {
        if (!trafficReportB) throw new Error("Dependency Test B failed");
        const res = await makeRequest(`/admin/reports/${trafficReportB.reportId}/status`, 'PATCH', { status: "Resolved" }, adminToken);
        if (res.status === 200 && res.data.report.status === "Resolved" && res.data.report.verificationStatus === "verified") {
            console.log("✅ TEST C PASSED: Traffic report moved In Progress → Resolved (HTTP 200).");
            passedTests++;
        } else {
            console.error("❌ TEST C FAILED:", res);
        }
    } catch (e) {
        console.error("❌ TEST C FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST D — Pothole Verified → Correction in Progress
    // ----------------------------------------------------
    let potholeReportD = null;
    try {
        const rep = await createPotholeReport("Test D Pothole Report");
        await verifyReport(rep.reportId);

        const res = await makeRequest(`/admin/reports/${rep.reportId}/status`, 'PATCH', { status: "Correction in Progress" }, adminToken);
        if (res.status === 200 && res.data.report.status === "Correction in Progress" && res.data.report.verificationStatus === "verified") {
            potholeReportD = res.data.report;
            console.log("✅ TEST D PASSED: Pothole report moved Verified → Correction in Progress (HTTP 200).");
            passedTests++;
        } else {
            console.error("❌ TEST D FAILED:", res);
        }
    } catch (e) {
        console.error("❌ TEST D FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST E — Pothole Correction in Progress → Corrected
    // ----------------------------------------------------
    try {
        if (!potholeReportD) throw new Error("Dependency Test D failed");
        const res = await makeRequest(`/admin/reports/${potholeReportD.reportId}/status`, 'PATCH', { status: "Corrected" }, adminToken);
        if (res.status === 200 && res.data.report.status === "Corrected" && res.data.report.verificationStatus === "verified") {
            console.log("✅ TEST E PASSED: Pothole report moved Correction in Progress → Corrected (HTTP 200).");
            passedTests++;
        } else {
            console.error("❌ TEST E FAILED:", res);
        }
    } catch (e) {
        console.error("❌ TEST E FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST F — Invalid Traffic Transition: Verified → Resolved
    // ----------------------------------------------------
    try {
        const rep = await createTrafficReport("Test F Traffic Report");
        await verifyReport(rep.reportId);

        const res = await makeRequest(`/admin/reports/${rep.reportId}/status`, 'PATCH', { status: "Resolved" }, adminToken);
        if (res.status === 409) {
            console.log("✅ TEST F PASSED: Invalid traffic transition Verified → Resolved rejected (HTTP 409).");
            passedTests++;
        } else {
            console.error("❌ TEST F FAILED: Expected 409, got status:", res.status);
        }
    } catch (e) {
        console.error("❌ TEST F FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST G — Invalid Pothole Transition: Verified → Corrected
    // ----------------------------------------------------
    try {
        const rep = await createPotholeReport("Test G Pothole Report");
        await verifyReport(rep.reportId);

        const res = await makeRequest(`/admin/reports/${rep.reportId}/status`, 'PATCH', { status: "Corrected" }, adminToken);
        if (res.status === 409) {
            console.log("✅ TEST G PASSED: Invalid pothole transition Verified → Corrected rejected (HTTP 409).");
            passedTests++;
        } else {
            console.error("❌ TEST G FAILED: Expected 409, got status:", res.status);
        }
    } catch (e) {
        console.error("❌ TEST G FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST H — Skipping Traffic Stage: Pending → Resolved
    // ----------------------------------------------------
    try {
        const rep = await createTrafficReport("Test H Traffic Report");

        const res = await makeRequest(`/admin/reports/${rep.reportId}/status`, 'PATCH', { status: "Resolved" }, adminToken);
        if (res.status === 409) {
            console.log("✅ TEST H PASSED: Skipping stage Pending → Resolved rejected (HTTP 409).");
            passedTests++;
        } else {
            console.error("❌ TEST H FAILED: Expected 409, got status:", res.status);
        }
    } catch (e) {
        console.error("❌ TEST H FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST I — Skipping Pothole Stage: Pending Verification → Corrected
    // ----------------------------------------------------
    try {
        const rep = await createPotholeReport("Test I Pothole Report");

        const res = await makeRequest(`/admin/reports/${rep.reportId}/status`, 'PATCH', { status: "Corrected" }, adminToken);
        if (res.status === 409) {
            console.log("✅ TEST I PASSED: Skipping stage Pending Verification → Corrected rejected (HTTP 409).");
            passedTests++;
        } else {
            console.error("❌ TEST I FAILED: Expected 409, got status:", res.status);
        }
    } catch (e) {
        console.error("❌ TEST I FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST J — Normal User Tries To Change Status
    // ----------------------------------------------------
    try {
        const rep = await createTrafficReport("Test J Traffic Report");
        await verifyReport(rep.reportId);

        const res = await makeRequest(`/admin/reports/${rep.reportId}/status`, 'PATCH', { status: "In Progress" }, userToken);
        if (res.status === 403) {
            console.log("✅ TEST J PASSED: Normal user forbidden from changing status (HTTP 403).");
            passedTests++;
        } else {
            console.error("❌ TEST J FAILED: Expected 403, got status:", res.status);
        }
    } catch (e) {
        console.error("❌ TEST J FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST K — Try Changing Status on False Report
    // ----------------------------------------------------
    try {
        const rep = await createTrafficReport("Test K False Report");
        await rejectReport(rep.reportId, "Spam / False Report");

        const res = await makeRequest(`/admin/reports/${rep.reportId}/status`, 'PATCH', { status: "In Progress" }, adminToken);
        if (res.status === 409) {
            console.log("✅ TEST K PASSED: Transition on False Report rejected (HTTP 409).");
            passedTests++;
        } else {
            console.error("❌ TEST K FAILED: Expected 409, got status:", res.status);
        }
    } catch (e) {
        console.error("❌ TEST K FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST L — Check statusHistory After Successful Transitions
    // ----------------------------------------------------
    try {
        if (!trafficReportB) throw new Error("Dependency Test B failed");
        const fetchRes = await makeRequest(`/reports/${trafficReportB.reportId}`, 'GET', null, userToken);
        
        if (fetchRes.status === 200 && fetchRes.data.report) {
            const report = fetchRes.data.report;
            const history = report.statusHistory || [];
            
            const inProgressEntry = history.find(h => h.status === 'In Progress');
            const resolvedEntry = history.find(h => h.status === 'Resolved');

            if (
                inProgressEntry &&
                inProgressEntry.changedBy === adminUserId &&
                inProgressEntry.changedAt &&
                inProgressEntry.note &&
                resolvedEntry &&
                resolvedEntry.changedBy === adminUserId &&
                resolvedEntry.changedAt &&
                resolvedEntry.note
            ) {
                console.log("✅ TEST L PASSED: statusHistory correctly recorded status, admin userId, timestamp, and note.");
                passedTests++;
            } else {
                console.error("❌ TEST L FAILED: Invalid statusHistory structure:", history);
            }
        } else {
            console.error("❌ TEST L FAILED to fetch updated report:", fetchRes);
        }
    } catch (e) {
        console.error("❌ TEST L FAILED:", e.message);
    }

    console.log("\n==================================================");
    console.log(`  MODULE 10 TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
    console.log("==================================================");

    if (passedTests === totalTests) {
        console.log("🎉 ALL MODULE 10 TESTS PASSED SUCCESSFULLY!");
        process.exit(0);
    } else {
        console.error("⚠️ SOME MODULE 10 TESTS FAILED.");
        process.exit(1);
    }
}

runModule10Tests();
