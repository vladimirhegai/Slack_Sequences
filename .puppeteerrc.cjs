/** @type {import("puppeteer").Configuration} */
module.exports = {
  // Runtime resolves system Chrome/Edge; avoid Puppeteer's separate download.
  skipDownload: true,
};
