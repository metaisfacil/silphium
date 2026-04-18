import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../wailsjs/runtime/runtime', () => ({
    BrowserOpenURL: vi.fn(),
}));

import { renderExplorationGraph } from './exploration-graph';

type AnimationFrameQueue = Map<number, FrameRequestCallback>;

const createGraph = () => ({
    found: true,
    title: 'Connection Explorer',
    summary: 'Connections',
    warnings: [],
    nodes: [
        {
            id: 'artist:1',
            entityType: 'artist',
            kind: 'artist',
            mbid: '5e9450ca-77d5-4f64-a385-f453cfe98b24',
            label: 'Artist',
            subtitle: 'Artist',
            accent: '#ffffff',
            emphasis: 2,
            url: 'https://musicbrainz.org/artist/5e9450ca-77d5-4f64-a385-f453cfe98b24',
        },
        {
            id: 'release:1',
            entityType: 'release',
            kind: 'release',
            mbid: '11111111-1111-4111-8111-111111111111',
            label: 'Release',
            subtitle: 'Release',
            accent: '#ffffff',
            emphasis: 2,
            url: 'https://musicbrainz.org/release/11111111-1111-4111-8111-111111111111',
        },
    ],
    edges: [
        {
            id: 'edge:1',
            sourceId: 'artist:1',
            targetId: 'release:1',
            kind: 'artist-release',
            label: 'released',
        },
    ],
});

describe('exploration graph', () => {
    let rafQueue: AnimationFrameQueue;
    let nextAnimationFrameId: number;

    const extractScale = (transform: string | null): number => {
        const match = transform?.match(/scale\(([^)]+)\)/);
        return match ? Number(match[1]) : Number.NaN;
    };

    const flushAnimationFrame = (timestamp: number): void => {
        const queuedFrames = Array.from(rafQueue.values());
        rafQueue.clear();
        for (const callback of queuedFrames) {
            callback(timestamp);
        }
    };

    beforeEach(() => {
        rafQueue = new Map();
        nextAnimationFrameId = 0;
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="graph-host"></div>';
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback): number => {
            nextAnimationFrameId += 1;
            rafQueue.set(nextAnimationFrameId, callback);
            return nextAnimationFrameId;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
            rafQueue.delete(id);
        }) as typeof cancelAnimationFrame);
    });

    it('eases wheel zoom over multiple animation frames', () => {
        const graphHost = document.getElementById('graph-host') as HTMLDivElement;
        const graphHandle = renderExplorationGraph(graphHost, createGraph());
        const svg = graphHost.querySelector('svg') as SVGSVGElement;
        const viewport = svg.querySelector('g') as SVGGElement;

        Object.defineProperty(svg, 'getBoundingClientRect', {
            value: () => ({
                left: 0,
                top: 0,
                width: 100,
                height: 100,
                right: 100,
                bottom: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }),
            configurable: true,
        });

        const initialTransform = viewport.getAttribute('transform');
        svg.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -120,
            clientX: 50,
            clientY: 50,
            bubbles: true,
            cancelable: true,
        }));

        expect(viewport.getAttribute('transform')).toBe(initialTransform);

        flushAnimationFrame(0);
        const firstFrameTransform = viewport.getAttribute('transform');
        expect(firstFrameTransform).toBe(initialTransform);

        flushAnimationFrame(90);
        const midAnimationTransform = viewport.getAttribute('transform');
        expect(midAnimationTransform).not.toBe(initialTransform);

        flushAnimationFrame(220);
        const finalTransform = viewport.getAttribute('transform');
        expect(finalTransform).not.toBe(initialTransform);
        expect(finalTransform).not.toBe(midAnimationTransform);

        graphHandle.destroy();
    });

    it('accumulates consecutive wheel zoom ticks while easing is in progress', () => {
        const graphHost = document.getElementById('graph-host') as HTMLDivElement;
        const graphHandle = renderExplorationGraph(graphHost, createGraph());
        const svg = graphHost.querySelector('svg') as SVGSVGElement;
        const viewport = svg.querySelector('g') as SVGGElement;

        Object.defineProperty(svg, 'getBoundingClientRect', {
            value: () => ({
                left: 0,
                top: 0,
                width: 100,
                height: 100,
                right: 100,
                bottom: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }),
            configurable: true,
        });

        const initialScale = extractScale(viewport.getAttribute('transform'));

        svg.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -120,
            clientX: 50,
            clientY: 50,
            bubbles: true,
            cancelable: true,
        }));
        flushAnimationFrame(0);

        svg.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -120,
            clientX: 50,
            clientY: 50,
            bubbles: true,
            cancelable: true,
        }));

        flushAnimationFrame(220);
        flushAnimationFrame(440);

        const finalScale = extractScale(viewport.getAttribute('transform'));
        expect(finalScale).toBeGreaterThan(initialScale * 1.08);

        graphHandle.destroy();
    });
});