/**
 * Typing shim: resolving the 108 KB world-atlas TopoJSON through TS' JSON
 * module inference is needlessly slow. The runtime import stays a normal
 * JSON import (bundled by Vite); only the type is declared here.
 */
declare module "world-atlas/countries-110m.json" {
	const value: unknown;
	export default value;
}
