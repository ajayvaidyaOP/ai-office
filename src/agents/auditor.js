/* ═══════════════════════════════════════════════════════════════
   WEBSITE AUDITOR — the agent that actually earns the money.

   It opens the lead's public page and reports only what it can see:
   HTTP status, https, mobile viewport, booking/order path, contact
   buttons, broken links, page weight, placeholder text.

   Design rules (non-negotiable):
   1. NEVER invent a finding. If a check cannot run, the finding is
      "could not check", not a guess.
   2. Every finding carries evidence — the exact phrase or status code
      you can screenshot and show the business owner.
   3. Read-only. It fetches public pages and never submits a form,
      never posts, never messages anyone.
   ═══════════════════════════════════════════════════════════════ */

import { config } from '../config.js';

const SEVERITY_ORDER = { high: 3, medium: 2, low: 1, none: 0 };

/** Polite, identifiable UA — a human could verify every request in their logs. */
const UA =
  'Mozilla/5.0 (compatible; InvincibleOfficeAuditor/1.0; +read-only audit; contact: office owner)';

/** Fetch with a hard timeout, a byte cap, and no redirect surprises. */
async function fetchPage(url, { timeoutMs = config.audit.timeoutMs, maxBytes = config.audit.maxBytes } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    });
    const contentType = response.headers.get('content-type') || '';
    let body = '';
    let truncated = false;

    if (/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      const reader = response.body?.getReader();
      if (reader) {
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            truncated = true;
            chunks.push(value.slice(0, Math.max(0, maxBytes - (total - value.byteLength))));
            break;
          }
          chunks.push(value);
        }
        body = Buffer.concat(chunks).toString('utf8');
        try {
          reader.cancel();
        } catch {
          /* already closed */
        }
      }
    }

    return {
      ok: true,
      status: response.status,
      finalUrl: response.url || url,
      redirected: Boolean(response.url && response.url !== url),
      contentType,
      body,
      truncated,
      bytes: Buffer.byteLength(body),
      ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      error: error.name === 'AbortError' ? `Timed out after ${timeoutMs} ms` : error.message,
      ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

const has = (html, pattern) => pattern.test(html);

const strip = (html) =>
  String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words that mean "this site is not finished". */
const PLACEHOLDERS = [
  /\blorem ipsum\b/i,
  /\bdummy text\b/i,
  /\btyp(?:e|ing) set\b/i,
  /\bplaceholder\b/i,
  /\byour text here\b/i,
  /\bunder construction\b/i,
  /\bcoming soon\b/i,
];

const BOOKING_WORDS = /\b(book|booking|appointment|reserve|schedule|slot|enrol|enroll|admission|consult)\b/i;
const ORDER_WORDS = /\b(order|cart|checkout|buy now|add to cart|menu|price list|shop now|whatsapp)\b/i;

/**
 * Audit one URL. Returns findings with severity, evidence and a
 * customer-facing consequence — the exact sentence an outreach can use.
 */
export async function auditWebsite(rawUrl, { isSocial = false } = {}) {
  const url = normaliseUrl(rawUrl);
  if (!url) {
    return {
      url: rawUrl || '',
      checkedAt: new Date().toISOString(),
      reachable: false,
      severity: 'high',
      findings: [
        {
          key: 'no-website',
          severity: 'high',
          title: 'no working website — customers cannot check anything before visiting',
          evidence: 'No website URL on file',
          fix: 'One-page site with menu/prices + a book/order button',
        },
      ],
      checks: { fetched: false },
    };
  }

  const page = await fetchPage(url);
  const findings = [];
  const checks = {
    fetched: page.ok,
    status: page.status,
    https: url.startsWith('https://'),
    secureAfterRedirect: String(page.finalUrl || '').startsWith('https://'),
    bytes: page.bytes,
    loadMs: page.ms,
    truncated: page.truncated,
    isSocial,
  };

  /* ── 1. Can anyone open it at all? ─────────────────────── */
  if (!page.ok) {
    findings.push({
      key: 'unreachable',
      severity: 'high',
      title: `site did not open (${page.error || 'no response'})`,
      evidence: page.error || 'Fetch failed',
      fix: 'Restore hosting/DNS, then verify from a phone',
    });
  } else if (page.status >= 400) {
    findings.push({
      key: 'http-error',
      severity: 'high',
      title: `site returns HTTP ${page.status} — customers see an error page`,
      evidence: `HTTP ${page.status} from ${page.finalUrl}`,
      fix: 'Fix the failing page or redirect it to the homepage',
    });
  }

  if (!url.startsWith('https://') && page.ok) {
    findings.push({
      key: 'no-https',
      severity: 'medium',
      title: 'opens on http:// only — browsers show "Not secure"',
      evidence: `Fetched ${page.finalUrl} over http`,
      fix: 'Enable free SSL (Let’s Encrypt) and redirect http → https',
    });
  }

  const html = page.body || '';

  const loaded = page.ok && page.status < 400;

  /* ── 2. Is it usable on a phone? (we cannot run a browser,
        so we check the one signal that decides mobile layout) ── */
  if (loaded) {
    const viewport = has(html, /<meta[^>]+name=["']viewport["']/i);
    checks.mobileViewport = viewport;
    if (!viewport) {
      findings.push({
        key: 'no-viewport',
        severity: 'high',
        title: 'no mobile viewport tag — the page shrinks on a phone',
        evidence: 'No <meta name="viewport"> in the HTML head',
        fix: 'Add a responsive viewport and test at 390px width',
        unverified: false,
      });
    }
  }

  /* ── 3. Is there a path to money? ─────────────────────── */
  if (loaded && html) {
    const text = strip(html);
    const tel = (html.match(/href=["']tel:/gi) || []).length;
    const wa = (html.match(/wa\.me|api\.whatsapp\.com|web\.whatsapp\.com/gi) || []).length;
    const mail = (html.match(/href=["']mailto:/gi) || []).length;
    const forms = (html.match(/<form\b/gi) || []).length;
    const booking = BOOKING_WORDS.test(text) || has(html, /calendly|bookpebble|respark|setmore|zoho.*book/i);
    const ordering = ORDER_WORDS.test(text) || has(html, /razorpay|instamojo|zomato|swiggy/i);

    checks.telLinks = tel;
    checks.whatsappLinks = wa;
    checks.mailtoLinks = mail;
    checks.forms = forms;
    checks.bookingKeyword = booking;
    checks.orderKeyword = ordering;

    if (!tel && !wa && !mail && !forms) {
      findings.push({
        key: 'no-contact-path',
        severity: 'high',
        title: 'no phone, WhatsApp, email or form anywhere on the page',
        evidence: '0 tel:, 0 wa.me, 0 mailto:, 0 <form> found',
        fix: 'Add one visible call + WhatsApp button above the fold',
      });
    } else if (!forms && !booking && !ordering) {
      findings.push({
        key: 'no-booking-path',
        severity: 'medium',
        title: 'no booking or order step — visitors can only call',
        evidence: `Contact links exist (tel ${tel}, WhatsApp ${wa}) but no form or booking flow`,
        fix: 'Add a 3-field enquiry form + WhatsApp handoff',
      });
    } else if (forms > 0 && !booking && !ordering) {
      findings.push({
        key: 'form-without-purpose',
        severity: 'low',
        title: 'a form exists but nothing on the page says what it books or orders',
        evidence: `${forms} form(s), no booking/order wording`,
        fix: 'Label the form with the action and time expectations',
      });
    }

    /* ── 4. Is the page still a draft? ──────────────────── */
    const placeholder = PLACEHOLDERS.find((rx) => rx.test(text));
    if (placeholder) {
      const match = text.match(placeholder);
      findings.push({
        key: 'placeholder-text',
        severity: 'high',
        title: 'unfinished template text is live on the page',
        evidence: `Found "${match?.[0] || 'placeholder text'}" in the visible copy`,
        fix: 'Replace template copy with real menu/services and prices',
      });
    }

    const dollars = (text.match(/\$\s?\d{1,4}(?:\.\d{2})?/g) || []).slice(0, 3);
    const hasRupees = /₹|INR|Rs\.?\s?\d/.test(text);
    if (dollars.length && !hasRupees) {
      findings.push({
        key: 'wrong-currency',
        severity: 'medium',
        title: 'prices are in dollars, not rupees',
        evidence: `Found ${dollars.join(', ')} with no ₹ anywhere`,
        fix: 'Replace with real INR prices',
      });
    }

    /* ── 5. Search & sharing basics ─────────────────────── */
    const title = (html.match(/<title[^>]*>([\s\S]{0,180}?)<\/title>/i) || [, ''])[1].trim();
    const description = (
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]{0,300}?)["']/i) || [, '']
    )[1].trim();
    checks.title = title;
    checks.description = description;

    if (loaded && !title) {
      findings.push({
        key: 'no-title',
        severity: 'medium',
        title: 'page has no <title> — Google and WhatsApp previews show the URL',
        evidence: 'No <title> element',
        fix: 'Add a page title: business + area + main service',
      });
    }
    if (loaded && !description) {
      findings.push({
        key: 'no-description',
        severity: 'low',
        title: 'no meta description',
        evidence: 'No <meta name="description">',
        fix: 'One sentence describing what you do and where',
      });
    }

    /* ── 6. Weight & links (cheap checks, honest labels) ── */
    if (page.bytes > 900_000) {
      findings.push({
        key: 'heavy-page',
        severity: 'medium',
        title: 'homepage HTML is unusually heavy',
        evidence: `${Math.round(page.bytes / 1024)} KB of HTML in the first ${config.audit.maxBytes / 1000} KB`,
        fix: 'Compress images, defer scripts',
        note: 'UNVERIFIED for real-world mobile speed — needs a Lighthouse run',
      });
    }

    const externalHosts = [...html.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi)]
      .map((m) => {
        try {
          return new URL(m[1]).hostname;
        } catch {
          return '';
        }
      })
      .filter(Boolean);
    const selfHost = new URL(page.finalUrl).hostname.replace(/^www\./, '');
    const foreignHosts = [...new Set(externalHosts.filter((host) => !host.replace(/^www\./, '').endsWith(selfHost)))];
    checks.foreignImageHosts = foreignHosts.slice(0, 5);
    if (foreignHosts.length) {
      findings.push({
        key: 'hotlinked-assets',
        severity: 'medium',
        title: 'images are loaded from another website',
        evidence: `${foreignHosts.slice(0, 3).join(', ')} — if they change it, your page breaks`,
        fix: 'Host the images on your own domain',
      });
    }

    const telHref = (html.match(/href=["']tel:([^"']+)["']/i) || [])[1] || '';
    if (telHref && !/^\+?91|^[6-9]\d{9}/.test(telHref.replace(/[^\d+]/g, ''))) {
      const digits = telHref.replace(/[^\d]/g, '');
      if (digits.length < 10 || /^1/.test(digits)) {
        findings.push({
          key: 'bad-tel-link',
          severity: 'high',
          title: 'the tap-to-call button dials the wrong number',
          evidence: `href="tel:${telHref}" is not an Indian number`,
          fix: 'Point it at the real business number',
        });
      }
    }
  }

  /* ── 7. Social profile: no site to crawl ──────────────── */
  if (isSocial) {
    findings.push({
      key: 'social-only',
      severity: 'high',
      title: 'business lives only on social media — no owned website',
      evidence: `Source is a social profile: ${page.finalUrl}`,
      fix: 'One-page site + link in bio that can take orders',
    });
  }

  return {
    url,
    finalUrl: page.finalUrl,
    checkedAt: new Date().toISOString(),
    reachable: page.ok && page.status < 400,
    status: page.status,
    severity: summarise(findings),
    findings,
    checks,
  };
}

/** Worst finding decides the severity — one broken checkout beats five typos. */
export function summarise(findings = []) {
  if (!findings.length) return 'none';
  const worst = findings.reduce(
    (acc, item) => (SEVERITY_ORDER[item.severity] > SEVERITY_ORDER[acc] ? item.severity : acc),
    'none',
  );
  return worst;
}

export function normaliseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  try {
    const parsed = new URL(withScheme);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/** True for a URL we know is a social profile rather than a website. */
export const isSocialUrl = (value) =>
  /instagram\.com|facebook\.com|fb\.me|wa\.me\/|linktr\.ee|twitter\.com|x\.com/i.test(String(value || ''));

/**
 * Audit a lead: uses `website` when present, otherwise the source URL if it
 * is a social profile (so "Instagram only" is itself a recorded finding).
 */
export async function auditLead(lead) {
  const website = String(lead?.website || '').trim();
  const sourceUrl = String(lead?.sourceUrl || '').trim();
  if (website) return auditWebsite(website, { isSocial: isSocialUrl(website) });
  if (sourceUrl && isSocialUrl(sourceUrl)) return auditWebsite(sourceUrl, { isSocial: true });
  if (sourceUrl) return auditWebsite(sourceUrl, { isSocial: false });
  return auditWebsite('', { isSocial: false });
}

/** One-line summary for lists and the brief. */
export function auditSummary(audit) {
  if (!audit) return 'not audited';
  if (!audit.findings?.length) return 'no issues found';
  const top = [...audit.findings].sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])[0];
  return `${audit.severity} · ${top.title}`;
}
