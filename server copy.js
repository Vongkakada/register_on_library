// File: D:\CUS\digital library\imagekit-backend\server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const ImageKit = require('imagekit');
const { google } = require('googleapis'); 
const { v4: uuidv4 } = require('uuid'); 

const { collectionsConfig } = require('./server/data/rerngNitenCollectionsConfig'); 


const youtubeApiKey = process.env.YOUTUBE_API_KEY;
if (!youtubeApiKey || youtubeApiKey === 'YOUR_COPIED_YOUTUBE_API_KEY') {
    console.error("🔴 ERROR: YOUTUBE_API_KEY is not set or is using the placeholder in .env. Video data will not load from YouTube.");
}

const youtube = (youtubeApiKey && youtubeApiKey !== 'YOUR_COPIED_YOUTUBE_API_KEY') ? google.youtube({
    version: 'v3',
    auth: youtubeApiKey,
}) : null; 


let loadedVideoCollections = []; 
let isVideoDataLoaded = false; 
let videoDataLoadError = null; 

const viewCounts = {};
console.log("View counts for books stored in-memory (not persistent).");

const commentsStore = {};
console.log("🔴 Video comments and reactions stored in-memory (NOT PERSISTENT). Use a database for production.");


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


const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;

if (!publicKey || !privateKey || !urlEndpoint) {
  console.error("🔴 ERROR: ImageKit environment variables are not set.");
  console.error("🔴 Please set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT in .env.");
   if (process.env.NODE_ENV !== 'production') {
       if (!publicKey) process.env.IMAGEKIT_PUBLIC_KEY = 'dummy_public_key';
       if (!privateKey) process.env.IMAGEKIT_PRIVATE_KEY = 'dummy_private_key';
       if (!urlEndpoint) process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/dummy/';
       console.warn("Using dummy ImageKit credentials. Book features may not function correctly.");
   } else {
       console.error("Missing ImageKit credentials in production. Book features might not work.");
   }
} else {
    console.log("ImageKit credentials loaded.");
}

const imagekit = (publicKey && privateKey && urlEndpoint) ? new ImageKit({
  publicKey: publicKey,
  privateKey: privateKey,
  urlEndpoint: urlEndpoint
}) : null; 


app.get('/api/imagekit/rerngniten-data', async (req, res) => {
  if (!imagekit) {
      console.error("ImageKit not initialized. Cannot fetch book list.");
      return res.status(500).json({
          message: 'Backend not configured for ImageKit access. Please check server environment variables.',
          error: 'ImageKit configuration missing'
      });
  }

  const allBooksFolderPath = "/AllBook"; 
  const allCoversFolderPath = "/AllCover"; 

  try {
    console.log(`Fetching PDF files from: ${allBooksFolderPath}`);
    const pdfFiles = await imagekit.listFiles({
      path: allBooksFolderPath,
      fileType: "non-image",
      extensions: ["pdf"],
      limit: 1000 
    });
    console.log(`Found ${pdfFiles.length} PDF files in ${allBooksFolderPath}`);

    console.log(`Fetching cover image files from: ${allCoversFolderPath}`);
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
    console.error("Error fetching book list from ImageKit:", error);
     if (process.env.NODE_ENV !== 'production') {
         console.error("Detailed ImageKit Error:", error);
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

app.get('/api/videos/collections', (req, res) => {
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

    const newComment = {
        id: uuidv4(), 
        videoId: videoId,
        text: text.trim(),
        author: commentAuthor,
        timestamp: new Date().toISOString(), 
        parentId: parentId || null, 
        likes: 0, 
        replies: [], 
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
                    const description = item.snippet?.description || 'មិនមានព័ត៌មានពិស្តារទេ';
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


app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);

  loadVideoData().catch(err => {
      console.error("🔴 Fatal error during initial video data load process:", err);
  });


   if (process.env.NODE_ENV !== 'production') {
       console.log(`ImageKit Data URL: http://localhost:${port}/api/imagekit/rerngniten-data`);
       console.log(`ImageKit View URL: POST to http://localhost:${port}/api/imagekit/view-book with body { "bookId": "..." }`);
       console.log(`Video Collections URL: http://localhost:${port}/api/videos/collections`);
       console.log(`🔴 Comments GET: http://localhost:${port}/api/videos/:videoId/comments`);
       console.log(`🔴 Comments POST (New/Reply): POST to http://localhost:${port}/api/videos/:videoId/comments with body { text: "...", author: "...", parentId: "..." }`);
       console.log(`🔴 Comment Reaction POST: POST to http://localhost:${port}/api/comments/:commentId/react with body { type: "like" }`);
       console.log(`Remember to update REACT_APP_BACKEND_API_URL in your React app's environment variables.`);
        console.warn("\n--- Backend Configuration Notes ---");
        console.warn(`ImageKit Folders: /AllBook (PDFs), /AllCover (Covers)`);
        console.warn(`Book Category Logic: Filename prefixes defined in 'categoryPrefixes' array.`);
        console.warn(`Book/Cover Match Logic: Base filename must match exactly (case-insensitive).`);
        console.warn(`Video Data: Fetched from YouTube Playlists defined in ./server/data/rerngNitenCollectionsConfig.js`);
        console.warn(`Required Environment Variables: IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT, YOUTUBE_API_KEY`);
        console.warn(`🔴 COMMENTS AND REACTIONS ARE STORED IN-MEMORY ONLY AND WILL BE LOST ON SERVER RESTART.`);
        console.warn(`🔴 In-memory comment storage is currently FLAT, meaning replies are not nested under parents when fetched by the GET endpoint.`);
   }
});