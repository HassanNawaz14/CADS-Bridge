import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGlossary } from '../context/GlossaryContext';

const EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE']);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isInsideExcluded(el) {
  let cur = el;
  while (cur) {
    if (cur.nodeType === 1) {
      const tag = cur.tagName;
      if (EXCLUDED_TAGS.has(tag)) return true;
      if (cur.getAttribute?.('data-glossary-skip') === 'true') return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

function buildMatcher(terms) {
  const cleaned = terms
    .map((t) => ({ ...t, term: String(t.term || '').trim() }))
    .filter((t) => t.term.length >= 2);

  // Prefer longer terms first to avoid partial matches
  cleaned.sort((a, b) => b.term.length - a.term.length);

  const termMap = new Map(cleaned.map((t) => [t.term.toLowerCase(), t]));
  const pattern = cleaned.map((t) => escapeRegex(t.term)).join('|');
  const regex = pattern ? new RegExp(`\\b(${pattern})\\b`, 'gi') : null;

  return { regex, termMap };
}

function wrapTextNode(textNode, regex) {
  const text = textNode.nodeValue;
  if (!text || !regex) return;
  if (!regex.test(text)) return;
  regex.lastIndex = 0;

  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));

    const span = document.createElement('span');
    span.className = 'glossary-term';
    span.setAttribute('data-glossary-term', match[0]);
    span.textContent = match[0];
    span.style.textDecoration = 'underline';
    span.style.textDecorationThickness = '1px';
    span.style.textUnderlineOffset = '2px';
    span.style.color = 'var(--ca)';
    span.style.cursor = 'help';
    frag.appendChild(span);

    lastIndex = end;
  }
  if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  textNode.parentNode.replaceChild(frag, textNode);
}

function scanRoot(rootEl, regex) {
  if (!rootEl || !regex) return;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentNode;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.nodeType === 1 && parent.classList?.contains('glossary-term')) return NodeFilter.FILTER_REJECT;
      if (isInsideExcluded(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach((tn) => wrapTextNode(tn, regex));
}

const Tooltip = ({ anchorRect, term }) => {
  if (!anchorRect || !term) return null;
  const style = {
    position: 'fixed',
    top: Math.min(anchorRect.bottom + 8, window.innerHeight - 260),
    left: Math.min(anchorRect.left, window.innerWidth - 360),
    width: 340,
    background: 'white',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
    padding: '0.85rem 0.95rem',
    zIndex: 9999,
  };
  return createPortal(
    <div style={style} role="tooltip">
      <div style={{ fontWeight: 800, fontFamily: 'Syne', marginBottom: 6 }}>{term.term}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
        CA Definition
      </div>
      <div style={{ fontSize: '0.85rem', marginBottom: 10, whiteSpace: 'pre-wrap' }}>{term.ca_definition}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
        DS Definition
      </div>
      <div style={{ fontSize: '0.85rem', marginBottom: 10, whiteSpace: 'pre-wrap' }}>{term.ds_definition || '—'}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
        Plain English
      </div>
      <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{term.plain_english_description}</div>
    </div>,
    document.body
  );
};

const GlossaryTooltipScanner = ({ rootSelector = '.page-body' }) => {
  const { terms } = useGlossary();
  const { regex, termMap } = useMemo(() => buildMatcher(terms), [terms]);
  const observerRef = useRef(null);

  const [tooltip, setTooltip] = useState({ rect: null, term: null });

  useEffect(() => {
    const rootEl = document.querySelector(rootSelector);
    scanRoot(rootEl, regex);

    if (observerRef.current) observerRef.current.disconnect();
    if (!rootEl || !regex) return;

    const obs = new MutationObserver(() => {
      scanRoot(rootEl, regex);
    });
    obs.observe(rootEl, { childList: true, subtree: true, characterData: true });
    observerRef.current = obs;

    return () => obs.disconnect();
  }, [regex, rootSelector]);

  useEffect(() => {
    const onMove = (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.classList.contains('glossary-term')) return;
      const raw = el.getAttribute('data-glossary-term') || el.textContent || '';
      const t = termMap.get(String(raw).toLowerCase());
      if (!t) return;
      setTooltip({ rect: el.getBoundingClientRect(), term: t });
    };
    const onOut = (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (el.classList.contains('glossary-term')) {
        setTooltip({ rect: null, term: null });
      }
    };
    document.addEventListener('mouseover', onMove);
    document.addEventListener('mouseout', onOut);
    return () => {
      document.removeEventListener('mouseover', onMove);
      document.removeEventListener('mouseout', onOut);
    };
  }, [termMap]);

  return <Tooltip anchorRect={tooltip.rect} term={tooltip.term} />;
};

export default GlossaryTooltipScanner;

