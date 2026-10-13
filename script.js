/* ==========================================================================
   SMART TRAFFIC INCIDENT REPORTER - JAVASCRIPT (MODULE 8 FRONTEND ↔ BACKEND)
   Description: Connected Vanilla JS frontend to Express Node.js & MongoDB Atlas backend.
                Implements JWT session storage, User & Admin login, report submission
                via POST /api/reports, report viewing & filtering via GET /api/reports,
                dashboard stats, map visualization, CSV export, and print features.
   ========================================================================== */

// --------------------------------------------------------------------------
// PART 1 — BACKEND BASE URL & STORAGE KEYS
// --------------------------------------------------------------------------
const API_BASE_URL = "http://localhost:5000/api";

const AUTH_TOKEN_KEY = "authToken";
const CURRENT_USER_KEY = "currentUser";

// Global variables
let cameraStream = null;
let capturedPhotoDataUrl = null;
let currentMapFilter = 'all';
let currentAdminFilter = 'all';
let cachedReports = [];
let searchDebounceTimer = null;

// Predefined City Location Map Coordinates (Percentage offsets X%, Y%)
const CITY_LOCATION_COORDINATES = {
    'anna nagar': { x: 25, y: 28 },
    't. nagar': { x: 50, y: 46 },
    't nagar': { x: 50, y: 46 },
    'guindy': { x: 44, y: 66 },
    'velachery': { x: 70, y: 74 },
    'adyar': { x: 76, y: 56 },
    'mount road': { x: 56, y: 36 },
    'anna salai': { x: 56, y: 36 },
    'koyambedu': { x: 18, y: 42 },
    'mylapore': { x: 70, y: 40 },
    'tambaram': { x: 35, y: 84 },
    'porur': { x: 15, y: 58 },
    'chromepet': { x: 38, y: 78 },
    'saidapet': { x: 48, y: 55 }
};

// Wait for HTML document to load
document.addEventListener('DOMContentLoaded', async function () {
    
    // Check initial authentication session
    await checkAuthSessionOnStartup();

    // Setup debounced search listener
    setupSearchDebounce();

    // Mobile Navigation Menu Toggle
    const menuToggle = document.getElementById('menuToggle');
    const navLinks = document.getElementById('navLinks');

    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', function () {
            navLinks.classList.toggle('active');
        });
    }

    // Set default date and time across form inputs
    setDefaultDateTime();

    // Load initial stats and data on Dashboard
    await loadDashboardData();

    // Initialize Realtime Socket.IO connection (Module 16)
    initSocketConnection();

    console.log("Smart Traffic Incident Reporter - Module 8 Frontend ↔ Backend Connected.");
});

// --------------------------------------------------------------------------
// PART 2 — AUTHENTICATION STORAGE HELPER FUNCTIONS
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// MODULE 16 — REALTIME SOCKET.IO CONNECTION MANAGEMENT
// --------------------------------------------------------------------------
let realtimeSocket = null;

function initSocketConnection() {
    const token = getAuthToken();
    if (!token) {
        disconnectSocketConnection();
        return;
    }

    if (realtimeSocket && realtimeSocket.connected) {
        return;
    }

    if (typeof io === 'undefined') {
        console.warn("Socket.IO client library not loaded. Realtime updates fallback to REST.");
        return;
    }

    try {
        const serverUrl = API_BASE_URL.replace(/\/api\/?$/, '');
        realtimeSocket = io(serverUrl, {
            auth: {
                token: token
            },
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 2000
        });

        realtimeSocket.on("connect", () => {
            console.log("Realtime Socket.IO connected successfully.");
        });

        realtimeSocket.on("connect_error", (err) => {
            console.warn("Socket.IO connection note:", err.message);
        });

        realtimeSocket.on("report:created", (data) => {
            console.log("Realtime event [report:created]:", data);
            refreshAllViews();
        });

        realtimeSocket.on("report:updated", (data) => {
            console.log("Realtime event [report:updated]:", data);
            refreshAllViews();
        });

        realtimeSocket.on("report:deleted", (data) => {
            console.log("Realtime event [report:deleted]:", data);
            refreshAllViews();
        });

        realtimeSocket.on("report:verification-updated", (data) => {
            console.log("Realtime event [report:verification-updated]:", data);
            refreshAllViews();
        });

        realtimeSocket.on("report:status-updated", (data) => {
            console.log("Realtime event [report:status-updated]:", data);
            refreshAllViews();
        });

        realtimeSocket.on("dashboard:refresh", () => {
            console.log("Realtime event [dashboard:refresh]");
            loadDashboardData();
        });

    } catch (err) {
        console.warn("Failed to initialize Socket.IO connection:", err.message);
    }
}

function disconnectSocketConnection() {
    if (realtimeSocket) {
        try {
            realtimeSocket.disconnect();
        } catch (e) {}
        realtimeSocket = null;
    }
}

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getCurrentUser() {
    try {
        const raw = localStorage.getItem(CURRENT_USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function setAuthSession(token, user) {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    if (user) {
        const safeUser = {
            userId: user.userId || user.id || user._id,
            name: user.name,
            email: user.email,
            role: user.role
        };
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(safeUser));
    }
    updateAuthUI();
    initSocketConnection();
}

function clearAuthSession() {
    disconnectSocketConnection();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(CURRENT_USER_KEY);
    updateAuthUI();
}

function updateAuthUI() {
    const user = getCurrentUser();
    const userInfoEl = document.getElementById('navUserInfo');
    const loginBtn = document.getElementById('navLoginBtn');
    const logoutBtn = document.getElementById('navLogoutBtn');

    if (user) {
        if (userInfoEl) {
            userInfoEl.innerText = `👤 ${user.name} (${user.role})`;
            userInfoEl.classList.remove('hidden');
        }
        if (loginBtn) loginBtn.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
    } else {
        if (userInfoEl) userInfoEl.classList.add('hidden');
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
    }
}

// --------------------------------------------------------------------------
// PART 17 & 18 — REUSABLE API REQUEST HELPER WITH ERROR HANDLING
// --------------------------------------------------------------------------

async function apiRequest(endpoint, options = {}) {
    const token = getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        ...options,
        headers
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
        let data;
        try {
            data = await response.json();
        } catch (e) {
            data = {};
        }

        if (!response.ok) {
            if (response.status === 401) {
                clearAuthSession();
                const err = new Error(data.message || 'Authentication session expired. Please log in again.');
                err.status = 401;
                throw err;
            }
            const message = data.message || (response.status === 500 ? 'Server error. Please try again later.' : 'Request failed.');
            const err = new Error(message);
            err.status = response.status;
            throw err;
        }

        return data;
    } catch (err) {
        if (err.isOffline || err.name === 'TypeError' || err.message.includes('fetch')) {
            const offlineErr = new Error('Unable to connect to the server. Please make sure the backend is running.');
            offlineErr.isOffline = true;
            throw offlineErr;
        }
        throw err;
    }
}

// --------------------------------------------------------------------------
// PART 3, 4, 5 & 6 — AUTHENTICATION FLOWS (LOGIN, STARTUP CHECK & LOGOUT)
// --------------------------------------------------------------------------

async function checkAuthSessionOnStartup() {
    const token = getAuthToken();
    if (!token) {
        updateAuthUI();
        return;
    }

    try {
        const data = await apiRequest('/auth/me');
        if (data && data.success && data.user) {
            setAuthSession(token, data.user);
        } else {
            clearAuthSession();
        }
    } catch (err) {
        console.warn("Startup auth verification failed:", err.message);
        if (err.status === 401) {
            clearAuthSession();
        }
    }
}

function openAuthModal(defaultTab = 'userLogin') {
    const modal = document.getElementById('authModal');
    if (modal) {
        switchAuthTab(defaultTab);
        modal.classList.remove('hidden');
    }
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.add('hidden');
}

function switchAuthTab(tabName) {
    const tabUser = document.getElementById('tabUserLogin');
    const tabAdmin = document.getElementById('tabAdminLogin');
    const tabReg = document.getElementById('tabRegister');

    const formUser = document.getElementById('userLoginForm');
    const formAdmin = document.getElementById('adminLoginForm');
    const formReg = document.getElementById('userRegisterForm');

    const errorBox = document.getElementById('authModalError');
    const successBox = document.getElementById('authModalSuccess');
    if (errorBox) errorBox.classList.add('hidden');
    if (successBox) successBox.classList.add('hidden');

    if (tabUser) tabUser.className = tabName === 'userLogin' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    if (tabAdmin) tabAdmin.className = tabName === 'adminLogin' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    if (tabReg) tabReg.className = tabName === 'register' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';

    if (formUser) formUser.classList.toggle('hidden', tabName !== 'userLogin');
    if (formAdmin) formAdmin.classList.toggle('hidden', tabName !== 'adminLogin');
    if (formReg) formReg.classList.toggle('hidden', tabName !== 'register');

    const modalTitle = document.getElementById('authModalTitle');
    if (modalTitle) {
        if (tabName === 'adminLogin') modalTitle.innerText = '🛠️ Admin Login';
        else if (tabName === 'register') modalTitle.innerText = '📝 Register User Account';
        else modalTitle.innerText = '🔑 User Login';
    }
}

async function handleUserLoginSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('userLoginEmail').value.trim();
    const password = document.getElementById('userLoginPassword').value;

    const errorBox = document.getElementById('authModalError');
    const successBox = document.getElementById('authModalSuccess');
    if (errorBox) errorBox.classList.add('hidden');
    if (successBox) successBox.classList.add('hidden');

    try {
        const data = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        if (data && data.success) {
            setAuthSession(data.token, data.user);
            if (successBox) {
                successBox.innerText = `Welcome back, ${data.user.name}!`;
                successBox.classList.remove('hidden');
            }
            setTimeout(() => {
                closeAuthModal();
                refreshAllViews();
            }, 600);
        }
    } catch (err) {
        if (errorBox) {
            errorBox.innerText = err.message;
            errorBox.classList.remove('hidden');
        }
    }
}

async function handleAdminLoginSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('adminLoginEmail').value.trim();
    const password = document.getElementById('adminLoginPassword').value;

    const errorBox = document.getElementById('authModalError');
    const successBox = document.getElementById('authModalSuccess');
    if (errorBox) errorBox.classList.add('hidden');
    if (successBox) successBox.classList.add('hidden');

    try {
        const data = await apiRequest('/auth/admin/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        if (data && data.success) {
            setAuthSession(data.token, data.user);
            if (successBox) {
                successBox.innerText = `Welcome Admin ${data.user.name}!`;
                successBox.classList.remove('hidden');
            }
            setTimeout(() => {
                closeAuthModal();
                showView('adminDashboardView');
            }, 600);
        }
    } catch (err) {
        if (errorBox) {
            errorBox.innerText = err.message;
            errorBox.classList.remove('hidden');
        }
    }
}

async function handleUserRegisterSubmit(event) {
    event.preventDefault();
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;

    const errorBox = document.getElementById('authModalError');
    const successBox = document.getElementById('authModalSuccess');
    if (errorBox) errorBox.classList.add('hidden');
    if (successBox) successBox.classList.add('hidden');

    try {
        const data = await apiRequest('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, password })
        });

        if (data && data.success) {
            setAuthSession(data.token, data.user);
            if (successBox) {
                successBox.innerText = `Account created successfully! Welcome, ${data.user.name}.`;
                successBox.classList.remove('hidden');
            }
            setTimeout(() => {
                closeAuthModal();
                refreshAllViews();
            }, 800);
        }
    } catch (err) {
        if (errorBox) {
            errorBox.innerText = err.message;
            errorBox.classList.remove('hidden');
        }
    }
}

function handleLogout() {
    clearAuthSession();
    refreshAllViews();
    showView('dashboardView');
}

// --------------------------------------------------------------------------
// PART 10 & 11 — DATA NORMALIZATION & BACKEND REPORT RETRIEVAL
// --------------------------------------------------------------------------

function normalizeReportForFrontend(report) {
    if (!report) return null;

    const isPothole = (report.reportType === 'pothole') || (report.type === 'Pothole');
    const reportId = report.reportId || report.id || report._id;

    return {
        _id: report._id,
        id: reportId,
        reportId: reportId,
        category: isPothole ? 'pothole' : 'incident',
        reportType: report.reportType || (isPothole ? 'pothole' : 'traffic'),
        type: isPothole ? 'Pothole' : (report.incidentType || report.type || 'Traffic Incident'),
        incidentType: report.incidentType || report.type,
        location: report.location || '',
        severity: report.severity || (isPothole ? 'High' : 'Medium'),
        vehiclesAffected: report.vehiclesAffected !== undefined ? report.vehiclesAffected : 0,
        date: report.date || '',
        time: report.time || '',
        description: report.description || '',
        priority: report.priority || 'Medium',
        status: report.status || (isPothole ? 'Pending Verification' : 'Pending'),
        verificationStatus: report.verificationStatus || 'pending',
        imageUrl: report.imageUrl || null,
        statusHistory: Array.isArray(report.statusHistory) ? report.statusHistory : [],
        createdAt: report.createdAt,
        updatedAt: report.updatedAt
    };
}

async function fetchBackendReports(params = {}) {
    const query = new URLSearchParams();

    if (params.search) query.append('search', params.search);
    if (params.reportType && params.reportType !== 'all') {
        const mappedType = (params.reportType === 'incidents' || params.reportType === 'traffic') ? 'traffic' : (params.reportType === 'potholes' || params.reportType === 'pothole' ? 'pothole' : params.reportType);
        query.append('reportType', mappedType);
    }
    if (params.priority && params.priority !== 'all') {
        query.append('priority', params.priority);
    }
    if (params.status && params.status !== 'all') {
        query.append('status', params.status);
    }
    if (params.verificationStatus && params.verificationStatus !== 'all') {
        query.append('verificationStatus', params.verificationStatus);
    }
    if (params.page) query.append('page', params.page);
    if (params.limit) query.append('limit', params.limit);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    try {
        const data = await apiRequest(`/reports${queryString}`);
        if (data && data.success && Array.isArray(data.reports)) {
            const normalized = data.reports.map(normalizeReportForFrontend);
            cachedReports = normalized;
            return normalized;
        }
        return [];
    } catch (err) {
        console.warn("Fetch reports note:", err.message);
        return cachedReports || [];
    }
}

async function fetchSingleReport(reportId, forceFresh = false) {
    if (!reportId) return null;
    if (!forceFresh) {
        let found = cachedReports.find(r => r.id === reportId || r.reportId === reportId);
        if (found) return found;
    }

    try {
        const data = await apiRequest(`/reports/${reportId}`);
        if (data && data.success && data.report) {
            const normalized = normalizeReportForFrontend(data.report);
            const idx = cachedReports.findIndex(r => r.id === reportId || r.reportId === reportId);
            if (idx !== -1) {
                cachedReports[idx] = normalized;
            } else {
                cachedReports.push(normalized);
            }
            return normalized;
        }
    } catch (err) {
        console.warn(`Fetch single report ${reportId} failed:`, err.message);
    }
    return cachedReports.find(r => r.id === reportId || r.reportId === reportId) || null;
}

// --------------------------------------------------------------------------
// SPA VIEW SWITCHING FUNCTION
// --------------------------------------------------------------------------
function showView(viewId) {
    stopCameraStream();

    const views = document.querySelectorAll('.view-section');
    views.forEach(view => view.classList.add('hidden'));

    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.remove('hidden');
    }

    const navDashboard = document.getElementById('navDashboard');
    const navReportIncident = document.getElementById('navReportIncident');
    const navReportPothole = document.getElementById('navReportPothole');
    const navViewReports = document.getElementById('navViewReports');
    const navIncidentMap = document.getElementById('navIncidentMap');
    const navAdmin = document.getElementById('navAdmin');

    if (navDashboard && navReportIncident && navReportPothole && navViewReports && navIncidentMap && navAdmin) {
        navDashboard.classList.remove('active');
        navReportIncident.classList.remove('active');
        navReportPothole.classList.remove('active');
        navViewReports.classList.remove('active');
        navIncidentMap.classList.remove('active');
        navAdmin.classList.remove('active');

        if (viewId === 'dashboardView') {
            navDashboard.classList.add('active');
            loadDashboardData();
        } else if (viewId === 'reportIncidentView') {
            navReportIncident.classList.add('active');
            setDefaultDateTime();
        } else if (viewId === 'reportPotholeView') {
            navReportPothole.classList.add('active');
            setDefaultDateTime();
        } else if (viewId === 'viewReportsView') {
            navViewReports.classList.add('active');
            filterAndRenderReports();
        } else if (viewId === 'incidentMapView') {
            navIncidentMap.classList.add('active');
            renderIncidentMap();
        } else if (viewId === 'adminDashboardView') {
            navAdmin.classList.add('active');
            loadAdminDashboardData();
        }
    }

    const navLinks = document.getElementById('navLinks');
    if (navLinks && navLinks.classList.contains('active')) {
        navLinks.classList.remove('active');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setDefaultDateTime() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const currentDateStr = `${year}-${month}-${day}`;

    const hours = String(today.getHours()).padStart(2, '0');
    const minutes = String(today.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${hours}:${minutes}`;

    const incidentDate = document.getElementById('incidentDate');
    const incidentTime = document.getElementById('incidentTime');
    if (incidentDate && !incidentDate.value) incidentDate.value = currentDateStr;
    if (incidentTime && !incidentTime.value) incidentTime.value = currentTimeStr;

    const potholeDate = document.getElementById('potholeDate');
    const potholeTime = document.getElementById('potholeTime');
    if (potholeDate && !potholeDate.value) potholeDate.value = currentDateStr;
    if (potholeTime && !potholeTime.value) potholeTime.value = currentTimeStr;
}

// --------------------------------------------------------------------------
// CAMERA CAPTURE FUNCTIONS (MODULE 3 & 9)
// --------------------------------------------------------------------------
async function startCamera() {
    const video = document.getElementById('cameraVideo');
    const videoContainer = document.getElementById('videoContainer');
    const openCameraBtn = document.getElementById('openCameraBtn');
    const capturePhotoBtn = document.getElementById('capturePhotoBtn');
    const cameraErrorAlert = document.getElementById('cameraErrorAlert');

    if (!cameraErrorAlert) return;

    cameraErrorAlert.classList.add('hidden');
    cameraErrorAlert.innerHTML = '';

    const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    if (!hasMediaDevices) {
        let userMsg = "📷 <strong>Camera Permission Required:</strong> Camera permission is required to capture a pothole photo.";
        if (window.location.protocol === 'file:') {
            userMsg = "📷 <strong>Local File Limitation:</strong> Opening HTML files via <code>file://</code> restricts camera permissions. Please run on Live Server (<code>http://localhost:5500</code>).";
        }
        cameraErrorAlert.innerHTML = userMsg;
        cameraErrorAlert.classList.remove('hidden');
        return;
    }

    try {
        stopCameraStream();

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
        } catch (envErr) {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        cameraStream = stream;
        if (video) {
            video.srcObject = cameraStream;
            await video.play();
        }

        if (videoContainer) videoContainer.classList.remove('hidden');
        if (capturePhotoBtn) capturePhotoBtn.classList.remove('hidden');
        if (openCameraBtn) openCameraBtn.classList.add('hidden');

    } catch (error) {
        console.error("Camera access error:", error);
        let userMsg = "📷 <strong>Camera Access Note:</strong> Camera permission is required to capture a pothole photo.";
        cameraErrorAlert.innerHTML = userMsg;
        cameraErrorAlert.classList.remove('hidden');
    }
}

function capturePhoto() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('photoCanvas');
    const photoPreview = document.getElementById('photoPreview');
    const photoPreviewContainer = document.getElementById('photoPreviewContainer');
    const videoContainer = document.getElementById('videoContainer');
    const capturePhotoBtn = document.getElementById('capturePhotoBtn');
    const retakePhotoBtn = document.getElementById('retakePhotoBtn');

    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    capturedPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.85);

    photoPreview.src = capturedPhotoDataUrl;
    photoPreviewContainer.classList.remove('hidden');
    retakePhotoBtn.classList.remove('hidden');

    videoContainer.classList.add('hidden');
    capturePhotoBtn.classList.add('hidden');

    stopCameraStream();
}

function retakePhoto() {
    capturedPhotoDataUrl = null;
    const photoPreviewContainer = document.getElementById('photoPreviewContainer');
    const retakePhotoBtn = document.getElementById('retakePhotoBtn');

    if (photoPreviewContainer) photoPreviewContainer.classList.add('hidden');
    if (retakePhotoBtn) retakePhotoBtn.classList.add('hidden');

    startCamera();
}

function stopCameraStream() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => {
            try { track.stop(); } catch (e) {}
        });
        cameraStream = null;
    }

    const videoContainer = document.getElementById('videoContainer');
    const capturePhotoBtn = document.getElementById('capturePhotoBtn');
    const openCameraBtn = document.getElementById('openCameraBtn');
    const video = document.getElementById('cameraVideo');

    if (video) video.srcObject = null;
    if (videoContainer) videoContainer.classList.add('hidden');
    if (capturePhotoBtn) capturePhotoBtn.classList.add('hidden');

    if (!capturedPhotoDataUrl && openCameraBtn) {
        openCameraBtn.classList.remove('hidden');
    }
}

// --------------------------------------------------------------------------
// PART 7 — CREATE TRAFFIC REPORT (POST /api/reports)
// --------------------------------------------------------------------------

async function handleIncidentSubmit(event) {
    event.preventDefault();

    if (!getAuthToken()) {
        alert("Please log in to submit a traffic report.");
        openAuthModal('userLogin');
        return;
    }

    const type = document.getElementById('incidentType').value;
    const location = document.getElementById('incidentLocation').value.trim();
    const severity = document.getElementById('incidentSeverity').value;
    const vehicles = document.getElementById('vehiclesAffected').value;
    const date = document.getElementById('incidentDate').value;
    const time = document.getElementById('incidentTime').value;
    const description = document.getElementById('incidentDescription').value.trim();

    const errorBox = document.getElementById('formErrorMessage');
    const successBox = document.getElementById('formSuccessMessage');
    const formCard = document.getElementById('formCard');
    const generatedIdDisplay = document.getElementById('generatedIdDisplay');

    const missingFields = [];
    if (!type) missingFields.push("Incident Type");
    if (!location) missingFields.push("Location");
    if (!severity) missingFields.push("Severity Level");
    if (vehicles === "" || isNaN(vehicles) || parseInt(vehicles, 10) < 0) {
        missingFields.push("Valid number of Vehicles Affected");
    }
    if (!date) missingFields.push("Date");
    if (!time) missingFields.push("Time");
    if (!description) missingFields.push("Incident Description");

    if (missingFields.length > 0) {
        errorBox.innerHTML = `⚠️ <strong>Please complete all required fields:</strong><br>• ${missingFields.join('<br>• ')}`;
        errorBox.classList.remove('hidden');
        errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
    }

    errorBox.classList.add('hidden');

    const payload = {
        reportType: "traffic",
        incidentType: type,
        location: location,
        severity: severity,
        vehiclesAffected: parseInt(vehicles, 10),
        date: date,
        time: time,
        description: description
    };

    try {
        const data = await apiRequest('/reports', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (data && data.success && data.report) {
            const newReportId = data.report.reportId;
            generatedIdDisplay.innerText = newReportId;
            formCard.classList.add('hidden');
            successBox.classList.remove('hidden');
            successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await refreshAllViews();
        }
    } catch (err) {
        errorBox.innerText = err.message;
        errorBox.classList.remove('hidden');
        errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function resetFormView() {
    const formCard = document.getElementById('formCard');
    const successBox = document.getElementById('formSuccessMessage');
    const errorBox = document.getElementById('formErrorMessage');
    const form = document.getElementById('incidentForm');

    if (form) form.reset();
    setDefaultDateTime();

    if (errorBox) errorBox.classList.add('hidden');
    if (successBox) successBox.classList.add('hidden');
    if (formCard) formCard.classList.remove('hidden');
}

// Helper to convert captured Data URL to Blob for multipart upload
function dataURLtoBlob(dataURL) {
    const arr = dataURL.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

// --------------------------------------------------------------------------
// PART 8 & 9 — CREATE POTHOLE REPORT (POST /api/reports & POST /api/uploads/pothole-image)
// --------------------------------------------------------------------------

async function handlePotholeSubmit(event) {
    event.preventDefault();

    if (!getAuthToken()) {
        alert("Please log in to submit a pothole report.");
        openAuthModal('userLogin');
        return;
    }

    const location = document.getElementById('potholeLocation').value.trim();
    const description = document.getElementById('potholeDescription').value.trim();
    const date = document.getElementById('potholeDate').value;
    const time = document.getElementById('potholeTime').value;

    const errorBox = document.getElementById('potholeErrorMessage');
    const successBox = document.getElementById('potholeSuccessMessage');
    const formCard = document.getElementById('potholeFormCard');
    const generatedIdDisplay = document.getElementById('generatedPotholeIdDisplay');

    const missingFields = [];
    if (!location) missingFields.push("Location / Street Address");
    if (!description) missingFields.push("Description of Pothole");
    if (!date) missingFields.push("Date");
    if (!time) missingFields.push("Time");

    if (missingFields.length > 0) {
        errorBox.innerHTML = `⚠️ <strong>Please complete all required items:</strong><br>• ${missingFields.join('<br>• ')}`;
        errorBox.classList.remove('hidden');
        errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
    }

    errorBox.classList.add('hidden');

    let uploadedImageUrl = null;

    if (capturedPhotoDataUrl) {
        try {
            const blob = dataURLtoBlob(capturedPhotoDataUrl);
            const formData = new FormData();
            formData.append('image', blob, 'pothole_photo.jpg');

            const token = getAuthToken();
            const uploadRes = await fetch(`${API_BASE_URL}/uploads/pothole-image`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            const uploadData = await uploadRes.json();
            if (!uploadRes.ok || !uploadData.success) {
                throw new Error((uploadData && uploadData.message) || "Image upload failed. Maximum size is 5 MB.");
            }
            uploadedImageUrl = uploadData.imageUrl;
        } catch (uploadErr) {
            errorBox.innerText = uploadErr.message || "Image upload failed. Please try again.";
            errorBox.classList.remove('hidden');
            errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
        }
    }

    const payload = {
        reportType: "pothole",
        location: location,
        date: date,
        time: time,
        description: description,
        imageUrl: uploadedImageUrl
    };

    try {
        const data = await apiRequest('/reports', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (data && data.success && data.report) {
            const newPotholeId = data.report.reportId;
            generatedIdDisplay.innerText = newPotholeId;
            formCard.classList.add('hidden');
            successBox.classList.remove('hidden');
            successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await refreshAllViews();
        }
    } catch (err) {
        errorBox.innerText = err.message;
        errorBox.classList.remove('hidden');
        errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function resetPotholeFormView() {
    const formCard = document.getElementById('potholeFormCard');
    const successBox = document.getElementById('potholeSuccessMessage');
    const errorBox = document.getElementById('potholeErrorMessage');
    const form = document.getElementById('potholeForm');

    if (form) form.reset();
    capturedPhotoDataUrl = null;
    setDefaultDateTime();
    stopCameraStream();

    const photoPreviewContainer = document.getElementById('photoPreviewContainer');
    const retakePhotoBtn = document.getElementById('retakePhotoBtn');
    if (photoPreviewContainer) photoPreviewContainer.classList.add('hidden');
    if (retakePhotoBtn) retakePhotoBtn.classList.add('hidden');

    if (errorBox) errorBox.classList.add('hidden');
    if (successBox) successBox.classList.add('hidden');
    if (formCard) formCard.classList.remove('hidden');
}

// --------------------------------------------------------------------------
// PART 13 & 23 — VIEW REPORTS PAGE, SEARCH & FILTERING INTEGRATION
// --------------------------------------------------------------------------

function setupSearchDebounce() {
    const searchInput = document.getElementById('reportSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                filterAndRenderReports();
            }, 400);
        });
    }
}

async function filterAndRenderReports() {
    const searchInput = document.getElementById('reportSearchInput');
    const filterSelect = document.getElementById('reportFilterSelect');
    const prioritySelect = document.getElementById('reportPriorityFilterSelect');

    const searchQuery = searchInput ? searchInput.value.trim() : '';
    const filterCategory = filterSelect ? filterSelect.value : 'all';
    const filterPriority = prioritySelect ? prioritySelect.value : 'all';

    const params = {};
    if (searchQuery) params.search = searchQuery;
    if (filterCategory !== 'all') params.reportType = filterCategory;
    if (filterPriority !== 'all') params.priority = filterPriority;

    const reports = await fetchBackendReports(params);
    renderReportsGrid(reports);
}

function renderReportsGrid(reports) {
    const container = document.getElementById('reportsContainer');
    if (!container) return;

    if (reports.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #ffffff; border-radius: 10px; border: 1px solid #e2e8f0;">
                <p style="font-size: 1.5rem; margin-bottom: 0.5rem;">🔍 No reports found</p>
                <p style="color: #64748b;">Try adjusting your search terms or filter selection.</p>
            </div>
        `;
        return;
    }

    let cardsHtml = '';

    const currentUser = getCurrentUser();
    const isAdmin = currentUser && currentUser.role === 'admin';

    reports.forEach(report => {
        const priorityClass = getPriorityBadgeClass(report.priority);
        const statusClass = getStatusBadgeClass(report.status);
        const typeIcon = getTypeIcon(report.type);

        let bodyContent = '';

        let imgHtml = '';
        if (report.imageUrl) {
            const fullImgUrl = report.imageUrl.startsWith('http') ? report.imageUrl : API_BASE_URL.replace(/\/api\/?$/, '') + report.imageUrl;
            imgHtml = `<div class="report-image-container" style="margin-top:0.5rem; margin-bottom:0.5rem;"><img src="${escapeHtml(fullImgUrl)}" alt="Pothole Photo" class="report-thumbnail" style="max-width:100%; max-height:200px; border-radius:6px; object-fit:cover; cursor:pointer;" onclick="openPhotoModal('${escapeHtml(fullImgUrl)}')"></div>`;
        }

        if (report.category === 'pothole') {
            bodyContent = `
                <div class="report-meta-item"><strong>Location:</strong> ${escapeHtml(report.location)}</div>
                <div class="report-meta-item"><strong>Priority:</strong> <span class="badge ${priorityClass}">${escapeHtml(report.priority)}</span></div>
                <div class="report-meta-item"><strong>Date & Time:</strong> ${escapeHtml(report.date || '')} ${escapeHtml(report.time || '')}</div>
                ${imgHtml}
                <div class="report-description-text">${escapeHtml(report.description)}</div>
            `;
        } else {
            bodyContent = `
                <div class="report-meta-item"><strong>Location:</strong> ${escapeHtml(report.location)}</div>
                <div class="report-meta-item"><strong>Priority:</strong> <span class="badge ${priorityClass}">${escapeHtml(report.priority)}</span></div>
                <div class="report-meta-item"><strong>Severity Level:</strong> ${escapeHtml(report.severity || 'Medium')}</div>
                <div class="report-meta-item"><strong>Vehicles Affected:</strong> ${report.vehiclesAffected !== undefined ? report.vehiclesAffected : 0}</div>
                <div class="report-meta-item"><strong>Date & Time:</strong> ${escapeHtml(report.date || '')} ${escapeHtml(report.time || '')}</div>
                ${imgHtml}
                <div class="report-description-text">${escapeHtml(report.description)}</div>
            `;
        }

        const isPending = (report.verificationStatus === 'pending') || (report.status === 'Pending') || (report.status === 'Pending Verification');
        const isTraffic = report.category === 'incident' || report.reportType === 'traffic';

        let adminActionBtns = '';
        if (isAdmin) {
            if (isPending && report.verificationStatus !== 'verified' && report.verificationStatus !== 'false') {
                adminActionBtns = `
                    <button type="button" class="btn btn-sm btn-submit" style="background-color: var(--status-resolved);" onclick="verifyReport('${report.id}')">✓ Verify</button>
                    <button type="button" class="btn btn-sm btn-cancel" style="background-color: var(--status-false);" onclick="rejectReport('${report.id}')">✕ Reject</button>
                `;
            } else if (isTraffic) {
                if (report.status === 'Verified') {
                    adminActionBtns = `
                        <button type="button" class="btn btn-sm btn-correction" style="background-color: var(--status-progress);" onclick="changeReportStatus('${report.id}', 'In Progress', 'Are you sure you want to move this traffic report to In Progress?')">🚀 Start Progress</button>
                    `;
                } else if (report.status === 'In Progress') {
                    adminActionBtns = `
                        <button type="button" class="btn btn-sm btn-submit" style="background-color: var(--status-resolved);" onclick="changeReportStatus('${report.id}', 'Resolved', 'Are you sure you want to mark this traffic report as Resolved?')">🎉 Mark Resolved</button>
                    `;
                }
            } else {
                if (report.status === 'Verified') {
                    adminActionBtns = `
                        <button type="button" class="btn btn-sm btn-correction" style="background-color: var(--status-progress);" onclick="changeReportStatus('${report.id}', 'Correction in Progress', 'Are you sure you want to move this pothole report to Correction in Progress?')">🚜 Start Correction</button>
                    `;
                } else if (report.status === 'Correction in Progress') {
                    adminActionBtns = `
                        <button type="button" class="btn btn-sm btn-submit" style="background-color: var(--status-resolved);" onclick="changeReportStatus('${report.id}', 'Corrected', 'Are you sure you want to mark this pothole report as Corrected?')">✅ Mark Corrected</button>
                    `;
                }
            }
        }

        const isOwnerOrAdmin = currentUser && (isAdmin || report.reporterId === currentUser.userId);
        let ownerActionBtns = '';
        if (isOwnerOrAdmin) {
            ownerActionBtns = `
                <button type="button" class="btn btn-sm btn-correction" style="background-color: var(--status-progress);" onclick="openEditModal('${report.id}')">✏️ Edit</button>
                <button type="button" class="btn btn-sm btn-cancel" style="background-color: var(--status-false);" onclick="deleteReport('${report.id}')">🗑️ Delete</button>
            `;
        }

        cardsHtml += `
            <div class="report-card" data-report-id="${report.id}">
                <div>
                    <div class="report-card-header">
                        <span class="report-card-id">${report.id}</span>
                        <span class="report-card-type">${typeIcon} ${escapeHtml(report.type)}</span>
                    </div>
                    <div class="report-card-body">
                        ${bodyContent}
                    </div>
                </div>
                <div class="report-card-footer">
                    <div class="report-card-status-row">
                        <span class="badge ${statusClass}">${escapeHtml(report.status)}</span>
                    </div>
                    <div class="card-action-btns">
                        <button type="button" class="btn btn-sm btn-print" onclick="printSingleReport('${report.id}')">🖨️ Print</button>
                        <button type="button" class="btn btn-sm btn-track" onclick="openStatusTimeline('${report.id}')">📊 View Status</button>
                        ${ownerActionBtns}
                        ${adminActionBtns}
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = cardsHtml;
}

async function verifyReport(reportId) {
    if (!reportId) return;

    const isConfirmed = confirm("Are you sure you want to verify this report?");
    if (!isConfirmed) return;

    try {
        const data = await apiRequest(`/admin/reports/${reportId}/verify`, {
            method: 'PATCH'
        });

        if (data && data.success) {
            alert(`Report ${reportId} verified successfully.`);
            await refreshAllViews();
        }
    } catch (err) {
        alert(err.message || "Failed to verify report");
    }
}

async function rejectReport(reportId) {
    if (!reportId) return;

    const isConfirmed = confirm("Are you sure you want to reject this report as a false report?");
    if (!isConfirmed) return;

    try {
        const data = await apiRequest(`/admin/reports/${reportId}/reject`, {
            method: 'PATCH'
        });

        if (data && data.success) {
            alert(`Report ${reportId} rejected as false report.`);
            await refreshAllViews();
        }
    } catch (err) {
        alert(err.message || "Failed to reject report");
    }
}

async function changeReportStatus(reportId, nextStatus, confirmMessage) {
    if (!reportId || !nextStatus) return;

    if (confirmMessage && !confirm(confirmMessage)) {
        return;
    }

    try {
        const data = await apiRequest(`/admin/reports/${reportId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: nextStatus })
        });

        if (data && data.success) {
            alert(`Report ${reportId} status updated to "${nextStatus}".`);
            await refreshAllViews();
        }
    } catch (err) {
        alert(err.message || "Failed to update report status");
    }
}

// --------------------------------------------------------------------------
// MODULE 13 — EDIT & DELETE REPORT FUNCTIONS
// --------------------------------------------------------------------------

async function openEditModal(reportId) {
    if (!reportId) return;

    const report = await fetchSingleReport(reportId);
    if (!report) {
        alert("Report not found!");
        return;
    }

    const modal = document.getElementById('editReportModal');
    const modalId = document.getElementById('editModalReportId');
    const errorBox = document.getElementById('editModalError');

    const editId = document.getElementById('editReportId');
    const editCategory = document.getElementById('editReportCategory');
    const editType = document.getElementById('editType');
    const editLocation = document.getElementById('editLocation');
    const editSeverity = document.getElementById('editSeverity');
    const editVehicles = document.getElementById('editVehicles');
    const editDate = document.getElementById('editDate');
    const editTime = document.getElementById('editTime');
    const editDescription = document.getElementById('editDescription');

    const groupType = document.getElementById('editGroupType');
    const groupSeverity = document.getElementById('editGroupSeverity');
    const groupVehicles = document.getElementById('editGroupVehicles');

    if (errorBox) errorBox.classList.add('hidden');

    if (modalId) modalId.innerText = report.id;
    if (editId) editId.value = report.id;
    if (editCategory) editCategory.value = report.category || report.reportType || 'traffic';

    if (editLocation) editLocation.value = report.location || '';
    if (editDate) editDate.value = report.date || '';
    if (editTime) editTime.value = report.time || '';
    if (editDescription) editDescription.value = report.description || '';

    const isTraffic = (report.category === 'incident' || report.reportType === 'traffic');
    if (isTraffic) {
        if (groupType) groupType.classList.remove('hidden');
        if (groupSeverity) groupSeverity.classList.remove('hidden');
        if (groupVehicles) groupVehicles.classList.remove('hidden');

        if (editType) editType.value = report.incidentType || report.type || 'Accident';
        if (editSeverity) {
            const sev = (report.severity || 'Medium');
            editSeverity.value = sev.charAt(0).toUpperCase() + sev.slice(1).toLowerCase();
        }
        if (editVehicles) editVehicles.value = report.vehiclesAffected !== undefined ? report.vehiclesAffected : 0;
    } else {
        if (groupType) groupType.classList.add('hidden');
        if (groupSeverity) groupSeverity.classList.add('hidden');
        if (groupVehicles) groupVehicles.classList.add('hidden');
    }

    if (modal) modal.classList.remove('hidden');
}

function closeEditModal() {
    const modal = document.getElementById('editReportModal');
    const errorBox = document.getElementById('editModalError');
    if (errorBox) errorBox.classList.add('hidden');
    if (modal) modal.classList.add('hidden');
}

async function handleEditReportSubmit(event) {
    event.preventDefault();

    const reportId = document.getElementById('editReportId').value;
    const category = document.getElementById('editReportCategory').value;
    const errorBox = document.getElementById('editModalError');

    const location = document.getElementById('editLocation').value.trim();
    const date = document.getElementById('editDate').value;
    const time = document.getElementById('editTime').value;
    const description = document.getElementById('editDescription').value.trim();

    const isTraffic = (category === 'incident' || category === 'traffic');
    const payload = {
        location,
        date,
        time,
        description
    };

    if (isTraffic) {
        payload.incidentType = document.getElementById('editType').value;
        payload.severity = document.getElementById('editSeverity').value.toLowerCase();
        payload.vehiclesAffected = parseInt(document.getElementById('editVehicles').value || 0, 10);
    }

    try {
        const data = await apiRequest(`/reports/${reportId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });

        if (data && data.success) {
            alert(`Report ${reportId} updated successfully.`);
            closeEditModal();
            await refreshAllViews();
        }
    } catch (err) {
        if (errorBox) {
            errorBox.innerText = err.message || "Failed to edit report";
            errorBox.classList.remove('hidden');
        } else {
            alert(err.message || "Failed to edit report");
        }
    }
}

async function deleteReport(reportId) {
    if (!reportId) return;

    const isConfirmed = confirm(`Are you sure you want to delete report ${reportId}?`);
    if (!isConfirmed) return;

    try {
        const data = await apiRequest(`/reports/${reportId}`, {
            method: 'DELETE'
        });

        if (data && data.success) {
            alert(`Report ${reportId} deleted successfully.`);
            await refreshAllViews();
        }
    } catch (err) {
        alert(err.message || "Failed to delete report");
    }
}

// Lightbox & Modals
function openPhotoModal(imageSrc) {
    const modal = document.getElementById('photoModal');
    const img = document.getElementById('photoModalImg');
    if (modal && img) {
        img.src = imageSrc;
        modal.classList.remove('hidden');
    }
}

function closePhotoModal() {
    const modal = document.getElementById('photoModal');
    if (modal) modal.classList.add('hidden');
}

// --------------------------------------------------------------------------
// PART 12 — DASHBOARD INTEGRATION
// --------------------------------------------------------------------------

async function loadDashboardData() {
    try {
        let stats = null;

        // If user is authenticated, fetch statistics from backend API
        if (getAuthToken()) {
            try {
                const data = await apiRequest('/dashboard/stats');
                if (data && data.success && data.stats) {
                    stats = data.stats;
                }
            } catch (err) {
                console.warn("Backend dashboard stats request failed, falling back gracefully:", err.message);
            }
        }

        const reports = await fetchBackendReports({ limit: 20 });

        let totalCount = stats ? stats.totalReports : reports.length;
        let pendingCount = stats ? stats.pendingReports : 0;
        let verifiedCount = stats ? stats.verifiedReports : 0;
        let resolvedCount = stats ? stats.resolvedReports : 0;
        let highPriorityCount = stats ? stats.highPriorityReports : 0;
        let mediumPriorityCount = stats ? stats.mediumPriorityReports : 0;
        let lowPriorityCount = stats ? stats.lowPriorityReports : 0;

        if (!stats) {
            reports.forEach(r => {
                const s = r.status;
                if (s === 'Pending' || s === 'Pending Verification') pendingCount++;
                else if (s === 'Verified' || s === 'In Progress' || s === 'Correction in Progress') verifiedCount++;
                else if (s === 'Resolved' || s === 'Corrected') resolvedCount++;

                const priority = (r.priority || 'Medium').toUpperCase();
                if (priority === 'HIGH' || priority === 'CRITICAL') highPriorityCount++;
                else if (priority === 'LOW') lowPriorityCount++;
                else mediumPriorityCount++;
            });
        }

        const statTotalEl = document.getElementById('statTotal');
        const statPendingEl = document.getElementById('statPending');
        const statVerifiedEl = document.getElementById('statVerified');
        const statResolvedEl = document.getElementById('statResolved');

        const statPriorityHighEl = document.getElementById('statHighPriority');
        const statPriorityMediumEl = document.getElementById('statMediumPriority');
        const statPriorityLowEl = document.getElementById('statLowPriority');

        if (statTotalEl) statTotalEl.innerText = totalCount;
        if (statPendingEl) statPendingEl.innerText = pendingCount;
        if (statVerifiedEl) statVerifiedEl.innerText = verifiedCount;
        if (statResolvedEl) statResolvedEl.innerText = resolvedCount;

        if (statPriorityHighEl) statPriorityHighEl.innerText = highPriorityCount;
        if (statPriorityMediumEl) statPriorityMediumEl.innerText = mediumPriorityCount;
        if (statPriorityLowEl) statPriorityLowEl.innerText = lowPriorityCount;

        // Load Notifications
        loadDashboardNotificationsFromReports(reports);

        // Render Recent 5 Reports Table from backend stats.recentReports if available
        const tbody = document.getElementById('recentReportsBody');
        if (tbody) {
            let latest5 = [];
            if (stats && Array.isArray(stats.recentReports) && stats.recentReports.length > 0) {
                latest5 = stats.recentReports.map(r => ({
                    id: r.reportId || r.id,
                    type: r.incidentType || (r.reportType === 'pothole' ? 'Pothole' : 'Traffic Incident'),
                    location: r.location || '',
                    priority: r.priority || 'Medium',
                    status: r.status || 'Pending'
                }));
            } else if (reports.length > 0) {
                const sorted = [...reports].sort((a, b) => {
                    const timeA = new Date(`${a.date || ''} ${a.time || ''}`).getTime();
                    const timeB = new Date(`${b.date || ''} ${b.time || ''}`).getTime();
                    if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) return timeB - timeA;
                    return (b.id || '').localeCompare(a.id || '', undefined, { numeric: true });
                });
                latest5 = sorted.slice(0, 5);
            }

            if (latest5.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2.5rem; color:#64748b;">No reports available yet.</td></tr>`;
            } else {
                let tableHtml = '';
                latest5.forEach(report => {
                    const priorityClass = getPriorityBadgeClass(report.priority);
                    const statusClass = getStatusBadgeClass(report.status);
                    const typeIcon = getTypeIcon(report.type);

                    tableHtml += `
                        <tr>
                            <td><span class="id-badge">${report.id}</span></td>
                            <td>${typeIcon} ${escapeHtml(report.type)}</td>
                            <td>${escapeHtml(report.location)}</td>
                            <td><span class="badge ${priorityClass}">${escapeHtml(report.priority)}</span></td>
                            <td>
                                <span class="badge ${statusClass}">${escapeHtml(report.status)}</span>
                                <button type="button" class="btn btn-sm btn-track" style="margin-left: 0.5rem; padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="openStatusTimeline('${report.id}')">📊 Track</button>
                            </td>
                        </tr>
                    `;
                });
                tbody.innerHTML = tableHtml;
            }
        }
    } catch (err) {
        console.warn("Error loading dashboard data:", err.message);
    }
}

function loadDashboardNotificationsFromReports(reports) {
    const container = document.getElementById('notificationsContainer');
    const badgeCountEl = document.getElementById('notifBadgeCount');
    if (!container) return;

    const pendingItems = [];
    const inProgressItems = [];
    const resolvedItems = [];

    reports.forEach(report => {
        if (report.status === 'Pending' || report.status === 'Pending Verification') {
            pendingItems.push(report);
        } else if (report.status === 'In Progress' || report.status === 'Correction in Progress' || report.status === 'Verified') {
            inProgressItems.push(report);
        } else if (report.status === 'Resolved' || report.status === 'Corrected') {
            resolvedItems.push(report);
        }
    });

    const attentionCount = pendingItems.length + inProgressItems.length;

    if (badgeCountEl) {
        badgeCountEl.innerText = attentionCount;
        if (attentionCount === 0) {
            badgeCountEl.classList.add('zero');
        } else {
            badgeCountEl.classList.remove('zero');
        }
    }

    if (reports.length === 0) {
        container.innerHTML = `<div class="notification-empty">No new alerts.</div>`;
        return;
    }

    let notifHtml = '';
    let displayedCount = 0;
    const MAX_NOTIFS = 5;

    pendingItems.forEach(report => {
        if (displayedCount >= MAX_NOTIFS) return;
        const msg = `<strong>${report.id}</strong> (${escapeHtml(report.location)}) is waiting for verification.`;
        notifHtml += `
            <div class="notification-item urgent">
                <div class="notification-content">
                    <span class="notification-icon">⏳</span>
                    <span class="notification-message">${msg}</span>
                </div>
                <button type="button" class="btn btn-sm btn-track" onclick="openStatusTimeline('${report.id}')">View</button>
            </div>
        `;
        displayedCount++;
    });

    inProgressItems.forEach(report => {
        if (displayedCount >= MAX_NOTIFS) return;
        const msg = `<strong>${report.id}</strong> in progress at ${escapeHtml(report.location)}.`;
        notifHtml += `
            <div class="notification-item progress">
                <div class="notification-content">
                    <span class="notification-icon">🚀</span>
                    <span class="notification-message">${msg}</span>
                </div>
                <button type="button" class="btn btn-sm btn-track" onclick="openStatusTimeline('${report.id}')">View</button>
            </div>
        `;
        displayedCount++;
    });

    resolvedItems.forEach(report => {
        if (displayedCount >= MAX_NOTIFS) return;
        const msg = `<strong>${report.id}</strong> resolved at ${escapeHtml(report.location)}.`;
        notifHtml += `
            <div class="notification-item resolved">
                <div class="notification-content">
                    <span class="notification-icon">✅</span>
                    <span class="notification-message">${msg}</span>
                </div>
                <button type="button" class="btn btn-sm btn-track" onclick="openStatusTimeline('${report.id}')">View</button>
            </div>
        `;
        displayedCount++;
    });

    if (!notifHtml) {
        notifHtml = `<div class="notification-empty">No new alerts.</div>`;
    }

    container.innerHTML = notifHtml;
}

// --------------------------------------------------------------------------
// ADMIN DASHBOARD (PART 21 - LOG IN, VIEW REPORTS & SESSION ONLY)
// --------------------------------------------------------------------------

function filterAdminReports(filterCategory) {
    currentAdminFilter = filterCategory;

    const filterIds = [
        'adminFilterAll', 'adminFilterIncidents', 'adminFilterPotholes',
        'adminFilterPending', 'adminFilterVerified', 'adminFilterFalse', 'adminFilterResolved'
    ];

    filterIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.remove('active');
    });

    const targetMap = {
        'all': 'adminFilterAll',
        'incidents': 'adminFilterIncidents',
        'potholes': 'adminFilterPotholes',
        'pending': 'adminFilterPending',
        'verified': 'adminFilterVerified',
        'false': 'adminFilterFalse',
        'resolved': 'adminFilterResolved'
    };

    const targetBtn = document.getElementById(targetMap[filterCategory]);
    if (targetBtn) targetBtn.classList.add('active');

    loadAdminDashboardData();
}

async function loadAdminDashboardData() {
    let params = { limit: 100 };

    if (currentAdminFilter === 'incidents') params.reportType = 'traffic';
    else if (currentAdminFilter === 'potholes') params.reportType = 'pothole';
    else if (currentAdminFilter === 'pending') params.status = 'Pending';
    else if (currentAdminFilter === 'verified') params.status = 'Verified';

    const reports = await fetchBackendReports(params);

    const totalCount = reports.length;
    let incidentsCount = 0;
    let potholesCount = 0;
    let pendingCount = 0;
    let verifiedCount = 0;
    let falseCount = 0;
    let resolvedCount = 0;

    reports.forEach(r => {
        if (r.category === 'incident' || r.reportType === 'traffic') incidentsCount++;
        else potholesCount++;

        const s = r.status;
        if (s === 'Pending' || s === 'Pending Verification') pendingCount++;
        else if (s === 'Verified' || s === 'In Progress' || s === 'Correction in Progress') verifiedCount++;
        else if (s === 'False Report') falseCount++;
        else if (s === 'Resolved' || s === 'Corrected') resolvedCount++;
    });

    const adminTotalEl = document.getElementById('adminStatTotal');
    const adminIncidentsEl = document.getElementById('adminStatIncidents');
    const adminPotholesEl = document.getElementById('adminStatPotholes');
    const adminPendingEl = document.getElementById('adminStatPending');
    const adminVerifiedEl = document.getElementById('adminStatVerified');
    const adminFalseEl = document.getElementById('adminStatFalse');
    const adminResolvedEl = document.getElementById('adminStatResolved');

    if (adminTotalEl) adminTotalEl.innerText = totalCount;
    if (adminIncidentsEl) adminIncidentsEl.innerText = incidentsCount;
    if (adminPotholesEl) adminPotholesEl.innerText = potholesCount;
    if (adminPendingEl) adminPendingEl.innerText = pendingCount;
    if (adminVerifiedEl) adminVerifiedEl.innerText = verifiedCount;
    if (adminFalseEl) adminFalseEl.innerText = falseCount;
    if (adminResolvedEl) adminResolvedEl.innerText = resolvedCount;

    renderAdminReportsGrid(reports);
}

function renderAdminReportsGrid(reports) {
    const container = document.getElementById('adminReportsContainer');
    if (!container) return;

    if (reports.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #ffffff; border-radius: 10px; border: 1px solid #e2e8f0; color: #64748b;">
                <p style="font-size: 1.5rem; margin-bottom: 0.5rem;">📋 No reports match the selected admin filter</p>
                <p>Select another filter above or submit new incident/pothole reports.</p>
            </div>
        `;
        return;
    }

    let html = '';

    const currentUser = getCurrentUser();
    const isAdmin = currentUser && currentUser.role === 'admin';

    reports.forEach(report => {
        const priorityClass = getPriorityBadgeClass(report.priority);
        const statusClass = getStatusBadgeClass(report.status);
        const typeIcon = getTypeIcon(report.type);

        let imgHtml = '';
        if (report.imageUrl) {
            const fullImgUrl = report.imageUrl.startsWith('http') ? report.imageUrl : API_BASE_URL.replace(/\/api\/?$/, '') + report.imageUrl;
            imgHtml = `<div class="report-image-container" style="margin-top:0.5rem; margin-bottom:0.5rem;"><img src="${escapeHtml(fullImgUrl)}" alt="Pothole Photo" class="report-thumbnail" style="max-width:100%; max-height:200px; border-radius:6px; object-fit:cover; cursor:pointer;" onclick="openPhotoModal('${escapeHtml(fullImgUrl)}')"></div>`;
        }

        let bodyContent = `
            <div class="report-meta-item"><strong>Priority:</strong> <span class="badge ${priorityClass}">${escapeHtml(report.priority)}</span></div>
            <div class="report-meta-item"><strong>Location:</strong> ${escapeHtml(report.location)}</div>
            <div class="report-meta-item"><strong>Date & Time:</strong> ${escapeHtml(report.date || '')} ${escapeHtml(report.time || '')}</div>
            ${imgHtml}
            <div class="report-description-text">${escapeHtml(report.description)}</div>
        `;

        const isPending = (report.verificationStatus === 'pending') || (report.status === 'Pending') || (report.status === 'Pending Verification');
        const isTraffic = report.category === 'incident' || report.reportType === 'traffic';

        let adminActionBtns = '';
        if (isAdmin) {
            if (isPending && report.verificationStatus !== 'verified' && report.verificationStatus !== 'false') {
                adminActionBtns = `
                    <button type="button" class="btn btn-sm btn-submit" style="background-color: var(--status-resolved);" onclick="verifyReport('${report.id}')">✓ Verify</button>
                    <button type="button" class="btn btn-sm btn-cancel" style="background-color: var(--status-false);" onclick="rejectReport('${report.id}')">✕ Reject</button>
                `;
            } else if (isTraffic) {
                if (report.status === 'Verified') {
                    adminActionBtns = `
                        <button type="button" class="btn btn-sm btn-correction" style="background-color: var(--status-progress);" onclick="changeReportStatus('${report.id}', 'In Progress', 'Are you sure you want to move this traffic report to In Progress?')">🚀 Start Progress</button>
                    `;
                } else if (report.status === 'In Progress') {
                    adminActionBtns = `
                        <button type="button" class="btn btn-sm btn-submit" style="background-color: var(--status-resolved);" onclick="changeReportStatus('${report.id}', 'Resolved', 'Are you sure you want to mark this traffic report as Resolved?')">🎉 Mark Resolved</button>
                    `;
                }
            } else {
                if (report.status === 'Verified') {
                    adminActionBtns = `
                        <button type="button" class="btn btn-sm btn-correction" style="background-color: var(--status-progress);" onclick="changeReportStatus('${report.id}', 'Correction in Progress', 'Are you sure you want to move this pothole report to Correction in Progress?')">🚜 Start Correction</button>
                    `;
                } else if (report.status === 'Correction in Progress') {
                    adminActionBtns = `
                        <button type="button" class="btn btn-sm btn-submit" style="background-color: var(--status-resolved);" onclick="changeReportStatus('${report.id}', 'Corrected', 'Are you sure you want to mark this pothole report as Corrected?')">✅ Mark Corrected</button>
                    `;
                }
            }
        }

        html += `
            <div class="report-card" data-report-id="${report.id}">
                <div>
                    <div class="report-card-header">
                        <span class="report-card-id">${report.id}</span>
                        <span class="report-card-type">${typeIcon} ${escapeHtml(report.type)}</span>
                    </div>
                    <div class="report-card-body">
                        ${bodyContent}
                    </div>
                </div>
                <div class="report-card-footer">
                    <div class="report-card-status-row">
                        <span class="badge ${statusClass}">${escapeHtml(report.status)}</span>
                    </div>
                    <div class="card-action-btns">
                        <button type="button" class="btn btn-sm btn-track" onclick="openStatusTimeline('${report.id}')">📊 Timeline</button>
                        ${adminActionBtns}
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// --------------------------------------------------------------------------
// PART 14 & 22 — STATUS TIMELINE & INCIDENT MAP VISUALIZATION
// --------------------------------------------------------------------------

let currentOpenTimelineReportId = null;
let currentOpenMapReportId = null;

async function openStatusTimeline(reportId, forceFresh = false) {
    currentOpenTimelineReportId = reportId;
    const modal = document.getElementById('statusTimelineModal');
    const subHeader = document.getElementById('timelineReportSubHeader');
    const summaryBox = document.getElementById('timelineSummaryHeader');
    const stepsContainer = document.getElementById('timelineStepsContainer');

    if (!modal || !stepsContainer) return;

    const report = await fetchSingleReport(reportId, forceFresh);
    if (!report) {
        alert("Report not found!");
        return;
    }

    const priorityClass = getPriorityBadgeClass(report.priority);
    const statusClass = getStatusBadgeClass(report.status);
    const typeIcon = getTypeIcon(report.type);

    if (subHeader) {
        subHeader.innerText = `${report.id} • ${report.type} • ${report.location}`;
    }

    let imgSummaryHtml = '';
    if (report.imageUrl) {
        const fullImgUrl = report.imageUrl.startsWith('http') ? report.imageUrl : API_BASE_URL.replace(/\/api\/?$/, '') + report.imageUrl;
        imgSummaryHtml = `
            <div class="timeline-summary-item" style="grid-column: 1 / -1;">
                <span class="timeline-summary-label">Attached Photo</span>
                <div style="margin-top: 0.25rem;"><img src="${escapeHtml(fullImgUrl)}" alt="Pothole Photo" style="max-width: 150px; max-height: 100px; border-radius: 6px; cursor: pointer;" onclick="openPhotoModal('${escapeHtml(fullImgUrl)}')"></div>
            </div>
        `;
    }

    if (summaryBox) {
        summaryBox.innerHTML = `
            <div class="timeline-summary-item">
                <span class="timeline-summary-label">Report ID</span>
                <span class="timeline-summary-value" style="color: var(--primary-color);">${report.id}</span>
            </div>
            <div class="timeline-summary-item">
                <span class="timeline-summary-label">Type</span>
                <span class="timeline-summary-value">${typeIcon} ${escapeHtml(report.type)}</span>
            </div>
            <div class="timeline-summary-item">
                <span class="timeline-summary-label">Priority</span>
                <span class="badge ${priorityClass}">${escapeHtml(report.priority)}</span>
            </div>
            <div class="timeline-summary-item">
                <span class="timeline-summary-label">Current Status</span>
                <span class="badge ${statusClass}">${escapeHtml(report.status)}</span>
            </div>
            ${imgSummaryHtml}
        `;
    }

    let expectedWorkflow = [];
    if (report.category === 'pothole') {
        expectedWorkflow = [
            { id: 'Pending Verification', label: 'Reported / Pending Verification' },
            { id: 'Verified', label: 'Verified by Admin' },
            { id: 'Correction in Progress', label: 'Correction in Progress' },
            { id: 'Corrected', label: 'Road Corrected & Resolved' }
        ];
    } else {
        expectedWorkflow = [
            { id: 'Pending', label: 'Reported / Pending Review' },
            { id: 'Verified', label: 'Verified by Admin' },
            { id: 'In Progress', label: 'Work In Progress' },
            { id: 'Resolved', label: 'Incident Resolved' }
        ];
    }

    const history = report.statusHistory || [];
    const isFalseReport = (report.status === 'False Report');

    let timelineHtml = '';

    if (isFalseReport) {
        const initialHist = history[0] || { date: report.date || '', time: report.time || '' };
        const falseHist = history.find(h => h.status === 'False Report') || history[history.length - 1];

        const initialTimeStr = initialHist.changedAt ? new Date(initialHist.changedAt).toLocaleString() : `${initialHist.date || ''} ${initialHist.time || ''}`.trim();
        const falseTimeStr = falseHist && falseHist.changedAt ? new Date(falseHist.changedAt).toLocaleString() : `${falseHist.date || ''} ${falseHist.time || ''}`.trim();

        timelineHtml = `
            <div class="timeline-step completed">
                <div class="timeline-marker">✓</div>
                <div class="timeline-content">
                    <div class="timeline-title">
                        <span>Report Submitted</span>
                        <span class="timeline-time">📅 ${escapeHtml(initialTimeStr)}</span>
                    </div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(initialHist.note || "Incident report registered in system.")}</div>
                </div>
            </div>
            <div class="timeline-step false-report">
                <div class="timeline-marker">✕</div>
                <div class="timeline-content">
                    <div class="timeline-title">
                        <span>Marked as False Report</span>
                        <span class="timeline-time">📅 ${escapeHtml(falseTimeStr)}</span>
                    </div>
                    <div style="font-size: 0.85rem; color: var(--status-false);">${escapeHtml((falseHist && falseHist.note) || "Admin reviewed and identified this report as invalid/false.")} ${falseHist && falseHist.changedBy ? `(${escapeHtml(falseHist.changedBy)})` : ''}</div>
                </div>
            </div>
        `;
    } else {
        let activeIndex = 0;
        expectedWorkflow.forEach((wf, idx) => {
            if (history.some(h => h.status === wf.id)) {
                activeIndex = idx;
            }
        });

        expectedWorkflow.forEach((wf, idx) => {
            const historyMatch = history.find(h => h.status === wf.id);

            let stepClass = 'upcoming';
            let markerContent = '○';

            if (idx < activeIndex) {
                stepClass = 'completed';
                markerContent = '✓';
            } else if (idx === activeIndex) {
                stepClass = 'active';
                markerContent = '●';
            }

            let timestampHtml = `<span style="font-style: italic; color: #94a3b8;">Pending step</span>`;
            if (historyMatch) {
                const formattedTime = historyMatch.changedAt ? new Date(historyMatch.changedAt).toLocaleString() : `${historyMatch.date || ''} ${historyMatch.time || ''}`.trim();
                timestampHtml = `📅 ${escapeHtml(formattedTime)}`;
            }

            let detailMsg = `Awaiting workflow transition.`;
            if (historyMatch) {
                const noteStr = historyMatch.note ? escapeHtml(historyMatch.note) : `Status updated to <strong>${escapeHtml(wf.id)}</strong>`;
                const byStr = historyMatch.changedBy ? ` <span style="color: #64748b; font-size: 0.8rem;">(By ${escapeHtml(historyMatch.changedBy)})</span>` : '';
                detailMsg = `${noteStr}${byStr}`;
            }

            timelineHtml += `
                <div class="timeline-step ${stepClass}">
                    <div class="timeline-marker">${markerContent}</div>
                    <div class="timeline-content">
                        <div class="timeline-title">
                            <span>${escapeHtml(wf.label)}</span>
                            <span class="timeline-time">${timestampHtml}</span>
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">
                            ${detailMsg}
                        </div>
                    </div>
                </div>
            `;
        });
    }

    stepsContainer.innerHTML = timelineHtml;
    modal.classList.remove('hidden');
}

function closeStatusTimelineModal() {
    currentOpenTimelineReportId = null;
    const modal = document.getElementById('statusTimelineModal');
    if (modal) modal.classList.add('hidden');
}

function getLocationCoordinates(locationStr) {
    if (!locationStr) return { x: 50, y: 50 };

    const locLower = locationStr.trim().toLowerCase();

    for (const key in CITY_LOCATION_COORDINATES) {
        if (locLower.includes(key)) {
            return CITY_LOCATION_COORDINATES[key];
        }
    }

    let hash = 0;
    for (let i = 0; i < locationStr.length; i++) {
        hash = locationStr.charCodeAt(i) + ((hash << 5) - hash);
    }

    const posX = 15 + (Math.abs(hash) % 70);
    const posY = 15 + (Math.abs(hash * 7) % 70);

    return { x: posX, y: posY };
}

function filterMapReports(filterCategory) {
    currentMapFilter = filterCategory;

    const btnAll = document.getElementById('mapFilterAll');
    const btnIncidents = document.getElementById('mapFilterIncidents');
    const btnPotholes = document.getElementById('mapFilterPotholes');

    if (btnAll) btnAll.classList.remove('active');
    if (btnIncidents) btnIncidents.classList.remove('active');
    if (btnPotholes) btnPotholes.classList.remove('active');

    if (filterCategory === 'incidents' && btnIncidents) btnIncidents.classList.add('active');
    else if (filterCategory === 'potholes' && btnPotholes) btnPotholes.classList.add('active');
    else if (btnAll) btnAll.classList.add('active');

    renderIncidentMap();
}

async function renderIncidentMap() {
    const pinsContainer = document.getElementById('mapPinsContainer');
    if (!pinsContainer) return;

    let params = { limit: 100 };
    if (currentMapFilter === 'incidents') params.reportType = 'traffic';
    else if (currentMapFilter === 'potholes') params.reportType = 'pothole';

    const reports = await fetchBackendReports(params);

    const totalCount = reports.length;
    let incidentsCount = 0;
    let potholesCount = 0;
    let pendingCount = 0;

    reports.forEach(r => {
        if (r.category === 'pothole' || r.reportType === 'pothole') potholesCount++;
        else incidentsCount++;

        if (r.status === 'Pending' || r.status === 'Pending Verification') pendingCount++;
    });

    const mapStatTotalEl = document.getElementById('mapStatTotal');
    const mapStatIncidentsEl = document.getElementById('mapStatIncidents');
    const mapStatPotholesEl = document.getElementById('mapStatPotholes');
    const mapStatPendingEl = document.getElementById('mapStatPending');

    if (mapStatTotalEl) mapStatTotalEl.innerText = totalCount;
    if (mapStatIncidentsEl) mapStatIncidentsEl.innerText = incidentsCount;
    if (mapStatPotholesEl) mapStatPotholesEl.innerText = potholesCount;
    if (mapStatPendingEl) mapStatPendingEl.innerText = pendingCount;

    let pinsHtml = '';
    reports.forEach((report, index) => {
        const coords = getLocationCoordinates(report.location);
        const icon = (report.category === 'pothole' || report.reportType === 'pothole') ? '🕳️' : '🚨';
        const priority = report.priority || 'Medium';

        let pinPriorityClass = 'pin-priority-medium';
        const pUpper = String(priority).toUpperCase();
        if (pUpper === 'HIGH' || pUpper === 'CRITICAL') pinPriorityClass = 'pin-priority-high';
        else if (pUpper === 'LOW') pinPriorityClass = 'pin-priority-low';

        const offsetX = coords.x + ((index % 3) - 1) * 3;
        const offsetY = coords.y + (Math.floor(index / 3) % 3 - 1) * 3;

        let statusDotColor = 'var(--status-pending)';
        if (report.status === 'Verified' || report.status === 'Resolved' || report.status === 'Corrected') {
            statusDotColor = 'var(--status-resolved)';
        } else if (report.status === 'False Report') {
            statusDotColor = 'var(--status-false)';
        }

        pinsHtml += `
            <div class="map-pin-marker ${pinPriorityClass}" style="left: ${offsetX}%; top: ${offsetY}%;" onclick="showReportDetails('${report.id}')" title="Click to view details for ${report.id} (${priority} Priority)">
                <div class="pin-icon-box">
                    <span>${icon}</span>
                    <span class="pin-status-dot" style="background-color: ${statusDotColor};"></span>
                </div>
                <div class="pin-label-tag">${report.id}</div>
            </div>
        `;
    });

    pinsContainer.innerHTML = pinsHtml;
}

async function showReportDetails(reportId) {
    const modal = document.getElementById('mapReportModal');
    const modalTitle = document.getElementById('mapModalTitle');
    const modalBody = document.getElementById('mapModalBody');

    const report = await fetchSingleReport(reportId);
    if (!report || !modal || !modalBody) return;

    if (modalTitle) modalTitle.innerText = `${report.id} - ${report.type} (${report.location})`;

    const priorityClass = getPriorityBadgeClass(report.priority);
    const statusClass = getStatusBadgeClass(report.status);
    const typeIcon = getTypeIcon(report.type);

    const currentUser = getCurrentUser();
    const isAdmin = currentUser && currentUser.role === 'admin';
    const verStatus = report.verificationStatus || 'pending';
    const isTraffic = report.category === 'incident' || report.reportType === 'traffic';

    let verLabel = 'Pending';
    if (verStatus === 'verified') verLabel = 'Verified';
    else if (verStatus === 'false') verLabel = 'False Report';

    let adminDetailBtns = '';
    if (isAdmin) {
        if (verStatus === 'pending') {
            adminDetailBtns = `
                <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
                    <button type="button" class="btn btn-sm btn-submit" style="flex: 1; background-color: var(--status-resolved);" onclick="closeMapReportModal(); verifyReport('${report.id}');">✓ Verify</button>
                    <button type="button" class="btn btn-sm btn-cancel" style="flex: 1; background-color: var(--status-false);" onclick="closeMapReportModal(); rejectReport('${report.id}');">✕ Reject</button>
                </div>
            `;
        } else if (isTraffic) {
            if (report.status === 'Verified') {
                adminDetailBtns = `
                    <div style="margin-top: 0.75rem;">
                        <button type="button" class="btn btn-sm btn-correction" style="width: 100%; background-color: var(--status-progress);" onclick="closeMapReportModal(); changeReportStatus('${report.id}', 'In Progress', 'Are you sure you want to move this traffic report to In Progress?');">🚀 Start Progress</button>
                    </div>
                `;
            } else if (report.status === 'In Progress') {
                adminDetailBtns = `
                    <div style="margin-top: 0.75rem;">
                        <button type="button" class="btn btn-sm btn-submit" style="width: 100%; background-color: var(--status-resolved);" onclick="closeMapReportModal(); changeReportStatus('${report.id}', 'Resolved', 'Are you sure you want to mark this traffic report as Resolved?');">🎉 Mark Resolved</button>
                    </div>
                `;
            }
        } else {
            if (report.status === 'Verified') {
                adminDetailBtns = `
                    <div style="margin-top: 0.75rem;">
                        <button type="button" class="btn btn-sm btn-correction" style="width: 100%; background-color: var(--status-progress);" onclick="closeMapReportModal(); changeReportStatus('${report.id}', 'Correction in Progress', 'Are you sure you want to move this pothole report to Correction in Progress?');">🚜 Start Correction</button>
                    </div>
                `;
            } else if (report.status === 'Correction in Progress') {
                adminDetailBtns = `
                    <div style="margin-top: 0.75rem;">
                        <button type="button" class="btn btn-sm btn-submit" style="width: 100%; background-color: var(--status-resolved);" onclick="closeMapReportModal(); changeReportStatus('${report.id}', 'Corrected', 'Are you sure you want to mark this pothole report as Corrected?');">✅ Mark Corrected</button>
                    </div>
                `;
            }
        }
    }

    let detailsHtml = `
        <div class="report-meta-item"><strong>Report Type:</strong> ${report.type} (${typeIcon})</div>
        <div class="report-meta-item"><strong>Location:</strong> ${escapeHtml(report.location)}</div>
        <div class="report-meta-item"><strong>Priority:</strong> <span class="badge ${priorityClass}">${escapeHtml(report.priority)}</span></div>
        <div class="report-meta-item"><strong>Date & Time:</strong> ${escapeHtml(report.date || '')} ${escapeHtml(report.time || '')}</div>
        <div class="report-meta-item"><strong>Status:</strong> <span class="badge ${statusClass}">${escapeHtml(report.status)}</span></div>
        <div class="report-meta-item"><strong>Verification:</strong> <strong>${escapeHtml(verLabel)}</strong></div>
        <div class="report-description-text" style="margin-top: 0.75rem;"><strong>Description:</strong> ${escapeHtml(report.description)}</div>
        ${adminDetailBtns}
        <div style="margin-top: 1rem; border-top: 1px solid #e2e8f0; padding-top: 0.75rem;">
            <button type="button" class="btn btn-sm btn-track" style="width: 100%; justify-content: center;" onclick="closeMapReportModal(); openStatusTimeline('${report.id}');">📊 View Status Timeline</button>
        </div>
    `;

    modalBody.innerHTML = detailsHtml;
    modal.classList.remove('hidden');
}

function closeMapReportModal() {
    currentOpenMapReportId = null;
    const modal = document.getElementById('mapReportModal');
    if (modal) modal.classList.add('hidden');
}

// --------------------------------------------------------------------------
// REFRESH & EXPORT UTILITIES (PART 24 & 25)
// --------------------------------------------------------------------------

async function refreshAllViews() {
    await loadAdminDashboardData();
    await loadDashboardData();
    await filterAndRenderReports();
    await renderIncidentMap();

    const timelineModal = document.getElementById('statusTimelineModal');
    if (timelineModal && !timelineModal.classList.contains('hidden') && currentOpenTimelineReportId) {
        await openStatusTimeline(currentOpenTimelineReportId, true);
    }

    const mapModal = document.getElementById('mapReportModal');
    if (mapModal && !mapModal.classList.contains('hidden') && currentOpenMapReportId) {
        await openMapReportModal(currentOpenMapReportId);
    }
}

async function exportReportsToCSV() {
    const reports = await fetchBackendReports({ limit: 500 });

    if (reports.length === 0) {
        alert("No reports available to export.");
        return;
    }

    const headers = [
        "ID",
        "Type",
        "Location",
        "Severity",
        "Vehicles Affected",
        "Date",
        "Time",
        "Description",
        "Status",
        "Priority"
    ];

    let csvRows = [];
    csvRows.push(headers.join(","));

    reports.forEach(report => {
        const id = report.id || "";
        const type = report.type || "";
        const location = report.location || "";
        const severity = report.severity || "";
        const vehiclesAffected = report.vehiclesAffected !== undefined ? report.vehiclesAffected : "";
        const date = report.date || "";
        const time = report.time || "";
        const description = report.description || "";
        const status = report.status || "";
        const priority = report.priority || "";

        const row = [
            escapeCSVCell(id),
            escapeCSVCell(type),
            escapeCSVCell(location),
            escapeCSVCell(severity),
            escapeCSVCell(vehiclesAffected),
            escapeCSVCell(date),
            escapeCSVCell(time),
            escapeCSVCell(description),
            escapeCSVCell(status),
            escapeCSVCell(priority)
        ];

        csvRows.push(row.join(","));
    });

    const csvString = csvRows.join("\n");
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "traffic_incident_reports.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function escapeCSVCell(value) {
    if (value === null || value === undefined) return '';
    let str = String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        str = str.replace(/"/g, '""');
        return `"${str}"`;
    }
    return str;
}

function printFilteredReports() {
    const container = document.getElementById('reportsContainer');
    const cards = container ? container.querySelectorAll('.report-card') : [];

    if (!container || cards.length === 0) {
        alert("No reports available to print.");
        return;
    }

    document.body.classList.remove('printing-single-mode');
    window.print();
}

function printSingleReport(reportId) {
    fetchSingleReport(reportId, true).then(report => {
        if (!report) {
            alert(`Report ${reportId} not found for printing.`);
            return;
        }

        let printContainer = document.getElementById('singleReportPrintContainer');
        if (!printContainer) {
            printContainer = document.createElement('div');
            printContainer.id = 'singleReportPrintContainer';
            document.body.appendChild(printContainer);
        }

        const priorityClass = getPriorityBadgeClass(report.priority);
        const statusClass = getStatusBadgeClass(report.status);
        const typeIcon = getTypeIcon(report.type);

        let imgHtml = '';
        if (report.imageUrl) {
            const fullImgUrl = report.imageUrl.startsWith('http') ? report.imageUrl : API_BASE_URL.replace(/\/api\/?$/, '') + report.imageUrl;
            imgHtml = `
                <div style="margin-top: 1.25rem; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 1rem;">
                    <p style="font-weight: bold; margin-bottom: 0.5rem; color: #1e293b; font-size: 0.95rem;">Attached Pothole Photo Evidence:</p>
                    <img id="singlePrintImg" src="${escapeHtml(fullImgUrl)}" alt="Pothole Photo" style="max-width: 100%; max-height: 260px; border-radius: 6px; border: 1px solid #cbd5e1; object-fit: contain;">
                </div>
            `;
        }

        const printHtml = `
            <div class="single-print-wrapper" style="padding: 2rem; font-family: Arial, sans-serif; background: #fff; border: 2px solid #334155; border-radius: 8px; max-width: 800px; margin: 0 auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0284c7; padding-bottom: 0.75rem; margin-bottom: 1.25rem;">
                    <div>
                        <h2 style="margin: 0; color: #0284c7; font-size: 1.6rem;">Smart Traffic Incident Reporter</h2>
                        <p style="margin: 0.25rem 0 0 0; color: #64748b; font-size: 0.9rem;">Official Single Report Document Summary</p>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-weight: bold; font-size: 1.2rem; color: #0f172a; display: block;">ID: ${escapeHtml(report.id)}</span>
                        <span style="font-size: 0.85rem; color: #64748b;">Generated: ${new Date().toLocaleString()}</span>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem 1.5rem; margin-bottom: 1.25rem; background: #f8fafc; padding: 1.25rem; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 0.95rem;">
                    <div><strong>Report Type:</strong> ${typeIcon} ${escapeHtml(report.type)}</div>
                    <div><strong>Category:</strong> ${escapeHtml(report.category === 'pothole' ? 'Pothole Issue' : 'Traffic Incident')}</div>
                    <div><strong>Location:</strong> ${escapeHtml(report.location)}</div>
                    <div><strong>Priority Level:</strong> <span class="badge ${priorityClass}">${escapeHtml(report.priority)}</span></div>
                    <div><strong>Current Status:</strong> <span class="badge ${statusClass}">${escapeHtml(report.status)}</span></div>
                    <div><strong>Verification:</strong> <strong>${escapeHtml(report.verificationStatus === 'verified' ? 'Verified' : (report.verificationStatus === 'false' ? 'False Report' : 'Pending'))}</strong></div>
                    <div><strong>Date & Time:</strong> ${escapeHtml(report.date || '')} ${escapeHtml(report.time || '')}</div>
                    ${report.vehiclesAffected !== undefined ? `<div><strong>Vehicles Affected:</strong> ${report.vehiclesAffected}</div>` : ''}
                </div>

                <div style="margin-bottom: 1.25rem; padding: 1rem; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
                    <strong style="display: block; margin-bottom: 0.5rem; color: #0f172a;">Description / Details:</strong>
                    <p style="margin: 0; color: #334155; line-height: 1.5; white-space: pre-wrap; font-size: 0.95rem;">${escapeHtml(report.description)}</p>
                </div>

                ${imgHtml}
            </div>
        `;

        printContainer.innerHTML = printHtml;
        document.body.classList.add('printing-single-mode');

        const imgEl = document.getElementById('singlePrintImg');
        const triggerPrint = () => {
            window.print();
            const cleanup = () => {
                document.body.classList.remove('printing-single-mode');
                printContainer.innerHTML = '';
                window.removeEventListener('afterprint', cleanup);
            };
            window.addEventListener('afterprint', cleanup);
            setTimeout(cleanup, 1000);
        };

        if (imgEl && !imgEl.complete) {
            imgEl.onload = triggerPrint;
            imgEl.onerror = triggerPrint;
            setTimeout(triggerPrint, 1500);
        } else {
            triggerPrint();
        }
    });
}

// --------------------------------------------------------------------------
// UI HELPER FUNCTIONS
// --------------------------------------------------------------------------

function getPriorityBadgeClass(priorityStr) {
    if (!priorityStr) return 'priority-medium';
    const p = String(priorityStr).toUpperCase();
    if (p === 'HIGH' || p === 'CRITICAL') return 'priority-high';
    if (p === 'LOW') return 'priority-low';
    return 'priority-medium';
}

function getStatusBadgeClass(status) {
    if (status === 'Resolved' || status === 'Corrected') return 'status-resolved';
    if (status === 'Verified') return 'status-verified';
    if (status === 'In Progress' || status === 'Correction in Progress') return 'status-progress';
    if (status === 'False Report') return 'status-false';
    return 'status-pending';
}

function getTypeIcon(type) {
    switch (type) {
        case 'Pothole': return '🕳️';
        case 'Accident': return '🚗';
        case 'Traffic Jam': return '🚦';
        case 'Road Blockage': return '🚧';
        case 'Traffic Signal Failure': return '🚥';
        case 'Vehicle Breakdown': return '🚙';
        case 'Waterlogging': return '🌊';
        case 'Fire': return '🔥';
        default: return '⚠️';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
