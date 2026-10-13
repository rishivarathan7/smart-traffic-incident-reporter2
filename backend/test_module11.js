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

async function runModule11Tests() {
    console.log("==================================================");
    console.log("   SMART TRAFFIC INCIDENT REPORTER - MODULE 11   ");
    console.log("       TIMELINE AUDIT & SYNCHRONIZATION TEST      ");
    console.log("==================================================\n");

    let passedTests = 0;
    const totalTests = 17;

    let adminToken = null;
    let adminUserId = null;
    let userToken = null;
    let normalUserId = null;
    const userEmail = `mod11user_${Date.now()}@example.com`;

    // ----------------------------------------------------
    // TEST A — USER LOGIN
    // ----------------------------------------------------
    try {
        await makeRequest('/auth/register', 'POST', { name: "Module11 User", email: userEmail, password: "Password123!" });
        const userRes = await makeRequest('/auth/login', 'POST', { email: userEmail, password: "Password123!" });
        if (userRes.status === 200 && userRes.data.token && userRes.data.user.role === 'user') {
            userToken = userRes.data.token;
            normalUserId = userRes.data.user.userId;
            console.log("✅ TEST A PASSED: User Login successful. User JWT obtained.");
            passedTests++;
        } else {
            console.error("❌ TEST A FAILED:", userRes);
        }
    } catch (e) {
        console.error("❌ TEST A FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST B — ADMIN LOGIN
    // ----------------------------------------------------
    try {
        const adminRes = await makeRequest('/auth/admin/login', 'POST', {
            email: process.env.ADMIN_EMAIL || "admin@smarttraffic.com",
            password: process.env.ADMIN_PASSWORD || "AdminSecurePassword123"
        });
        if (adminRes.status === 200 && adminRes.data.token && adminRes.data.user.role === 'admin') {
            adminToken = adminRes.data.token;
            adminUserId = adminRes.data.user.userId;
            console.log("✅ TEST B PASSED: Admin Login successful. Admin JWT obtained.");
            passedTests++;
        } else {
            console.error("❌ TEST B FAILED:", adminRes);
        }
    } catch (e) {
        console.error("❌ TEST B FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST C — Newly created traffic report has exactly 1 Pending history entry
    // ----------------------------------------------------
    let trafficReportC = null;
    try {
        const rep = await makeRequest('/reports', 'POST', {
            reportType: "traffic",
            incidentType: "Congestion",
            location: "Mount Road",
            severity: "Medium",
            vehiclesAffected: 3,
            date: "2026-09-22",
            time: "14:00",
            description: "Heavy traffic jam on Mount Road"
        }, userToken);

        if (rep.status === 201 && rep.data.report) {
            trafficReportC = rep.data.report;
            const history = trafficReportC.statusHistory || [];
            if (history.length === 1 && history[0].status === "Pending" && history[0].changedBy === normalUserId) {
                console.log("✅ TEST C PASSED: Newly created traffic report has exactly 1 'Pending' history entry.");
                passedTests++;
            } else {
                console.error("❌ TEST C FAILED: Invalid history array:", history);
            }
        } else {
            console.error("❌ TEST C FAILED:", rep);
        }
    } catch (e) {
        console.error("❌ TEST C FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST D — Newly created pothole report has exactly 1 Pending Verification entry
    // ----------------------------------------------------
    let potholeReportD = null;
    try {
        const rep = await makeRequest('/reports', 'POST', {
            reportType: "pothole",
            location: "GST Road",
            potholeSize: "Medium",
            depthEstimate: "10cm",
            trafficImpact: "Medium",
            date: "2026-09-22",
            time: "14:30",
            description: "Noticeable pothole near bus stop"
        }, userToken);

        if (rep.status === 201 && rep.data.report) {
            potholeReportD = rep.data.report;
            const history = potholeReportD.statusHistory || [];
            if (history.length === 1 && history[0].status === "Pending Verification" && history[0].changedBy === normalUserId) {
                console.log("✅ TEST D PASSED: Newly created pothole report has exactly 1 'Pending Verification' history entry.");
                passedTests++;
            } else {
                console.error("❌ TEST D FAILED: Invalid history array:", history);
            }
        } else {
            console.error("❌ TEST D FAILED:", rep);
        }
    } catch (e) {
        console.error("❌ TEST D FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST E — Admin verification adds exactly 1 Verified entry
    // ----------------------------------------------------
    try {
        if (!trafficReportC) throw new Error("Dependency Test C failed");
        const verifyRes = await makeRequest(`/admin/reports/${trafficReportC.reportId}/verify`, 'PATCH', { status: 'verified' }, adminToken);
        if (verifyRes.status === 200 && verifyRes.data.report) {
            const history = verifyRes.data.report.statusHistory || [];
            if (history.length === 2 && history[1].status === "Verified" && history[1].changedBy === adminUserId) {
                console.log("✅ TEST E PASSED: Admin verification added exactly 1 'Verified' entry (total 2).");
                passedTests++;
            } else {
                console.error("❌ TEST E FAILED: History array state:", history);
            }
        } else {
            console.error("❌ TEST E FAILED:", verifyRes);
        }
    } catch (e) {
        console.error("❌ TEST E FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST F — Admin rejection adds exactly 1 False Report entry
    // ----------------------------------------------------
    let rejectedReport = null;
    try {
        const rep = await makeRequest('/reports', 'POST', {
            reportType: "traffic",
            incidentType: "Hazard",
            location: "ECR Road",
            severity: "Low",
            vehiclesAffected: 1,
            date: "2026-09-22",
            time: "15:00",
            description: "False hazard report test"
        }, userToken);

        const rejectRes = await makeRequest(`/admin/reports/${rep.data.report.reportId}/reject`, 'PATCH', { rejectReason: 'Spam' }, adminToken);
        if (rejectRes.status === 200 && rejectRes.data.report) {
            rejectedReport = rejectRes.data.report;
            const history = rejectedReport.statusHistory || [];
            if (history.length === 2 && history[1].status === "False Report" && history[1].changedBy === adminUserId) {
                console.log("✅ TEST F PASSED: Admin rejection added exactly 1 'False Report' entry.");
                passedTests++;
            } else {
                console.error("❌ TEST F FAILED: History array state:", history);
            }
        } else {
            console.error("❌ TEST F FAILED:", rejectRes);
        }
    } catch (e) {
        console.error("❌ TEST F FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST G — Traffic Verified → In Progress adds exactly 1 entry
    // ----------------------------------------------------
    try {
        if (!trafficReportC) throw new Error("Dependency Test C failed");
        const statusRes = await makeRequest(`/admin/reports/${trafficReportC.reportId}/status`, 'PATCH', { status: 'In Progress' }, adminToken);
        if (statusRes.status === 200 && statusRes.data.report) {
            const history = statusRes.data.report.statusHistory || [];
            if (history.length === 3 && history[2].status === "In Progress" && history[2].changedBy === adminUserId) {
                console.log("✅ TEST G PASSED: Traffic Verified → In Progress added exactly 1 entry (total 3).");
                passedTests++;
            } else {
                console.error("❌ TEST G FAILED:", history);
            }
        } else {
            console.error("❌ TEST G FAILED:", statusRes);
        }
    } catch (e) {
        console.error("❌ TEST G FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST H — Traffic In Progress → Resolved adds exactly 1 entry
    // ----------------------------------------------------
    try {
        if (!trafficReportC) throw new Error("Dependency Test C failed");
        const statusRes = await makeRequest(`/admin/reports/${trafficReportC.reportId}/status`, 'PATCH', { status: 'Resolved' }, adminToken);
        if (statusRes.status === 200 && statusRes.data.report) {
            const history = statusRes.data.report.statusHistory || [];
            if (history.length === 4 && history[3].status === "Resolved" && history[3].changedBy === adminUserId) {
                console.log("✅ TEST H PASSED: Traffic In Progress → Resolved added exactly 1 entry (total 4).");
                passedTests++;
            } else {
                console.error("❌ TEST H FAILED:", history);
            }
        } else {
            console.error("❌ TEST H FAILED:", statusRes);
        }
    } catch (e) {
        console.error("❌ TEST H FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST I — Pothole Verified → Correction in Progress adds exactly 1 entry
    // ----------------------------------------------------
    try {
        if (!potholeReportD) throw new Error("Dependency Test D failed");
        await makeRequest(`/admin/reports/${potholeReportD.reportId}/verify`, 'PATCH', { status: 'verified' }, adminToken);
        const statusRes = await makeRequest(`/admin/reports/${potholeReportD.reportId}/status`, 'PATCH', { status: 'Correction in Progress' }, adminToken);
        if (statusRes.status === 200 && statusRes.data.report) {
            const history = statusRes.data.report.statusHistory || [];
            if (history.length === 3 && history[2].status === "Correction in Progress" && history[2].changedBy === adminUserId) {
                console.log("✅ TEST I PASSED: Pothole Verified → Correction in Progress added exactly 1 entry (total 3).");
                passedTests++;
            } else {
                console.error("❌ TEST I FAILED:", history);
            }
        } else {
            console.error("❌ TEST I FAILED:", statusRes);
        }
    } catch (e) {
        console.error("❌ TEST I FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST J — Pothole Correction in Progress → Corrected adds exactly 1 entry
    // ----------------------------------------------------
    try {
        if (!potholeReportD) throw new Error("Dependency Test D failed");
        const statusRes = await makeRequest(`/admin/reports/${potholeReportD.reportId}/status`, 'PATCH', { status: 'Corrected' }, adminToken);
        if (statusRes.status === 200 && statusRes.data.report) {
            const history = statusRes.data.report.statusHistory || [];
            if (history.length === 4 && history[3].status === "Corrected" && history[3].changedBy === adminUserId) {
                console.log("✅ TEST J PASSED: Pothole Correction in Progress → Corrected added exactly 1 entry (total 4).");
                passedTests++;
            } else {
                console.error("❌ TEST J FAILED:", history);
            }
        } else {
            console.error("❌ TEST J FAILED:", statusRes);
        }
    } catch (e) {
        console.error("❌ TEST J FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST K — Invalid transition does not change history length
    // ----------------------------------------------------
    try {
        if (!trafficReportC) throw new Error("Dependency Test C failed");
        const beforeRes = await makeRequest(`/reports/${trafficReportC.reportId}`, 'GET', null, userToken);
        const lenBefore = beforeRes.data.report.statusHistory.length;

        const invalidRes = await makeRequest(`/admin/reports/${trafficReportC.reportId}/status`, 'PATCH', { status: 'In Progress' }, adminToken);
        
        const afterRes = await makeRequest(`/reports/${trafficReportC.reportId}`, 'GET', null, userToken);
        const lenAfter = afterRes.data.report.statusHistory.length;

        if (invalidRes.status === 409 && lenBefore === lenAfter) {
            console.log("✅ TEST K PASSED: Invalid transition rejected (HTTP 409) and did not change statusHistory length.");
            passedTests++;
        } else {
            console.error("❌ TEST K FAILED:", { status: invalidRes.status, lenBefore, lenAfter });
        }
    } catch (e) {
        console.error("❌ TEST K FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST L — False report cannot enter development workflow
    // ----------------------------------------------------
    try {
        if (!rejectedReport) throw new Error("Dependency Test F failed");
        const devRes = await makeRequest(`/admin/reports/${rejectedReport.reportId}/status`, 'PATCH', { status: 'In Progress' }, adminToken);
        if (devRes.status === 409) {
            console.log("✅ TEST L PASSED: False report prohibited from entering development workflow (HTTP 409).");
            passedTests++;
        } else {
            console.error("❌ TEST L FAILED: Expected 409, got status:", devRes.status);
        }
    } catch (e) {
        console.error("❌ TEST L FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST M — Normal user cannot perform admin status changes
    // ----------------------------------------------------
    try {
        if (!trafficReportC) throw new Error("Dependency Test C failed");
        const userActionRes = await makeRequest(`/admin/reports/${trafficReportC.reportId}/status`, 'PATCH', { status: 'Resolved' }, userToken);
        if (userActionRes.status === 403) {
            console.log("✅ TEST M PASSED: Normal user prohibited from admin status changes (HTTP 403).");
            passedTests++;
        } else {
            console.error("❌ TEST M FAILED: Expected 403, got status:", userActionRes.status);
        }
    } catch (e) {
        console.error("❌ TEST M FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST N — Report detail returns complete statusHistory
    // ----------------------------------------------------
    try {
        if (!trafficReportC) throw new Error("Dependency Test C failed");
        const detailRes = await makeRequest(`/reports/${trafficReportC.reportId}`, 'GET', null, userToken);
        if (detailRes.status === 200 && Array.isArray(detailRes.data.report.statusHistory) && detailRes.data.report.statusHistory.length === 4) {
            console.log("✅ TEST N PASSED: GET /api/reports/:reportId returns complete statusHistory array.");
            passedTests++;
        } else {
            console.error("❌ TEST N FAILED:", detailRes);
        }
    } catch (e) {
        console.error("❌ TEST N FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST O — statusHistory is in ascending chronological order
    // ----------------------------------------------------
    try {
        if (!trafficReportC) throw new Error("Dependency Test C failed");
        const detailRes = await makeRequest(`/reports/${trafficReportC.reportId}`, 'GET', null, userToken);
        const history = detailRes.data.report.statusHistory || [];
        
        let isChronological = true;
        for (let i = 0; i < history.length - 1; i++) {
            const timeA = new Date(history[i].changedAt).getTime();
            const timeB = new Date(history[i + 1].changedAt).getTime();
            if (timeA > timeB) {
                isChronological = false;
                break;
            }
        }

        if (isChronological && history.length >= 2) {
            console.log("✅ TEST O PASSED: statusHistory entries are in ascending chronological order (oldest → newest).");
            passedTests++;
        } else {
            console.error("❌ TEST O FAILED: Non-chronological history:", history);
        }
    } catch (e) {
        console.error("❌ TEST O FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST P — GET /api/reports/:reportId/history endpoint behavior
    // ----------------------------------------------------
    try {
        if (!trafficReportC) throw new Error("Dependency Test C failed");
        const historyEndpointRes = await makeRequest(`/reports/${trafficReportC.reportId}/history`, 'GET', null, userToken);
        const notFoundRes = await makeRequest('/reports/NON_EXISTENT_ID_9999/history', 'GET', null, userToken);

        if (
            historyEndpointRes.status === 200 &&
            historyEndpointRes.data.reportId === trafficReportC.reportId &&
            Array.isArray(historyEndpointRes.data.statusHistory) &&
            notFoundRes.status === 404
        ) {
            console.log("✅ TEST P PASSED: Dedicated GET /api/reports/:reportId/history returns 200 for valid report and 404 for unknown report.");
            passedTests++;
        } else {
            console.error("❌ TEST P FAILED:", { historyEndpointRes, notFoundRes });
        }
    } catch (e) {
        console.error("❌ TEST P FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST Q — Sensitive user credentials are never exposed
    // ----------------------------------------------------
    try {
        if (!trafficReportC) throw new Error("Dependency Test C failed");
        const detailRes = await makeRequest(`/reports/${trafficReportC.reportId}`, 'GET', null, userToken);
        const report = detailRes.data.report || {};

        const hasPassword = 'password' in report || 'passwordHash' in report || 'hash' in report;
        if (!hasPassword) {
            console.log("✅ TEST Q PASSED: Report endpoint does not leak passwordHash or sensitive credentials.");
            passedTests++;
        } else {
            console.error("❌ TEST Q FAILED: Leaked sensitive field in report:", report);
        }
    } catch (e) {
        console.error("❌ TEST Q FAILED:", e.message);
    }

    console.log("\n==================================================");
    console.log(`  MODULE 11 TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
    console.log("==================================================");

    if (passedTests === totalTests) {
        console.log("🎉 ALL MODULE 11 TESTS PASSED SUCCESSFULLY!");
        process.exit(0);
    } else {
        console.error("⚠️ SOME MODULE 11 TESTS FAILED.");
        process.exit(1);
    }
}

runModule11Tests();
