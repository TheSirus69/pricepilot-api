const express = require('express');
const axios = require('axios');
const redis = require('redis');
const rateLimit = require('express-rate-limit');
const axiosRetry = require('axios-retry').default;
const UserAgent = require('user-agents');
const logger = require('./logger');
const generateWalmartSignature = require('./generateWalmartSignature');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const consumerId = process.env.CONSUMER_ID;
const privateKeyBase64 = process.env.PRIVATE_KEY_BASE64;

app.set('trust proxy', 1);

if (!consumerId || !privateKeyBase64) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});

axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkError(error) || axiosRetry.isRetryableError(error);
  }
});

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

redisClient.connect().catch(console.error);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.disable('x-powered-by');

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use(limiter);

function validateSearchInput(item, lat, lon, zip) {
  const errors = [];
  
  if (!item || typeof item !== 'string' || item.trim().length === 0) {
    errors.push('Search item is required');
  }
  
  if (item && item.length > 200) {
    errors.push('Search item is too long');
  }
  
  if (item && /[<>'"&]/.test(item)) {
    errors.push('Search item contains invalid characters');
  }
  
  if (lat && (isNaN(lat) || parseFloat(lat) < -90 || parseFloat(lat) > 90)) {
    errors.push('Invalid latitude');
  }
  
  if (lon && (isNaN(lon) || parseFloat(lon) < -180 || parseFloat(lon) > 180)) {
    errors.push('Invalid longitude');
  }
  
  if (zip && (!/^\d{5}(-\d{4})?$/.test(zip))) {
    errors.push('Invalid ZIP code format');
  }
  
  return errors;
}

app.get('/search', async (req, res) => {
  const { item, lat, lon, zip } = req.query;

  const validationErrors = validateSearchInput(item, lat, lon, zip);
  if (validationErrors.length > 0) {
    return res.status(400).json({ 
      error: 'Invalid input parameters',
      details: validationErrors 
    });
  }

  const sanitizedItem = item.trim();
  const cacheKey = `search:${sanitizedItem.toLowerCase()}:${lat || 'no-lat'}:${lon || 'no-lon'}:${zip || 'no-zip'}`;

  try {
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      console.log('Serving from cache...');
      return res.json(JSON.parse(cachedData));
    }

    let walmartStore = null;
    let targetStore = null;

    if (lat && lon) {
      [walmartStore, targetStore] = await Promise.all([
        findNearestWalmartStore(lat, lon),
        findNearestTargetStore(lat, lon)
      ]);
    }

    const [walmartResults, targetResults] = await Promise.allSettled([
      scrapeWalmart(sanitizedItem, lat, lon),
      scrapeTarget(sanitizedItem, zip)
    ]);

    const allResults = [
      ...(walmartResults.value || []),
      ...(targetResults.value || [])
    ];

    allResults.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    await redisClient.set(cacheKey, JSON.stringify(allResults), { EX: 120 });

    res.json(allResults);
  } catch (error) {
    logger.error(`Search error: ${error.message}`);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', time: new Date().toISOString() });
});

async function scrapeTarget(item, zip) {
  const query = encodeURIComponent(item);
  const ua = new UserAgent().random().toString();

  let storeId = '2903';
  if (zip) {
    const nearbyStores = await findNearbyTargetStores(zip);
    if (nearbyStores.length > 0) {
      storeId = nearbyStores[0];
    }
  }

  const url = 'https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2';
  const params = {
    key: '9f36aeafbe60771e321a7cc95a78140772ab3e96',
    channel: 'WEB',
    count: '24',
    default_purchasability_filter: 'true',
    include_sponsored: 'true',
    keyword: query,
    offset: '0',
    page: `/s/${query}`,
    platform: 'desktop',
    pricing_store_id: storeId,
    spellcheck: 'true',
    store_ids: storeId,
    visitor_id: '0000000000E501015CE7CA4F873FE98D',
    zip: zip || '37862',
  };

  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': ua },
      params,
      timeout: 10000,
    });

    const items = data?.data?.search?.products || [];
    const results = [];

    for (let product of items) {
      if (results.length >= 10) break;

      const name = product.item?.product_description?.title?.trim();
      const price = product.price?.current_retail;
      const tcin = product.tcin;
      const image = product.item?.enrichment?.images?.primary_image_url;
      const link = `https://www.target.com/p/-/A-${tcin}`;

      if (name && price) {
        results.push({
          store: 'Target',
          name,
          price: price.toFixed(2),
          url: link,
          image,
        });
      }
    }

    logger.info(`[Target] Scraped ${results.length} items for ${item} at store ${storeId}`);
    return results;
  } catch (err) {
    logger.error(`Error scraping Target: ${err.response?.status} / ${err.message}`);
    return [];
  }
}

async function scrapeWalmart(item, lat, lon) {
  const ua = new UserAgent().random().toString();
  const url = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search';
  const params = { query: item };
  if (lat && lon) {
    params.lat = lat;
    params.lon = lon;
  }

  const { signature, timestamp, keyVersion } = generateWalmartSignature(
    consumerId,
    privateKeyBase64,
    3
  );

  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': ua,
        'WM_CONSUMER.ID': consumerId,
        'WM_CONSUMER.INTIMESTAMP': timestamp,
        'WM_SEC.KEY_VERSION': keyVersion,
        'WM_SEC.AUTH_SIGNATURE': signature
      },
      params,
      timeout: 10000
    });

    const items = data.items || [];
    const results = [];

    for (let product of items) {
      if (results.length >= 10) break;

      const name = product.name?.trim();
      let price = product.salePrice ?? product.msrp;
      const link = product.itemId ? `https://www.walmart.com/ip/${product.itemId}` : null;

      const image =
        product.largeImage ||
        product.mediumImage ||
        (product.imageEntities?.[0]?.largeImage || product.imageEntities?.[0]?.mediumImage);

      if (typeof price === 'string' && price.includes('/month')) {
        const monthlyMatch = price.match(/\$([\d,]+\.?\d*)\/month/);
        const durationMatch = price.match(/(\d+)\s*months?/);
        const downPaymentMatch = price.match(/\$([\d,]+\.?\d*)\s*down/);
        
        if (monthlyMatch && durationMatch) {
          const monthlyPayment = parseFloat(monthlyMatch[1].replace(/,/g, ''));
          const duration = parseInt(durationMatch[1]);
          const downPayment = downPaymentMatch ? parseFloat(downPaymentMatch[1].replace(/,/g, '')) : 0;
          
          price = (monthlyPayment * duration) + downPayment;
        }
      }

      if (name && price && link && image) {
        results.push({
          store: 'Walmart',
          name,
          price: parseFloat(price).toFixed(2),
          url: link,
          image
        });
      }
    }

    logger.info(`[Walmart] Scraped ${results.length} items for "${item}"`);
    return results;
  } catch (err) {
    logger.error(`Error scraping Walmart: ${err.response?.status} / ${err.message}`);
    return [];
  }
}

async function findNearestWalmartStore(lat, lon) {
  const url = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2/stores';
  const { signature, timestamp, keyVersion } = generateWalmartSignature(
    consumerId,
    privateKeyBase64,
    3
  );

  try {
    const { data } = await axios.get(url, {
      headers: {
        'WM_CONSUMER.ID': consumerId,
        'WM_CONSUMER.INTIMESTAMP': timestamp,
        'WM_SEC.KEY_VERSION': keyVersion,
        'WM_SEC.AUTH_SIGNATURE': signature
      },
      params: { lat, lon },
      timeout: 10000
    });

    return data.stores?.[0];
  } catch (err) {
    logger.error(`Error finding Walmart store: ${err.message}`);
    return null;
  }
}

async function findNearbyTargetStores(zip) {
  const url = 'https://redsky.target.com/redsky_aggregations/v1/web/nearby_stores_v1';
  const params = {
    limit: 5,
    within: 100,
    place: zip,
    key: '9f36aeafbe60771e321a7cc95a78140772ab3e96',
    visitor_id: '0000000000E501015CE7CA4F873FE98D',
    channel: 'WEB',
    page: '/c/root',
  };

  try {
    const { data } = await axios.get(url, { params, timeout: 10000 });
    const stores = data?.data?.stores || [];
    return stores.map(store => store.store_id);
  } catch (err) {
    console.error(`Error fetching Target nearby stores: ${err.message}`);
    return [];
  }
}

app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'An internal server error occurred.' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 