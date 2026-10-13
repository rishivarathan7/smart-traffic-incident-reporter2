/* ==========================================================================
   MODULE 16 TEST SUITE — REAL-TIME UPDATES USING SOCKET.IO
   ========================================================================== */

const path = require('path');
const fs = require('fs');
const { io: ioClient } = require('socket.io-client');

const BASE_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function runTests() {
    console.log("==================================================");
    console.log("  RUNNING MODULE 16 TEST SUITE (TEST A - TEST U)");
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

    function waitForEvent(socket, eventName, timeoutMs = 3000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for event '${eventName}'`));
            }, timeoutMs);

            socket.once(eventName, (data) => {
                clearTimeout(timer);
                resolve(data);
            });
        });
    }

    const timestamp = Date.now();
    const userEmail = `mod16_user_${timestamp}@example.com`;
    const userPassword = `Pass123!_${timestamp}`;

    let userToken = null;
    let adminToken = null;
    let createdReportId = null;

    try {
        // TEST A: Socket.IO package is installed
        console.log("--- TEST A: Socket.IO Package Installation ---");
        let hasSocketIO = false;
        try {
            require('socket.io');
            require('socket.io-client');
            hasSocketIO = true;
        } catch (e) {}
        assert(hasSocketIO, "socket.io & socket.io-client packages are installed");

        // TEST B: HTTP server starts successfully & TEST C: Socket.IO server initializes
        console.log("\n--- TEST B & C: HTTP & Socket.IO Server Availability ---");
        const healthRes = await fetch(`${BASE_URL}/health`);
        const healthData = await healthRes.json();
        assert(healthRes.ok && healthData.success, "HTTP server & REST API responding (200)");

        // Setup User & Admin logins
        console.log("\n--- SETUP: Authenticate User & Admin ---");
        const regRes = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Module16 Tester', email: userEmail, password: userPassword })
        });
        const regData = await regRes.json();

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

        assert(userToken && adminToken, "User and Admin JWT tokens obtained");

        // TEST D: Missing socket token is rejected
        console.log("\n--- TEST D: Missing Socket Token Rejection ---");
        let missingTokenRejected = false;
        await new Promise((resolve) => {
            const sock = ioClient(SOCKET_URL, {
                reconnection: false,
                timeout: 2000
            });
            sock.on('connect_error', (err) => {
                missingTokenRejected = true;
                sock.disconnect();
                resolve();
            });
            sock.on('connect', () => {
                sock.disconnect();
                resolve();
            });
        });
        assert(missingTokenRejected, "Connection with missing token was rejected");

        // TEST E: Invalid socket token is rejected
        console.log("\n--- TEST E: Invalid Socket Token Rejection ---");
        let invalidTokenRejected = false;
        await new Promise((resolve) => {
            const sock = ioClient(SOCKET_URL, {
                auth: { token: 'invalid_token_xyz_999' },
                reconnection: false,
                timeout: 2000
            });
            sock.on('connect_error', (err) => {
                invalidTokenRejected = true;
                sock.disconnect();
                resolve();
            });
            sock.on('connect', () => {
                sock.disconnect();
                resolve();
            });
        });
        assert(invalidTokenRejected, "Connection with invalid token was rejected");

        // TEST F: Valid normal-user JWT can establish socket connection
        console.log("\n--- TEST F: Valid Normal User Socket Connection ---");
        let userSocketConnected = false;
        const userSocket = ioClient(SOCKET_URL, {
            auth: { token: userToken },
            reconnection: false
        });
        await new Promise((resolve) => {
            userSocket.on('connect', () => {
                userSocketConnected = true;
                resolve();
            });
            userSocket.on('connect_error', (e) => resolve());
        });
        assert(userSocketConnected, "Normal user socket established connection successfully");

        // TEST G: Valid admin JWT can establish socket connection
        console.log("\n--- TEST G: Valid Admin Socket Connection ---");
        let adminSocketConnected = false;
        const adminSocket = ioClient(SOCKET_URL, {
            auth: { token: adminToken },
            reconnection: false
        });
        await new Promise((resolve) => {
            adminSocket.on('connect', () => {
                adminSocketConnected = true;
                resolve();
            });
            adminSocket.on('connect_error', (e) => resolve());
        });
        assert(adminSocketConnected, "Admin user socket established connection successfully");

        // Setup Event Collection Promises on Client Sockets
        // TEST H & I: New report emits report:created and dashboard:refresh
        console.log("\n--- TEST H & I: New Report Realtime Event Emission ---");
        const reportCreatedPromise = waitForEvent(userSocket, 'report:created');
        const dashboardRefreshPromise1 = waitForEvent(userSocket, 'dashboard:refresh');

        const createRes = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                reportType: 'traffic',
                incidentType: 'Accident',
                location: 'Realtime Test St',
                severity: 'high',
                vehiclesAffected: 4,
                date: '2026-09-26',
                time: '14:00',
                description: 'Realtime Socket.IO test report'
            })
        });
        const createData = await createRes.json();
        assert(createRes.ok && createData.success, "Report created via REST API");
        createdReportId = createData.report.reportId;

        const createdPayload = await reportCreatedPromise;
        const dashRefresh1Payload = await dashboardRefreshPromise1;

        assert(createdPayload && createdPayload.reportId === createdReportId, "report:created emitted with correct reportId");
        assert(dashRefresh1Payload !== undefined, "dashboard:refresh emitted on report creation");

        // TEST J & K: Report edit emits report:updated and dashboard:refresh
        console.log("\n--- TEST J & K: Edit Report Realtime Event Emission ---");
        const reportUpdatedPromise = waitForEvent(userSocket, 'report:updated');
        const dashboardRefreshPromise2 = waitForEvent(userSocket, 'dashboard:refresh');

        const editRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                location: 'Realtime Test St Updated'
            })
        });
        const editData = await editRes.json();
        assert(editRes.ok && editData.success, "Report edited via REST API");

        const updatedPayload = await reportUpdatedPromise;
        const dashRefresh2Payload = await dashboardRefreshPromise2;

        assert(updatedPayload && updatedPayload.location === 'Realtime Test St Updated', "report:updated emitted with updated location");
        assert(dashRefresh2Payload !== undefined, "dashboard:refresh emitted on report edit");

        // TEST N: Admin verification emits report:verification-updated
        console.log("\n--- TEST N: Admin Verification Realtime Event Emission ---");
        const verifyPromise = waitForEvent(userSocket, 'report:verification-updated');
        const verifyRes = await fetch(`${BASE_URL}/admin/reports/${createdReportId}/verify`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert(verifyRes.ok, "Report verified by admin via REST API");
        const verifyPayload = await verifyPromise;
        assert(verifyPayload && verifyPayload.verificationStatus === 'verified', "report:verification-updated emitted with status verified");

        // TEST P & Q: Status change emits report:status-updated and dashboard:refresh
        console.log("\n--- TEST P & Q: Status Change Realtime Event Emission ---");
        const statusPromise = waitForEvent(userSocket, 'report:status-updated');
        const statusDashPromise = waitForEvent(userSocket, 'dashboard:refresh');
        const statusRes = await fetch(`${BASE_URL}/admin/reports/${createdReportId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({ status: 'In Progress' })
        });
        assert(statusRes.ok, "Status changed by admin via REST API");
        const statusPayload = await statusPromise;
        const statusDashPayload = await statusDashPromise;
        assert(statusPayload && statusPayload.status === 'In Progress', "report:status-updated emitted with new status In Progress");
        assert(statusDashPayload !== undefined, "dashboard:refresh emitted on status change");

        // TEST O: Admin rejection emits report:verification-updated
        console.log("\n--- TEST O: Admin Rejection Realtime Event Emission ---");
        // Create temp report to test rejection
        const rejectTempRes = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                reportType: 'traffic',
                incidentType: 'Traffic Jam',
                location: 'Reject Test Loc',
                severity: 'low',
                vehiclesAffected: 1,
                date: '2026-09-26',
                time: '15:00',
                description: 'Report to reject'
            })
        });
        const rejectTempData = await rejectTempRes.json();
        const rejectReportId = rejectTempData.report.reportId;

        const rejectPromise = waitForEvent(userSocket, 'report:verification-updated');
        await fetch(`${BASE_URL}/admin/reports/${rejectReportId}/reject`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const rejectPayload = await rejectPromise;
        assert(rejectPayload && rejectPayload.verificationStatus === 'false', "report:verification-updated emitted with status false");

        // Clean up reject report
        await fetch(`${BASE_URL}/reports/${rejectReportId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        await new Promise(r => setTimeout(r, 500));

        // TEST L & M: Report delete emits report:deleted and dashboard:refresh
        console.log("\n--- TEST L & M: Delete Report Realtime Event Emission ---");
        const deletePromise = waitForEvent(userSocket, 'report:deleted');
        const deleteDashPromise = waitForEvent(userSocket, 'dashboard:refresh');

        const deleteRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${userToken}` }
        });
        assert(deleteRes.ok, "Report deleted via REST API");
        const deletePayload = await deletePromise;
        const deleteDashPayload = await deleteDashPromise;

        assert(deletePayload && deletePayload.reportId === createdReportId, "report:deleted emitted with correct reportId");
        assert(deleteDashPayload !== undefined, "dashboard:refresh emitted on report deletion");

        // TEST R: Socket payload does not expose passwordHash
        console.log("\n--- TEST R: Security - Exclude passwordHash ---");
        const payloadStr = JSON.stringify(createdPayload);
        assert(!payloadStr.includes('passwordHash') && !payloadStr.includes('password'), "Socket payload contains no passwordHash field");

        // TEST S: Socket payload does not expose JWT secrets
        console.log("\n--- TEST S: Security - Exclude JWT Secrets ---");
        const secretStr = process.env.JWT_SECRET || 'jwt_secret';
        assert(!payloadStr.includes(secretStr), "Socket payload contains no JWT secret");

        // TEST T: Socket payload does not expose MongoDB credentials
        console.log("\n--- TEST T: Security - Exclude MongoDB Credentials ---");
        const hasMongoCreds = payloadStr.includes('mongodb+srv') || payloadStr.includes('AdminSecurePassword');
        assert(!hasMongoCreds, "Socket payload contains no MongoDB credentials");

        // TEST U: Existing REST APIs continue working
        console.log("\n--- TEST U: Existing REST API Endpoint Integrity ---");
        const statsRes = await fetch(`${BASE_URL}/dashboard/stats`, {
            headers: { 'Authorization': `Bearer ${userToken}` }
        });
        const statsData = await statsRes.json();
        assert(statsRes.ok && statsData.success && statsData.stats, "REST GET /api/dashboard/stats continues functioning cleanly");

        // Close sockets
        userSocket.disconnect();
        adminSocket.disconnect();

    } catch (err) {
        console.error("Test execution error:", err);
        failed++;
    } finally {
        console.log("\n==================================================");
        console.log(`  MODULE 16 TEST SUMMARY`);
        console.log(`  Passed: ${passed}`);
        console.log(`  Failed: ${failed}`);
        console.log("==================================================\n");

        if (failed > 0) {
            process.exit(1);
        }
    }
}

runTests();
