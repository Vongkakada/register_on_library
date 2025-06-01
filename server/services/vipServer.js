// File: server/services/vipServer.js

const path = require('path'); // <--- ย้าย require('path') ขึ้นมาข้างบน

// Ensure dotenv is configured to load .env from the project root
// The path is relative to THIS file (server/services/vipServer.js)
// So, '../../.env' goes up two levels to the project root.
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const ImageKit = require('imagekit');
const multer = require('multer'); // For handling file uploads
const { v4: uuidv4 } = require('uuid'); // For generating unique filenames
// const path = require('path'); // <--- ไม่ต้อง require ที่นี่อีกต่อไป

const app = express();
const port = process.env.VIP_SERVER_PORT || 3002;

// --- Firebase Admin SDK Initialization ---
let serviceAccount;
let firebaseInitialized = false;
try {
    // Check for FIREBASE_SERVICE_ACCOUNT (JSON string) first
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log("(VIP Server) Firebase: Using service account JSON from FIREBASE_SERVICE_ACCOUNT env variable.");
    }
    // Else, check for FIREBASE_SERVICE_ACCOUNT_KEY_PATH
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH) {
        // Resolve the path relative to the project root
        const keyPath = path.resolve(__dirname, '..', '..', process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
        console.log(`(VIP Server) Firebase: Attempting to load service account file from resolved path: ${keyPath}`);
        serviceAccount = require(keyPath); // This will throw an error if the file is not found
        console.log(`(VIP Server) Firebase: Successfully loaded service account file from ${keyPath}.`);
    }
    // If neither is set, throw an error
    else {
        throw new Error('🔴 CRITICAL: FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_KEY_PATH must be set in environment variables.');
    }

    // Initialize Firebase Admin SDK if not already initialized
    if (admin.apps.length === 0) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        console.log("✅ (VIP Server) Firebase Admin SDK initialized successfully.");
    } else {
        // If already initialized (e.g. by another part of a larger app, though unlikely here), use the existing app
        console.log("✅ (VIP Server) Firebase Admin SDK was already initialized.");
    }
    firebaseInitialized = true;
} catch (error) {
    console.error("🔴 (VIP Server) ERROR: Failed to initialize Firebase Admin SDK. Details:", error.message);
    // More detailed error logging for debugging path issues with FIREBASE_SERVICE_ACCOUNT_KEY_PATH
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH && error.code === 'MODULE_NOT_FOUND') {
        console.error(`🔴 (VIP Server) Firebase: Could not find service account file at path specified by FIREBASE_SERVICE_ACCOUNT_KEY_PATH: ${process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH}`);
        console.error(`🔴 (VIP Server) Firebase: Resolved path was: ${path.resolve(__dirname, '..', '..', process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH)}`);
    }
    if (process.env.NODE_ENV === 'production') {
        console.error("🔴 (VIP Server) Exiting due to Firebase initialization failure in production.");
        process.exit(1); // Exit in production if Firebase is critical
    }
}

const db = firebaseInitialized ? admin.firestore() : null;

if (firebaseInitialized && !db) {
    console.error("🔴 (VIP Server) ERROR: Firestore instance could not be obtained even after Firebase Admin SDK initialization attempt.");
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
} else if (db) {
    console.log("✅ (VIP Server) Firestore DB instance obtained successfully.");
}


// --- ImageKit Initialization (for VIP ID Cards) ---
// Fallback to general ImageKit credentials if VIP-specific ones are not set
const vipIdPublicKey = process.env.VIP_ID_IMAGEKIT_PUBLIC_KEY || process.env.IMAGEKIT_PUBLIC_KEY;
const vipIdPrivateKey = process.env.VIP_ID_IMAGEKIT_PRIVATE_KEY || process.env.IMAGEKIT_PRIVATE_KEY;
const vipIdUrlEndpoint = process.env.VIP_ID_IMAGEKIT_URL_ENDPOINT || process.env.IMAGEKIT_URL_ENDPOINT;

// Folder path for VIP ID cards in ImageKit
const vipIdFolderPath = process.env.VIP_ID_IMAGEKIT_FOLDER_PATH || "/vip_id_cards/"; // Default if not in .env

let vipImageKit = null;
if (!vipIdPublicKey || !vipIdPrivateKey || !vipIdUrlEndpoint) {
    console.error("🔴 (VIP Server) ERROR: ImageKit credentials (either VIP_ID_... or general IMAGEKIT_...) are not fully set in .env.");
    console.error(`🔴 (VIP Server) Values loaded: PK: ${vipIdPublicKey ? 'OK' : 'MISSING'}, SK: ${vipIdPrivateKey ? 'OK' : 'MISSING'}, URL: ${vipIdUrlEndpoint ? 'OK' : 'MISSING'}`);
} else {
    try {
        vipImageKit = new ImageKit({
            publicKey: vipIdPublicKey,
            privateKey: vipIdPrivateKey,
            urlEndpoint: vipIdUrlEndpoint
        });
        console.log("✅ (VIP Server) ImageKit client for VIP IDs initialized successfully.");
    } catch (error) {
        console.error("🔴 (VIP Server) ERROR: Failed to create ImageKit instance. Details:", error.message);
    }
}

// --- CORS Configuration ---
const allowedOrigins = [
    "https://register-on-library.onrender.com", // Your deployed vip registration frontend
    'https://bannalydigital.netlify.app', // Your deployed frontend
    'http://localhost:3000'               // Your local frontend development server
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl)
    // OR if origin is in allowedOrigins list
    // OR if in development mode, allow all for easier testing
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      console.warn(`(VIP Server) CORS: Blocked request from unauthorized origin: ${origin}`);
      callback(new Error(`Not allowed by CORS: ${origin}`), false);
    }
  },
   methods: ['GET', 'POST'], // Only GET and POST needed for this specific server
   allowedHeaders: ['Content-Type', 'Authorization'], // Standard headers
   credentials: true, // If you plan to use cookies or auth headers with frontend
   optionsSuccessStatus: 204 // For preflight requests
};

if (process.env.NODE_ENV !== 'production') {
    console.warn("(VIP Server) CORS: Configured to allow all origins (*) in development mode.");
    app.use(cors()); // Allow all origins in development
} else {
    console.log(`(VIP Server) CORS: Configured to allow specific origins in production: ${allowedOrigins.join(', ')}`);
    app.use(cors(corsOptions)); // Use specific CORS options in production
}

// --- Middleware ---
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

// --- Multer Setup for File Uploads (in-memory storage) ---
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true); // Accept the file
        } else {
            // Reject the file, passing an error message
            cb(new Error('ឯកសារមិនត្រឹមត្រូវ! សូម Upload តែ File ប្រភេទរូបភាពប៉ុណ្ណោះ។'), false);
        }
    }
});

// --- API Endpoint for VIP Registration ---
app.post('/api/vip/register', upload.single('idImage'), async (req, res) => {
    // Check if critical services are initialized
    if (!db) {
        console.error("(VIP Server) Registration failed: Firestore DB not initialized.");
        return res.status(500).json({
            message: 'បញ្ហាម៉ាស៊ីនមេ៖ មូលដ្ឋានទិន្នន័យមិនដំណើរការ។',
            error: 'Database service is not available.'
        });
    }
    if (!vipImageKit) {
        console.error("(VIP Server) Registration failed: ImageKit not initialized.");
        return res.status(500).json({
            message: 'បញ្ហាម៉ាស៊ីនមេ៖ សេវាកម្មរូបភាពមិនដំណើរការ។',
            error: 'Image service is not available.'
        });
    }

    const { name, phone, address, cardType } = req.body;
    const idImageFile = req.file; // File is available in req.file due to multer

    // --- Basic Validation ---
    if (!name || !phone || !address || !cardType) {
        return res.status(400).json({ message: 'សូមបញ្ចូលព័ត៌មានចាំបាច់ទាំងអស់ (ឈ្មោះ, លេខទូរស័ព្ទ, អាសយដ្ឋាន, ប្រភេទប័ណ្ណ)។' });
    }
    if (!idImageFile) {
        // This case should ideally be caught by frontend 'required' attribute, but good to have backend check
        return res.status(400).json({ message: 'សូមបញ្ចូលរូបភាពអត្តសញ្ញាណប័ណ្ណ។' });
    }

    try {
        console.log(`(VIP Server) Attempting to upload ID image "${idImageFile.originalname}" to ImageKit folder: ${vipIdFolderPath}`);
        const imageUploadResponse = await vipImageKit.upload({
            file: idImageFile.buffer, // Use buffer from multer memory storage
            fileName: `${uuidv4()}-${idImageFile.originalname}`, // Create a unique filename
            folder: vipIdFolderPath,
            useUniqueFileName: false, // We are creating our own unique name with uuid
            tags: ["vip_registration", "id_card"] // Optional tags for ImageKit
        });
        const idImageUrl = imageUploadResponse.url;
        const idImageFileId = imageUploadResponse.fileId; // Store fileId if you need to manage it later
        console.log(`(VIP Server) Image uploaded to ImageKit successfully: ${idImageUrl} (File ID: ${idImageFileId})`);

        // Prepare data for Firestore
        const registrationData = {
            name,
            phone,
            address,
            cardType,
            idImageUrl,
            idImageFileId,
            status: 'pending', // Default status, can be 'approved', 'rejected' later
            registeredAt: admin.firestore.FieldValue.serverTimestamp(),
            userAgent: req.headers['user-agent'] || null,
            ipAddress: req.ip || req.connection?.remoteAddress || null
        };

        console.log("(VIP Server) Saving registration data to Firestore collection 'vipRegistrations'...");
        const docRef = await db.collection('vipRegistrations').add(registrationData);
        console.log(`(VIP Server) VIP Registration data saved to Firestore. Document ID: ${docRef.id}`);

        res.status(201).json({
            message: 'ការចុះឈ្មោះ VIP បានទទួលជោគជ័យ! យើងនឹងធ្វើការត្រួតពិនិត្យ និងទំនាក់ទំនងទៅលោកអ្នកក្នុងពេលឆាប់ៗនេះ។',
            registrationId: docRef.id
        });

    } catch (error) {
        console.error("(VIP Server) Error during VIP registration process. Details:", error);
        // Check if the error is from ImageKit upload specifically
        if (error.name === 'ImageKitError') { // Or check error.message for specific ImageKit error types
             return res.status(500).json({
                message: 'ការ Upload រូបភាពបានបរាជ័យ។ សូមព្យាយាមម្តងទៀត។',
                error: process.env.NODE_ENV !== 'production' ? error.message : 'Image upload failed'
            });
        }
        // General error
        res.status(500).json({
            message: 'ការចុះឈ្មោះ VIP បានបរាជ័យ។ សូមព្យាយាមម្តងទៀត។',
            error: process.env.NODE_ENV !== 'production' ? error.message : 'Internal Server Error'
        });
    }
});

// --- Centralized Error Handling Middleware (especially for Multer) ---
// This middleware MUST be defined AFTER your routes
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // A Multer error occurred when uploading (e.g., file too large)
        console.error("(VIP Server) Multer error caught by error handler:", err.message);
        let message = `បញ្ហាការ Upload រូបភាព៖ ${err.field ? err.field + ' ' : ''}`;
        if (err.code === 'LIMIT_FILE_SIZE') {
            message += 'ទំហំ File ធំពេក។';
        } else {
            message += err.message;
        }
        return res.status(400).json({ message });
    } else if (err) {
        // An error from fileFilter in multer or other unhandled errors
        console.error("(VIP Server) Non-Multer error caught by error handler:", err.message);
        // If the error message is the one we set in fileFilter
        if (err.message && err.message.includes('ឯកសារមិនត្រឹមត្រូវ!')) {
            return res.status(400).json({ message: err.message });
        }
        // For other errors
        return res.status(500).json({
            message: "មានបញ្ហាមិនរំពឹងទុកកើតឡើង។",
            error: process.env.NODE_ENV !== 'production' ? err.message : 'Unexpected server error'
        });
    }
    // If no error, pass to the next middleware (though unlikely to have one after this)
    next();
});


// --- Start the Server ---
app.listen(port, () => {
    console.log(`\n(VIP Server) 🚀 Server for VIP registration is now listening on http://localhost:${port}`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`(VIP Server) Environment: Development`);
        console.log(`(VIP Server) VIP Registration Endpoint: POST to http://localhost:${port}/api/vip/register`);
        console.warn(`(VIP Server) Logging: Verbose logging is enabled in development.`);
        console.warn(`(VIP Server) CORS: Currently allowing all origins in development.`);
    } else {
        console.log(`(VIP Server) Environment: Production`);
        console.warn(`(VIP Server) Logging: Reduced logging in production.`);
        console.warn(`(VIP Server) CORS: Restricted to specific origins in production.`);
    }
    console.warn(`(VIP Server) Ensure .env file is correctly placed at project root and contains all necessary credentials.`);
    console.warn(`(VIP Server) Expected .env path relative to this file: ${path.resolve(__dirname, '..', '..', '.env')}`);
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH) {
         console.warn(`(VIP Server) Firebase Key Path (from .env): ${process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH}`);
         console.warn(`(VIP Server) Firebase Key Resolved Path: ${path.resolve(__dirname, '..', '..', process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH)}`);
    }
});