/* ==========================================================================
   MODULE 17 TEST SUITE — MONGODB CHANGE STREAMS FOR REALTIME EVENTS
   ========================================================================== */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { io: ioClient } = require('socket.io-client');

const BASE_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function runTests() {
    console.log("==================================================");
    console.log("  RUNNING MODULE 17 TEST SUITE (TEST A - TEST Q)");
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

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    const timestamp = Date.now();
    const userEmail = `mod17_user_${timestamp}@example.com`;
    const userPassword = `Pass123!_${timestamp}`;

    let userToken = null;
    let adminToken = null;
    let createdReportId = null;

    try {
        // TEST A: Change Stream module exists
        console.log("--- TEST A: Change Stream Module Existence ---");
        const changeStreamPath = path.join(__dirname, 'changeStream.js');
        const changeStreamExists = fs.existsSync(changeStreamPath);
        assert(changeStreamExists, "backend/changeStream.js file exists");

        // TEST B: Backend syntax is valid
        console.log("\n--- TEST B: Backend Syntax Validation ---");
        let syntaxValid = true;
        try {
            execSync('node --check backend/changeStream.js', { cwd: path.join(__dirname, '..') });
            execSync('node --check backend/server.js', { cwd: path.join(__dirname, '..') });
        } catch (err) {
            syntaxValid = false;
        }
        assert(syntaxValid, "Syntax check passed for backend/changeStream.js and backend/server.js");

        // TEST C: MongoDB connection still works
        console.log("\n--- TEST C: MongoDB Connection Check ---");
        const healthDbRes = await fetch(`${BASE_URL}/health/db`);
        const healthDbData = await healthDbRes.json();
        assert(healthDbRes.ok && healthDbData.success, "MongoDB connection active and health/db endpoint returns healthy");

        // TEST D: Change Stream starts successfully
        console.log("\n--- TEST D: Change Stream Status ---");
        const csHealthRes = await fetch(`${BASE_URL}/health/change-stream`);
        const csHealthData = await csHealthRes.json();
        assert(csHealthRes.ok && csHealthData.success && csHealthData.isChangeStreamRunning, "MongoDB Change Stream is actively running on backend server");

        // Setup User & Admin logins for REST and Socket testing
        console.log("\n--- SETUP: Authenticate User & Admin ---");
        await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Module17 Tester', email: userEmail, password: userPassword })
        });

        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail, password: userPassword })
        });
        const loginData = await loginRes.json();
        userToken = loginData.token;

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@smarttraffic.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'AdminSecurePassword123';
        const adminLoginRes = await fetch(`${BASE_URL}/auth/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: adminEmail, password: adminPassword })
        });
        const adminLoginData = await adminLoginRes.json();
        adminToken = adminLoginData.token;

        assert(userToken && adminToken, "User and Admin JWT tokens obtained for REST API testing");

        // TEST N & O: Socket.IO JWT Authentication & Rejection
        console.log("\n--- TEST N & O: Socket.IO Authentication & Unauthenticated Rejection ---");
        let unauthRejected = false;
        await new Promise((resolve) => {
            const badSocket = ioClient(SOCKET_URL, {
                reconnection: false,
                timeout: 2000
            });
            badSocket.on('connect_error', (err) => {
                unauthRejected = true;
                badSocket.close();
                resolve();
            });
            badSocket.on('connect', () => {
                badSocket.close();
                resolve();
            });
        });
        assert(unauthRejected, "Unauthenticated socket connection rejected");

        let authConnected = false;
        const socket = ioClient(SOCKET_URL, {
            auth: { token: userToken },
            reconnection: false,
            timeout: 3000
        });

        await new Promise((resolve, reject) => {
            socket.on('connect', () => {
                authConnected = true;
                resolve();
            });
            socket.on('connect_error', (err) => {
                reject(err);
            });
        });
        assert(authConnected, "Authenticated socket connection established using JWT token");

        // Helper event recorder
        const recordedEvents = [];
        const trackEvent = (name) => {
            socket.on(name, (data) => {
                recordedEvents.push({ name, data, time: Date.now() });
            });
        };

        const eventNames = [
            "report:created",
            "report:updated",
            "report:deleted",
            "report:verification-updated",
            "report:status-updated",
            "dashboard:refresh"
        ];
        eventNames.forEach(trackEvent);

        function getEventsSince(startIndex) {
            return recordedEvents.slice(startIndex);
        }

        // TEST E, H, L, M: INSERT Operation & report:created, dashboard:refresh
        console.log("\n--- TEST E, H, L, M: INSERT Operation via REST & Change Stream Event Emission ---");
        const insertStartIndex = recordedEvents.length;
        const createRes = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                reportType: 'traffic',
                incidentType: 'Accident',
                location: 'Mod17 ChangeStream Highway',
                severity: 'high',
                vehiclesAffected: 2,
                date: '2026-09-28',
                time: '14:00',
                description: 'Module 17 Change Stream Test Incident'
            })
        });

        const createData = await createRes.json();
        assert(createRes.ok && createData.success, "REST API successfully created incident report");
        createdReportId = createData.report.reportId;

        // Wait for change stream to catch write and emit realtime event
        await sleep(1000);

        const insertEvents = getEventsSince(insertStartIndex);
        const createdEvents = insertEvents.filter(e => e.name === "report:created");
        const refreshEvents = insertEvents.filter(e => e.name === "dashboard:refresh");

        assert(createdEvents.length === 1, "Change Stream detected INSERT and emitted exactly ONE 'report:created' event");
        assert(refreshEvents.length === 1, "Change Stream emitted exactly ONE 'dashboard:refresh' event for report creation");
        if (createdEvents.length > 0) {
            assert(createdEvents[0].data.reportId === createdReportId, "report:created event payload contains correct reportId");
            assert(createdEvents[0].data.reportType === 'traffic', "report:created event payload contains correct reportType");
        }

        // TEST J & M: Verification Status Update via REST & Change Stream
        console.log("\n--- TEST J & M: Verification Status UPDATE via Change Stream ---");
        const verifyStartIndex = recordedEvents.length;
        const verifyRes = await fetch(`${BASE_URL}/admin/reports/${createdReportId}/verify`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });
        const verifyData = await verifyRes.json();
        assert(verifyRes.ok && verifyData.success, "REST API successfully verified report");

        await sleep(1000);

        const verifyEvents = getEventsSince(verifyStartIndex);
        const verificationUpdatedEvents = verifyEvents.filter(e => e.name === "report:verification-updated");
        const otherReportEvents = verifyEvents.filter(e => e.name !== "report:verification-updated" && e.name !== "dashboard:refresh");

        assert(verificationUpdatedEvents.length === 1, "Change Stream detected verification update and emitted exactly ONE 'report:verification-updated' event");
        assert(otherReportEvents.length === 0, "No duplicate/extraneous report events emitted during verification update");
        if (verificationUpdatedEvents.length > 0) {
            assert(verificationUpdatedEvents[0].data.reportId === createdReportId, "report:verification-updated payload has correct reportId");
            assert(verificationUpdatedEvents[0].data.verificationStatus === 'verified', "report:verification-updated payload has correct status ('verified')");
        }

        // TEST J & M: Incident Status Update via REST & Change Stream
        console.log("\n--- TEST J & M: Status UPDATE via Change Stream ---");
        const statusStartIndex = recordedEvents.length;
        const statusRes = await fetch(`${BASE_URL}/admin/reports/${createdReportId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({ status: 'In Progress' })
        });
        const statusData = await statusRes.json();
        assert(statusRes.ok && statusData.success, "REST API successfully updated status to In Progress");

        await sleep(1000);

        const statusEvents = getEventsSince(statusStartIndex);
        const statusUpdatedEvents = statusEvents.filter(e => e.name === "report:status-updated");
        const extraneousStatusEvents = statusEvents.filter(e => e.name !== "report:status-updated" && e.name !== "dashboard:refresh");

        assert(statusUpdatedEvents.length === 1, "Change Stream detected status update and emitted exactly ONE 'report:status-updated' event");
        assert(extraneousStatusEvents.length === 0, "No duplicate/extraneous report events emitted during status update");
        if (statusUpdatedEvents.length > 0) {
            assert(statusUpdatedEvents[0].data.reportId === createdReportId, "report:status-updated payload has correct reportId");
            assert(statusUpdatedEvents[0].data.status === 'In Progress', "report:status-updated payload has correct status ('In Progress')");
        }

        // TEST F, K, M: Ordinary Edit (UPDATE) via REST & Change Stream
        console.log("\n--- TEST F, K, M: Ordinary Report Edit (UPDATE) via Change Stream ---");
        const editStartIndex = recordedEvents.length;
        const editRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                description: 'Module 17 Updated Description Text'
            })
        });
        const editData = await editRes.json();
        assert(editRes.ok && editData.success, "REST API successfully updated report description");

        await sleep(1000);

        const editEvents = getEventsSince(editStartIndex);
        const updatedEvents = editEvents.filter(e => e.name === "report:updated");
        const extraneousEditEvents = editEvents.filter(e => e.name !== "report:updated" && e.name !== "dashboard:refresh");

        assert(updatedEvents.length === 1, "Change Stream detected ordinary edit and emitted exactly ONE 'report:updated' event");
        assert(extraneousEditEvents.length === 0, "No duplicate/extraneous report events emitted during ordinary report edit");
        if (updatedEvents.length > 0) {
            assert(updatedEvents[0].data.reportId === createdReportId, "report:updated payload has correct reportId");
        }

        // TEST G, I, L, M: DELETE Operation & report:deleted, dashboard:refresh
        console.log("\n--- TEST G, I, L, M: DELETE Operation via REST & Change Stream ---");
        const deleteStartIndex = recordedEvents.length;
        const deleteRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${userToken}`
            }
        });
        const deleteData = await deleteRes.json();
        assert(deleteRes.ok && deleteData.success, "REST API successfully deleted report");

        await sleep(1000);

        const deleteEvents = getEventsSince(deleteStartIndex);
        const deletedEvents = deleteEvents.filter(e => e.name === "report:deleted");
        const deleteRefreshEvents = deleteEvents.filter(e => e.name === "dashboard:refresh");

        assert(deletedEvents.length === 1, "Change Stream detected DELETE and emitted exactly ONE 'report:deleted' event");
        assert(deleteRefreshEvents.length === 1, "Change Stream emitted exactly ONE 'dashboard:refresh' event for report deletion");
        if (deletedEvents.length > 0) {
            assert(deletedEvents[0].data.reportId === createdReportId, "report:deleted payload contains correct reportId");
            assert(deletedEvents[0].data.reportType === 'traffic', "report:deleted payload contains correct reportType");
        }

        // TEST P: Existing REST APIs continue to work
        console.log("\n--- TEST P: Existing REST APIs Verification ---");
        const reportsListRes = await fetch(`${BASE_URL}/reports`, {
            headers: { 'Authorization': `Bearer ${userToken}` }
        });
        const reportsListData = await reportsListRes.json();
        assert(reportsListRes.ok && Array.isArray(reportsListData.reports), "GET /api/reports responds successfully");

        const statsRes = await fetch(`${BASE_URL}/dashboard/stats`, {
            headers: { 'Authorization': `Bearer ${userToken}` }
        });
        const statsData = await statsRes.json();
        assert(statsRes.ok && statsData.success, "GET /api/dashboard/stats responds successfully");

        // TEST Q: Existing frontend event names remain compatible
        console.log("\n--- TEST Q: Frontend Event Compatibility Verification ---");
        const frontendScript = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
        const listensCreated = frontendScript.includes('report:created');
        const listensUpdated = frontendScript.includes('report:updated');
        const listensDeleted = frontendScript.includes('report:deleted');
        const listensVerif = frontendScript.includes('report:verification-updated');
        const listensStatus = frontendScript.includes('report:status-updated');
        const listensRefresh = frontendScript.includes('dashboard:refresh');

        assert(
            listensCreated && listensUpdated && listensDeleted && listensVerif && listensStatus && listensRefresh,
            "Frontend script (script.js) event listeners for all 6 Socket.IO events are present and unchanged"
        );

        socket.close();

    } catch (err) {
        console.error("Test execution error:", err);
        failed++;
    }

    console.log("\n==================================================");
    console.log(`  MODULE 17 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests();
