/** @type {import("puppeteer").Configuration} */
module.exports = {
  // Sequences resolves an installed Chrome/Edge executable at runtime.
  // Avoid Puppeteer's separate ~280 MB browser download during npm install.
  skipDownload: true,
};
