/* ==========================================================================
   MODULE 18 TEST SUITE — SECURITY, VALIDATION & ERROR HANDLING
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
    console.log("==================================================");
    console.log("  RUNNING MODULE 18 TEST SUITE (SECURITY & VALIDATION)");
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
    const user1Email = `mod18_user1_${timestamp}@example.com`;
    const user2Email = `mod18_user2_${timestamp}@example.com`;
    const userPassword = `Pass123!_${timestamp}`;

    let user1Token = null;
    let user2Token = null;
    let adminToken = null;
    let createdReportId = null;

    try {
        // 1. Missing JWT Token → 401
        console.log("--- TEST 1: Missing JWT Token Rejection ---");
        const noAuthRes = await fetch(`${BASE_URL}/reports`);
        assert(noAuthRes.status === 401, "Missing Authorization header returns HTTP 401 Unauthorized");

        // 2. Invalid JWT Token → 401
        console.log("\n--- TEST 2: Invalid JWT Token Rejection ---");
        const badTokenRes = await fetch(`${BASE_URL}/reports`, {
            headers: { 'Authorization': 'Bearer invalid_garbage_token_12345' }
        });
        assert(badTokenRes.status === 401, "Invalid/malformed JWT token returns HTTP 401 Unauthorized");

        // 3. Setup Authenticated Users & Admin
        console.log("\n--- SETUP: User & Admin Registration/Logins ---");
        const reg1Res = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Mod18 User One', email: user1Email, password: userPassword, role: 'admin' }) // Attempt role escalation
        });
        const reg1Data = await reg1Res.json();
        assert(reg1Res.status === 201 && reg1Data.user.role === 'user', "Registration strictly forces role='user' regardless of request payload");

        await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Mod18 User Two', email: user2Email, password: userPassword })
        });

        const login1Res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user1Email, password: userPassword })
        });
        const login1Data = await login1Res.json();
        user1Token = login1Data.token;

        const login2Res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user2Email, password: userPassword })
        });
        const login2Data = await login2Res.json();
        user2Token = login2Data.token;

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@smarttraffic.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'AdminSecurePassword123';
        const adminLoginRes = await fetch(`${BASE_URL}/auth/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: adminEmail, password: adminPassword })
        });
        const adminLoginData = await adminLoginRes.json();
        adminToken = adminLoginData.token;

        assert(user1Token && user2Token && adminToken, "User1, User2, and Admin tokens generated");

        // 4. Normal User Accessing Admin Route → 403
        console.log("\n--- TEST 4: Normal User Accessing Admin Route ---");
        const userAdminRes = await fetch(`${BASE_URL}/admin/test`, {
            headers: { 'Authorization': `Bearer ${user1Token}` }
        });
        assert(userAdminRes.status === 403, "Normal user token accessing admin endpoint returns HTTP 403 Forbidden");

        // 5. Admin Accessing Admin Route → 200
        console.log("\n--- TEST 5: Admin Accessing Admin Route ---");
        const adminTestRes = await fetch(`${BASE_URL}/admin/test`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert(adminTestRes.status === 200, "Admin token accessing admin endpoint succeeds with HTTP 200");

        // 6. Invalid Registration Input → 400
        console.log("\n--- TEST 6: Invalid Registration Input Validation ---");
        const badRegRes = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Short Pass', email: 'valid@example.com', password: '123' })
        });
        assert(badRegRes.status === 400, "Password under 6 characters returns HTTP 400 Bad Request");

        // 7. Duplicate Email Registration → 409
        console.log("\n--- TEST 7: Duplicate Email Registration Rejection ---");
        const dupRegRes = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Duplicate User', email: user1Email, password: userPassword })
        });
        assert(dupRegRes.status === 409, "Duplicate email registration returns HTTP 409 Conflict");

        // 8. Invalid Report Creation Input → 400
        console.log("\n--- TEST 8: Invalid Report Creation Input Validation ---");
        const badReportRes = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user1Token}`
            },
            body: JSON.stringify({
                reportType: 'traffic',
                location: '', // Empty location
                description: 'Test'
            })
        });
        assert(badReportRes.status === 400, "Missing required location field returns HTTP 400 Bad Request");

        // Create Valid Report for User1
        const createRes = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user1Token}`
            },
            body: JSON.stringify({
                reportType: 'traffic',
                incidentType: 'Accident',
                location: 'Security Highway',
                severity: 'medium',
                vehiclesAffected: 2,
                date: '2026-10-06',
                time: '12:00',
                description: 'Valid test report for security checks'
            })
        });
        const createData = await createRes.json();
        assert(createRes.status === 201 && createData.success, "Valid report created successfully");
        createdReportId = createData.report.reportId;

        // 9. Unauthorized Report Modification (User2 modifying User1's report) → 403
        console.log("\n--- TEST 9: Unauthorized Report Modification Rejection ---");
        const unauthEditRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user2Token}`
            },
            body: JSON.stringify({ description: 'Hacked description by User2' })
        });
        assert(unauthEditRes.status === 403, "User2 editing User1's report returns HTTP 403 Forbidden");

        const unauthDeleteRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${user2Token}` }
        });
        assert(unauthDeleteRes.status === 403, "User2 deleting User1's report returns HTTP 403 Forbidden");

        // 10. Attempting Direct Protected Field Manipulation → Protected Fields Remain Unchanged
        console.log("\n--- TEST 10: Protected Report Fields Protection ---");
        const editProtectedRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user1Token}`
            },
            body: JSON.stringify({
                status: 'Resolved', // Protected
                verificationStatus: 'verified', // Protected
                reporterId: 'USR999', // Protected
                description: 'Updated valid description by owner'
            })
        });
        const editProtectedData = await editProtectedRes.json();
        assert(editProtectedRes.status === 200, "Edit request succeeds for valid fields");
        assert(editProtectedData.report.status === 'Pending', "Protected status field remained 'Pending'");
        assert(editProtectedData.report.verificationStatus === 'pending', "Protected verificationStatus field remained 'pending'");
        assert(editProtectedData.report.reporterId !== 'USR999', "Protected reporterId field remained unchanged");
        assert(editProtectedData.report.description === 'Updated valid description by owner', "Editable description field was updated");

        // 11. Invalid File Upload Type → 400
        console.log("\n--- TEST 11: Invalid Upload File Type Rejection ---");
        const textBlob = new Blob(["Hello text content"], { type: "text/plain" });
        const textFormData = new FormData();
        textFormData.append("image", textBlob, "test.txt");

        const badUploadRes = await fetch(`${BASE_URL}/uploads/pothole-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${user1Token}` },
            body: textFormData
        });
        assert(badUploadRes.status === 400, "Uploading text/plain file returns HTTP 400 Bad Request");

        // 12. Unknown API Route → 404
        console.log("\n--- TEST 12: Unknown API Route 404 Handling ---");
        const unknownRes = await fetch(`${BASE_URL}/unknown-endpoint-path-999`);
        const unknownData = await unknownRes.json();
        assert(unknownRes.status === 404 && unknownData.success === false, "Unknown route returns HTTP 404 JSON response");

        // 13. Password Hash & Secrets Leak Prevention
        console.log("\n--- TEST 13: Password Hash & Secret Privacy ---");
        const getMeRes = await fetch(`${BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${user1Token}` }
        });
        const getMeData = await getMeRes.json();
        const meStr = JSON.stringify(getMeData);
        assert(!meStr.includes('passwordHash') && !meStr.includes('password'), "/api/auth/me does not expose passwordHash");

        const getReportRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            headers: { 'Authorization': `Bearer ${user1Token}` }
        });
        const getReportData = await getReportRes.json();
        const repStr = JSON.stringify(getReportData);
        assert(!repStr.includes('passwordHash') && !repStr.includes('password'), "GET /api/reports/:id does not expose passwordHash");

        // 14. Cleanup Test Report
        console.log("\n--- CLEANUP: Delete Test Report ---");
        const delRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${user1Token}` }
        });
        assert(delRes.status === 200, "Test report cleaned up successfully");

    } catch (err) {
        console.error("Test execution error:", err);
        failed++;
    }

    console.log("\n==================================================");
    console.log(`  MODULE 18 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests();
