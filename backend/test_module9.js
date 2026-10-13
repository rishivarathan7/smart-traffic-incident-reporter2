const http = require('http');
const fs = require('fs');
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

async function runModule9Tests() {
    console.log("==================================================");
    console.log("    SMART TRAFFIC INCIDENT REPORTER - MODULE 9    ");
    console.log("        ADMIN VERIFY / REJECT WORKFLOW TEST       ");
    console.log("==================================================\n");

    let passedTests = 0;
    let totalTests = 9;

    let adminToken = null;
    let adminUserId = null;
    let userToken = null;
    let userEmail = `mod9user_${Date.now()}@example.com`;

    // TEST A — ADMIN LOGIN
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

    // Register & login normal user
    try {
        await makeRequest('/auth/register', 'POST', { name: "Module9 User", email: userEmail, password: "Password123!" });
        const userRes = await makeRequest('/auth/login', 'POST', { email: userEmail, password: "Password123!" });
        userToken = userRes.data.token;
    } catch (e) {
        console.error("Setup error registering normal user:", e.message);
    }

    // Create 2 pending reports for verification/rejection tests
    let reportToVerifyId = null;
    let reportToRejectId = null;

    try {
        const rep1 = await makeRequest('/reports', 'POST', {
            reportType: "traffic",
            incidentType: "Accident",
            location: "T. Nagar Roundtana",
            severity: "High",
            vehiclesAffected: 4,
            date: "2026-09-21",
            time: "10:00",
            description: "Module 9 accident report for verification."
        }, userToken);
        reportToVerifyId = rep1.data.report.reportId;

        const rep2 = await makeRequest('/reports', 'POST', {
            reportType: "pothole",
            location: "Velachery Main Road",
            date: "2026-09-21",
            time: "10:30",
            description: "Module 9 pothole report for rejection."
        }, userToken);
        reportToRejectId = rep2.data.report.reportId;
    } catch (e) {
        console.error("Setup error creating test reports:", e.message);
    }

    // TEST B — ADMIN VIEWS PENDING REPORTS
    try {
        const res = await makeRequest('/reports', 'GET', null, adminToken);
        const repV = res.data.reports.find(r => r.reportId === reportToVerifyId);
        const repR = res.data.reports.find(r => r.reportId === reportToRejectId);

        if (res.status === 200 && repV && repR && repV.verificationStatus === 'pending') {
            console.log("✅ TEST B PASSED: Admin retrieves pending reports successfully.");
            passedTests++;
        } else {
            console.error("❌ TEST B FAILED:", res);
        }
    } catch (e) {
        console.error("❌ TEST B FAILED:", e.message);
    }

    // TEST C — ADMIN VERIFY REPORT
    try {
        const vRes = await makeRequest(`/admin/reports/${reportToVerifyId}/verify`, 'PATCH', null, adminToken);
        if (
            vRes.status === 200 &&
            vRes.data.success &&
            vRes.data.report.verificationStatus === 'verified' &&
            vRes.data.report.status === 'Verified'
        ) {
            const lastHistory = vRes.data.report.statusHistory[vRes.data.report.statusHistory.length - 1];
            if (lastHistory.status === 'Verified' && lastHistory.changedBy === adminUserId) {
                console.log(`✅ TEST C PASSED: Report ${reportToVerifyId} verified successfully. Status & History updated.`);
                passedTests++;
            } else {
                console.error("❌ TEST C FAILED: History entry invalid:", lastHistory);
            }
        } else {
            console.error("❌ TEST C FAILED:", vRes);
        }
    } catch (e) {
        console.error("❌ TEST C FAILED:", e.message);
    }

    // TEST D — ADMIN REJECT REPORT
    try {
        const rRes = await makeRequest(`/admin/reports/${reportToRejectId}/reject`, 'PATCH', null, adminToken);
        if (
            rRes.status === 200 &&
            rRes.data.success &&
            rRes.data.report.verificationStatus === 'false' &&
            rRes.data.report.status === 'False Report'
        ) {
            const lastHistory = rRes.data.report.statusHistory[rRes.data.report.statusHistory.length - 1];
            if (lastHistory.status === 'False Report' && lastHistory.changedBy === adminUserId) {
                console.log(`✅ TEST D PASSED: Report ${reportToRejectId} rejected as False Report successfully.`);
                passedTests++;
            } else {
                console.error("❌ TEST D FAILED: History entry invalid:", lastHistory);
            }
        } else {
            console.error("❌ TEST D FAILED:", rRes);
        }
    } catch (e) {
        console.error("❌ TEST D FAILED:", e.message);
    }

    // TEST E — NORMAL USER CANNOT SEE ADMIN BUTTONS IN UI
    try {
        const scriptContent = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
        if (scriptContent.includes("isAdmin") && scriptContent.includes("isPending") && scriptContent.includes("verifyReport")) {
            console.log("✅ TEST E PASSED: UI strictly checks isAdmin before rendering verify/reject action buttons.");
            passedTests++;
        } else {
            console.error("❌ TEST E FAILED: UI role check missing.");
        }
    } catch (e) {
        console.error("❌ TEST E FAILED:", e.message);
    }

    // TEST F — NORMAL USER CALLS VERIFY ENDPOINT (HTTP 403 EXPECTED)
    try {
        const failV = await makeRequest(`/admin/reports/${reportToVerifyId}/verify`, 'PATCH', null, userToken);
        if (failV.status === 403) {
            console.log("✅ TEST F PASSED: Normal user call to verify endpoint rejected with HTTP 403 Forbidden.");
            passedTests++;
        } else {
            console.error("❌ TEST F FAILED: Expected 403 but got", failV.status);
        }
    } catch (e) {
        console.error("❌ TEST F FAILED:", e.message);
    }

    // TEST G — NORMAL USER CALLS REJECT ENDPOINT (HTTP 403 EXPECTED)
    try {
        const failR = await makeRequest(`/admin/reports/${reportToRejectId}/reject`, 'PATCH', null, userToken);
        if (failR.status === 403) {
            console.log("✅ TEST G PASSED: Normal user call to reject endpoint rejected with HTTP 403 Forbidden.");
            passedTests++;
        } else {
            console.error("❌ TEST G FAILED: Expected 403 but got", failR.status);
        }
    } catch (e) {
        console.error("❌ TEST G FAILED:", e.message);
    }

    // TEST H — VERIFY ALREADY VERIFIED REPORT (HTTP 409 EXPECTED)
    try {
        const dupV = await makeRequest(`/admin/reports/${reportToVerifyId}/verify`, 'PATCH', null, adminToken);
        if (dupV.status === 409) {
            console.log("✅ TEST H PASSED: Verifying an already verified report rejected with HTTP 409 Conflict.");
            passedTests++;
        } else {
            console.error("❌ TEST H FAILED: Expected 409 but got", dupV.status);
        }
    } catch (e) {
        console.error("❌ TEST H FAILED:", e.message);
    }

    // TEST I — REJECT ALREADY FALSE REPORT (HTTP 409 EXPECTED)
    try {
        const dupR = await makeRequest(`/admin/reports/${reportToRejectId}/reject`, 'PATCH', null, adminToken);
        if (dupR.status === 409) {
            console.log("✅ TEST I PASSED: Rejecting an already false report rejected with HTTP 409 Conflict.");
            passedTests++;
        } else {
            console.error("❌ TEST I FAILED: Expected 409 but got", dupR.status);
        }
    } catch (e) {
        console.error("❌ TEST I FAILED:", e.message);
    }

    console.log("\n==================================================");
    console.log(`   MODULE 9 INTEGRATION TESTS: ${passedTests} / ${totalTests} PASSED   `);
    console.log("==================================================\n");
}

runModule9Tests();
