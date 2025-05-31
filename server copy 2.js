// File: D:\CUS\digital library\imagekit-backend\server.js

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const ImageKit = require('imagekit'); // Used for Book ImageKit
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch'); // 🔴 Import node-fetch to fetch content from TXT URLs

const { collectionsConfig } = require('./server/data/rerngNitenCollectionsConfig'); // Video Collections Config


// --- YouTube Data API Initialization ---
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
if (!youtubeApiKey || youtubeApiKey === 'YOUR_COPIED_YOUTUBE_API_KEY') {
    console.error("🔴 ERROR: YOUTUBE_API_KEY is not set or is using the placeholder in .env. Video data will not load from YouTube.");
}

const youtube = (youtubeApiKey && youtubeApiKey !== 'YOUR_COPIED_YOUTUBE_API_KEY') ? google.youtube({
    version: 'v3',
    auth: youtubeApiKey,
}) : null;


// --- Data Storage (In-Memory - NOT Persistent) ---
// Global variables to store processed data after fetching
let loadedVideoCollections = []; // Stores the collections with video details fetched from YouTube
let isVideoDataLoaded = false; // Flag to indicate if video data loading is complete
let videoDataLoadError = null; // To store error if video data load fails

// View counts for books (Keep existing)
const viewCounts = {};
console.log("View counts for books stored in-memory (not persistent).");

const commentsStore = {};
console.log("🔴 Video comments and reactions stored in-memory (NOT PERSISTENT). Use a database for production.");

// 🔴 In-Memory storage for audio item like counts (for demonstration)
const audioLikeCountsStore = {};
console.log("🔴 Audio item like counts stored in-memory (NOT PERSISTENT).");


const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
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


// --- 🔴 ImageKit Initialization (for Audio) ---
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


// --- API Endpoint for Listing ImageKit Data (Books) --- (Keep existing)
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
    console.log(`Created cover map with ${Object.keys(coverFilesByBaseName).length} entries.`);

    const allBooksData = [];

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

        const views = viewCounts[uniqueId] || 0;

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

app.post('/api/imagekit/view-book', (req, res) => {
    const bookId = req.body.bookId;
    if (!bookId) {
        return res.status(400).json({ message: 'Book ID is required' });
    }
    viewCounts[bookId] = (viewCounts[bookId] || 0) + 1;
    console.log(`View recorded for bookId: ${bookId}. Current count: ${viewCounts[bookId]}.`);
    res.json({ message: 'View recorded successfully', bookId: bookId, newViewCount: viewCounts[bookId] });
});


// --- 🔴 NEW API Endpoint for Listing ImageKit Data (Audio) ---
// Path: /api/imagekit/audio-data
app.get('/api/imagekit/audio-data', async (req, res) => {
    if (!audioImageKit) {
        console.error("ImageKit AUDIO not initialized. Cannot fetch audio list.");
        return res.status(500).json({
            message: 'Backend not configured for ImageKit AUDIO access. Please check server environment variables.',
            error: 'ImageKit AUDIO configuration missing'
        });
    }

    // 🔴 Define the folder paths for audio files and descriptions in the Audio ImageKit account
    const audioFilesFolderPath = "/AllAudio"; // User specified this folder
    const descriptionFilesFolderPath = "/AllDescription"; // User specified this folder
    // If you have covers for audio, define that path too (e.g., "/AudioCovers")
    // const audioCoversFolderPath = "/AudioCovers";


    try {
        console.log(`Fetching audio files from ImageKit AUDIO: ${audioFilesFolderPath}`);
        const audioFiles = await audioImageKit.listFiles({
            path: audioFilesFolderPath,
            fileType: "non-image",
            extensions: ["mp3", "ogg", "wav", "aac"], // List your expected audio extensions
            limit: 1000 // Adjust limit or handle pagination
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

        // 🔴 Create a map of description content by base name
        const descriptionContentMap = {};
        // Fetch content for each description file concurrently
        await Promise.all(descriptionFiles.map(async (descFile) => {
             const descBaseName = getBaseName(descFile.name).trim().toLowerCase();
             if (descBaseName) {
                 try {
                     // Fetch the content of the text file directly from its URL
                     const response = await fetch(descFile.url);
                     if (!response.ok) {
                         console.warn(`Failed to fetch content for description file ${descFile.name}: ${response.status} ${response.statusText}`);
                         descriptionContentMap[descBaseName] = ''; // Store empty string or error indicator
                         return; // Skip to next iteration in Promise.all
                     }
                     const textContent = await response.text();
                     descriptionContentMap[descBaseName] = textContent;
                      // console.log(`Fetched content for ${descFile.name}`); // Log each fetch if needed

                 } catch (fetchError) {
                      console.warn(`Error fetching content for description file ${descFile.name}:`, fetchError);
                      descriptionContentMap[descBaseName] = ''; // Store empty string or error indicator
                 }
             }
        }));
        console.log(`Populated description map with ${Object.keys(descriptionContentMap).length} entries.`);

        // 🔴 If you decide to add audio covers to this account:
        // Fetch audio cover image files similarly if needed
        // const audioCoverFiles = await audioImageKit.listFiles({...});
        // Create a map of audio cover files by their base name for quick lookup
        // const audioCoverFilesByBaseName = audioCoverFiles.reduce(...);


        const allAudioData = [];

        // Process each audio file, match with description and covers (if fetching covers)
        for (const audioFile of audioFiles) {
            const audioBaseName = getBaseName(audioFile.name).trim();
            const uniqueId = audioFile.fileId; // Use FileId as the unique ID for audio

            if (!audioBaseName) {
                 console.warn(`Skipping processing of audio file with empty name at path: ${audioFile.filePath}`);
                 continue; // Move to the next audio file
            }

            // Find matching description content
            const lowerCaseAudioBaseNameForLookup = audioBaseName.toLowerCase();
            const descriptionText = descriptionContentMap[lowerCaseAudioBaseNameForLookup] || 'មិនមានព័ទ្ធិមានពិស្តារទេ'; // Default description if TXT not found


             // 🔴 If you are fetching audio covers:
             // Find matching cover image by base name
             // const audioCoverFile = audioCoverFilesByBaseName[lowerCaseAudioBaseNameForLookup]; // Need to create this map earlier
             // const audioCoverImageUrl = audioCoverFile ? audioCoverFile.url : null;


            // Initialize like count from in-memory storage
            const likes = audioLikeCountsStore[uniqueId] || 0;

            allAudioData.push({
                id: uniqueId, // Unique ID for the audio item
                title: audioBaseName, // Use trimmed base filename as title
                src: audioFile.url, // The full URL to the audio file (Frontend needs 'src' property)
                // coverImageUrl: audioCoverImageUrl || null, // Use found cover or null (uncomment if fetching covers)
                coverImageUrl: null, // 🔴 Assuming no covers for audio for now
                description: descriptionText,
                likes: likes, // Add the like count
            });
        }

        console.log(`Successfully processed audio data. Total found ${allAudioData.length} audio entries.`);
        res.json(allAudioData); // Respond with the list of audio data

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

// 🔴 NEW API Endpoint to handle liking/unliking audio items
// Path: POST /api/audio/:audioId/like
// NOTE: This is a very simple in-memory like count. Real app needs user tracking in DB.
app.post('/api/audio/:audioId/like', (req, res) => {
     const audioId = req.params.audioId; // Get audioId from URL
     // 🔴 In a real app, you'd get user ID from req.user or similar for auth
     // const userId = req.body.userId; // Or from body if user sends it

     if (!audioId) {
         return res.status(400).json({ message: 'Audio ID is required' });
     }

     // 🔴 Simple toggle like logic (in-memory)
     // You might want to track WHICH user liked it for a real app
     // For now, we just increment/decrement a global count
     const isCurrentlyLiked = req.body.isLiked; // Assume frontend sends current liked status

     if (isCurrentlyLiked === undefined) {
          console.warn(`Received audio like request for ${audioId} without isLiked status.`);
         // This endpoint expects the frontend to tell it whether it's a like or unlike action
         return res.status(400).json({ message: 'isLiked status is required in body' });
     }


     // Initialize count if it doesn't exist
     audioLikeCountsStore[audioId] = audioLikeCountsStore[audioId] || 0;

     if (isCurrentlyLiked) {
          // If frontend says it was liked, it's an unlike action now
          audioLikeCountsStore[audioId] = Math.max(0, audioLikeCountsStore[audioId] - 1); // Ensure count doesn't go below zero
     } else {
         // If frontend says it was NOT liked, it's a like action now
          audioLikeCountsStore[audioId]++;
     }

     console.log(`Like action for audio ID ${audioId}. New count: ${audioLikeCountsStore[audioId]}. Action: ${isCurrentlyLiked ? 'Unlike' : 'Like'}`);

     // Respond with the new like count
     res.status(200).json({
         audioId: audioId,
         newLikeCount: audioLikeCountsStore[audioId]
     });
});


// --- API Endpoint for fetching Video Collections ---
// This endpoint returns the data that was loaded from YouTube API on startup
app.get('/api/videos/collections', async (req, res) => { // 🔴 Made async to allow awaiting fetchPlaylistItems
  // Optional: Check if data has finished loading
  if (!isVideoDataLoaded) {
       if (videoDataLoadError) { // If there was a critical error during load
            return res.status(500).json({
                 message: 'Failed to load video collections data initially.',
                 error: videoDataLoadError.message || 'Internal Server Error',
                 collections: []
            });
       }
       if (youtube === null) { // If API key was missing
            return res.status(503).json({ // Service Unavailable
                 message: 'Video data is not available due to missing YouTube API key.',
                 collections: []
            });
       }
       // Return empty array if still loading - Note: In a real app, you might just wait or retry
       return res.status(202).json({ // Accepted - request is processing
            message: 'Video data is still loading...',
            collections: [] // Send empty array while loading
        });
  }

  try {
    console.log("Serving loaded video collections data.");
    res.json(loadedVideoCollections); // Serve the data that was loaded on startup
  } catch (error) {
    console.error("Error serving video collections data:", error);
    res.status(500).json({
      message: 'Failed to fetch video collections',
      error: process.env.NODE_ENV !== 'production' ? error.message : 'Internal Server Error'
    });
  }
});


const findCommentById = (commentId) => {
    for (const videoId in commentsStore) {
        if (Object.hasOwnProperty.call(commentsStore, videoId) && Array.isArray(commentsStore[videoId])) {
            const comment = commentsStore[videoId].find(c => c.id === commentId);
            if (comment) {
                return comment;
            }
        }
    }
    return null;
};


app.get('/api/videos/:videoId/comments', (req, res) => {
    const videoId = req.params.videoId;

    if (!videoId) {
        return res.status(400).json({ message: 'Video ID is required' });
    }

    const comments = commentsStore[videoId] || [];

    console.log(`Serving ${comments.length} comments (and replies) for video ID: ${videoId}`);
    res.json(comments.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
});

app.post('/api/videos/:videoId/comments', (req, res) => {
    const videoId = req.params.videoId;
    const { text, author, parentId } = req.body;

    if (!videoId || !text || typeof text !== 'string' || text.trim() === '') {
        return res.status(400).json({ message: 'Video ID and non-empty comment text are required' });
    }

    const commentAuthor = author || 'អ្នកប្រើប្រាស់អនាមិក';
    // 🔴 In a real app, you would get author from authenticated user data, not body.

    const newComment = {
        id: uuidv4(),
        videoId: videoId,
        text: text.trim(),
        author: commentAuthor,
        timestamp: new Date().toISOString(),
        parentId: parentId || null,
        likes: 0, // Initialize likes count to 0
        replies: [], // Add an empty replies array
    };

    if (!commentsStore[videoId]) {
        commentsStore[videoId] = [];
    }

    commentsStore[videoId].push(newComment);

    console.log(`New comment/reply added for video ID: ${videoId} by ${commentAuthor}. Parent ID: ${parentId}`);
    res.status(201).json(newComment);
});


app.post('/api/comments/:commentId/react', (req, res) => {
    const commentId = req.params.commentId;
    const { type } = req.body;

    if (!commentId || !type || type !== 'like') {
        console.warn(`Received invalid reaction request for comment ID ${commentId}: type=${type}`);
        return res.status(400).json({ message: 'Valid Comment ID and reaction type "like" are required' });
    }

    const commentToUpdate = findCommentById(commentId);

    if (!commentToUpdate) {
        console.warn(`Attempted to react to non-existent comment ID: ${commentId}`);
        return res.status(404).json({ message: 'Comment not found' });
    }

    commentToUpdate.likes = (commentToUpdate.likes || 0) + 1;

    console.log(`Reaction 'like' recorded for comment ID: ${commentId}. New likes count: ${commentToUpdate.likes}`);

    res.status(200).json({
        message: 'Reaction recorded successfully',
        commentId: commentId,
        newLikesCount: commentToUpdate.likes
    });
});


// --- Function to load video data from YouTube Playlists on server startup ---
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

// --- Helper function to fetch all playlist items (handles pagination) ---
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

  // 🔴 Start loading video data from YouTube API when the server starts
  // This function is now correctly included and called
  loadVideoData().catch(err => {
      console.error("🔴 Fatal error during initial video data load process:", err);
  });


   if (process.env.NODE_ENV !== 'production') {
       console.log(`ImageKit Book Data URL: http://localhost:${port}/api/imagekit/rerngniten-data`);
       console.log(`ImageKit Book View URL: POST to http://localhost:${port}/api/imagekit/view-book with body { "bookId": "..." }`);
       console.log(`🔴 ImageKit Audio Data URL: http://localhost:${port}/api/imagekit/audio-data`); // 🔴 New Log
       console.log(`🔴 ImageKit Audio Like URL: POST to http://localhost:${port}/api/audio/:audioId/like with body { type: "like", isLiked: boolean }`); // 🔴 New Log
       console.log(`Video Collections URL: http://localhost:${port}/api/videos/collections`);
       console.log(`Comments GET: http://localhost:${port}/api/videos/:videoId/comments`);
       console.log(`Comments POST (New/Reply): POST to http://localhost:${port}/api/videos/:videoId/comments with body { text: "...", author: "...", parentId: "..." }`);
       console.log(`Comment Reaction POST: POST to http://localhost:${port}/api/comments/:commentId/react with body { type: "like" }`);
       console.log(`Remember to update REACT_APP_BACKEND_API_URL in your React app's environment variables.`);
        console.warn("\n--- Backend Configuration Notes ---");
        console.warn(`ImageKit Book Folders: /AllBook (PDFs), /AllCover (Covers)`);
         console.warn(`🔴 ImageKit Audio Folders: /AllAudio (MP3 etc.), /AllDescription (TXT)`); // 🔴 Updated Note
        console.warn(`Book Category Logic: Filename prefixes defined in 'categoryPrefixes' array.`);
        console.warn(`Book/Cover Match Logic: Base filename must match exactly (case-insensitive).`);
        console.warn(`Audio Description Match Logic: Base filename of MP3 must match base filename of TXT.`); // 🔴 New Note
        console.warn(`Video Data: Fetched from YouTube Playlists defined in ./server/data/rerngNitenCollectionsConfig.js`);
        console.warn(`Required Environment Variables: IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT, AUDIO_IMAGEKIT_PUBLIC_KEY, AUDIO_IMAGEKIT_PRIVATE_KEY, AUDIO_IMAGEKIT_URL_ENDPOINT, YOUTUBE_API_KEY`); // 🔴 Updated required variables
        console.warn(`🔴 COMMENTS, REACTIONS, AND AUDIO LIKES ARE STORED IN-MEMORY ONLY AND WILL BE LOST ON SERVER RESTART.`); // 🔴 Updated Note
        console.warn(`🔴 In-memory comment storage is currently FLAT.`);
   }
});