/* ==========================================================================
   MODULE 15 TEST SUITE — DASHBOARD STATISTICS & ANALYTICS API
   ========================================================================== */

const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
    console.log("==================================================");
    console.log("  RUNNING MODULE 15 TEST SUITE (TEST A - TEST S)");
    console.log("==================================================\n");

    let passed = 0;
    let failed = 0;

    function assert(condition, message, details = '') {
        if (condition) {
            console.log(`  ✅ PASS: ${message}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${message} ${details ? `(${details})` : ''}`);
            failed++;
        }
    }

    const timestamp = Date.now();
    const userEmail = `mod15_user_${timestamp}@example.com`;
    const userPassword = `Pass123!_${timestamp}`;

    let userToken = null;
    let adminToken = null;
    let createdReportIds = [];

    try {
        // Setup: Register and Login normal user
        console.log("--- SETUP: Register and Login Normal User & Admin ---");
        const regRes = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Module15 User', email: userEmail, password: userPassword })
        });
        const regData = await regRes.json();
        assert(regRes.ok && regData.success, "Normal user registered successfully");

        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail, password: userPassword })
        });
        const loginData = await loginRes.json();
        assert(loginRes.ok && loginData.success && loginData.token, "Normal user logged in successfully");
        userToken = loginData.token;

        // Admin login (using default admin credentials)
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@smarttraffic.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'AdminSecurePassword123';
        const adminLoginRes = await fetch(`${BASE_URL}/auth/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: adminEmail, password: adminPassword })
        });
        const adminLoginData = await adminLoginRes.json();
        assert(adminLoginRes.ok && adminLoginData.success && adminLoginData.token, "Admin user logged in successfully");
        adminToken = adminLoginData.token;

        // TEST A: Missing token → 401
        console.log("\n--- TEST A: Missing Token Authentication ---");
        const resA = await fetch(`${BASE_URL}/dashboard/stats`);
        const dataA = await resA.json();
        assert(resA.status === 401 && !dataA.success, "Missing token returns HTTP 401 Unauthorized");

        // TEST B: Invalid token → 401
        console.log("\n--- TEST B: Invalid Token Authentication ---");
        const resB = await fetch(`${BASE_URL}/dashboard/stats`, {
            headers: { 'Authorization': 'Bearer invalid_jwt_token_12345' }
        });
        const dataB = await resB.json();
        assert(resB.status === 401 && !dataB.success, "Invalid token returns HTTP 401 Unauthorized");

        // TEST C: Normal authenticated user → 200
        console.log("\n--- TEST C: Normal Authenticated User Access ---");
        const resC = await fetch(`${BASE_URL}/dashboard/stats`, {
            headers: { 'Authorization': `Bearer ${userToken}` }
        });
        const dataC = await resC.json();
        assert(resC.status === 200 && dataC.success && dataC.stats, "Normal user successfully receives statistics (200)");

        // TEST D: Admin authenticated user → 200
        console.log("\n--- TEST D: Admin Authenticated User Access ---");
        const resD = await fetch(`${BASE_URL}/dashboard/stats`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const dataD = await resD.json();
        assert(resD.status === 200 && dataD.success && dataD.stats, "Admin user successfully receives statistics (200)");

        // Save baseline statistics
        const baselineStats = dataC.stats;

        // Create 4 test reports for controlled statistics verification
        console.log("\n--- SETUP: Creating Controlled Test Reports ---");

        // 1. Traffic, High Priority, Pending
        const rep1Res = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                reportType: 'traffic',
                incidentType: 'Accident',
                location: 'Test Location Mod15 A',
                severity: 'high',
                vehiclesAffected: 5,
                date: '2026-09-26',
                time: '10:00',
                description: 'Module 15 Test Report 1 High Priority Pending'
            })
        });
        const rep1Data = await rep1Res.json();
        if (rep1Data.success && rep1Data.report) createdReportIds.push(rep1Data.report.reportId);

        // 2. Traffic, Medium Priority, Verified
        const rep2Res = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                reportType: 'traffic',
                incidentType: 'Traffic Jam',
                location: 'Test Location Mod15 B',
                severity: 'medium',
                vehiclesAffected: 3,
                date: '2026-09-26',
                time: '11:00',
                description: 'Module 15 Test Report 2 Medium Priority Verified'
            })
        });
        const rep2Data = await rep2Res.json();
        if (rep2Data.success && rep2Data.report) {
            createdReportIds.push(rep2Data.report.reportId);
            // Verify via Admin
            await fetch(`${BASE_URL}/admin/reports/${rep2Data.report.reportId}/verify`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
        }

        // 3. Pothole, Low Priority, False Report
        const rep3Res = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                reportType: 'pothole',
                location: 'Test Location Mod15 C',
                date: '2026-09-26',
                time: '12:00',
                description: 'small minor pothole'
            })
        });
        const rep3Data = await rep3Res.json();
        if (rep3Data.success && rep3Data.report) {
            createdReportIds.push(rep3Data.report.reportId);
            // Reject via Admin
            await fetch(`${BASE_URL}/admin/reports/${rep3Data.report.reportId}/reject`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
        }

        // 4. Pothole, High Priority, Corrected
        const rep4Res = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                reportType: 'pothole',
                location: 'Test Location Mod15 D',
                date: '2026-09-26',
                time: '13:00',
                description: 'severe deep hazard major pothole'
            })
        });
        const rep4Data = await rep4Res.json();
        if (rep4Data.success && rep4Data.report) {
            createdReportIds.push(rep4Data.report.reportId);
            // Verify -> Correction in Progress -> Corrected
            await fetch(`${BASE_URL}/admin/reports/${rep4Data.report.reportId}/verify`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            await fetch(`${BASE_URL}/admin/reports/${rep4Data.report.reportId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify({ status: 'Correction in Progress' })
            });
            await fetch(`${BASE_URL}/admin/reports/${rep4Data.report.reportId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify({ status: 'Corrected' })
            });
        }

        // Fetch updated stats after adding 4 reports
        const updatedRes = await fetch(`${BASE_URL}/dashboard/stats`, {
            headers: { 'Authorization': `Bearer ${userToken}` }
        });
        const updatedData = await updatedRes.json();
        const newStats = updatedData.stats;

        // TEST E: totalReports is correct
        console.log("\n--- TEST E: totalReports Calculation ---");
        assert(newStats.totalReports === baselineStats.totalReports + 4, `totalReports updated accurately (${newStats.totalReports})`);

        // TEST F: trafficReports is correct
        console.log("\n--- TEST F: trafficReports Calculation ---");
        assert(newStats.trafficReports === baselineStats.trafficReports + 2, `trafficReports updated accurately (${newStats.trafficReports})`);

        // TEST G: potholeReports is correct
        console.log("\n--- TEST G: potholeReports Calculation ---");
        assert(newStats.potholeReports === baselineStats.potholeReports + 2, `potholeReports updated accurately (${newStats.potholeReports})`);

        // TEST H: pendingReports is correct
        console.log("\n--- TEST H: pendingReports Calculation ---");
        assert(newStats.pendingReports === baselineStats.pendingReports + 1, `pendingReports updated accurately (${newStats.pendingReports})`);

        // TEST I: verifiedReports is correct
        console.log("\n--- TEST I: verifiedReports Calculation ---");
        assert(newStats.verifiedReports === baselineStats.verifiedReports + 2, `verifiedReports updated accurately (${newStats.verifiedReports})`);

        // TEST J: falseReports is correct
        console.log("\n--- TEST J: falseReports Calculation ---");
        assert(newStats.falseReports === baselineStats.falseReports + 1, `falseReports updated accurately (${newStats.falseReports})`);

        // TEST K: priority counts are correct
        console.log("\n--- TEST K: Priority Counts Breakdown ---");
        assert(
            newStats.highPriorityReports === baselineStats.highPriorityReports + 2 &&
            newStats.mediumPriorityReports === baselineStats.mediumPriorityReports + 1 &&
            newStats.lowPriorityReports === baselineStats.lowPriorityReports + 1 &&
            newStats.byPriority.high === baselineStats.byPriority.high + 2 &&
            newStats.byPriority.medium === baselineStats.byPriority.medium + 1 &&
            newStats.byPriority.low === baselineStats.byPriority.low + 1,
            "Priority counts (high, medium, low) calculated correctly"
        );

        // TEST L: report type counts are correct
        console.log("\n--- TEST L: Report Type Breakdown ---");
        assert(
            newStats.byReportType.traffic === baselineStats.byReportType.traffic + 2 &&
            newStats.byReportType.pothole === baselineStats.byReportType.pothole + 2,
            "byReportType breakdown (traffic, pothole) calculated correctly"
        );

        // TEST M: status counts are correct
        console.log("\n--- TEST M: Status Counts Breakdown ---");
        assert(
            newStats.byStatus['Pending'] === baselineStats.byStatus['Pending'] + 1 &&
            newStats.byStatus['Verified'] === baselineStats.byStatus['Verified'] + 1 &&
            newStats.byStatus['False Report'] === baselineStats.byStatus['False Report'] + 1 &&
            newStats.byStatus['Corrected'] === baselineStats.byStatus['Corrected'] + 1,
            "byStatus breakdown matching workflow statuses calculated correctly"
        );

        // TEST N: todayReports is correct
        console.log("\n--- TEST N: todayReports Calculation ---");
        assert(newStats.todayReports >= 4, `todayReports correctly tracks today created reports (${newStats.todayReports})`);

        // TEST O: recentReports maximum is 5
        console.log("\n--- TEST O: recentReports Maximum Cap ---");
        assert(Array.isArray(newStats.recentReports) && newStats.recentReports.length <= 5, `recentReports capped at maximum 5 items (actual: ${newStats.recentReports.length})`);

        // TEST P: recentReports sorted newest first
        console.log("\n--- TEST P: recentReports Sorting Order ---");
        let isSortedNewestFirst = true;
        for (let i = 0; i < newStats.recentReports.length - 1; i++) {
            const timeCurrent = new Date(newStats.recentReports[i].createdAt).getTime();
            const timeNext = new Date(newStats.recentReports[i + 1].createdAt).getTime();
            if (!isNaN(timeCurrent) && !isNaN(timeNext) && timeCurrent < timeNext) {
                isSortedNewestFirst = false;
                break;
            }
        }
        assert(isSortedNewestFirst, "recentReports are ordered newest first");

        // TEST Q: Empty database zero handling
        console.log("\n--- TEST Q: Zero Counts Structure Validation ---");
        assert(
            typeof newStats.totalReports === 'number' &&
            typeof newStats.trafficReports === 'number' &&
            typeof newStats.potholeReports === 'number' &&
            typeof newStats.pendingReports === 'number' &&
            typeof newStats.verifiedReports === 'number' &&
            typeof newStats.falseReports === 'number' &&
            typeof newStats.inProgressReports === 'number' &&
            typeof newStats.resolvedReports === 'number' &&
            typeof newStats.correctedReports === 'number',
            "All metric counts return clean numeric values"
        );

        // TEST R: Response does not expose passwordHash
        console.log("\n--- TEST R: Security - Exclude passwordHash ---");
        const jsonStr = JSON.stringify(updatedData);
        assert(!jsonStr.includes('passwordHash') && !jsonStr.includes('password'), "Response payload contains no passwordHash or password field");

        // TEST S: Response does not expose credentials/secrets
        console.log("\n--- TEST S: Security - Exclude Secrets & Database Credentials ---");
        const hasSecrets = jsonStr.includes('JWT_SECRET') ||
            jsonStr.includes('mongodb+srv') ||
            jsonStr.includes('AdminSecurePassword') ||
            jsonStr.includes('ADMIN_PASSWORD');
        assert(!hasSecrets, "Response payload does not leak JWT secrets or MongoDB credentials");

    } catch (err) {
        console.error("Test execution error:", err);
        failed++;
    } finally {
        // Cleanup created test reports
        console.log("\n--- CLEANUP: Deleting Test Data ---");
        for (const rId of createdReportIds) {
            try {
                await fetch(`${BASE_URL}/reports/${rId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });
            } catch (e) {}
        }
        console.log(`Cleaned up ${createdReportIds.length} test reports.`);

        console.log("\n==================================================");
        console.log(`  MODULE 15 TEST SUMMARY`);
        console.log(`  Passed: ${passed}`);
        console.log(`  Failed: ${failed}`);
        console.log("==================================================\n");

        if (failed > 0) {
            process.exit(1);
        }
    }
}

runTests();
