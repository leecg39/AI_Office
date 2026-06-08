#!/usr/bin/env node
const {
  extractDuckDuckGoResults,
  isFetchSafeResearchUrl,
  isPrivateResearchHost,
  isSafeResearchUrl,
  normalizeResearchHostname,
  normalizeResearchUrl,
  researchSafeLookup
} = require('./web-server');

let checkCount = 0;

function assert(condition, message) {
  checkCount += 1;
  if (!condition) throw new Error(message);
}

function lookupRejected(hostname) {
  return new Promise((resolve) => {
    researchSafeLookup(hostname, {}, (error) => {
      resolve(Boolean(error));
    });
  });
}

async function main() {
  assert(normalizeResearchHostname('[::1]') === '::1', 'Bracketed IPv6 hostname was not normalized');
  assert(isPrivateResearchHost('localhost'), 'localhost was not treated as private');
  assert(isPrivateResearchHost('sub.localhost'), 'sub.localhost was not treated as private');
  assert(isPrivateResearchHost('0.0.0.0'), '0.0.0.0 was not treated as private');
  assert(isPrivateResearchHost('127.0.0.1'), '127.0.0.1 was not treated as private');
  assert(isPrivateResearchHost('100.64.1.1'), 'carrier-grade NAT range was not treated as private');
  assert(isPrivateResearchHost('192.0.2.1'), 'IPv4 documentation range was not treated as private');
  assert(isPrivateResearchHost('198.18.0.1'), 'IPv4 benchmark range was not treated as private');
  assert(isPrivateResearchHost('203.0.113.1'), 'IPv4 documentation range 203.0.113.0/24 was not treated as private');
  assert(isPrivateResearchHost('[::1]'), 'Bracketed IPv6 loopback was not treated as private');
  assert(isPrivateResearchHost('[::]'), 'Bracketed IPv6 unspecified was not treated as private');
  assert(isPrivateResearchHost('[fd00::1]'), 'Bracketed IPv6 unique local was not treated as private');
  assert(isPrivateResearchHost('[::ffff:127.0.0.1]'), 'IPv4-mapped IPv6 loopback was not treated as private');
  assert(isPrivateResearchHost('[2001:db8::1]'), 'IPv6 documentation range was not treated as private');
  assert(!isSafeResearchUrl('http://127.0.0.1:8788/api/status'), 'Local IPv4 URL was treated as safe');
  assert(!isSafeResearchUrl('http://[::1]/secret'), 'Local IPv6 URL was treated as safe');
  assert(!isSafeResearchUrl('http://[::ffff:127.0.0.1]/secret'), 'IPv4-mapped IPv6 URL was treated as safe');
  assert(isSafeResearchUrl('https://example.com/connect-ai/qa'), 'Public HTTPS URL was not treated as safe');
  assert(!isSafeResearchUrl('file:///etc/passwd'), 'file:// URL was treated as safe');
  assert(!isSafeResearchUrl('ftp://example.com/secret'), 'ftp:// URL was treated as safe');
  assert(!await isFetchSafeResearchUrl('http://127.0.0.1:8788/api/status'), 'Local IPv4 fetch URL was treated as safe');
  assert(!await isFetchSafeResearchUrl('http://[::1]/secret'), 'Local IPv6 fetch URL was treated as safe');
  assert(!await isFetchSafeResearchUrl('http://[::ffff:127.0.0.1]/secret'), 'IPv4-mapped IPv6 fetch URL was treated as safe');
  assert(await lookupRejected('localhost'), 'Lookup hook allowed localhost');
  assert(await lookupRejected('127.0.0.1'), 'Lookup hook allowed 127.0.0.1');
  assert(await lookupRejected('::1'), 'Lookup hook allowed ::1');
  assert(await lookupRejected('[fd00::1]'), 'Lookup hook allowed fd00::1');
  assert(await lookupRejected('[::ffff:127.0.0.1]'), 'Lookup hook allowed IPv4-mapped IPv6 loopback');

  const redirected = normalizeResearchUrl('/l/?uddg=https%3A%2F%2Fexample.com%2Fconnect-ai%2Fqa');
  assert(redirected === 'https://example.com/connect-ai/qa', 'DuckDuckGo redirect URL was not normalized');
  assert(normalizeResearchUrl('javascript:alert(1)') === '', 'javascript: URL was normalized as safe');
  assert(normalizeResearchUrl('/l/?uddg=file%3A%2F%2F%2Fetc%2Fpasswd') === '', 'DuckDuckGo file redirect was normalized as safe');
  assert(normalizeResearchUrl('http://[::1') === '', 'Malformed URL was normalized as safe');
  const malformedReuters = 'http://reuters-reuters-prod.cdn.arcpublishing.com/technology/eu-ai-act-enforcement-begins-2025-04-17/%5d(https:/www.reuters.com/technology/eu-ai-act-enforcement-begins-2025-04-17/';
  const canonicalReuters = 'https://www.reuters.com/technology/eu-ai-act-enforcement-begins-2025-04-17/';
  assert(normalizeResearchUrl(malformedReuters) === canonicalReuters, 'Malformed Reuters CDN URL was not normalized to the public article URL');
  assert(normalizeResearchUrl(`/l/?uddg=${encodeURIComponent(malformedReuters)}`) === canonicalReuters, 'Malformed Reuters URL inside DuckDuckGo redirect was not normalized');

  const html = `
    <div class="result">
      <a class="result__a" href="http://127.0.0.1/private">Local Result</a>
      <a class="result__snippet">Should be rejected.</a>
    </div>
    <div class="result">
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fconnect-ai">Public &amp; Result</a>
      <a class="result__snippet">Should <b>remain</b>.</a>
    </div>
  `;
  const results = extractDuckDuckGoResults(html, 5);
  assert(results.length === 1, `Expected one safe result, got ${results.length}`);
  assert(results[0].url === 'https://example.com/connect-ai', 'Safe public result URL was not preserved');
  assert(results[0].title === 'Public & Result', 'Research result title was not HTML-decoded');
  assert(results[0].snippet === 'Should remain.', 'Research result snippet was not stripped safely');

  const malformedReutersHtml = `
    <div class="result">
      <a class="result__a" href="${malformedReuters}">Reuters Result</a>
      <a class="result__snippet">Should use canonical Reuters URL.</a>
    </div>
  `;
  const reutersResults = extractDuckDuckGoResults(malformedReutersHtml, 5);
  assert(reutersResults.length === 1, `Expected one Reuters result, got ${reutersResults.length}`);
  assert(reutersResults[0].url === canonicalReuters, 'Extracted Reuters result kept the inaccessible CDN URL');

  const hyphenHtml = `
    <div class="result">
      <a class="result__a" href="https://example.com/hyphen">Hyphen Result</a>
      <a class="result__snippet"><b>AI</b>-powered QA should stay readable.</a>
    </div>
  `;
  const hyphenResults = extractDuckDuckGoResults(hyphenHtml, 5);
  assert(hyphenResults.length === 1, `Expected one hyphen result, got ${hyphenResults.length}`);
  assert(hyphenResults[0].snippet === 'AI-powered QA should stay readable.', 'Hyphenated research snippet was not normalized');

  console.log(JSON.stringify({ ok: true, checks: checkCount }, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
