/* ==========================================================================
   MODULE 14 TEST SUITE — POTHOLE IMAGE UPLOAD, STORAGE & RETRIEVAL
   ========================================================================== */

const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:5000/api';
const STATIC_URL = 'http://localhost:5000';

async function runTests() {
    console.log("==================================================");
    console.log("  RUNNING MODULE 14 TEST SUITE (TEST A - TEST W)");
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
    const userEmail = `mod14_user_${timestamp}@example.com`;
    const userPassword = `Pass123!_${timestamp}`;

    let authToken = null;
    let createdReportId = null;
    let uploadedImageUrl1 = null;
    let uploadedImageFilename1 = null;
    let uploadedImageUrl2 = null;

    try {
        // TEST B: Register and Login Test User
        console.log("--- TEST B: User Authentication ---");
        const regRes = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Module14 Tester', email: userEmail, password: userPassword })
        });
        const regData = await regRes.json();
        assert(regRes.ok && regData.success, "User registered successfully", `Status: ${regRes.status}`);

        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail, password: userPassword })
        });
        const loginData = await loginRes.json();
        assert(loginRes.ok && loginData.success && loginData.token, "User logged in successfully", `Status: ${loginRes.status}`);
        authToken = loginData.token;

        // TEST A: Health / Server Check
        console.log("\n--- TEST A: Server Availability ---");
        const healthRes = await fetch(`${BASE_URL}/reports`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const healthData = await healthRes.json();
        assert(healthRes.ok && healthData.success, "Server is running and returning reports endpoint");

        // TEST C: Reject Unauthenticated Upload
        console.log("\n--- TEST C: Reject Unauthenticated Upload ---");
        const dummyBlob = new Blob([Buffer.from('fake image data')], { type: 'image/jpeg' });
        const formDataUnauth = new FormData();
        formDataUnauth.append('image', dummyBlob, 'test.jpg');

        const unauthRes = await fetch(`${BASE_URL}/uploads/pothole-image`, {
            method: 'POST',
            body: formDataUnauth
        });
        assert(unauthRes.status === 401, "Reject upload without Bearer token (401)", `Received status: ${unauthRes.status}`);

        // TEST D: Reject Request Without File
        console.log("\n--- TEST D: Reject Request Without File ---");
        const emptyForm = new FormData();
        const noFileRes = await fetch(`${BASE_URL}/uploads/pothole-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: emptyForm
        });
        assert(noFileRes.status === 400, "Reject upload with no image file attached (400)", `Received status: ${noFileRes.status}`);

        // TEST E: Reject Oversized File (> 5 MB)
        console.log("\n--- TEST E: Reject Oversized File (> 5 MB) ---");
        const largeBuffer = Buffer.alloc(5.5 * 1024 * 1024); // 5.5 MB
        const largeForm = new FormData();
        largeForm.append('image', new Blob([largeBuffer], { type: 'image/jpeg' }), 'large.jpg');

        const largeRes = await fetch(`${BASE_URL}/uploads/pothole-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: largeForm
        });
        assert(largeRes.status === 400 || largeRes.status === 413 || largeRes.status === 500, "Reject oversized image > 5MB", `Received status: ${largeRes.status}`);

        // TEST F: Reject Invalid MIME Type (e.g. text/plain)
        console.log("\n--- TEST F: Reject Invalid File Format ---");
        const textBuffer = Buffer.from("This is a text file, not an image.");
        const textForm = new FormData();
        textForm.append('image', new Blob([textBuffer], { type: 'text/plain' }), 'test.txt');

        const textRes = await fetch(`${BASE_URL}/uploads/pothole-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: textForm
        });
        assert(textRes.status === 400, "Reject text/plain non-image file (400)", `Received status: ${textRes.status}`);

        // TEST G: Upload Valid JPEG Image
        console.log("\n--- TEST G: Upload Valid JPEG Image ---");
        // 1x1 valid minimal JPEG file bytes
        const jpegBytes = Buffer.from([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
            0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
            0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xDA, 0x00, 0x08,
            0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xBF, 0x00, 0xFF, 0xD9
        ]);

        const jpegForm = new FormData();
        jpegForm.append('image', new Blob([jpegBytes], { type: 'image/jpeg' }), 'sample_pothole.jpg');

        const uploadRes1 = await fetch(`${BASE_URL}/uploads/pothole-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: jpegForm
        });
        const uploadData1 = await uploadRes1.json();
        assert(uploadRes1.ok && uploadData1.success && uploadData1.imageUrl, "Upload valid JPEG image successfully", `Status: ${uploadRes1.status}, Msg: ${JSON.stringify(uploadData1)}`);
        uploadedImageUrl1 = uploadData1.imageUrl;
        uploadedImageFilename1 = uploadData1.filename;
        console.log(`    imageUrl: ${uploadedImageUrl1}`);

        // TEST H: Confirm File Exists on Server Disk
        console.log("\n--- TEST H: Confirm File Exists on Disk ---");
        const filePathOnDisk = path.join(__dirname, uploadedImageUrl1.replace(/^\//, ''));
        const fileExistsOnDisk = fs.existsSync(filePathOnDisk);
        assert(fileExistsOnDisk, `Uploaded file exists on disk: ${filePathOnDisk}`);

        // TEST I: Test Static File Serving via HTTP
        console.log("\n--- TEST I: Static File Serving ---");
        const staticRes = await fetch(`${STATIC_URL}${uploadedImageUrl1}`);
        assert(staticRes.ok && staticRes.headers.get('content-type').includes('image'), "Static server delivers uploaded file via GET");

        // TEST J: Upload Valid PNG Image
        console.log("\n--- TEST J: Upload Valid PNG Image ---");
        // 1x1 valid PNG bytes
        const pngBytes = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
            0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
            0x42, 0x60, 0x82
        ]);

        const pngForm = new FormData();
        pngForm.append('image', new Blob([pngBytes], { type: 'image/png' }), 'sample_pothole.png');

        const uploadRes2 = await fetch(`${BASE_URL}/uploads/pothole-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: pngForm
        });
        const uploadData2 = await uploadRes2.json();
        assert(uploadRes2.ok && uploadData2.success && uploadData2.imageUrl, "Upload valid PNG image successfully");
        uploadedImageUrl2 = uploadData2.imageUrl;

        // TEST K: Create Pothole Report with Image URL
        console.log("\n--- TEST K: Create Pothole Report with Attached Image ---");
        const potholePayload = {
            reportType: 'pothole',
            location: 'Mount Road Pothole Spot',
            date: '2026-09-26',
            time: '14:30',
            description: 'Severe pothole near Mount Road intersection.',
            imageUrl: uploadedImageUrl1
        };

        const createRes = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(potholePayload)
        });
        const createData = await createRes.json();
        assert(createRes.ok && createData.success && createData.report, "Pothole report created with imageUrl");
        createdReportId = createData.report.reportId;
        assert(createData.report.imageUrl === uploadedImageUrl1, "Report object returns exact uploaded imageUrl");

        // TEST L: Retrieve Created Report via GET /api/reports
        console.log("\n--- TEST L: Retrieve Created Pothole Report ---");
        const getRes = await fetch(`${BASE_URL}/reports`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const getData = await getRes.json();
        assert(getRes.ok && getData.success && Array.isArray(getData.reports), "Retrieve reports list");
        const retrievedReport = (getData.reports || []).find(r => r.reportId === createdReportId);
        assert(retrievedReport && retrievedReport.imageUrl === uploadedImageUrl1, "Retrieved report contains matching imageUrl");

        // TEST M: Edit Pothole Report Description
        console.log("\n--- TEST M: Edit Pothole Report ---");
        const editRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                description: 'Updated severe pothole near Mount Road intersection with image preserved.'
            })
        });
        const editData = await editRes.json();
        assert(editRes.ok && editData.success, "Edit pothole report successfully");
        assert(editData.report.imageUrl === uploadedImageUrl1, "Pothole report retains imageUrl after edit");

        // TEST N: Create Traffic Report without Image URL
        console.log("\n--- TEST N: Create Traffic Report without Image ---");
        const trafficPayload = {
            reportType: 'traffic',
            incidentType: 'Congestion',
            location: 'Guindy Flyover',
            severity: 'Medium',
            vehiclesAffected: 12,
            date: '2026-09-26',
            time: '15:00',
            description: 'Heavy traffic congestion at Guindy flyover.'
        };
        const trafficRes = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(trafficPayload)
        });
        const trafficData = await trafficRes.json();
        assert(trafficRes.ok && trafficData.success, "Traffic report created without imageUrl");
        assert(trafficData.report.imageUrl === null, "Traffic report imageUrl is null");

        // TEST O: Create Temporary Report and Delete it (Verifying File Unlink)
        console.log("\n--- TEST O: Delete Pothole Report and Unlink File ---");
        const tempPotholePayload = {
            reportType: 'pothole',
            location: 'Temporary Delete Test Location',
            date: '2026-09-26',
            time: '16:00',
            description: 'Temporary pothole report for file deletion test.',
            imageUrl: uploadedImageUrl2
        };

        const tempRes = await fetch(`${BASE_URL}/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(tempPotholePayload)
        });
        const tempData = await tempRes.json();
        const tempReportId = tempData.report.reportId;
        const tempFilePathOnDisk = path.join(__dirname, uploadedImageUrl2.replace(/^\//, ''));

        assert(fs.existsSync(tempFilePathOnDisk), "Temp image file exists on disk prior to report deletion");

        const delRes = await fetch(`${BASE_URL}/reports/${tempReportId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const delData = await delRes.json();
        assert(delRes.ok && delData.success, "Report deleted from database");
        assert(!fs.existsSync(tempFilePathOnDisk), "Image file safely unlinked from disk upon report deletion");

        // TEST P: Delete Report without Image URL (No error on null imageUrl)
        console.log("\n--- TEST P: Delete Report without Image URL ---");
        const delTrafficRes = await fetch(`${BASE_URL}/reports/${trafficData.report.reportId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const delTrafficData = await delTrafficRes.json();
        assert(delTrafficRes.ok && delTrafficData.success, "Traffic report without imageUrl deleted smoothly");

        // TEST Q: Confirm Safety of File Path Operations
        console.log("\n--- TEST Q: Path Traversal File Safety ---");
        const safeDeleteCheck = !uploadedImageUrl1.includes('..');
        assert(safeDeleteCheck, "Generated image paths do not contain path traversal sequences");

        // TEST R: Admin Report List Includes Image URL
        console.log("\n--- TEST R: Admin Report List Integration ---");
        const adminListRes = await fetch(`${BASE_URL}/reports`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const adminListData = await adminListRes.json();
        const foundReport = adminListData.reports.find(r => r.reportId === createdReportId);
        assert(foundReport && foundReport.imageUrl === uploadedImageUrl1, "Report in main list includes correct imageUrl");

        // TEST S: Status History Timeline Retains Report Data
        console.log("\n--- TEST S: Timeline Status API Compatibility ---");
        assert(foundReport && Array.isArray(foundReport.statusHistory), "Status history timeline array present on pothole report");

        // TEST T: Priority Calculation for Image Pothole Report
        console.log("\n--- TEST T: Priority Synchronization ---");
        assert(foundReport && (foundReport.priority === 'High' || foundReport.priority === 'Medium' || foundReport.priority === 'Low'), "Pothole report with image receives calculated priority level");

        // TEST U: Search and Filter Compatibility
        console.log("\n--- TEST U: Filter by Pothole Category ---");
        const potholeFilterRes = await fetch(`${BASE_URL}/reports?reportType=pothole`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const potholeFilterData = await potholeFilterRes.json();
        const filteredItem = potholeFilterData.reports.find(r => r.reportId === createdReportId);
        assert(filteredItem && filteredItem.imageUrl === uploadedImageUrl1, "Filtered pothole list includes image-attached report");

        // TEST V: Clean Cleanup of Test Data
        console.log("\n--- TEST V: Final Report Deletion & Cleanup ---");
        const finalDelRes = await fetch(`${BASE_URL}/reports/${createdReportId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const finalDelData = await finalDelRes.json();
        assert(finalDelRes.ok && finalDelData.success, "Final test report deleted and cleaned up");

        // TEST W: Final Summary
        console.log("\n==================================================");
        console.log(`  MODULE 14 TEST SUMMARY`);
        console.log(`  Passed: ${passed}`);
        console.log(`  Failed: ${failed}`);
        console.log("==================================================");

        if (failed === 0) {
            console.log("\n✨ ALL MODULE 14 TESTS PASSED SUCCESSFULLY! ✨");
        } else {
            console.error(`\n⚠️ ${failed} TEST(S) FAILED IN MODULE 14.`);
            process.exit(1);
        }

    } catch (err) {
        console.error("Test execution error:", err);
        process.exit(1);
    }
}

runTests();
