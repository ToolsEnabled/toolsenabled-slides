'use strict';
function trunc(s) { s = String(s || ''); return s.length > 42 ? s.slice(0, 42) + '…' : s; }
const DASH_RE = /[–—]/; // en dash, em dash
const LINT_MIN_SIZE = 20;

function lintModel(m) {
  const issues = [];
  const flagDash = (slideId, elementId, field, text) => {
    const s = String(text == null ? '' : text);
    const hit = s.match(DASH_RE);
    if (hit) issues.push({ type: 'dash', slideId, elementId, field, detail: `contains "${hit[0]}"`, text: trunc(s) });
  };

  const headers = []; // size>=28, non-centered text — the slide-title convention
  for (const slide of m.slides) {
    flagDash(slide.id, null, 'notes', slide.notes);
    for (const el of (slide.elements || [])) {
      const texts = Array.isArray(el.items) ? el.items : [el.text];
      texts.forEach((t, i) => flagDash(slide.id, el.id, Array.isArray(el.items) ? `items[${i}]` : 'text', t));
      const st = el.style || {};
      if (typeof st.size === 'number' && st.size < LINT_MIN_SIZE) {
        issues.push({ type: 'min-size', slideId: slide.id, elementId: el.id, field: 'style.size',
          detail: `${st.size}pt is under the ${LINT_MIN_SIZE}pt floor` });
      }
      if (typeof st.size === 'number' && st.size >= 28 && st.align !== 'center') {
        headers.push({ slideId: slide.id, elementId: el.id, align: st.align || 'left' });
      }
    }
  }

  if (headers.length > 1) {
    const counts = {};
    for (const h of headers) counts[h.align] = (counts[h.align] || 0) + 1;
    const majority = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    for (const h of headers) {
      if (h.align !== majority) {
        issues.push({ type: 'header-align', slideId: h.slideId, elementId: h.elementId, field: 'style.align',
          detail: `header aligned "${h.align}", ${counts[majority]}/${headers.length} other headers are "${majority}"` });
      }
    }
  }

  return { rev: m.rev, ok: issues.length === 0, count: issues.length, issues };
}

const TIMING_WPM = 135;
const TIMING_TARGET_S = 11 * 60;   // default target: 11:00
const TIMING_CAP_S = 12 * 60;      // default budget: 12:00

function estimateTiming(m) {
  const perSlide = m.slides.map((slide) => {
    let words = 0;
    for (const el of (slide.elements || [])) {
      const texts = Array.isArray(el.items) ? el.items : [el.text];
      for (const t of texts) {
        const s = String(t == null ? '' : t).trim();
        if (s) words += s.split(/\s+/).length;
      }
    }
    return { slideId: slide.id, words, seconds: Math.round(words / TIMING_WPM * 60) };
  });
  const totalWords = perSlide.reduce((n, s) => n + s.words, 0);
  const totalSeconds = perSlide.reduce((n, s) => n + s.seconds, 0);
  return {
    wpm: TIMING_WPM, targetSeconds: TIMING_TARGET_S, capSeconds: TIMING_CAP_S,
    totalWords, totalSeconds, perSlide,
    overTarget: totalSeconds > TIMING_TARGET_S, overCap: totalSeconds > TIMING_CAP_S
  };
}

module.exports={DASH_RE,LINT_MIN_SIZE,lintModel,estimateTiming};
