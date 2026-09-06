import { describe, expect, it } from "vitest";
import {
	clampView,
	INITIAL_VIEW,
	MAP_H,
	MAP_MAX_K,
	MAP_W,
	type MapView,
	zoomAtPoint,
} from "./mapZoom";

describe("clampView", () => {
	it("clamps k into [1, MAX_K]", () => {
		expect(clampView({ k: 0.2, x: 0, y: 0 }).k).toBe(1);
		expect(clampView({ k: 99, x: 0, y: 0 }).k).toBe(MAP_MAX_K);
	});

	it("clamps pan so the map covers the viewBox", () => {
		const v = clampView({ k: 2, x: 100, y: 100 });
		expect(v.x).toBe(0);
		expect(v.y).toBe(0);
		const v2 = clampView({ k: 2, x: -2000, y: -2000 });
		expect(v2.x).toBe(MAP_W - MAP_W * 2);
		expect(v2.y).toBe(MAP_H - MAP_H * 2);
	});

	it("forces identity at k = 1", () => {
		const v = clampView({ k: 1, x: -50, y: 20 });
		expect(v).toEqual({ k: 1, x: 0, y: 0 });
	});
});

describe("zoomAtPoint", () => {
	it("keeps the zoom anchor fixed on screen", () => {
		const v: MapView = { k: 2, x: -200, y: -80 };
		const vx = 500;
		const vy = 220;
		const next = zoomAtPoint(v, vx, vy, 2);
		// The viewBox point must map to the same screen fraction before/after.
		const beforeX = (vx - v.x) / v.k / MAP_W;
		const afterX = (vx - next.x) / next.k / MAP_W;
		const beforeY = (vy - v.y) / v.k / MAP_H;
		const afterY = (vy - next.y) / next.k / MAP_H;
		expect(afterX).toBeCloseTo(beforeX, 10);
		expect(afterY).toBeCloseTo(beforeY, 10);
	});

	it("zooming out at k = 1 resets to identity", () => {
		const v = zoomAtPoint({ k: 3, x: -300, y: -150 }, 100, 100, 0.001);
		expect(v).toEqual(INITIAL_VIEW);
	});

	it("clamps runaway factors to MAX_K", () => {
		expect(zoomAtPoint(INITIAL_VIEW, 480, 250, 1e6).k).toBe(MAP_MAX_K);
	});

	it("never leaves legal bounds", () => {
		let v = INITIAL_VIEW;
		v = zoomAtPoint(v, 480, 250, 3);
		v = zoomAtPoint(v, 0, 0, 0.2);
		const c = clampView(v);
		expect(c).toEqual(v);
	});
});
