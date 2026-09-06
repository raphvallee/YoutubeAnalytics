/**
 * Browser storage probe utilities (Phase 0).
 *
 * IndexedDB lifetime semantics are documented in docs/BLUEPRINT.md §1.3:
 * data survives tab close / restart / reboot and is only cleared by the user
 * (or evicted under disk pressure when the origin is NOT marked persistent).
 */

export interface StorageEstimateInfo {
	/** Approximate bytes used by this origin. */
	usage: number;
	/** Total bytes granted to this origin. */
	quota: number;
	/** Usage as a fraction of quota (0..1), or null when unknown. */
	usageRatio: number | null;
}

/** Ask the browser to never evict our storage. Returns whether the grant succeeded. */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === "undefined" || !navigator.storage?.persist) {
		return false;
	}
	if (await navigator.storage.persisted()) {
		return true;
	}
	try {
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

/** Current persisted flag, null when the API is unavailable. */
export async function isStoragePersisted(): Promise<boolean | null> {
	if (typeof navigator === "undefined" || !navigator.storage?.persisted) {
		return null;
	}
	try {
		return await navigator.storage.persisted();
	} catch {
		return null;
	}
}

/** Quota info from navigator.storage.estimate(), nulls when unavailable. */
export async function getStorageEstimate(): Promise<StorageEstimateInfo | null> {
	if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
		return null;
	}
	try {
		const { usage = 0, quota = 0 } = await navigator.storage.estimate();
		return {
			usage,
			quota,
			usageRatio: quota > 0 ? usage / quota : null,
		};
	} catch {
		return null;
	}
}

/** Human-readable byte size, e.g. `1.4 MB`. */
export function formatBytes(bytes: number, fractionDigits = 1): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return "0 B";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	const digits = unitIndex === 0 ? 0 : fractionDigits;
	return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
