import type {
  MusicBrainzExplorationEdge,
  MusicBrainzExplorationGraph,
  MusicBrainzExplorationNode,
} from '../../types/app-types';
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime';

type ExplorationGraphHandle = {
  destroy: () => void;
};

type ExplorationGraphOptions = {
  onNodeActivated?: (node: MusicBrainzExplorationNode) => void;
};

type RenderNode = MusicBrainzExplorationNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  anchorX: number;
  anchorY: number;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const WORLD_WIDTH = 1360;
const WORLD_HEIGHT = 860;
const CENTER_PADDING_X = 88;
const CENTER_PADDING_Y = 82;
const ZOOM_EASING_DURATION_MS = 180;

const createSvgElement = <K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG_NS, tagName);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, progress: number): number => from + (to - from) * progress;
const easeOutCubic = (progress: number): number => 1 - ((1 - progress) ** 3);

const compactText = (value: string, maxLength: number): string => {
  const cleanValue = value.trim();
  if (cleanValue.length <= maxLength) {
    return cleanValue;
  }

  return `${cleanValue.slice(0, maxLength - 3)}...`;
};

const nodeRadius = (node: MusicBrainzExplorationNode): number => {
  const baseByKind: Record<string, number> = {
    recording: 62,
    release: 50,
    compilation: 46,
    label: 44,
    group: 42,
    artist: 38,
  };

  return (baseByKind[node.kind] || 36) + Math.max(0, node.emphasis - 1) * 4;
};

const chooseRootNodeId = (nodes: MusicBrainzExplorationNode[]): string => {
  const preferredKinds = ['recording', 'release', 'label', 'artist'];
  for (const kind of preferredKinds) {
    const preferredNode = nodes.find((node) => node.kind === kind || node.entityType === kind);
    if (preferredNode) {
      return preferredNode.id;
    }
  }

  return nodes[0]?.id || '';
};

const assignAnchors = (nodes: RenderNode[], rootNodeId: string): void => {
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2 + 10;
  const rootNode = nodes.find((node) => node.id === rootNodeId);
  if (rootNode) {
    rootNode.anchorX = centerX;
    rootNode.anchorY = centerY;
    rootNode.x = centerX;
    rootNode.y = centerY;
  }

  const buckets: Record<string, RenderNode[]> = {
    label: [],
    release: [],
    compilation: [],
    artist: [],
    group: [],
    other: [],
  };

  for (const node of nodes) {
    if (node.id === rootNodeId) {
      continue;
    }

    if (node.kind === 'label') {
      buckets.label.push(node);
    } else if (node.kind === 'release') {
      buckets.release.push(node);
    } else if (node.kind === 'compilation') {
      buckets.compilation.push(node);
    } else if (node.kind === 'artist') {
      buckets.artist.push(node);
    } else if (node.kind === 'group') {
      buckets.group.push(node);
    } else {
      buckets.other.push(node);
    }
  }

  const placeColumn = (bucket: RenderNode[], x: number, yCenter: number, gap: number): void => {
    const startY = yCenter - ((bucket.length - 1) * gap) / 2;
    bucket.forEach((node, index) => {
      node.anchorX = x;
      node.anchorY = startY + index * gap;
      node.x = node.anchorX;
      node.y = node.anchorY;
    });
  };

  const placeArc = (bucket: RenderNode[], centerAngle: number, spread: number, radius: number): void => {
    if (bucket.length === 0) {
      return;
    }

    bucket.forEach((node, index) => {
      const progress = bucket.length === 1 ? 0.5 : index / (bucket.length - 1);
      const angle = centerAngle - spread / 2 + progress * spread;
      node.anchorX = centerX + Math.cos(angle) * radius;
      node.anchorY = centerY + Math.sin(angle) * radius;
      node.x = node.anchorX;
      node.y = node.anchorY;
    });
  };

  placeColumn(buckets.label, centerX - 110, 126, 136);
  placeColumn(buckets.release, centerX + 360, centerY - 8, 148);
  placeColumn(buckets.compilation, centerX + 610, centerY - 18, 144);
  placeArc(buckets.artist, Math.PI, 1.95, 390);
  placeArc(buckets.group, Math.PI * 1.18, 1.45, 555);
  placeColumn(buckets.other, centerX - 24, centerY + 320, 136);
};

const relaxLayout = (nodes: RenderNode[], edges: MusicBrainzExplorationEdge[]): void => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (let iteration = 0; iteration < 240; iteration += 1) {
    const forces = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));

    for (let index = 0; index < nodes.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
        const node = nodes[index];
        const otherNode = nodes[otherIndex];
        const deltaX = otherNode.x - node.x;
        const deltaY = otherNode.y - node.y;
        const distance = Math.max(8, Math.hypot(deltaX, deltaY));
        const repulsion = 38000 / (distance * distance);
        const forceX = (deltaX / distance) * repulsion;
        const forceY = (deltaY / distance) * repulsion;

        const nodeForce = forces.get(node.id)!;
        const otherForce = forces.get(otherNode.id)!;
        nodeForce.x -= forceX;
        nodeForce.y -= forceY;
        otherForce.x += forceX;
        otherForce.y += forceY;
      }
    }

    for (const edge of edges) {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (!source || !target) {
        continue;
      }

      const deltaX = target.x - source.x;
      const deltaY = target.y - source.y;
      const distance = Math.max(1, Math.hypot(deltaX, deltaY));
      const desiredDistance = edge.kind === 'artist-relation'
        ? 255
        : edge.kind === 'recording-appearance'
          ? 430
          : edge.kind === 'artist-label'
            ? 330
            : edge.kind === 'artist-release'
              ? 300
              : edge.kind === 'recording-release'
                ? 290
                : 280;
      const spring = (distance - desiredDistance) * 0.02;
      const forceX = (deltaX / distance) * spring;
      const forceY = (deltaY / distance) * spring;

      const sourceForce = forces.get(source.id)!;
      const targetForce = forces.get(target.id)!;
      sourceForce.x += forceX;
      sourceForce.y += forceY;
      targetForce.x -= forceX;
      targetForce.y -= forceY;
    }

    for (const node of nodes) {
      const force = forces.get(node.id)!;
      force.x += (node.anchorX - node.x) * 0.013;
      force.y += (node.anchorY - node.y) * 0.013;

      node.vx = (node.vx + force.x) * 0.8;
      node.vy = (node.vy + force.y) * 0.8;
      node.x = clamp(node.x + clamp(node.vx, -26, 26), node.radius + 24, WORLD_WIDTH - node.radius - 24);
      node.y = clamp(node.y + clamp(node.vy, -26, 26), node.radius + 24, WORLD_HEIGHT - node.radius - 24);
    }
  }
}

export function renderExplorationGraph(
  container: HTMLElement,
  graph: MusicBrainzExplorationGraph,
  options: ExplorationGraphOptions = {},
): ExplorationGraphHandle {
  const renderNodes: RenderNode[] = graph.nodes.map((node) => ({
    ...node,
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    vx: 0,
    vy: 0,
    radius: nodeRadius(node),
    anchorX: WORLD_WIDTH / 2,
    anchorY: WORLD_HEIGHT / 2,
  }));

  const nodeById = new Map(renderNodes.map((node) => [node.id, node]));
  const rootNodeId = chooseRootNodeId(graph.nodes);
  assignAnchors(renderNodes, rootNodeId);
  relaxLayout(renderNodes, graph.edges);

  const svg = createSvgElement('svg');
  svg.setAttribute('viewBox', `0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-label', 'MusicBrainz exploration graph');
  svg.style.display = 'block';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.cursor = 'grab';
  svg.style.touchAction = 'none';

  const markerId = `exploration-graph-arrow-${Math.random().toString(36).slice(2, 10)}`;
  const defs = createSvgElement('defs');
  const arrowMarker = createSvgElement('marker');
  arrowMarker.setAttribute('id', markerId);
  arrowMarker.setAttribute('markerWidth', '3.5');
  arrowMarker.setAttribute('markerHeight', '3.5');
  arrowMarker.setAttribute('refX', '3');
  arrowMarker.setAttribute('refY', '1.2');
  arrowMarker.setAttribute('orient', 'auto');
  arrowMarker.setAttribute('markerUnits', 'strokeWidth');
  const arrowPath = createSvgElement('path');
  arrowPath.setAttribute('d', 'M 0 0 L 3 1.2 L 0 2.4 z');
  arrowPath.setAttribute('fill', '#d7d7d7');
  arrowMarker.appendChild(arrowPath);
  defs.appendChild(arrowMarker);
  svg.appendChild(defs);

  const viewport = createSvgElement('g');
  const background = createSvgElement('rect');
  background.setAttribute('x', '0');
  background.setAttribute('y', '0');
  background.setAttribute('width', String(WORLD_WIDTH));
  background.setAttribute('height', String(WORLD_HEIGHT));
  background.setAttribute('fill', 'transparent');
  viewport.appendChild(background);

  const edgeLayer = createSvgElement('g');
  const edgeLabelLayer = createSvgElement('g');
  const nodeLayer = createSvgElement('g');
  viewport.appendChild(edgeLayer);
  viewport.appendChild(edgeLabelLayer);
  viewport.appendChild(nodeLayer);
  svg.appendChild(viewport);

  const edgeElements = new Map<string, SVGLineElement>();
  const edgeLabelElements = new Map<string, SVGTextElement>();
  const nodeElements = new Map<string, SVGGElement>();

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let panPointerId: number | null = null;
  let dragPointerId: number | null = null;
  let panStartX = 0;
  let panStartY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let activeNode: RenderNode | null = null;
  let dragMoved = false;
  let suppressClickNodeID: string | null = null;
  let zoomAnimationFrameId: number | null = null;
  let zoomAnimationStartTime: number | null = null;
  let zoomAnimationFromScale = scale;
  let zoomAnimationFromTranslateX = translateX;
  let zoomAnimationFromTranslateY = translateY;
  let zoomAnimationTargetScale = scale;
  let zoomAnimationTargetTranslateX = translateX;
  let zoomAnimationTargetTranslateY = translateY;

  const updateViewport = () => {
    viewport.setAttribute('transform', `translate(${translateX} ${translateY}) scale(${scale})`);
  };

  const activeZoomTransform = () => {
    if (zoomAnimationFrameId !== null) {
      return {
        scale: zoomAnimationTargetScale,
        translateX: zoomAnimationTargetTranslateX,
        translateY: zoomAnimationTargetTranslateY,
      };
    }

    return {
      scale,
      translateX,
      translateY,
    };
  };

  const cancelZoomAnimation = () => {
    if (zoomAnimationFrameId !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(zoomAnimationFrameId);
    }

    zoomAnimationFrameId = null;
  zoomAnimationStartTime = null;
    zoomAnimationFromScale = scale;
    zoomAnimationFromTranslateX = translateX;
    zoomAnimationFromTranslateY = translateY;
    zoomAnimationTargetScale = scale;
    zoomAnimationTargetTranslateX = translateX;
    zoomAnimationTargetTranslateY = translateY;
  };

  const animateZoomTo = (nextScale: number, nextTranslateX: number, nextTranslateY: number) => {
    cancelZoomAnimation();

    if (nextScale === scale && nextTranslateX === translateX && nextTranslateY === translateY) {
      return;
    }

    zoomAnimationFromScale = scale;
    zoomAnimationFromTranslateX = translateX;
    zoomAnimationFromTranslateY = translateY;
    zoomAnimationTargetScale = nextScale;
    zoomAnimationTargetTranslateX = nextTranslateX;
    zoomAnimationTargetTranslateY = nextTranslateY;

    const step = (timestamp: number) => {
      if (zoomAnimationStartTime === null) {
        zoomAnimationStartTime = timestamp;
      }

      const progress = clamp((timestamp - zoomAnimationStartTime) / ZOOM_EASING_DURATION_MS, 0, 1);
      const easedProgress = easeOutCubic(progress);
      scale = lerp(zoomAnimationFromScale, zoomAnimationTargetScale, easedProgress);
      translateX = lerp(zoomAnimationFromTranslateX, zoomAnimationTargetTranslateX, easedProgress);
      translateY = lerp(zoomAnimationFromTranslateY, zoomAnimationTargetTranslateY, easedProgress);
      updateViewport();

      if (progress < 1) {
        zoomAnimationFrameId = window.requestAnimationFrame(step);
        return;
      }

      zoomAnimationFrameId = null;
      zoomAnimationStartTime = null;
    };

    zoomAnimationFrameId = window.requestAnimationFrame(step);
  };

  const toWorldPoint = (
    clientX: number,
    clientY: number,
    transform: { scale: number; translateX: number; translateY: number } = { scale, translateX, translateY },
  ) => {
    const rect = svg.getBoundingClientRect();
    const localX = ((clientX - rect.left) / rect.width) * WORLD_WIDTH;
    const localY = ((clientY - rect.top) / rect.height) * WORLD_HEIGHT;

    return {
      x: (localX - transform.translateX) / transform.scale,
      y: (localY - transform.translateY) / transform.scale,
    };
  };

  const clampScale = (value: number): number => Math.min(2.6, Math.max(0.65, value));

  const centerGraph = () => {
    const bounds = renderNodes.reduce(
      (accumulator, node) => ({
        minX: Math.min(accumulator.minX, node.x - node.radius),
        minY: Math.min(accumulator.minY, node.y - node.radius),
        maxX: Math.max(accumulator.maxX, node.x + node.radius),
        maxY: Math.max(accumulator.maxY, node.y + node.radius),
      }),
      { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
    );

    const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
    const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
    cancelZoomAnimation();
    scale = clampScale(Math.min(WORLD_WIDTH / (graphWidth + CENTER_PADDING_X), WORLD_HEIGHT / (graphHeight + CENTER_PADDING_Y), 1));
    translateX = (WORLD_WIDTH - graphWidth * scale) / 2 - bounds.minX * scale;
    translateY = (WORLD_HEIGHT - graphHeight * scale) / 2 - bounds.minY * scale;
    updateViewport();
  };

  const updateEdges = () => {
    for (const edge of graph.edges) {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      const line = edgeElements.get(edge.id);
      if (!source || !target || !line) {
        continue;
      }

      const deltaX = target.x - source.x;
      const deltaY = target.y - source.y;
      const distance = Math.max(1, Math.hypot(deltaX, deltaY));
      const startOffset = source.radius - 5;
      const endOffset = target.radius + 7;
      const x1 = source.x + (deltaX / distance) * startOffset;
      const y1 = source.y + (deltaY / distance) * startOffset;
      const x2 = target.x - (deltaX / distance) * endOffset;
      const y2 = target.y - (deltaY / distance) * endOffset;

      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));

      const labelElement = edgeLabelElements.get(edge.id);
      if (labelElement) {
        const midpointX = (x1 + x2) / 2;
        const midpointY = (y1 + y2) / 2;
        const offsetX = (-deltaY / distance) * 14;
        const offsetY = (deltaX / distance) * 14;
        labelElement.setAttribute('x', String(midpointX + offsetX));
        labelElement.setAttribute('y', String(midpointY + offsetY));
      }
    }
  };

  const updateNodes = () => {
    for (const node of renderNodes) {
      const nodeGroup = nodeElements.get(node.id);
      if (!nodeGroup) {
        continue;
      }

      nodeGroup.setAttribute('transform', `translate(${node.x} ${node.y})`);
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (dragPointerId === event.pointerId && activeNode) {
      const point = toWorldPoint(event.clientX, event.clientY);
      if (!dragMoved && (Math.abs(point.x - panStartX) > 1 || Math.abs(point.y - panStartY) > 1)) {
        dragMoved = true;
      }
      activeNode.x = clamp(dragStartX + (point.x - panStartX), activeNode.radius + 24, WORLD_WIDTH - activeNode.radius - 24);
      activeNode.y = clamp(dragStartY + (point.y - panStartY), activeNode.radius + 24, WORLD_HEIGHT - activeNode.radius - 24);
      activeNode.anchorX = activeNode.x;
      activeNode.anchorY = activeNode.y;
      updateNodes();
      updateEdges();
      return;
    }

    if (panPointerId === event.pointerId) {
      const rect = svg.getBoundingClientRect();
      const localX = ((event.clientX - rect.left) / rect.width) * WORLD_WIDTH;
      const localY = ((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT;
      translateX = panOriginX + (localX - panStartX);
      translateY = panOriginY + (localY - panStartY);
      updateViewport();
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (dragPointerId === event.pointerId) {
      const completedNodeID = activeNode?.id || null;
      const movedDuringDrag = dragMoved;
      dragPointerId = null;
      activeNode = null;
      dragMoved = false;
      if (movedDuringDrag && completedNodeID) {
        suppressClickNodeID = completedNodeID;
        window.setTimeout(() => {
          if (suppressClickNodeID === completedNodeID) {
            suppressClickNodeID = null;
          }
        }, 0);
      }
    }

    if (panPointerId === event.pointerId) {
      panPointerId = null;
      svg.style.cursor = 'grab';
    }
  };

  background.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    cancelZoomAnimation();
    panPointerId = event.pointerId;
    const rect = svg.getBoundingClientRect();
    panStartX = ((event.clientX - rect.left) / rect.width) * WORLD_WIDTH;
    panStartY = ((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT;
    panOriginX = translateX;
    panOriginY = translateY;
    svg.style.cursor = 'grabbing';
    background.setPointerCapture(event.pointerId);
  });

  const showEdgeLabels = graph.edges.length <= 18;
  for (const edge of graph.edges) {
    const line = createSvgElement('line');
    line.setAttribute('stroke', 'rgba(228, 228, 228, 0.88)');
    line.setAttribute('stroke-width', edge.kind === 'artist-relation' ? '4' : '5');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', `url(#${markerId})`);
    edgeLayer.appendChild(line);
    edgeElements.set(edge.id, line);

    if (showEdgeLabels && edge.label.trim()) {
      const label = createSvgElement('text');
      label.textContent = compactText(edge.label, 24);
      label.setAttribute('fill', 'rgba(245, 245, 245, 0.92)');
      label.setAttribute('font-size', '14');
      label.setAttribute('font-weight', '600');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('paint-order', 'stroke');
      label.setAttribute('stroke', '#23242a');
      label.setAttribute('stroke-width', '5');
      label.setAttribute('stroke-linejoin', 'round');
      edgeLabelLayer.appendChild(label);
      edgeLabelElements.set(edge.id, label);
    }
  }

  for (const node of renderNodes) {
    const nodeGroup = createSvgElement('g');
    nodeGroup.dataset.nodeId = node.id;
    nodeGroup.style.cursor = 'pointer';

    const tooltip = createSvgElement('title');
    const tooltipBase = node.subtitle ? `${node.label} - ${node.subtitle}` : node.label;
    tooltip.textContent = node.url
      ? `${tooltipBase}\nCtrl+click to open in MusicBrainz`
      : tooltipBase;
    nodeGroup.appendChild(tooltip);

    const circle = createSvgElement('circle');
    circle.setAttribute('r', String(node.radius));
    circle.setAttribute('fill', node.accent || '#6f6f77');
    circle.setAttribute('stroke', 'rgba(255, 255, 255, 0.12)');
    circle.setAttribute('stroke-width', '2');

    const subtitleRing = createSvgElement('circle');
    subtitleRing.setAttribute('r', String(Math.max(14, node.radius - 8)));
    subtitleRing.setAttribute('fill', 'rgba(12, 14, 18, 0.10)');

    const label = createSvgElement('text');
    label.textContent = compactText(node.label, node.radius > 52 ? 26 : 20);
    label.setAttribute('fill', '#f5f5f5');
    label.setAttribute('font-size', String(Math.max(12, Math.min(21, node.radius * 0.34))));
    label.setAttribute('font-weight', '700');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('paint-order', 'stroke');
    label.setAttribute('stroke', '#23242a');
    label.setAttribute('stroke-width', '6');
    label.setAttribute('stroke-linejoin', 'round');

    const subtitle = createSvgElement('text');
    subtitle.textContent = compactText(node.subtitle || node.kind, 22);
    subtitle.setAttribute('fill', 'rgba(255, 255, 255, 0.78)');
    subtitle.setAttribute('font-size', '11');
    subtitle.setAttribute('font-weight', '600');
    subtitle.setAttribute('text-anchor', 'middle');
    subtitle.setAttribute('dominant-baseline', 'middle');
    subtitle.setAttribute('y', String(node.radius - 16));

    nodeGroup.append(circle, subtitleRing, label, subtitle);
    nodeLayer.appendChild(nodeGroup);
    nodeElements.set(node.id, nodeGroup);

    nodeGroup.addEventListener('click', (event) => {
      if (suppressClickNodeID === node.id) {
        suppressClickNodeID = null;
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) {
        if (options.onNodeActivated) {
          event.preventDefault();
          event.stopPropagation();
          options.onNodeActivated(node);
        }
        return;
      }

      if (!node.url) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      BrowserOpenURL(node.url);
    });

    nodeGroup.addEventListener('pointerdown', (event) => {
      if (event.ctrlKey || event.metaKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      cancelZoomAnimation();
      activeNode = node;
      dragPointerId = event.pointerId;
      dragMoved = false;
      dragStartX = node.x;
      dragStartY = node.y;
      const point = toWorldPoint(event.clientX, event.clientY);
      panStartX = point.x;
      panStartY = point.y;
      nodeGroup.setPointerCapture(event.pointerId);
    });
  }

  svg.addEventListener('pointermove', handlePointerMove);
  svg.addEventListener('pointerup', handlePointerUp);
  svg.addEventListener('pointercancel', handlePointerUp);
  const wheelHandler = (event: WheelEvent) => {
    event.preventDefault();

    const zoomBase = activeZoomTransform();
    const beforeZoom = toWorldPoint(event.clientX, event.clientY, zoomBase);
    const nextScale = clampScale(zoomBase.scale * (event.deltaY < 0 ? 1.08 : 0.92));
    if (nextScale === zoomBase.scale) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * WORLD_WIDTH;
    const localY = ((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT;
    animateZoomTo(
      nextScale,
      localX - beforeZoom.x * nextScale,
      localY - beforeZoom.y * nextScale,
    );
  };
  svg.addEventListener('wheel', wheelHandler, { passive: false });

  updateEdges();
  updateNodes();
  centerGraph();
  container.replaceChildren(svg);

  return {
    destroy: () => {
      cancelZoomAnimation();
      svg.removeEventListener('pointermove', handlePointerMove);
      svg.removeEventListener('pointerup', handlePointerUp);
      svg.removeEventListener('pointercancel', handlePointerUp);
      svg.removeEventListener('wheel', wheelHandler);
      svg.replaceChildren();
      container.replaceChildren();
    },
  };
}

