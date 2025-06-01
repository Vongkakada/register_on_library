// File: D:\CUS\digital library\imagekit-backend\server.js

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors'); // Import cors middleware
const ImageKit = require('imagekit');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch'); // Import node-fetch to fetch content from TXT URLs

const { collectionsConfig } = require('./server/data/rerngNitenCollectionsConfig'); // Video Collections Config

// --- Firebase Admin SDK Initialization ---
const admin = require('firebase-admin');

let serviceAccount;
let firebaseInitialized = false; // Flag to track successful Firebase init
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // Use JSON content from environment variable (Good for hosting platforms like Render)
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log("Firebase: Using service account JSON from FIREBASE_SERVICE_ACCOUNT environment variable.");
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH) {
        // Use file path (Good for local development or platforms supporting file paths)
        // Use path.resolve(__dirname, ...) for safer path resolution if needed
        serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
        console.log("Firebase: Using service account file from FIREBASE_SERVICE_ACCOUNT_KEY_PATH.");
    } else {
        throw new Error('FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_KEY_PATH must be set in environment variables.');
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        // Optional: Add databaseURL if you use Realtime Database
        // databaseURL: "https://YOUR_DATABASE_NAME.firebaseio.com"
    });
    console.log("✅ Firebase Admin SDK initialized successfully.");
    firebaseInitialized = true;
} catch (error) {
    console.error("🔴 ERROR: Failed to initialize Firebase Admin SDK:", error.message);
     // 🔴 Decide whether to exit on Firebase failure in production
     if (process.env.NODE_ENV === 'production') {
          console.error("Exiting process due to Firebase initialization failure in production.");
         process.exit(1); // Exit in production if DB is critical
     }
     // In development, we might allow it to continue with a null db, but log heavily
}

// Get a reference to the Firestore database ONLY if Firebase was initialized successfully
const db = firebaseInitialized ? admin.firestore() : null;
if (!db && firebaseInitialized) {
    console.error("🔴 ERROR: Firestore instance could not be obtained after Firebase initialization.");
     if (process.env.NODE_ENV === 'production') {
          console.error("Exiting process due to Firestore instance failure in production.");
         process.exit(1); // Exit in production if DB is critical
     }
} else if (db) {
    console.log("✅ Firestore DB instance obtained.");
}


// --- YouTube Data API Initialization ---
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
if (!youtubeApiKey || youtubeApiKey === 'YOUR_COPIED_YOUTUBE_API_KEY') {
    console.error("🔴 ERROR: YOUTUBE_API_KEY is not set or is using the placeholder in .env. Video data will not load from YouTube.");
    // In production, you might want to exit here
}

const youtube = (youtubeApiKey && youtubeApiKey !== 'YOUR_COPIED_YOUTUBE_API_KEY') ? google.youtube({
    version: 'v3',
    auth: youtubeApiKey,
}) : null;

// --- Data Storage (In-Memory for Videos Only) ---
let loadedVideoCollections = []; // Stores the collections with video details fetched from YouTube
let isVideoDataLoaded = false; // Flag to indicate if video data loading is complete
let videoDataLoadError = null; // To store error if video data load fails

console.log("🔴 Book views, audio likes, and video comments are now stored in Firestore.");

// --- Express Setup ---
const app = express();
const port = process.env.PORT || 3001;

// --- 🔴 CORS Configuration ---
// Define allowed origins based on environment
const allowedOrigins = [
    'https://bannalydigital.netlify.app', // Frontend deployed on Netlify
    // Add other deployed frontend URLs here if any
    // You might also want to include the backend's own URL if it serves anything directly to the browser,
    // although it's less common for an API-only backend.
    // 'https://backend-library-uoqs.onrender.com' // Backend deployed URL (can be helpful for debugging)
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or same-origin in some cases)
    // Allow the specific allowed origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Deny other origins and log the unauthorized origin
      console.warn(`CORS blocked request from unauthorized origin: ${origin}`);
      callback(new Error(`Not allowed by CORS: ${origin}`), false);
    }
  },
   methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'], // Explicitly allowed methods
   allowedHeaders: ['Content-Type', 'Authorization'], // Explicitly allowed headers (add others if your frontend uses them)
   credentials: true, // Allow cookies/auth headers if needed
   optionsSuccessStatus: 204 // Recommended for CORS preflight requests
};

// Apply CORS middleware
// 💡 In development, you might want to use cors() without options to allow all origins
// for easier local testing if your local frontend doesn't run on 3000 exactly.
// For this code, we apply specific rules in production and allow all in development.
if (process.env.NODE_ENV !== 'production') {
    console.warn("CORS is configured to allow all origins (*) in development mode.");
    app.use(cors()); // Allow all origins (*) in development
} else {
    console.log(`CORS is configured to allow origins: ${allowedOrigins.join(', ')} in production mode.`);
    app.use(cors(corsOptions)); // Apply specific CORS rules in production
}


// --- Middleware --- (Keep existing)
app.use(express.json());

const getBaseName = (filename) => {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) {
        return filename;
    }
    return filename.substring(0, lastDotIndex);
};

const categoryPrefixes = [
    { prefix: 'រឿង ', category: 'រឿងនិទាន' },
    { prefix: 'សៀវភៅកុំព្យូទ័រ ', category: 'សៀវភៅកុំព្យូទ័រ' },
    { prefix: 'សៀវភៅ ', category: 'សៀវភៅទូទៅ' },
    { prefix: 'ប្រវត្តិសាស្ត្រ ', category: 'ប្រវត្តិសាស្ត្រ' },
];
const defaultCategory = 'ផ្សេងៗ';

// --- ImageKit Initialization (for Books) ---
const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;

if (!publicKey || !privateKey || !urlEndpoint) {
    console.error("🔴 ERROR: ImageKit BOOK environment variables are not set.");
    console.error("🔴 Please set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT in .env.");
    // ... dummy credentials logic ...
}

const imagekit = (publicKey && privateKey && urlEndpoint) ? new ImageKit({
    publicKey: publicKey,
    privateKey: privateKey,
    urlEndpoint: urlEndpoint
}) : null;

// --- ImageKit Initialization (for Audio) ---
const audioPublicKey = process.env.AUDIO_IMAGEKIT_PUBLIC_KEY;
const audioPrivateKey = process.env.AUDIO_IMAGEKIT_PRIVATE_KEY;
const audioUrlEndpoint = process.env.AUDIO_IMAGEKIT_URL_ENDPOINT;

let audioImageKit = null;
if (!audioPublicKey || !audioPrivateKey || !audioUrlEndpoint) {
    console.error("🔴 ERROR: ImageKit AUDIO environment variables are not set.");
    console.error("🔴 Please set AUDIO_IMAGEKIT_PUBLIC_KEY, AUDIO_IMAGEKIT_PRIVATE_KEY, and AUDIO_IMAGEKIT_URL_ENDPOINT in .env.");
    // ... dummy credentials logic ...
} else {
    console.log("ImageKit AUDIO credentials loaded.");
    audioImageKit = new ImageKit({
        publicKey: audioPublicKey,
        privateKey: audioPrivateKey,
        urlEndpoint: audioUrlEndpoint
    });
}

// --- 🔴 TEMPORARY: Data Migration Script (Run this ONCE manually) ---
// You would typically run this script separately, not within your main server file.
// This is for demonstration purposes only.
/*
async function migrateDataToFirestore() {
    if (!db) {
        console.error("Firestore DB not initialized. Skipping data migration.");
        return;
    }
    if (!imagekit || !audioImageKit) {
         console.error("ImageKit clients not initialized. Cannot migrate data.");
         return;
    }

    console.log("🔴 Starting data migration from ImageKit to Firestore...");

    // --- Migrate Book Data ---
    const allBooksFolderPath = "/AllBook";
    const allCoversFolderPath = "/AllCover";
    try {
        const pdfFiles = await imagekit.listFiles({ path: allBooksFolderPath, fileType: "non-image", extensions: ["pdf"], limit: 1000 });
        const coverFiles = await imagekit.listFiles({ path: allCoversFolderPath, fileType: "image", limit: 1000 });
        const coverFilesByBaseName = coverFiles.reduce((acc, file) => {
            const baseName = getBaseName(file.name).trim().toLowerCase();
            if (baseName) acc[baseName] = file;
            return acc;
        }, {});

        for (const pdfFile of pdfFiles) {
            const pdfBaseName = getBaseName(pdfFile.name).trim();
             if (!pdfBaseName) continue;

            let category = defaultCategory;
            const lowerCasePdfBaseName = pdfBaseName.toLowerCase();
            for (const catPrefix of categoryPrefixes) {
                 if (lowerCasePdfBaseName.startsWith(catPrefix.prefix.toLowerCase())) {
                     category = catPrefix.category;
                     break;
                 }
            }
            const matchingCoverFile = coverFilesByBaseName[lowerCasePdfBaseName];
            const coverImageUrl = matchingCoverFile ? matchingCoverFile.url : null;

            const bookItemData = {
                title: pdfBaseName, // Use original case for title
                pdfUrl: pdfFile.url,
                coverImageUrl: coverImageUrl,
                category: category,
                author: 'មិនមានព័ទ្ធិមាន', // You might want to add author logic here
                views: 0, // Start views at 0 or migrate from old source if possible
                // Add other metadata fields as needed
            };

            // Use ImageKit FileId as document ID in Firestore for consistency
            await db.collection('bookItems').doc(pdfFile.fileId).set(bookItemData, { merge: true });
        }
        console.log(`✅ Book data migration complete. Migrated ${pdfFiles.length} books to Firestore.`);

    } catch (error) {
        console.error("🔴 Book data migration FAILED:", error);
    }


    // --- Migrate Audio Data ---
    const audioFilesFolderPath = "/AllAudio";
    const descriptionFilesFolderPath = "/AllDescription";
     // const audioCoversFolderPath = "/AudioCovers"; // Uncomment if you have audio covers

    try {
        const audioFiles = await audioImageKit.listFiles({ path: audioFilesFolderPath, fileType: "non-image", extensions: ["mp3", "ogg", "wav", "aac"], limit: 1000 });
        const descriptionFiles = await audioImageKit.listFiles({ path: descriptionFilesFolderPath, fileType: "non-image", extensions: ["txt"], limit: 1000 });

        const descriptionContentMap = {};
        await Promise.all(descriptionFiles.map(async (descFile) => {
             const descBaseName = getBaseName(descFile.name).trim().toLowerCase();
             if (descBaseName) {
                 try {
                     const response = await fetch(descFile.url);
                     if (response.ok) {
                         descriptionContentMap[descBaseName] = await response.text();
                     } else {
                          console.warn(`Failed to fetch content for description file ${descFile.name}: ${response.status}`);
                          descriptionContentMap[descBaseName] = '';
                     }
                 } catch (fetchError) {
                      console.warn(`Error fetching content for description file ${descFile.name}:`, fetchError);
                      descriptionContentMap[descBaseName] = '';
                 }
             }
        }));

         // If you have audio covers:
         // const audioCoverFiles = await audioImageKit.listFiles({...});
         // const audioCoverFilesByBaseName = audioCoverFiles.reduce(...);


        for (const audioFile of audioFiles) {
            const audioBaseName = getBaseName(audioFile.name).trim();
             if (!audioBaseName) continue;

            const lowerCaseAudioBaseName = audioBaseName.toLowerCase();
            const descriptionText = descriptionContentMap[lowerCaseAudioBaseName] || 'មិនមានព័ទ្ធិមានពិស្តារទេ';

             // const audioCoverFile = audioCoverFilesByBaseName[lowerCaseAudioBaseName]; // If fetching covers
             // const audioCoverImageUrl = audioCoverFile ? audioCoverFile.url : null;

            const audioItemData = {
                title: audioBaseName, // Use original case for title
                src: audioFile.url,
                coverImageUrl: null, // Set to audioCoverImageUrl if fetching covers
                description: descriptionText,
                likes: 0, // Start likes at 0 or migrate from old source
                // Add other metadata fields as needed
            };

             // Use ImageKit FileId as document ID in Firestore for consistency
            await db.collection('audioItems').doc(audioFile.fileId).set(audioItemData, { merge: true });
        }
        console.log(`✅ Audio data migration complete. Migrated ${audioFiles.length} audio items to Firestore.`);

    } catch (error) {
        console.error("🔴 Audio data migration FAILED:", error);
    }

    console.log("🔴 Data migration process finished.");
}
// To run the migration: Uncomment the line below, run the server ONCE, then comment it back out.
// migrateDataToFirestore().catch(console.error);
*/


// --- API Endpoint for Listing ImageKit Data (Books) ---
// 🔴 NOW Fetches from Firestore with Pagination
app.get('/api/imagekit/rerngniten-data', async (req, res) => {
    if (!db) {
        console.error("Firestore DB not initialized. Cannot fetch book list.");
        return res.status(500).json({
            message: 'Backend database is not configured.',
            error: 'Firestore DB configuration missing'
        });
    }

    // 🔴 Get pagination parameters from query string
    const page = parseInt(req.query.page) || 1; // Default to page 1
    const limit = parseInt(req.query.limit) || 16; // Default to 16 items per page
    const skip = (page - 1) * limit; // Calculate number of items to skip

     // Optional: Get filter parameters if needed (e.g., category)
     // const categoryFilter = req.query.category;

    try {
        console.log(`Fetching book items from Firestore with pagination: Page ${page}, Limit ${limit}`);

        // 🔴 Get total count of items (needed for frontend pagination)
        const countSnapshot = await db.collection('bookItems').count().get();
        const totalItems = countSnapshot.data().count;
        console.log(`Total book items available: ${totalItems}`);


        // 🔴 Fetch the paginated data from Firestore
        let query = db.collection('bookItems');
         // Optional: Add filter conditions to the query if needed (e.g., query = query.where('category', '==', categoryFilter);)
        query = query.limit(limit).offset(skip); // Apply limit and offset

        const itemsSnapshot = await query.get();

        const paginatedBookData = itemsSnapshot.docs.map(doc => {
             const data = doc.data();
             return {
                 id: doc.id, // Firestore Document ID
                 title: data.title,
                 pdfUrl: data.pdfUrl,
                 coverImageUrl: data.coverImageUrl,
                 category: data.category,
                 author: data.author,
                 views: data.views || 0, // Ensure views defaults to 0
                 // Add other fields as needed
             };
        });

        console.log(`Successfully fetched ${paginatedBookData.length} book items for page ${page}.`);
        res.json({
             items: paginatedBookData, // Array of items for the current page
             totalItems: totalItems, // Total number of items across all pages
             totalPages: Math.ceil(totalItems / limit), // Calculate total pages
             currentPage: page, // Return current page number
             itemsPerPage: limit // Return items per page
        });

    } catch (error) {
        console.error("Error fetching paginated book list from Firestore:", error);
        if (process.env.NODE_ENV !== 'production') {
            console.error("Detailed Error:", error);
        }
        res.status(500).json({
            message: 'Failed to fetch book list from database',
            error: process.env.NODE_ENV !== 'production' ? error.message : 'Internal Server Error'
        });
    }
});

// --- API Endpoint for Recording Book Views (Update Firestore) ---
app.post('/api/imagekit/view-book', async (req, res) => {
    const bookId = req.body.bookId;
    if (!bookId) {
        return res.status(400).json({ message: 'Book ID is required' });
    }
    if (!db) { // Check if Firestore DB is initialized
        console.error("Firestore DB not initialized. Cannot record book view.");
        return res.status(500).json({
            message: 'Backend database is not configured.',
            error: 'Firestore DB configuration missing'
        });
    }

    try {
        // 🔴 Update the 'bookItems' collection
        const bookRef = db.collection('bookItems').doc(bookId);
        await db.runTransaction(async (transaction) => {
            const bookDoc = await transaction.get(bookRef);
            // 🔴 Handle case where book item might not exist
             if (!bookDoc.exists) {
                 console.warn(`Attempted to record view for non-existent book ID: ${bookId}`);
                  throw new Error('Book item not found in database'); // Throw error to transaction
             }
            const currentViews = bookDoc.data().views || 0;
            transaction.update(bookRef, { views: currentViews + 1 }); // Use update for existing document
        });

        // Fetch the updated document to get the new count
        const updatedDoc = await bookRef.get();
        const newViewCount = updatedDoc.data().views;
        console.log(`View recorded for bookId: ${bookId}. New count: ${newViewCount}.`);
        res.status(200).json({ message: 'View recorded successfully', bookId: bookId, newViewCount });
    } catch (error) {
        console.error(`Error recording view for bookId: ${bookId}:`, error);
         // 🔴 Handle the 'Book item not found' error separately if needed
         if (error.message === 'Book item not found in database') {
             return res.status(404).json({ message: error.message });
         }
        res.status(500).json({ message: 'Failed to record view', error: error.message });
    }
});

// --- API Endpoint for Listing ImageKit Data (Audio) ---
// 🔴 NOW Fetches from Firestore with Pagination
app.get('/api/imagekit/audio-data', async (req, res) => {
    if (!db) { // Check if Firestore DB is initialized
        console.error("Firestore DB not initialized. Cannot fetch audio list.");
        return res.status(500).json({
            message: 'Backend database is not configured.',
            error: 'Firestore DB configuration missing'
        });
    }

     // 🔴 Get pagination parameters from query string
    const page = parseInt(req.query.page) || 1; // Default to page 1
    const limit = parseInt(req.query.limit) || 16; // Default to 16 items per page
    const skip = (page - 1) * limit; // Calculate number of items to skip

    try {
        console.log(`Fetching audio items from Firestore with pagination: Page ${page}, Limit ${limit}`);

        // 🔴 Get total count of items (needed for frontend pagination)
        const countSnapshot = await db.collection('audioItems').count().get();
        const totalItems = countSnapshot.data().count;
        console.log(`Total audio items available: ${totalItems}`);

        // 🔴 Fetch the paginated data from Firestore
        let query = db.collection('audioItems');
        query = query.limit(limit).offset(skip); // Apply limit and offset

        const itemsSnapshot = await query.get();

        const paginatedAudioData = itemsSnapshot.docs.map(doc => {
             const data = doc.data();
             return {
                 id: doc.id, // Firestore Document ID
                 title: data.title,
                 src: data.src,
                 coverImageUrl: data.coverImageUrl, // Should come from Firestore now
                 description: data.description, // Should come from Firestore now
                 likes: data.likes || 0, // Ensure likes defaults to 0
                 // Add other fields as needed
             };
        });

        console.log(`Successfully fetched ${paginatedAudioData.length} audio items for page ${page}.`);
        res.json({
             items: paginatedAudioData, // Array of items for the current page
             totalItems: totalItems, // Total number of items across all pages
             totalPages: Math.ceil(totalItems / limit), // Calculate total pages
             currentPage: page, // Return current page number
             itemsPerPage: limit // Return items per page
        });


    } catch (error) {
        console.error("Error fetching paginated audio list from Firestore:", error);
        if (process.env.NODE_ENV !== 'production') {
            console.error("Detailed Error:", error);
        }
        res.status(500).json({
            message: 'Failed to fetch audio list from database',
            error: process.env.NODE_ENV !== 'production' ? error.message : 'Internal Server Error'
        });
    }
});

// --- API Endpoint for Liking/Unliking Audio Items (Update Firestore) ---
app.post('/api/audio/:audioId/like', async (req, res) => {
    const audioId = req.params.audioId;
    const { isLiked } = req.body;

    if (!audioId) {
        return res.status(400).json({ message: 'Audio ID is required' });
    }
    if (isLiked === undefined) {
        console.warn(`Received audio like request for ${audioId} without isLiked status.`);
        return res.status(400).json({ message: 'isLiked status is required in body' });
    }
     if (!db) { // Check if Firestore DB is initialized
        console.error("Firestore DB not initialized. Cannot record audio like.");
        return res.status(500).json({
            message: 'Backend database is not configured.',
            error: 'Firestore DB configuration missing'
        });
    }

    try {
        // 🔴 Update the 'audioItems' collection
        const audioRef = db.collection('audioItems').doc(audioId);
        await db.runTransaction(async (transaction) => {
            const audioDoc = await transaction.get(audioRef);
            // 🔴 Handle case where audio item might not exist
            if (!audioDoc.exists) {
                console.warn(`Attempted to like non-existent audio item ID: ${audioId}`);
                 throw new Error('Audio item not found in database'); // Throw error to transaction
            }
            const currentLikes = audioDoc.data().likes || 0;
            const newLikes = isLiked ? Math.max(0, currentLikes - 1) : currentLikes + 1;
            transaction.update(audioRef, { likes: newLikes }); // Use update for existing document
        });

        // Fetch the updated document to get the new count
        const updatedDoc = await audioRef.get();
        const newLikeCount = updatedDoc.data().likes;
        console.log(`Like action for audio ID ${audioId}. New count: ${newLikeCount}. Action: ${isLiked ? 'Unlike' : 'Like'}`);
        res.status(200).json({ audioId, newLikeCount });
    } catch (error) {
        console.error(`Error updating like for audioId: ${audioId}:`, error);
         // 🔴 Handle the 'Audio item not found' error separately if needed
         if (error.message === 'Audio item not found in database') {
             return res.status(404).json({ message: error.message });
         }
        res.status(500).json({ message: 'Failed to update like', error: error.message });
    }
});

// --- API Endpoint for Fetching Video Collections ---
app.get('/api/videos/collections', async (req, res) => {
    if (!isVideoDataLoaded) {
        if (videoDataLoadError) {
            return res.status(500).json({
                message: 'Failed to load video collections data initially.',
                error: videoDataLoadError.message || 'Internal Server Error',
                collections: []
            });
        }
        if (youtube === null) {
            return res.status(503).json({
                message: 'Video data is not available due to missing YouTube API key.',
                collections: []
            });
        }
        return res.status(202).json({
            message: 'Video data is still loading...',
            collections: []
        });
    }

    try {
        console.log("Serving loaded video collections data.");
        res.json(loadedVideoCollections);
    } catch (error) {
        console.error("Error serving video collections data:", error);
        res.status(500).json({
            message: 'Failed to fetch video collections',
            error: process.env.NODE_ENV !== 'production' ? error.message : 'Internal Server Error'
        });
    }
});

// --- API Endpoint for Fetching Video Comments ---
app.get('/api/videos/:videoId/comments', async (req, res) => {
    const videoId = req.params.videoId;

    if (!videoId) {
        return res.status(400).json({ message: 'Video ID is required' });
    }
     if (!db) { // Check if Firestore DB is initialized
        console.error("Firestore DB not initialized. Cannot fetch comments.");
        return res.status(500).json({
            message: 'Backend database is not configured.',
            error: 'Firestore DB configuration missing'
        });
    }

    try {
        // Fetch all comments and replies for this video from Firestore
        const commentsSnapshot = await db.collection('videoComments')
            .where('videoId', '==', videoId)
            .orderBy('timestamp', 'asc')
            .get();

        const flatComments = commentsSnapshot.docs.map(doc => {
             const data = doc.data();
             // 🔴 Ensure all necessary fields are mapped correctly from Firestore data
             return {
                 id: doc.id,
                 videoId: data.videoId,
                 text: data.text,
                 author: data.author,
                 timestamp: data.timestamp && typeof data.timestamp.toDate === 'function' ? data.timestamp.toDate().toISOString() : (data.timestamp || new Date()).toISOString(),
                 parentId: data.parentId || null,
                 likes: data.likes || 0,
                 // Add other fields if they exist in Firestore and needed by frontend
             };
        });

        // Build the nested comment tree structure (for frontend)
        const commentsMap = {};
        flatComments.forEach(comment => {
             commentsMap[comment.id] = { ...comment, replies: [] }; // Initialize replies array
        });

        const nestedComments = [];
        flatComments.forEach(comment => {
            if (comment.parentId && commentsMap[comment.parentId]) {
                 if (!commentsMap[comment.parentId].replies) {
                     commentsMap[comment.parentId].replies = [];
                 }
                commentsMap[comment.parentId].replies.push(commentsMap[comment.id]);
            } else {
                // Only push top-level comments to the root array
                if (!comment.parentId) {
                    nestedComments.push(commentsMap[comment.id]);
                }
            }
        });

        // Sort replies by timestamp if needed (optional)
         nestedComments.forEach(comment => {
             if (comment.replies && comment.replies.length > 0) {
                 comment.replies.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
             }
         });


        console.log(`Serving ${flatComments.length} total comments/replies for video ID: ${videoId}. Built ${nestedComments.length} top-level comments.`);
        res.json(nestedComments); // Return the built tree

    } catch (error) {
        console.error(`Error fetching comments for videoId: ${videoId}:`, error);
        res.status(500).json({ message: 'Failed to fetch comments', error: error.message });
    }
});

// --- API Endpoint for Posting Video Comments ---
app.post('/api/videos/:videoId/comments', async (req, res) => {
    const videoId = req.params.videoId;
    const { text, author, parentId } = req.body;

    if (!videoId || !text || typeof text !== 'string' || text.trim() === '') {
        return res.status(400).json({ message: 'Video ID and non-empty comment text are required' });
    }

    const commentAuthor = author || 'អ្នកប្រើប្រាស់អនាមិក';
    // In a real app, you would get author from authenticated user data, not body.

    const newCommentData = {
        videoId,
        text: text.trim(),
        author: commentAuthor,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        parentId: parentId || null,
        likes: 0,
        // replies array is not stored in Firestore for nested comments
    };

    try {
        const docRef = await db.collection('videoComments').add(newCommentData); // 🔴 Use 'videoComments' collection name
        const newCommentDoc = await docRef.get();
        const newComment = { id: newCommentDoc.id, ...newCommentDoc.data() };

        // Ensure timestamp is in a format frontend expects
        if (newComment.timestamp && typeof newComment.timestamp.toDate === 'function') {
             newComment.timestamp = newComment.timestamp.toDate().toISOString();
        } else {
             newComment.timestamp = new Date().toISOString(); // Fallback for pending server timestamp
        }
         // Add empty replies array for frontend structure consistency
         newComment.replies = [];


        console.log(`New comment/reply added for video ID: ${videoId} by ${commentAuthor}. Document ID: ${docRef.id}. Parent ID: ${parentId}`);
        res.status(201).json(newComment); // Return the newly created comment object
    } catch (error) {
        console.error(`Error adding comment for videoId: ${videoId}:`, error);
        res.status(500).json({ message: 'Failed to add comment', error: error.message });
    }
});

// --- API Endpoint for Reacting to Comments ---
app.post('/api/comments/:commentId/react', async (req, res) => {
    const commentId = req.params.commentId;
    const { type } = req.body; // Expecting { type: 'like' }
    // In a real app, you'd get the userId from authentication here to track who liked

    if (!commentId || !type || type !== 'like') {
        console.warn(`Received invalid reaction request for comment ID ${commentId}: type=${type}`);
        return res.status(400).json({ message: 'Valid Comment ID and reaction type "like" are required' });
    }

    try {
        const commentRef = db.collection('videoComments').doc(commentId); // 🔴 Use 'videoComments' collection name
        const commentDoc = await commentRef.get();

        if (!commentDoc.exists) {
            console.warn(`Attempted to react to non-existent comment ID: ${commentId}`);
            return res.status(404).json({ message: 'Comment not found' });
        }

        await db.runTransaction(async (transaction) => {
            const commentDoc = await transaction.get(commentRef);
            const currentLikes = commentDoc.data().likes || 0;
            transaction.update(commentRef, { likes: currentLikes + 1 }); // Atomically increment likes
        });

        // Fetch the updated document to return the new count
        const updatedDoc = await commentRef.get();
        const newLikesCount = updatedDoc.data().likes;
        console.log(`Reaction 'like' recorded for comment ID: ${commentId}. New likes count: ${newLikesCount}`);
        res.status(200).json({ message: 'Reaction recorded successfully', commentId, newLikesCount });
    } catch (error) {
        console.error(`Error reacting to commentId: ${commentId}:`, error);
        res.status(500).json({ message: 'Failed to record reaction', error: error.message });
    }
});

// --- Function to Load Video Data from YouTube Playlists ---
async function loadVideoData() {
    if (youtube === null) {
        console.error("Skipping video data load: YouTube API Key is not configured.");
        isVideoDataLoaded = false;
        videoDataLoadError = new Error("YouTube API Key is missing.");
        return;
    }

    console.log("Starting initial load of video data from YouTube playlists...");
    const collectionsWithVideos = [];
    let loadError = null;

    for (const config of collectionsConfig) {
        if (config.playlistId) {
            try {
                console.log(`Fetching videos for playlist: "${config.title}" (ID: ${config.playlistId})`);
                const playlistItems = await fetchPlaylistItems(config.playlistId);
                console.log(`Fetched ${playlistItems.length} items for playlist "${config.title}".`);

                const processedVideos = playlistItems.map((item, index) => {
                    const videoId = item.snippet?.resourceId?.videoId;
                    if (!videoId) {
                        console.warn(`Skipping playlist item with missing video ID in playlist ${config.playlistId}:`, item);
                        return null;
                    }

                    const title = item.snippet?.title || `វីដេអូទី ${index + 1}`;
                    const description = item.snippet?.description || 'មិនមានព័ទ្ធិមានពិស្តារទេ';
                    const thumbnail = item.snippet?.thumbnails?.standard?.url ||
                                      item.snippet?.thumbnails?.high?.url ||
                                      item.snippet?.thumbnails?.medium?.url ||
                                      null;

                    return {
                        id: videoId,
                        title: title,
                        description: description,
                        thumbnail: thumbnail,
                        src: `https://www.youtube.com/embed/${videoId}?rel=0&showinfo=0`,
                    };
                }).filter(video => video !== null);

                collectionsWithVideos.push({
                    id: config.id,
                    title: config.title,
                    thumbnail: config.thumbnail || (processedVideos.length > 0 ? processedVideos[0].thumbnail : null),
                    description: config.description,
                    videos: processedVideos,
                });
                console.log(`Processed ${processedVideos.length} videos for "${config.title}" collection.`);
            } catch (error) {
                console.error(`🔴 Failed to load playlist ${config.playlistId} for collection "${config.title}":`, error);
                loadError = error;
            }
        } else {
            console.warn(`Collection config "${config.id}" is missing playlistId. Skipping video load for this collection.`);
        }
    }

    loadedVideoCollections = collectionsWithVideos;
    isVideoDataLoaded = true;
    videoDataLoadError = loadError;
    console.log(`✅ Initial video data load complete. Total collections loaded: ${loadedVideoCollections.length}. ${loadError ? 'WITH ERRORS.' : ''}`);
}

// --- Helper Function to Fetch All Playlist Items (Handles Pagination) ---
async function fetchPlaylistItems(playlistId, pageToken = null, allItems = []) {
    if (youtube === null) {
        console.error("Cannot fetch playlist items: YouTube API client is not initialized.");
        return allItems;
    }
    try {
        const response = await youtube.playlistItems.list({
            part: 'snippet,contentDetails',
            playlistId: playlistId,
            maxResults: 50,
            pageToken: pageToken,
        });

        const items = response.data.items;
        if (!items || items.length === 0) {
            // No items found on this page or playlist is empty
            return allItems;
        }

        const currentItems = allItems.concat(items);
        const nextToken = response.data.nextPageToken;

        // If there's a next page token, recursively call to fetch the next page
        if (nextToken) {
            // Add a small delay to avoid hitting rate limits too quickly if playlists are very large (Optional)
            // await new Promise(resolve => setTimeout(resolve, 100));
            return fetchPlaylistItems(playlistId, nextToken, currentItems); // Pass accumulated items
        } else {
            return currentItems; // Return the full list when no more pages
        }
    } catch (error) {
        console.error(`🔴 Error fetching playlist items for playlist ID ${playlistId} (Page Token: ${pageToken}):`, error);
        // Depending on the error, you might want to throw it, return the items fetched so far, etc.
        // Returning the items fetched so far might be more resilient.
        return allItems; // Return items fetched up to this point on error
    }
}

// --- Start the Server ---
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);

    // Start loading video data from YouTube API when the server starts
    loadVideoData().catch(err => {
        console.error("🔴 Fatal error during initial video data load process:", err);
    });

    if (process.env.NODE_ENV !== 'production') {
        console.log(`ImageKit Book Data URL: http://localhost:${port}/api/imagekit/rerngniten-data`);
        console.log(`ImageKit Book View URL: POST to http://localhost:${port}/api/imagekit/view-book with body { "bookId": "..." }`);
        console.log(`ImageKit Audio Data URL: http://localhost:${port}/api/imagekit/audio-data`);
        console.log(`ImageKit Audio Like URL: POST to http://localhost:${port}/api/audio/:audioId/like with body { type: "like", isLiked: boolean }`);
        console.log(`Video Collections URL: http://localhost:${port}/api/videos/collections`);
        console.log(`Comments GET: http://localhost:${port}/api/videos/:videoId/comments`);
        console.log(`Comments POST (New/Reply): POST to http://localhost:${port}/api/videos/:videoId/comments with body { text: "...", author: "...", parentId: "..." }`);
        console.log(`Comment Reaction POST: POST to http://localhost:${port}/api/comments/:commentId/react with body { type: "like" }`);
        console.log(`Remember to update REACT_APP_BACKEND_API_URL in your React app's environment variables.`);
        console.warn("\n--- Backend Configuration Notes ---");
        console.warn(`Firebase DB: Using Firestore for Comments, Reactions, Audio Likes, Book Views.`);
        console.warn(`Firebase Config: Requires FIREBASE_SERVICE_ACCOUNT_KEY_PATH or FIREBASE_SERVICE_ACCOUNT JSON in environment.`);
        console.warn(`ImageKit Book Folders: /AllBook (PDFs), /AllCover (Covers)`);
        console.warn(`ImageKit Audio Folders: /AllAudio (MP3 etc.), /AllDescription (TXT)`);
        console.warn(`Book Category Logic: Filename prefixes defined in 'categoryPrefixes' array.`);
        console.warn(`Book/Cover Match Logic: Base filename must match exactly (case-insensitive).`);
        console.warn(`Audio Description Match Logic: Base filename of MP3 must match base filename of TXT.`);
        console.warn(`Video Data: Fetched from YouTube Playlists defined in ./server/data/rerngNitenCollectionsConfig.js`);
        console.warn(`Required Environment Variables: IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT, AUDIO_IMAGEKIT_PUBLIC_KEY, AUDIO_IMAGEKIT_PRIVATE_KEY, AUDIO_IMAGEKIT_URL_ENDPOINT, YOUTUBE_API_KEY, FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_KEY_PATH`);
        console.warn(`🔴 Book views, audio likes, and video comments are stored in Firestore for persistence.`);
        console.warn(`🔴 Video comments GET endpoint currently returns flat list, not nested tree.`);
        console.warn(`🔴 IMPORTANT: Implement Firestore Security Rules in Firebase Console for Production!`);
    }
});