import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectResearchReport, ResearchSourceLink, StoryBible } from '../types';
import { AddIcon, SearchIcon, TrashIcon, XIcon } from './icons';

/**
 * Knowledge graph over the project's research: every saved report, every
 * source link and every recurring topic becomes a node; edges connect reports
 * to the sources they cite and sources to the topics they share. Layout is a
 * small force simulation so clusters emerge from shared topics.
 */

type NodeKind = 'report' | 'source' | 'topic' | 'link';

type GraphNode = {
  id: string;
  kind: NodeKind;
  label: string;
  url?: string;
  host?: string;
  meta?: string;
  weight: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
};

type GraphEdge = { source: string; target: string; weight: number };

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'was', 'were', 'will', 'have', 'has', 'not', 'but', 'its', 'our', 'can', 'all', 'more', 'how', 'what', 'why', 'when', 'into', 'about', 'over', 'than', 'also', 'der', 'die', 'das', 'und', 'mit', 'für', 'von', 'ist', 'ein', 'eine', 'auf', 'den', 'dem', 'des', 'nicht', 'sich', 'auch', 'wie', 'wir', 'sie', 'als', 'aus', 'bei', 'zum', 'zur', 'im', 'in', 'an', 'of', 'to', 'a', 'is', 'on', 'by', 'or', 'as', 'at', 'it', 'be', 'new', 'best', 'top', 'guide', 'review', 'news', 'video', 'videos', 'film', 'films', 'movie', 'movies', 'com', 'www', 'http', 'https']);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t) && !/^\d+$/.test(t));

const NODE_COLORS: Record<NodeKind, string> = {
  report: 'var(--app-accent-strong)',
  source: 'var(--app-success)',
  link: 'var(--app-warm)',
  topic: 'var(--app-muted)',
};

const buildGraph = (reports: ProjectResearchReport[], links: ResearchSourceLink[], maxTopics: number) => {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const termDocs = new Map<string, Set<string>>();
  const docTerms = new Map<string, Set<string>>();

  const addNode = (node: Omit<GraphNode, 'x' | 'y' | 'vx' | 'vy'>) => {
    const existing = nodes.get(node.id);
    if (existing) {
      existing.weight += node.weight;
      return existing;
    }
    const angle = Math.random() * Math.PI * 2;
    const radius = 120 + Math.random() * 220;
    const created: GraphNode = { ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 };
    nodes.set(node.id, created);
    return created;
  };

  const registerTerms = (docId: string, text: string) => {
    const terms = new Set(tokenize(text));
    docTerms.set(docId, terms);
    terms.forEach((term) => {
      const set = termDocs.get(term) || new Set<string>();
      set.add(docId);
      termDocs.set(term, set);
    });
  };

  reports.forEach((report) => {
    const reportId = `report:${report.id}`;
    addNode({ id: reportId, kind: 'report', label: report.query, meta: `${report.mode.replace(/_/g, ' ')} · ${new Date(report.createdAt).toLocaleDateString()}`, weight: 3 });
    registerTerms(reportId, [report.query, ...report.overview, ...report.keyFindings].join(' '));
    [...report.webHits, ...report.newsHits].forEach((hit) => {
      const sourceId = `source:${hit.url}`;
      addNode({ id: sourceId, kind: 'source', label: hit.title || hostOf(hit.url), url: hit.url, host: hostOf(hit.url), meta: hit.snippet, weight: 1 });
      edges.push({ source: reportId, target: sourceId, weight: 1 });
      registerTerms(sourceId, `${hit.title || ''} ${hit.snippet || ''}`);
    });
  });

  links.forEach((link) => {
    const id = `link:${link.id}`;
    addNode({ id, kind: 'link', label: link.title || hostOf(link.url), url: link.url, host: hostOf(link.url), meta: link.notes, weight: 2 });
    registerTerms(id, `${link.title} ${link.notes || ''} ${(link.tags || []).join(' ')}`);
    (link.tags || []).forEach((tag) => {
      const topicId = `topic:${tag.toLowerCase()}`;
      addNode({ id: topicId, kind: 'topic', label: tag, weight: 1 });
      edges.push({ source: id, target: topicId, weight: 1.5 });
    });
  });

  // Topics: terms shared by at least two documents, ranked by spread.
  const candidates = Array.from(termDocs.entries())
    .filter(([, docs]) => docs.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, maxTopics);
  candidates.forEach(([term, docs]) => {
    const topicId = `topic:${term}`;
    addNode({ id: topicId, kind: 'topic', label: term, weight: docs.size });
    docs.forEach((docId) => edges.push({ source: docId, target: topicId, weight: 0.6 }));
  });

  // Same host → light edge so sources from one site cluster.
  const byHost = new Map<string, GraphNode[]>();
  nodes.forEach((node) => {
    if ((node.kind === 'source' || node.kind === 'link') && node.host) {
      const list = byHost.get(node.host) || [];
      list.push(node);
      byHost.set(node.host, list);
    }
  });
  byHost.forEach((list) => {
    for (let i = 1; i < list.length; i += 1) edges.push({ source: list[0].id, target: list[i].id, weight: 0.3 });
  });

  return { nodes: Array.from(nodes.values()), edges };
};

const KnowledgeGraphPanel: React.FC<{
  storyBible: StoryBible;
  setStoryBible: React.Dispatch<React.SetStateAction<StoryBible>>;
}> = ({ storyBible, setStoryBible }) => {
  const reports = storyBible.researchReports || [];
  const links = storyBible.researchSources || [];
  const [maxTopics, setMaxTopics] = useState(18);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newTags, setNewTags] = useState('');
  const [showKinds, setShowKinds] = useState<Record<NodeKind, boolean>>({ report: true, source: true, link: true, topic: true });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const dragRef = useRef<{ id: string | null; pan?: { startX: number; startY: number; origin: { x: number; y: number } } } | null>(null);
  const [, forceRender] = useState(0);

  const graph = useMemo(() => buildGraph(reports, links, maxTopics), [reports, links, maxTopics]);

  useEffect(() => {
    // Keep positions for nodes that survive a rebuild.
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    nodesRef.current = graph.nodes.map((node) => {
      const old = previous.get(node.id);
      return old ? { ...node, x: old.x, y: old.y, vx: old.vx, vy: old.vy, pinned: old.pinned } : node;
    });
    edgesRef.current = graph.edges;
  }, [graph]);

  // Force simulation.
  useEffect(() => {
    let frame = 0;
    let iterations = 0;
    const tick = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const index = new Map(nodes.map((node) => [node.id, node]));
      const alpha = Math.max(0.02, 0.35 * Math.exp(-iterations / 160));
      // Repulsion.
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy) || 0.01;
          if (dist > 600) continue;
          const force = (1400 / (dist * dist)) * alpha;
          dx /= dist;
          dy /= dist;
          if (!a.pinned) { a.vx -= dx * force; a.vy -= dy * force; }
          if (!b.pinned) { b.vx += dx * force; b.vy += dy * force; }
          dist = 0;
        }
      }
      // Springs.
      edges.forEach((edge) => {
        const a = index.get(edge.source);
        const b = index.get(edge.target);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const desired = 90 + (a.kind === 'topic' || b.kind === 'topic' ? 30 : 60);
        const force = ((dist - desired) / dist) * 0.04 * edge.weight * alpha * 4;
        if (!a.pinned) { a.vx += dx * force; a.vy += dy * force; }
        if (!b.pinned) { b.vx -= dx * force; b.vy -= dy * force; }
      });
      // Gravity to centre + integrate.
      nodes.forEach((node) => {
        if (node.pinned) return;
        node.vx -= node.x * 0.0025 * alpha * 4;
        node.vy -= node.y * 0.0025 * alpha * 4;
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x += node.vx;
        node.y += node.vy;
      });
      iterations += 1;
      forceRender((v) => v + 1);
      if (iterations < 420 || dragRef.current?.id) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [graph]);

  const svgPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left || 0) - (rect?.width || 0) / 2 - viewport.x) / viewport.zoom,
      y: (clientY - (rect?.top || 0) - (rect?.height || 0) / 2 - viewport.y) / viewport.zoom,
    };
  }, [viewport]);

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const target = event.target as SVGElement;
    const nodeId = target.closest('[data-node]')?.getAttribute('data-node') || null;
    try {
      (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    } catch {
      // synthetic or already-released pointers have no capture target
    }
    if (nodeId) {
      dragRef.current = { id: nodeId };
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (node) node.pinned = true;
      setSelectedId(nodeId);
    } else {
      dragRef.current = { id: null, pan: { startX: event.clientX, startY: event.clientY, origin: { x: viewport.x, y: viewport.y } } };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.id) {
      const node = nodesRef.current.find((n) => n.id === drag.id);
      if (node) {
        const point = svgPoint(event.clientX, event.clientY);
        node.x = point.x;
        node.y = point.y;
        node.vx = 0;
        node.vy = 0;
        forceRender((v) => v + 1);
      }
    } else if (drag.pan) {
      setViewport((prev) => ({ ...prev, x: drag.pan!.origin.x + (event.clientX - drag.pan!.startX), y: drag.pan!.origin.y + (event.clientY - drag.pan!.startY) }));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.id) {
      const node = nodesRef.current.find((n) => n.id === drag.id);
      if (node && !event.shiftKey) node.pinned = false;
    }
    dragRef.current = null;
    try {
      (event.currentTarget as SVGSVGElement).releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setViewport((prev) => ({ ...prev, zoom: Math.min(3, Math.max(0.25, prev.zoom * factor)) }));
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, []);

  const addLink = () => {
    const url = newUrl.trim();
    if (!/^https?:\/\//i.test(url)) return;
    const link: ResearchSourceLink = {
      id: `src-${Date.now()}`,
      url,
      title: newTitle.trim() || hostOf(url),
      tags: newTags.split(',').map((t) => t.trim()).filter(Boolean),
      addedAt: new Date().toISOString(),
    };
    setStoryBible((prev) => ({ ...prev, researchSources: [...(prev.researchSources || []), link] }));
    setNewUrl('');
    setNewTitle('');
    setNewTags('');
  };

  const removeLink = (id: string) => {
    setStoryBible((prev) => ({ ...prev, researchSources: (prev.researchSources || []).filter((link) => link.id !== id) }));
    if (selectedId === `link:${id}`) setSelectedId(null);
  };

  const nodes = nodesRef.current;
  const edges = edgesRef.current;
  const nodeIndex = new Map(nodes.map((node) => [node.id, node]));
  const term = filter.trim().toLowerCase();
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!selectedId) return set;
    edges.forEach((edge) => {
      if (edge.source === selectedId) set.add(edge.target);
      if (edge.target === selectedId) set.add(edge.source);
    });
    return set;
  }, [edges, selectedId]);
  const visibleNodes = nodes.filter((node) => showKinds[node.kind] && (!term || node.label.toLowerCase().includes(term) || (node.host || '').includes(term)));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const selected = selectedId ? nodeIndex.get(selectedId) : null;
  const counts = { report: reports.length, source: nodes.filter((n) => n.kind === 'source').length, link: links.length, topic: nodes.filter((n) => n.kind === 'topic').length };

  return (
    <div className="kgraph">
      <aside className="kgraph__side">
        <div className="kgraph__section">
          <div className="kgraph__title">Add a source</div>
          <input className="app-input app-input--compact" placeholder="https://…" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addLink(); }} />
          <input className="app-input app-input--compact" placeholder="Title (optional)" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <input className="app-input app-input--compact" placeholder="Tags, comma separated" value={newTags} onChange={(e) => setNewTags(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addLink(); }} />
          <button type="button" className="app-button app-primary text-xs w-full justify-center" onClick={addLink} disabled={!/^https?:\/\//i.test(newUrl.trim())}>
            <AddIcon className="w-4 h-4" /> Add to graph
          </button>
        </div>
        <div className="kgraph__section">
          <div className="kgraph__title">Show</div>
          {(['report', 'source', 'link', 'topic'] as NodeKind[]).map((kind) => (
            <label key={kind} className="kgraph__toggle">
              <input type="checkbox" checked={showKinds[kind]} onChange={(e) => setShowKinds((prev) => ({ ...prev, [kind]: e.target.checked }))} />
              <span className="kgraph__swatch" style={{ background: NODE_COLORS[kind] }} />
              <span className="capitalize">{kind === 'link' ? 'Your sources' : kind === 'source' ? 'Found sources' : `${kind}s`}</span>
              <span className="ml-auto app-muted">{counts[kind]}</span>
            </label>
          ))}
          <label className="kgraph__toggle">
            <span>Topics</span>
            <input type="range" min={4} max={40} value={maxTopics} onChange={(e) => setMaxTopics(Number(e.target.value))} className="ml-auto w-24" />
          </label>
        </div>
        <div className="kgraph__section kgraph__section--grow">
          <div className="kgraph__title">Your sources</div>
          {links.length === 0 && <p className="app-muted text-xs">Add links above. Research reports from the Internal tab appear automatically.</p>}
          <ul className="kgraph__list" role="list">
            {links.map((link) => (
              <li key={link.id} className={`kgraph__list-item ${selectedId === `link:${link.id}` ? 'kgraph__list-item--active' : ''}`}>
                <button type="button" onClick={() => setSelectedId(`link:${link.id}`)}>
                  <span className="kgraph__list-title">{link.title}</span>
                  <span className="kgraph__list-meta">{hostOf(link.url)}{link.tags?.length ? ` · ${link.tags.join(', ')}` : ''}</span>
                </button>
                <button type="button" className="toolbar-button toolbar-button--icon" onClick={() => removeLink(link.id)} aria-label="Remove"><TrashIcon className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="kgraph__main">
        <div className="kgraph__toolbar">
          <div className="kgraph__search">
            <SearchIcon className="w-4 h-4 app-muted" />
            <input className="app-input app-input--compact" placeholder="Filter nodes" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <span className="app-muted text-xs">{visibleNodes.length} nodes · {edges.length} links · drag to move, ⇧-drop to pin</span>
          <div className="mood-zoom">
            <button type="button" className="toolbar-button toolbar-button--icon" onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(0.25, v.zoom / 1.2) }))}>−</button>
            <button type="button" className="toolbar-button mood-zoom__value" onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })}>{Math.round(viewport.zoom * 100)}%</button>
            <button type="button" className="toolbar-button toolbar-button--icon" onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(3, v.zoom * 1.2) }))}>+</button>
          </div>
        </div>
        <svg
          ref={svgRef}
          className="kgraph__svg"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <g transform={`translate(${(svgRef.current?.clientWidth || 0) / 2 + viewport.x}, ${(svgRef.current?.clientHeight || 0) / 2 + viewport.y}) scale(${viewport.zoom})`}>
            {edges.map((edge, index) => {
              const a = nodeIndex.get(edge.source);
              const b = nodeIndex.get(edge.target);
              if (!a || !b || !visibleIds.has(a.id) || !visibleIds.has(b.id)) return null;
              const highlighted = selectedId && (edge.source === selectedId || edge.target === selectedId);
              return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`kgraph__edge ${highlighted ? 'kgraph__edge--active' : ''} ${selectedId && !highlighted ? 'kgraph__edge--dim' : ''}`} strokeWidth={0.6 + edge.weight} />;
            })}
            {visibleNodes.map((node) => {
              const radius = node.kind === 'topic' ? 6 + Math.min(10, node.weight * 1.5) : node.kind === 'report' ? 14 : 9;
              const dim = selectedId && selectedId !== node.id && !neighbours.has(node.id);
              return (
                <g key={node.id} data-node={node.id} transform={`translate(${node.x}, ${node.y})`} className={`kgraph__node ${selectedId === node.id ? 'kgraph__node--active' : ''} ${dim ? 'kgraph__node--dim' : ''}`}>
                  <circle r={radius} fill={NODE_COLORS[node.kind]} />
                  <text y={radius + 12} textAnchor="middle" className="kgraph__label">{node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label}</text>
                </g>
              );
            })}
          </g>
        </svg>
        {nodes.length === 0 && (
          <div className="kgraph__empty">
            <p className="font-semibold">No research yet</p>
            <p className="app-muted text-sm">Run a search in the Internal tab or add links on the left; the graph builds itself from the sources and the topics they share.</p>
          </div>
        )}
        {selected && (
          <div className="kgraph__detail">
            <div className="kgraph__detail-head">
              <span className="kgraph__swatch" style={{ background: NODE_COLORS[selected.kind] }} />
              <span className="kgraph__detail-kind">{selected.kind}</span>
              <button type="button" className="toolbar-button toolbar-button--icon ml-auto" onClick={() => setSelectedId(null)} aria-label="Close"><XIcon className="w-4 h-4" /></button>
            </div>
            <div className="kgraph__detail-title">{selected.label}</div>
            {selected.meta && <p className="kgraph__detail-meta">{selected.meta}</p>}
            {selected.url && <a className="kgraph__detail-link" href={selected.url} target="_blank" rel="noreferrer">{selected.host || selected.url}</a>}
            {neighbours.size > 0 && (
              <div className="kgraph__detail-links">
                <div className="kgraph__title">Connected</div>
                {Array.from(neighbours).slice(0, 12).map((id) => {
                  const node = nodeIndex.get(id);
                  if (!node) return null;
                  return <button key={id} type="button" className="kgraph__chip" onClick={() => setSelectedId(id)}><span className="kgraph__swatch" style={{ background: NODE_COLORS[node.kind] }} />{node.label}</button>;
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgeGraphPanel;
