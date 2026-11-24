'use strict';
// Where the advert files live (content/ads, or ADS_DIR on a volume). Shared by ads.js and adsense.js.
const path = require('path');
module.exports = { AD_DIR: process.env.ADS_DIR || path.join(__dirname, '..', 'content', 'ads') };
