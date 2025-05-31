// File: D:\CUS\digital library\imagekit-backend\server.js

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const ImageKit = require('imagekit'); // Used for Book ImageKit
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch'); // Import node-fetch to fetch content from TXT URLs
const admin = require('firebase-admin'); // Add Firebase Admin SDK

const { collectionsConfig } = require('./server/data/rerngNitenCollectionsConfig'); // Video Collections Config

// --- Firebase Admin SDK Initialization ---
const admin = require('firebase-admin');

let serviceAccount;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // Use JSON content from environment variable
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log("Firebase: Using service account JSON from FIREBASE_SERVICE_ACCOUNT.");
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH) {
        // Use file path (local or uploaded to Render)
        serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
        console.log("Firebase: Using service account file from FIREBASE_SERVICE_ACCOUNT_KEY_PATH.");
    } else {
        throw new Error('FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_KEY_PATH must be set in environment variables.');
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("🔴 ERROR: Failed to initialize Firebase Admin SDK:", error.message);
    process.exit(1); // Exit process if initialization fails
}

const db = admin.firestore(); // Firestore instance

// --- YouTube Data API Initialization ---
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
if (!youtubeApiKey || youtubeApiKey === 'YOUR_COPIED_YOUTUBE_API_KEY') {
    console.error("🔴 ERROR: YOUTUBE_API_KEY is not set or is using the placeholder in .env. Video data will not load from YouTube.");
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

app.use(cors(
    {
    origin: ['http://localhost:3000', 'https://bannalydigital.netlify.app/'], // ប្តូរទៅ Netlify URL ក្រោយ Deploy
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}
));
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
    if (process.env.NODE_ENV !== 'production') {
        if (!publicKey) process.env.IMAGEKIT_PUBLIC_KEY = 'dummy_public_key_book';
        if (!privateKey) process.env.IMAGEKIT_PRIVATE_KEY = 'dummy_private_key_book';
        if (!urlEndpoint) process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/dummy_book/';
        console.warn("Using dummy ImageKit BOOK credentials. Book features may not function correctly.");
    } else {
        console.error("Missing ImageKit BOOK credentials in production. Book features might not work.");
    }
} else {
    console.log("ImageKit BOOK credentials loaded.");
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
    if (process.env.NODE_ENV !== 'production') {
        if (!audioPublicKey) process.env.AUDIO_IMAGEKIT_PUBLIC_KEY = 'dummy_public_key_audio';
        if (!audioPrivateKey) process.env.AUDIO_IMAGEKIT_PRIVATE_KEY = 'dummy_private_key_audio';
        if (!audioUrlEndpoint) process.env.AUDIO_IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/dummy_audio/';
        console.warn("Using dummy ImageKit AUDIO credentials. Audio features may not function correctly.");
    } else {
        console.error("Missing ImageKit AUDIO credentials in production. Audio features might not work.");
    }
} else {
    console.log("ImageKit AUDIO credentials loaded.");
    audioImageKit = new ImageKit({
        publicKey: audioPublicKey,
        privateKey: audioPrivateKey,
        urlEndpoint: audioUrlEndpoint
    });
}

// --- API Endpoint for Listing ImageKit Data (Books) ---
app.get('/api/imagekit/rerngniten-data', async (req, res) => {
    if (!imagekit) {
        console.error("ImageKit BOOK not initialized. Cannot fetch book list.");
        return res.status(500).json({
            message: 'Backend not configured for ImageKit BOOK access. Please check server environment variables.',
            error: 'ImageKit BOOK configuration missing'
        });
    }

    const allBooksFolderPath = "/AllBook";
    const allCoversFolderPath = "/AllCover";

    try {
        console.log(`Fetching PDF files from: ${allBooksFolderPath} (Book ImageKit)`);
        const pdfFiles = await imagekit.listFiles({
            path: allBooksFolderPath,
            fileType: "non-image",
            extensions: ["pdf"],
            limit: 1000
        });
        console.log(`Found ${pdfFiles.length} PDF files in ${allBooksFolderPath}`);

        console.log(`Fetching cover image files from: ${allCoversFolderPath} (Book ImageKit)`);
        const coverFiles = await imagekit.listFiles({
            path: allCoversFolderPath,
            fileType: "image",
            limit: 1000
        });
        console.log(`Found ${coverFiles.length} cover image files in ${allCoversFolderPath}`);

        const coverFilesByBaseName = coverFiles.reduce((acc, file) => {
            const baseName = getBaseName(file.name).trim().toLowerCase();
            if (baseName) {
                acc[baseName] = file;
            }
            return acc;
        }, {});

        const allBooksData = [];

        // Fetch all view counts in one query
        const bookViewsSnapshot = await db.collection('bookViews').get();
        const viewCountsMap = bookViewsSnapshot.docs.reduce((acc, doc) => {
            acc[doc.id] = doc.data().views || 0;
            return acc;
        }, {});

        for (const pdfFile of pdfFiles) {
            const pdfBaseName = getBaseName(pdfFile.name).trim();
            const uniqueId = pdfFile.fileId;

            if (!pdfBaseName) {
                console.warn(`Skipping processing of a PDF file with empty name at path: ${pdfFile.filePath}`);
                continue;
            }

            let category = defaultCategory;
            const lowerCasePdfBaseName = pdfBaseName.toLowerCase();
            for (const catPrefix of categoryPrefixes) {
                if (lowerCasePdfBaseName.startsWith(catPrefix.prefix.toLowerCase())) {
                    category = catPrefix.category;
                    break;
                }
            }

            const lowerCasePdfBaseNameForCoverLookup = pdfBaseName.toLowerCase();
            const matchingCoverFile = coverFilesByBaseName[lowerCasePdfBaseNameForCoverLookup];
            const coverImageUrl = matchingCoverFile ? matchingCoverFile.url : null;

            const views = viewCountsMap[uniqueId] || 0;

            allBooksData.push({
                id: uniqueId,
                pdfUrl: pdfFile.url,
                coverImageUrl: coverImageUrl,
                title: pdfBaseName,
                category: category,
                author: 'មិនមានព័ទ្ធិមាន',
                views: views,
            });
        }
        console.log(`Successfully processed data. Total found ${allBooksData.length} book entries.`);
        res.json(allBooksData);
    } catch (error) {
        console.error("Error fetching book list from ImageKit BOOK:", error);
        if (process.env.NODE_ENV !== 'production') {
            console.error("Detailed ImageKit BOOK Error:", error);
        }
        res.status(500).json({
            message: 'Failed to fetch book list from ImageKit',
            error: process.env.NODE_ENV !== 'production' ? error.message : 'Internal Server Error'
        });
    }
});

// --- API Endpoint for Recording Book Views ---
app.post('/api/imagekit/view-book', async (req, res) => {
    const bookId = req.body.bookId;
    if (!bookId) {
        return res.status(400).json({ message: 'Book ID is required' });
    }

    try {
        const bookRef = db.collection('bookViews').doc(bookId);
        await db.runTransaction(async (transaction) => {
            const bookDoc = await transaction.get(bookRef);
            const currentViews = bookDoc.exists ? bookDoc.data().views : 0;
            transaction.set(bookRef, { views: currentViews + 1 }, { merge: true });
        });

        const updatedDoc = await bookRef.get();
        const newViewCount = updatedDoc.data().views;
        console.log(`View recorded for bookId: ${bookId}. Current count: ${newViewCount}.`);
        res.json({ message: 'View recorded successfully', bookId: bookId, newViewCount });
    } catch (error) {
        console.error(`Error recording view for bookId: ${bookId}:`, error);
        res.status(500).json({ message: 'Failed to record view', error: error.message });
    }
});

// --- API Endpoint for Listing ImageKit Data (Audio) ---
app.get('/api/imagekit/audio-data', async (req, res) => {
    if (!audioImageKit) {
        console.error("ImageKit AUDIO not initialized. Cannot fetch audio list.");
        return res.status(500).json({
            message: 'Backend not configured for ImageKit AUDIO access. Please check server environment variables.',
            error: 'ImageKit AUDIO configuration missing'
        });
    }

    const audioFilesFolderPath = "/AllAudio";
    const descriptionFilesFolderPath = "/AllDescription";

    try {
        console.log(`Fetching audio files from ImageKit AUDIO: ${audioFilesFolderPath}`);
        const audioFiles = await audioImageKit.listFiles({
            path: audioFilesFolderPath,
            fileType: "non-image",
            extensions: ["mp3", "ogg", "wav", "aac"],
            limit: 1000
        });
        console.log(`Found ${audioFiles.length} audio files in ${audioFilesFolderPath}`);

        console.log(`Fetching description files from ImageKit AUDIO: ${descriptionFilesFolderPath}`);
        const descriptionFiles = await audioImageKit.listFiles({
            path: descriptionFilesFolderPath,
            fileType: "non-image",
            extensions: ["txt"],
            limit: 1000
        });
        console.log(`Found ${descriptionFiles.length} description files in ${descriptionFilesFolderPath}`);

        const descriptionContentMap = {};
        await Promise.all(descriptionFiles.map(async (descFile) => {
            const descBaseName = getBaseName(descFile.name).trim().toLowerCase();
            if (descBaseName) {
                try {
                    const response = await fetch(descFile.url);
                    if (!response.ok) {
                        console.warn(`Failed to fetch content for description file ${descFile.name}: ${response.status} ${response.statusText}`);
                        descriptionContentMap[descBaseName] = '';
                        return;
                    }
                    const textContent = await response.text();
                    descriptionContentMap[descBaseName] = textContent;
                } catch (fetchError) {
                    console.warn(`Error fetching content for description file ${descFile.name}:`, fetchError);
                    descriptionContentMap[descBaseName] = '';
                }
            }
        }));

        // Fetch all like counts in one query
        const audioLikesSnapshot = await db.collection('audioLikes').get();
        const audioLikesMap = audioLikesSnapshot.docs.reduce((acc, doc) => {
            acc[doc.id] = doc.data().likes || 0;
            return acc;
        }, {});

        const allAudioData = [];

        for (const audioFile of audioFiles) {
            const audioBaseName = getBaseName(audioFile.name).trim();
            const uniqueId = audioFile.fileId;

            if (!audioBaseName) {
                console.warn(`Skipping processing of audio file with empty name at path: ${audioFile.filePath}`);
                continue;
            }

            const lowerCaseAudioBaseNameForLookup = audioBaseName.toLowerCase();
            const descriptionText = descriptionContentMap[lowerCaseAudioBaseNameForLookup] || 'មិនមានព័ទ្ធិមានពិស្តារទេ';
            const likes = audioLikesMap[uniqueId] || 0;

            allAudioData.push({
                id: uniqueId,
                title: audioBaseName,
                src: audioFile.url,
                coverImageUrl: null,
                description: descriptionText,
                likes: likes,
            });
        }

        console.log(`Successfully processed audio data. Total found ${allAudioData.length} audio entries.`);
        res.json(allAudioData);
    } catch (error) {
        console.error("Error fetching audio list from ImageKit AUDIO:", error);
        if (process.env.NODE_ENV !== 'production') {
            console.error("Detailed ImageKit AUDIO Error:", error);
        }
        res.status(500).json({
            message: 'Failed to fetch audio list from ImageKit',
            error: process.env.NODE_ENV !== 'production' ? error.message : 'Internal Server Error'
        });
    }
});

// --- API Endpoint for Liking/Unliking Audio Items ---
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

    try {
        const audioRef = db.collection('audioLikes').doc(audioId);
        await db.runTransaction(async (transaction) => {
            const audioDoc = await transaction.get(audioRef);
            const currentLikes = audioDoc.exists ? audioDoc.data().likes : 0;
            const newLikes = isLiked ? Math.max(0, currentLikes - 1) : currentLikes + 1;
            transaction.set(audioRef, { likes: newLikes }, { merge: true });
        });

        const updatedDoc = await audioRef.get();
        const newLikeCount = updatedDoc.data().likes;
        console.log(`Like action for audio ID ${audioId}. New count: ${newLikeCount}. Action: ${isLiked ? 'Unlike' : 'Like'}`);
        res.status(200).json({ audioId, newLikeCount });
    } catch (error) {
        console.error(`Error updating like for audioId: ${audioId}:`, error);
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

    try {
        const commentsSnapshot = await db.collection('videoComments')
            .where('videoId', '==', videoId)
            .orderBy('timestamp', 'asc')
            .get();

        const comments = commentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`Serving ${comments.length} comments (and replies) for video ID: ${videoId}`);
        res.json(comments);
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

    const newComment = {
        videoId,
        text: text.trim(),
        author: commentAuthor,
        timestamp: new Date().toISOString(),
        parentId: parentId || null,
        likes: 0,
        replies: [],
    };

    try {
        const commentRef = await db.collection('videoComments').add(newComment);
        newComment.id = commentRef.id;
        console.log(`New comment/reply added for video ID: ${videoId} by ${commentAuthor}. Parent ID: ${parentId}`);
        res.status(201).json(newComment);
    } catch (error) {
        console.error(`Error adding comment for videoId: ${videoId}:`, error);
        res.status(500).json({ message: 'Failed to add comment', error: error.message });
    }
});

// --- API Endpoint for Reacting to Comments ---
app.post('/api/comments/:commentId/react', async (req, res) => {
    const commentId = req.params.commentId;
    const { type } = req.body;

    if (!commentId || !type || type !== 'like') {
        console.warn(`Received invalid reaction request for comment ID ${commentId}: type=${type}`);
        return res.status(400).json({ message: 'Valid Comment ID and reaction type "like" are required' });
    }

    try {
        const commentRef = db.collection('videoComments').doc(commentId);
        const commentDoc = await commentRef.get();

        if (!commentDoc.exists) {
            console.warn(`Attempted to react to non-existent comment ID: ${commentId}`);
            return res.status(404).json({ message: 'Comment not found' });
        }

        await db.runTransaction(async (transaction) => {
            const commentDoc = await transaction.get(commentRef);
            const currentLikes = commentDoc.data().likes || 0;
            transaction.update(commentRef, { likes: currentLikes + 1 });
        });

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
            return allItems;
        }

        const currentItems = allItems.concat(items);
        const nextToken = response.data.nextPageToken;

        if (nextToken) {
            return fetchPlaylistItems(playlistId, nextToken, currentItems);
        } else {
            return currentItems;
        }
    } catch (error) {
        console.error(`🔴 Error fetching playlist items for playlist ID ${playlistId} (Page Token: ${pageToken}):`, error);
        return allItems;
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
        console.warn(`ImageKit Book Folders: /AllBook (PDFs), /AllCover (Covers)`);
        console.warn(`ImageKit Audio Folders: /AllAudio (MP3 etc.), /AllDescription (TXT)`);
        console.warn(`Book Category Logic: Filename prefixes defined in 'categoryPrefixes' array.`);
        console.warn(`Book/Cover Match Logic: Base filename must match exactly (case-insensitive).`);
        console.warn(`Audio Description Match Logic: Base filename of MP3 must match base filename of TXT.`);
        console.warn(`Video Data: Fetched from YouTube Playlists defined in ./server/data/rerngNitenCollectionsConfig.js`);
        console.warn(`Required Environment Variables: IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT, AUDIO_IMAGEKIT_PUBLIC_KEY, AUDIO_IMAGEKIT_PRIVATE_KEY, AUDIO_IMAGEKIT_URL_ENDPOINT, YOUTUBE_API_KEY, FIREBASE_SERVICE_ACCOUNT_KEY_PATH`);
        console.warn(`🔴 Book views, audio likes, and video comments are stored in Firestore for persistence.`);
    }
});