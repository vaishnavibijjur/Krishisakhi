'use strict';

const fs     = require('fs');
const path   = require('path');
const express = require('express');
const axios   = require('axios');
const logger  = require('../config/logger');

const router = express.Router();

// data.gov.in resource ID for "Current Daily Price of Various Commodities from Various Markets (Mandi)"
const AGMARKNET_RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070';
const AGMARKNET_BASE_URL    = 'https://api.data.gov.in/resource/' + AGMARKNET_RESOURCE_ID;

// Local CSV fallback — place the official AGMARKNET dataset here.
// Download from: https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?api-key=YOUR_KEY&format=csv
// Required columns: state, district, market, commodity, variety, arrival_date, min_price, max_price, modal_price
const FALLBACK_CSV = path.join(__dirname, '../../data/mandi_fallback.csv');

/**
 * Parse the local CSV fallback and filter by query params.
 * Returns null if the CSV file does not exist.
 * Returns [] if it exists but has no matching rows.
 */
function readCsvFallback({ state, district, commodity } = {}) {
  if (!fs.existsSync(FALLBACK_CSV)) return null;

  const content = fs.readFileSync(FALLBACK_CSV, 'utf8');
  const lines   = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const records = lines.slice(1).map(line => {
    // Basic CSV split — handles simple comma-separated data without embedded commas
    const values = line.split(',');
    const rec    = {};
    headers.forEach((h, i) => {
      rec[h] = (values[i] || '').trim().replace(/^"|"$/g, '');
    });
    return rec;
  });

  return records.filter(r => {
    if (state     && !(r.state     || '').toLowerCase().includes(state.toLowerCase()))     return false;
    if (district  && !(r.district  || '').toLowerCase().includes(district.toLowerCase()))  return false;
    if (commodity && !(r.commodity || '').toLowerCase().includes(commodity.toLowerCase())) return false;
    return true;
  });
}

/**
 * GET /api/market/prices
 *
 * Query params:
 *   state      : e.g. "Karnataka"
 *   district   : e.g. "Bangalore"
 *   commodity  : e.g. "Tomato"
 *   limit      : number of records (default 20, max 100)
 *   offset     : pagination offset
 *
 * PRIMARY: live data.gov.in API (requires MANDI_API_KEY)
 * FALLBACK: local CSV at server/data/mandi_fallback.csv
 */
router.get('/prices', async (req, res) => {
  const apiKey   = process.env.MANDI_API_KEY;
  const limit    = Math.min(parseInt(req.query.limit  || '20', 10), 100);
  const offset   = parseInt(req.query.offset || '0', 10);
  const { state, district, commodity } = req.query;

  // ── Try live API ────────────────────────────────────────────
  if (apiKey) {
    const filters = [];
    if (state)     filters.push(`state:${state}`);
    if (district)  filters.push(`district:${district}`);
    if (commodity) filters.push(`commodity:${commodity}`);

    const params = { 'api-key': apiKey, format: 'json', limit, offset };
    if (filters.length > 0) params.filters = filters.join(',');

    try {
      const { data } = await axios.get(AGMARKNET_BASE_URL, { params, timeout: 15000 });
      return res.json({
        status:    'ok',
        available: true,
        total:     data.total,
        count:     data.count,
        offset:    data.offset,
        records:   data.records || [],
      });
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      logger.warn('Mandi live API failed, trying CSV fallback', { detail });
      // Fall through to CSV fallback below
    }
  } else {
    logger.info('MANDI_API_KEY not set — using CSV fallback directly.');
  }

  // ── CSV fallback ─────────────────────────────────────────────
  const rows = readCsvFallback({ state, district, commodity });

  if (rows === null) {
    // CSV also missing — return graceful unavailable (frontend shows "Coming Soon")
    return res.status(503).json({
      status:    'unavailable',
      message:   'Mandi price data unavailable. Place mandi_fallback.csv in server/data/ for offline use.',
      available: false,
    });
  }

  const pageRows = rows.slice(offset, offset + limit);
  return res.json({
    status:    'ok',
    available: true,
    total:     rows.length,
    count:     pageRows.length,
    offset,
    records:   pageRows,
  });
});

/**
 * GET /api/market/commodities
 *
 * Returns distinct commodity names for a state/district.
 * Falls back to CSV if live API fails.
 */
router.get('/commodities', async (req, res) => {
  const apiKey  = process.env.MANDI_API_KEY;
  const { state, district } = req.query;

  if (apiKey) {
    const params = { 'api-key': apiKey, format: 'json', limit: 100, offset: 0, fields: 'commodity' };
    if (state)    params.filters = `state:${state}`;
    if (district) params.filters = (params.filters ? params.filters + ',' : '') + `district:${district}`;

    try {
      const { data } = await axios.get(AGMARKNET_BASE_URL, { params, timeout: 15000 });
      const commodities = [...new Set(
        (data.records || []).map(r => r.commodity).filter(Boolean)
      )].sort();
      return res.json({ status: 'ok', available: true, commodities });
    } catch (err) {
      logger.warn('Mandi commodities API failed, trying CSV fallback', { detail: err.message });
    }
  }

  // CSV fallback
  const rows = readCsvFallback({ state, district });
  if (rows === null) {
    return res.status(503).json({ status: 'unavailable', available: false, commodities: [] });
  }
  const commodities = [...new Set(rows.map(r => r.commodity).filter(Boolean))].sort();
  return res.json({ status: 'ok', available: true, commodities });
});

module.exports = router;
