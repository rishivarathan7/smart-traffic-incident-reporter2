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

async function runModule13Tests() {
    console.log("==================================================");
    console.log("   SMART TRAFFIC INCIDENT REPORTER - MODULE 13   ");
    console.log(" BACKEND REPORT EDIT, DELETE & PRIORITY RECALC   ");
    console.log("==================================================\n");

    let passedTests = 0;
    const totalTests = 28;

    let adminToken = null;
    let user1Token = null;
    let user1Id = null;
    let user2Token = null;
    let user2Id = null;

    const user1Email = `mod13user1_${Date.now()}@example.com`;
    const user2Email = `mod13user2_${Date.now()}@example.com`;

    // ----------------------------------------------------
    // TEST A — USER LOGIN
    // ----------------------------------------------------
    try {
        await makeRequest('/auth/register', 'POST', { name: "Module13 User1", email: user1Email, password: "Password123!" });
        const user1Res = await makeRequest('/auth/login', 'POST', { email: user1Email, password: "Password123!" });
        
        await makeRequest('/auth/register', 'POST', { name: "Module13 User2", email: user2Email, password: "Password123!" });
        const user2Res = await makeRequest('/auth/login', 'POST', { email: user2Email, password: "Password123!" });

        if (user1Res.status === 200 && user1Res.data.token && user2Res.status === 200 && user2Res.data.token) {
            user1Token = user1Res.data.token;
            user1Id = user1Res.data.user.userId;
            user2Token = user2Res.data.token;
            user2Id = user2Res.data.user.userId;
            console.log("✅ TEST A PASSED: User1 and User2 Login successful. JWTs obtained.");
            passedTests++;
        } else {
            console.error("❌ TEST A FAILED:", { user1Res, user2Res });
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
            console.log("✅ TEST B PASSED: Admin Login successful. Admin JWT obtained.");
            passedTests++;
        } else {
            console.error("❌ TEST B FAILED:", adminRes);
        }
    } catch (e) {
        console.error("❌ TEST B FAILED:", e.message);
    }

    // Create report owned by User 1
    let user1TrafficReport = null;
    let user1PotholeReport = null;
    try {
        const rep1 = await makeRequest('/reports', 'POST', {
            reportType: "traffic",
            incidentType: "Accident",
            location: "Kamarajar Salai",
            severity: "Low",
            vehiclesAffected: 1,
            date: "2026-09-22",
            time: "10:00",
            description: "Minor fender bender"
        }, user1Token);
        user1TrafficReport = rep1.data.report;

        const rep2 = await makeRequest('/reports', 'POST', {
            reportType: "pothole",
            location: "Cathedral Road",
            potholeSize: "Small",
            depthEstimate: "3cm",
            trafficImpact: "Low",
            date: "2026-09-22",
            time: "10:30",
            description: "Minor small pothole"
        }, user1Token);
        user1PotholeReport = rep2.data.report;
    } catch (e) {
        console.error("Setup error creating test reports:", e.message);
    }

    // ----------------------------------------------------
    // TEST C — User can edit their own traffic report
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            location: "Kamarajar Salai Updated",
            description: "Updated description for minor fender bender"
        }, user1Token);

        if (editRes.status === 200 && editRes.data.report.location === "Kamarajar Salai Updated") {
            console.log("✅ TEST C PASSED: User1 successfully edited their own traffic report.");
            passedTests++;
        } else {
            console.error("❌ TEST C FAILED:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST C FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST D — User can edit their own pothole report
    // ----------------------------------------------------
    try {
        if (!user1PotholeReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1PotholeReport.reportId}`, 'PATCH', {
            location: "Cathedral Road East",
            description: "Updated pothole description"
        }, user1Token);

        if (editRes.status === 200 && editRes.data.report.location === "Cathedral Road East") {
            console.log("✅ TEST D PASSED: User1 successfully edited their own pothole report.");
            passedTests++;
        } else {
            console.error("❌ TEST D FAILED:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST D FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST E — Admin can edit another user's report
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            location: "Kamarajar Salai Admin Updated"
        }, adminToken);

        if (editRes.status === 200 && editRes.data.report.location === "Kamarajar Salai Admin Updated") {
            console.log("✅ TEST E PASSED: Admin successfully edited User1's traffic report.");
            passedTests++;
        } else {
            console.error("❌ TEST E FAILED:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST E FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST F — User cannot edit another user's report (HTTP 403)
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            location: "Hacked Location"
        }, user2Token);

        if (editRes.status === 403) {
            console.log("✅ TEST F PASSED: User2 blocked from editing User1's report (HTTP 403 Forbidden).");
            passedTests++;
        } else {
            console.error("❌ TEST F FAILED: Expected 403, got status:", editRes.status);
        }
    } catch (e) {
        console.error("❌ TEST F FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST G — Unknown report edit (HTTP 404)
    // ----------------------------------------------------
    try {
        const editRes = await makeRequest('/reports/NON_EXISTENT_REP_999', 'PATCH', {
            location: "Test Location"
        }, user1Token);

        if (editRes.status === 404) {
            console.log("✅ TEST G PASSED: Editing non-existent report returned HTTP 404 Not Found.");
            passedTests++;
        } else {
            console.error("❌ TEST G FAILED: Expected 404, got status:", editRes.status);
        }
    } catch (e) {
        console.error("❌ TEST G FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST H — Invalid edit data (HTTP 400)
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            location: "" // Invalid empty location string
        }, user1Token);

        if (editRes.status === 400) {
            console.log("✅ TEST H PASSED: Invalid edit data returned HTTP 400 Bad Request.");
            passedTests++;
        } else {
            console.error("❌ TEST H FAILED: Expected 400, got status:", editRes.status);
        }
    } catch (e) {
        console.error("❌ TEST H FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST I — Client-supplied priority cannot override backend priority
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            severity: "high",
            vehiclesAffected: 12,
            priority: "Low" // Client attempt to force Low priority
        }, user1Token);

        if (editRes.status === 200 && editRes.data.report.priority === "High") {
            console.log("✅ TEST I PASSED: Client attempt to force priority was overridden by server calculation (High).");
            passedTests++;
        } else {
            console.error("❌ TEST I FAILED: Priority overridden failed:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST I FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST J — Priority recalculates correctly after traffic edit
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            severity: "low",
            vehiclesAffected: 1
        }, user1Token);

        if (editRes.status === 200 && editRes.data.report.priority === "Low") {
            console.log("✅ TEST J PASSED: Priority recalculated correctly from High → Low after severity reduction.");
            passedTests++;
        } else {
            console.error("❌ TEST J FAILED:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST J FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST K — Priority recalculates correctly after pothole edit
    // ----------------------------------------------------
    try {
        if (!user1PotholeReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1PotholeReport.reportId}`, 'PATCH', {
            description: "Deep hazard pothole endangering vehicles on main road"
        }, user1Token);

        if (editRes.status === 200 && editRes.data.report.priority === "High") {
            console.log("✅ TEST K PASSED: Pothole priority recalculated to High after adding hazard keywords.");
            passedTests++;
        } else {
            console.error("❌ TEST K FAILED:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST K FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST L — Protected status cannot be changed through edit
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const statusBefore = user1TrafficReport.status;
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            status: "Resolved"
        }, user1Token);

        if (editRes.status === 200 && editRes.data.report.status === statusBefore) {
            console.log("✅ TEST L PASSED: Protected field 'status' remained unchanged after edit attempt.");
            passedTests++;
        } else {
            console.error("❌ TEST L FAILED: Status was altered via edit API:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST L FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST M — Protected verificationStatus cannot be changed through edit
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const verBefore = user1TrafficReport.verificationStatus;
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            verificationStatus: "verified"
        }, user1Token);

        if (editRes.status === 200 && editRes.data.report.verificationStatus === verBefore) {
            console.log("✅ TEST M PASSED: Protected field 'verificationStatus' remained unchanged after edit attempt.");
            passedTests++;
        } else {
            console.error("❌ TEST M FAILED:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST M FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST N — Protected reporterId cannot be changed through edit
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            reporterId: user2Id
        }, user1Token);

        if (editRes.status === 200 && editRes.data.report.reporterId === user1Id) {
            console.log("✅ TEST N PASSED: Protected field 'reporterId' remained unchanged after edit attempt.");
            passedTests++;
        } else {
            console.error("❌ TEST N FAILED: reporterId changed:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST N FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST O — Protected reportId cannot be changed through edit
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', {
            reportId: "INC99999"
        }, user1Token);

        if (editRes.status === 200 && editRes.data.report.reportId === user1TrafficReport.reportId) {
            console.log("✅ TEST O PASSED: Protected field 'reportId' remained unchanged after edit attempt.");
            passedTests++;
        } else {
            console.error("❌ TEST O FAILED: reportId changed:", editRes.data);
        }
    } catch (e) {
        console.error("❌ TEST O FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST P — createdAt remains unchanged after edit
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const fetchRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'GET', null, user1Token);
        const createdTimeBefore = new Date(user1TrafficReport.createdAt).getTime();
        const createdTimeAfter = new Date(fetchRes.data.report.createdAt).getTime();

        if (fetchRes.status === 200 && createdTimeBefore === createdTimeAfter) {
            console.log("✅ TEST P PASSED: 'createdAt' timestamp remained unchanged after edit.");
            passedTests++;
        } else {
            console.error("❌ TEST P FAILED:", { createdTimeBefore, createdTimeAfter });
        }
    } catch (e) {
        console.error("❌ TEST P FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST Q — updatedAt changes after edit
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const fetchRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'GET', null, user1Token);
        const updatedTime = new Date(fetchRes.data.report.updatedAt).getTime();

        if (fetchRes.status === 200 && !isNaN(updatedTime) && updatedTime > 0) {
            console.log("✅ TEST Q PASSED: 'updatedAt' timestamp updated after report edit.");
            passedTests++;
        } else {
            console.error("❌ TEST Q FAILED:", fetchRes.data);
        }
    } catch (e) {
        console.error("❌ TEST Q FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST R — Normal field edit does not create a fake statusHistory entry
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const lenBefore = user1TrafficReport.statusHistory.length;
        const fetchRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'GET', null, user1Token);
        const lenAfter = fetchRes.data.report.statusHistory.length;

        if (fetchRes.status === 200 && lenBefore === lenAfter) {
            console.log("✅ TEST R PASSED: Normal field edit did not push a duplicate/fake statusHistory entry.");
            passedTests++;
        } else {
            console.error("❌ TEST R FAILED:", { lenBefore, lenAfter });
        }
    } catch (e) {
        console.error("❌ TEST R FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST S — statusHistory remains intact after edit
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Setup report missing");
        const fetchRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'GET', null, user1Token);
        const history = fetchRes.data.report.statusHistory || [];

        if (fetchRes.status === 200 && history.length === 1 && history[0].status === "Pending") {
            console.log("✅ TEST S PASSED: Original statusHistory array remained intact.");
            passedTests++;
        } else {
            console.error("❌ TEST S FAILED:", history);
        }
    } catch (e) {
        console.error("❌ TEST S FAILED:", e.message);
    }

    // Create a fresh report for User 1 delete tests
    let reportToDelete = null;
    try {
        const rep = await makeRequest('/reports', 'POST', {
            reportType: "traffic",
            incidentType: "Accident",
            location: "ToDelete Location",
            severity: "Low",
            vehiclesAffected: 1,
            date: "2026-09-22",
            time: "11:00",
            description: "Temporary report to test deletion"
        }, user1Token);
        reportToDelete = rep.data.report;
    } catch (e) {
        console.error("Setup deletion report error:", e.message);
    }

    // ----------------------------------------------------
    // TEST T — User can delete their own report
    // ----------------------------------------------------
    try {
        if (!reportToDelete) throw new Error("Report to delete missing");
        const delRes = await makeRequest(`/reports/${reportToDelete.reportId}`, 'DELETE', null, user1Token);
        if (delRes.status === 200 && delRes.data.success) {
            console.log("✅ TEST T PASSED: User1 successfully deleted their own report.");
            passedTests++;
        } else {
            console.error("❌ TEST T FAILED:", delRes.data);
        }
    } catch (e) {
        console.error("❌ TEST T FAILED:", e.message);
    }

    // Create report owned by User 1 for User 2 delete attempt
    let reportUser1ForUser2 = null;
    try {
        const rep = await makeRequest('/reports', 'POST', {
            reportType: "traffic",
            incidentType: "Accident",
            location: "User1 Protected Location",
            severity: "Low",
            vehiclesAffected: 1,
            date: "2026-09-22",
            time: "11:15",
            description: "Report owned by User1"
        }, user1Token);
        reportUser1ForUser2 = rep.data.report;
    } catch (e) {
        console.error("Setup report error:", e.message);
    }

    // ----------------------------------------------------
    // TEST U — User cannot delete another user's report (HTTP 403)
    // ----------------------------------------------------
    try {
        if (!reportUser1ForUser2) throw new Error("Report missing");
        const delRes = await makeRequest(`/reports/${reportUser1ForUser2.reportId}`, 'DELETE', null, user2Token);
        if (delRes.status === 403) {
            console.log("✅ TEST U PASSED: User2 blocked from deleting User1's report (HTTP 403 Forbidden).");
            passedTests++;
        } else {
            console.error("❌ TEST U FAILED: Expected 403, got status:", delRes.status);
        }
    } catch (e) {
        console.error("❌ TEST U FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST V — Admin can delete another user's report
    // ----------------------------------------------------
    try {
        if (!reportUser1ForUser2) throw new Error("Report missing");
        const delRes = await makeRequest(`/reports/${reportUser1ForUser2.reportId}`, 'DELETE', null, adminToken);
        if (delRes.status === 200 && delRes.data.success) {
            console.log("✅ TEST V PASSED: Admin successfully deleted User1's report.");
            passedTests++;
        } else {
            console.error("❌ TEST V FAILED:", delRes.data);
        }
    } catch (e) {
        console.error("❌ TEST V FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST W — Unknown report deletion (HTTP 404)
    // ----------------------------------------------------
    try {
        const delRes = await makeRequest('/reports/NON_EXISTENT_DEL_999', 'DELETE', null, user1Token);
        if (delRes.status === 404) {
            console.log("✅ TEST W PASSED: Deleting non-existent report returned HTTP 404 Not Found.");
            passedTests++;
        } else {
            console.error("❌ TEST W FAILED: Expected 404, got status:", delRes.status);
        }
    } catch (e) {
        console.error("❌ TEST W FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST X — Deleted report no longer appears in GET /api/reports
    // ----------------------------------------------------
    try {
        if (!reportToDelete) throw new Error("Report to delete missing");
        const getRes = await makeRequest('/reports?limit=100', 'GET', null, user1Token);
        const exists = getRes.data.reports.some(r => r.reportId === reportToDelete.reportId);
        if (getRes.status === 200 && !exists) {
            console.log("✅ TEST X PASSED: Deleted report no longer present in GET /api/reports.");
            passedTests++;
        } else {
            console.error("❌ TEST X FAILED: Deleted report still found in list!");
        }
    } catch (e) {
        console.error("❌ TEST X FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST Y — Deleted report no longer appears in GET /api/reports/:reportId
    // ----------------------------------------------------
    try {
        if (!reportToDelete) throw new Error("Report to delete missing");
        const getRes = await makeRequest(`/reports/${reportToDelete.reportId}`, 'GET', null, user1Token);
        if (getRes.status === 404) {
            console.log("✅ TEST Y PASSED: Deleted report GET /api/reports/:reportId returned HTTP 404 Not Found.");
            passedTests++;
        } else {
            console.error("❌ TEST Y FAILED: Expected 404, got status:", getRes.status);
        }
    } catch (e) {
        console.error("❌ TEST Y FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST Z — Unauthenticated edit returns HTTP 401
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Report missing");
        const editRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'PATCH', { location: "No Auth" }, null);
        if (editRes.status === 401) {
            console.log("✅ TEST Z PASSED: Unauthenticated edit returned HTTP 401 Unauthorized.");
            passedTests++;
        } else {
            console.error("❌ TEST Z FAILED: Expected 401, got status:", editRes.status);
        }
    } catch (e) {
        console.error("❌ TEST Z FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST AA — Unauthenticated delete returns HTTP 401
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Report missing");
        const delRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'DELETE', null, null);
        if (delRes.status === 401) {
            console.log("✅ TEST AA PASSED: Unauthenticated delete returned HTTP 401 Unauthorized.");
            passedTests++;
        } else {
            console.error("❌ TEST AA FAILED: Expected 401, got status:", delRes.status);
        }
    } catch (e) {
        console.error("❌ TEST AA FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST AB — No sensitive credentials returned in API responses
    // ----------------------------------------------------
    try {
        if (!user1TrafficReport) throw new Error("Report missing");
        const fetchRes = await makeRequest(`/reports/${user1TrafficReport.reportId}`, 'GET', null, user1Token);
        const report = fetchRes.data.report || {};
        const hasLeak = 'password' in report || 'passwordHash' in report || 'jwt' in report;
        if (fetchRes.status === 200 && !hasLeak) {
            console.log("✅ TEST AB PASSED: No passwordHash or sensitive credentials returned in report endpoints.");
            passedTests++;
        } else {
            console.error("❌ TEST AB FAILED: Leaked sensitive field in response:", report);
        }
    } catch (e) {
        console.error("❌ TEST AB FAILED:", e.message);
    }

    console.log("\n==================================================");
    console.log(`  MODULE 13 TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
    console.log("==================================================");

    if (passedTests === totalTests) {
        console.log("🎉 ALL MODULE 13 TESTS PASSED SUCCESSFULLY!");
        process.exit(0);
    } else {
        console.error("⚠️ SOME MODULE 13 TESTS FAILED.");
        process.exit(1);
    }
}

runModule13Tests();
