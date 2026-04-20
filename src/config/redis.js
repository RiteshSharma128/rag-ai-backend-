// Upstash Redis - REST API based (free tier friendly)
const https = require('https');

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Check if Upstash is configured
const isUpstashConfigured = () => UPSTASH_URL && UPSTASH_TOKEN && 
  UPSTASH_URL !== 'https://XXXXX.upstash.io';

// REST API call to Upstash
const upstashFetch = async (command) => {
  if (!isUpstashConfigured()) return null;
  
  try {
    const url = `${UPSTASH_URL}/${command.map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await res.json();
    return data.result;
  } catch {
    return null;
  }
};

const connectRedis = async () => {
  if (!isUpstashConfigured()) {
    console.log('⚠️  Upstash Redis not configured — caching disabled (app still works)');
    return;
  }
  try {
    const result = await upstashFetch(['ping']);
    if (result === 'PONG') {
      console.log('✅ Upstash Redis Connected');
    }
  } catch (error) {
    console.log('⚠️  Upstash Redis connection failed — caching disabled');
  }
};

// Cache get
const cacheGet = async (key) => {
  try {
    if (!isUpstashConfigured()) return null;
    const result = await upstashFetch(['get', key]);
    return result ? JSON.parse(result) : null;
  } catch { return null; }
};

// Cache set with TTL
const cacheSet = async (key, value, ttlSeconds = 3600) => {
  try {
    if (!isUpstashConfigured()) return;
    await upstashFetch(['set', key, JSON.stringify(value), 'ex', String(ttlSeconds)]);
  } catch { /* silent */ }
};

// Cache delete
const cacheDel = async (key) => {
  try {
    if (!isUpstashConfigured()) return;
    await upstashFetch(['del', key]);
  } catch { /* silent */ }
};

module.exports = connectRedis;
module.exports.cacheGet = cacheGet;
module.exports.cacheSet = cacheSet;
module.exports.cacheDel = cacheDel;
module.exports.isUpstashConfigured = isUpstashConfigured;
