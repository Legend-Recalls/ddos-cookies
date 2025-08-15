import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const REFERER = "https://animepahe.ru";
const RECENT_ANIME_FILE = "recent-anime.json";
const POPULAR_ANIME_FILE = "popular-anime.json";
const TOP_MOVIES_FILE = "top-movies.json";
const COOKIES_FILE = "cookies.json";

// Load cookies from file
function loadCookies() {
  try {
    if (!fs.existsSync(COOKIES_FILE)) {
      throw new Error("cookies.json not found");
    }
    const cookieData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    return cookieData.cookies || cookieData; // Handle different cookie file formats
  } catch (err) {
    console.error("❌ Failed to load cookies:", err.message);
    process.exit(1);
  }
}

// Initialize cookies
const cookies = loadCookies();
console.log("✅ Cookies loaded successfully");

// Fetch with cookies
async function fetchWithCookies(url) {
  const cookieString = typeof cookies === 'string' ? cookies : cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": REFERER,
      "Cookie": cookieString
    }
  });
  
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.data,
    text: async () => response.data
  };
}

// Get MAL ID from anime page
async function getMALId(session) {
  try {
    const response = await fetchWithCookies(`https://animepahe.ru/anime/${session}`);
    const html = await response.text();
    const match = html.match(/meta name="myanimelist" content="(\d+)"/);
    return match ? match[1] : null;
  } catch (err) {
    console.warn(`⚠️ Failed to get MAL ID for session ${session}`);
    return null;
  }
}

// Scan airing anime
async function scanAiringAnime() {
  console.log("🔍 Scanning airing anime...");
  const airingAnime = [];

  try {
    // Scan first 5 pages of airing anime
    for (let page = 1; page <= 5; page++) {
      console.log(`📄 Scanning airing page ${page}...`);
      
      const airingUrl = `${REFERER}/api?m=airing&page=${page}`;
      const response = await fetchWithCookies(airingUrl);
      
      if (!response.ok) {
        console.warn(`⚠️ Airing page ${page} returned status ${response.status}`);
        continue;
      }

      const data = await response.json();
      if (!data.data || !Array.isArray(data.data)) {
        console.warn(`⚠️ No data found on airing page ${page}`);
        continue;
      }

      // Process each airing item
      for (const item of data.data) {
        try {
          // Search for the anime to get full details
          const searchUrl = `${REFERER}/api?m=search&q=${encodeURIComponent(item.anime_title)}`;
          const searchResponse = await fetchWithCookies(searchUrl);
          
          if (!searchResponse.ok) continue;
          
          const searchData = await searchResponse.json();
          if (!searchData.data || !Array.isArray(searchData.data)) continue;

          // Find matching anime by session
          const matchedAnime = searchData.data.find(anime => anime.session === item.anime_session);
          if (!matchedAnime) continue;

          // Get MAL ID
          const malId = await getMALId(matchedAnime.session);

          const animeInfo = {
            id: matchedAnime.id,
            malid: malId,
            title: matchedAnime.title,
            type: matchedAnime.type,
            episodes: matchedAnime.episodes,
            status: matchedAnime.status,
            season: matchedAnime.season,
            year: matchedAnime.year,
            score: matchedAnime.score,
            poster: matchedAnime.poster,
            session: matchedAnime.session,
            slug: matchedAnime.slug,
            latest_episode: item.episode,
            latest_snapshot: item.snapshot,
            latest_fansub: item.fansub,
            last_updated: item.created_at,
            scanned_at: new Date().toISOString()
          };

          airingAnime.push(animeInfo);
          console.log(`✅ Found: ${item.anime_title} (Episode ${item.episode})`);

        } catch (err) {
          console.error(`❌ Error processing ${item.anime_title}:`, err.message);
        }

        // Small delay to be respectful
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Remove duplicates by session
    const uniqueAnime = [];
    const seenSessions = new Set();
    
    for (const anime of airingAnime) {
      if (!seenSessions.has(anime.session)) {
        seenSessions.add(anime.session);
        uniqueAnime.push(anime);
      }
    }

    // Sort by latest scanned
    uniqueAnime.sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));

    // Save to file
    const output = {
      timestamp: Date.now(),
      total: uniqueAnime.length,
      data: uniqueAnime
    };

    fs.writeFileSync(RECENT_ANIME_FILE, JSON.stringify(output, null, 2));
    console.log(`✅ Saved ${uniqueAnime.length} airing anime to ${RECENT_ANIME_FILE}`);
    
    return uniqueAnime;

  } catch (err) {
    console.error("❌ Error scanning airing anime:", err.message);
    return [];
  }
}

// Get random user agent
function getRandomUserAgent() {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Scan popular anime (from Jikan + match with AnimePahe)
async function scanPopularAnime() {
  console.log("🔍 Scanning popular anime...");
  const popularAnime = [];

  try {
    // Get popular anime from Jikan (MyAnimeList API)
    const jikanPages = 2; // Scan first 2 pages
    
    for (let page = 1; page <= jikanPages; page++) {
      console.log(`📄 Scanning Jikan popular page ${page}...`);
      
      const jikanUrl = `https://api.jikan.moe/v4/top/anime?filter=airing&page=${page}`;
      const response = await axios.get(jikanUrl, {
        headers: { "User-Agent": getRandomUserAgent() }
      });

      if (response.status < 200 || response.status >= 300) {
        console.warn(`⚠️ Jikan page ${page} returned status ${response.status}`);
        continue;
      }

      const data = response.data;
      if (!data.data || !Array.isArray(data.data)) continue;

      // Process each popular anime
      for (const jikanAnime of data.data) {
        try {
          const malId = jikanAnime.mal_id;
          const titles = [
            jikanAnime.title,
            jikanAnime.title_english,
            jikanAnime.title_japanese,
            ...(jikanAnime.title_synonyms || [])
          ].filter(Boolean);

          // Try to find on AnimePahe
          let paheMatch = null;
          for (const title of titles) {
            if (!title) continue;
            
            try {
              const searchUrl = `${REFERER}/api?m=search&q=${encodeURIComponent(title)}`;
              const searchResponse = await fetchWithCookies(searchUrl);
              
              if (!searchResponse.ok) continue;
              
              const searchData = await searchResponse.json();
              if (!searchData.data || !Array.isArray(searchData.data)) continue;

              // Look for exact or close match
              paheMatch = searchData.data.find(anime => {
                const animeTitle = anime.title.toLowerCase();
                return animeTitle === title.toLowerCase() || 
                       animeTitle.includes(title.toLowerCase()) ||
                       title.toLowerCase().includes(animeTitle);
              });

              if (paheMatch) break;
              
            } catch (err) {
              // Continue to next title
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          // Create anime object - use AnimePahe data when available, fallback to Jikan
          const animeInfo = {
            id: paheMatch?.id || null,
            malid: malId ? String(malId) : null,
            title: paheMatch?.title || jikanAnime.title,
            type: paheMatch?.type || jikanAnime.type,
            episodes: paheMatch?.episodes || jikanAnime.episodes,
            status: paheMatch?.status || jikanAnime.status,
            season: paheMatch?.season || jikanAnime.season,
            year: paheMatch?.year || jikanAnime.year,
            score: paheMatch?.score || jikanAnime.score,
            // Use AnimePahe poster if available, otherwise fallback to Jikan
            poster: paheMatch?.poster || jikanAnime.images?.webp?.large_image_url || jikanAnime.images?.jpg?.image_url,
            synopsis: jikanAnime.synopsis,
            session: paheMatch?.session || null,
            slug: paheMatch?.slug || null,
            scanned_at: new Date().toISOString(),
            source: paheMatch ? 'animepahe' : 'jikan'
          };

          popularAnime.push(animeInfo);
          console.log(`✅ Found: ${jikanAnime.title}${paheMatch ? ' (matched on AnimePahe)' : ' (Jikan only)'}`);

        } catch (err) {
          console.error(`❌ Error processing ${jikanAnime.title}:`, err.message);
        }

        // Small delay
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Delay between pages
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Sort by score (highest first)
    popularAnime.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Save to file
    const output = {
      timestamp: Date.now(),
      total: popularAnime.length,
      data: popularAnime
    };

    fs.writeFileSync(POPULAR_ANIME_FILE, JSON.stringify(output, null, 2));
    console.log(`✅ Saved ${popularAnime.length} popular anime to ${POPULAR_ANIME_FILE}`);
    
    return popularAnime;

  } catch (err) {
    console.error("❌ Error scanning popular anime:", err.message);
    return [];
  }
}

// Scan top movies (from Jikan + match with AnimePahe)
async function scanTopMovies() {
  console.log("🔍 Scanning top anime movies...");
  const topMovies = [];

  try {
    // Get top movies from Jikan (MyAnimeList API)
    const jikanPages = 3; // Scan first 3 pages for movies
    
    for (let page = 1; page <= jikanPages; page++) {
      console.log(`📄 Scanning Jikan top movies page ${page}...`);
      
      const jikanUrl = `https://api.jikan.moe/v4/top/anime?type=movie&page=${page}`;
      const response = await axios.get(jikanUrl, {
        headers: { "User-Agent": getRandomUserAgent() }
      });

      if (response.status < 200 || response.status >= 300) {
        console.warn(`⚠️ Jikan movies page ${page} returned status ${response.status}`);
        continue;
      }

      const data = response.data;
      if (!data.data || !Array.isArray(data.data)) continue;

      // Process each top movie
      for (const jikanMovie of data.data) {
        try {
          const malId = jikanMovie.mal_id;
          const titles = [
            jikanMovie.title,
            jikanMovie.title_english,
            jikanMovie.title_japanese,
            ...(jikanMovie.title_synonyms || [])
          ].filter(Boolean);

          // Try to find on AnimePahe
          let paheMatch = null;
          for (const title of titles) {
            if (!title) continue;
            
            try {
              const searchUrl = `${REFERER}/api?m=search&q=${encodeURIComponent(title)}`;
              const searchResponse = await fetchWithCookies(searchUrl);
              
              if (!searchResponse.ok) continue;
              
              const searchData = await searchResponse.json();
              if (!searchData.data || !Array.isArray(searchData.data)) continue;

              // Look for exact or close match, prioritize movies
              paheMatch = searchData.data.find(anime => {
                const animeTitle = anime.title.toLowerCase();
                const titleLower = title.toLowerCase();
                const isMatch = animeTitle === titleLower || 
                               animeTitle.includes(titleLower) ||
                               titleLower.includes(animeTitle);
                
                // Prefer movies if available
                return isMatch && (anime.type === 'Movie' || anime.type === 'movie');
              });

              // If no movie match found, look for any match
              if (!paheMatch) {
                paheMatch = searchData.data.find(anime => {
                  const animeTitle = anime.title.toLowerCase();
                  return animeTitle === title.toLowerCase() || 
                         animeTitle.includes(title.toLowerCase()) ||
                         title.toLowerCase().includes(animeTitle);
                });
              }

              if (paheMatch) break;
              
            } catch (err) {
              // Continue to next title
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          // Create movie object - use AnimePahe data when available, fallback to Jikan
          const movieInfo = {
            id: paheMatch?.id || null,
            malid: malId ? String(malId) : null,
            title: paheMatch?.title || jikanMovie.title,
            type: paheMatch?.type || jikanMovie.type,
            episodes: paheMatch?.episodes || jikanMovie.episodes,
            status: paheMatch?.status || jikanMovie.status,
            season: paheMatch?.season || jikanMovie.season,
            year: paheMatch?.year || jikanMovie.year,
            score: paheMatch?.score || jikanMovie.score,
            // Use AnimePahe poster if available, otherwise fallback to Jikan
            poster: paheMatch?.poster || jikanMovie.images?.webp?.large_image_url || jikanMovie.images?.jpg?.image_url,
            synopsis: jikanMovie.synopsis,
            session: paheMatch?.session || null,
            slug: paheMatch?.slug || null,
            // Movie specific fields
            duration: jikanMovie.duration,
            rating: jikanMovie.rating,
            rank: jikanMovie.rank,
            popularity: jikanMovie.popularity,
            favorites: jikanMovie.favorites,
            scored_by: jikanMovie.scored_by,
            // Additional info
            scanned_at: new Date().toISOString(),
            source: paheMatch ? 'animepahe' : 'jikan'
          };

          topMovies.push(movieInfo);
          console.log(`✅ Found: ${jikanMovie.title} (${jikanMovie.score || 'N/A'})${paheMatch ? ' (matched on AnimePahe)' : ' (Jikan only)'}`);

        } catch (err) {
          console.error(`❌ Error processing ${jikanMovie.title}:`, err.message);
        }

        // Small delay
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Delay between pages
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Sort by score (highest first), then by rank
    topMovies.sort((a, b) => {
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      
      const rankA = a.rank || 999999;
      const rankB = b.rank || 999999;
      return rankA - rankB;
    });

    // Save to file
    const output = {
      timestamp: Date.now(),
      total: topMovies.length,
      data: topMovies
    };

    fs.writeFileSync(TOP_MOVIES_FILE, JSON.stringify(output, null, 2));
    console.log(`✅ Saved ${topMovies.length} top movies to ${TOP_MOVIES_FILE}`);
    
    return topMovies;

  } catch (err) {
    console.error("❌ Error scanning top movies:", err.message);
    return [];
  }
}

// Main scanning function
async function scanAll() {
  console.log("🚀 Starting anime scanning...");
  console.log("=" .repeat(50));

  try {
    // Scan airing anime
    const airingResults = await scanAiringAnime();
    console.log(`📊 Airing anime scan complete: ${airingResults.length} items`);
    console.log("-".repeat(50));

    // Small delay between scans
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Scan popular anime
    const popularResults = await scanPopularAnime();
    console.log(`📊 Popular anime scan complete: ${popularResults.length} items`);
    console.log("-".repeat(50));

    // Small delay between scans
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Scan top movies
    const movieResults = await scanTopMovies();
    console.log(`📊 Top movies scan complete: ${movieResults.length} items`);
    console.log("=" .repeat(50));

    console.log("🎉 All scans completed successfully!");
    console.log(`📁 Files created:`);
    console.log(`   - ${RECENT_ANIME_FILE} (${airingResults.length} airing anime)`);
    console.log(`   - ${POPULAR_ANIME_FILE} (${popularResults.length} popular anime)`);
    console.log(`   - ${TOP_MOVIES_FILE} (${movieResults.length} top movies)`);

  } catch (err) {
    console.error("❌ Scanning failed:", err.message);
    process.exit(1);
  }
}

// Run the scanner
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  scanAll().then(() => {
    console.log("✅ Scanner finished successfully");
    process.exit(0);
  }).catch(err => {
    console.error("❌ Scanner failed:", err);
    process.exit(1);
  });
}

export {
  scanAiringAnime,
  scanPopularAnime,
  scanTopMovies,
  scanAll
};
