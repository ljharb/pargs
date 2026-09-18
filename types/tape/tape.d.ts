import 'tape';

declare module 'tape' {
	interface Test {
		// `capture` guards with `typeof obj !== 'object' && typeof obj !== 'function'`,
		// so it takes any object - but it declares `Record<PropertyKey, unknown> |
		// unknown[]`, which no interface can satisfy, since only anonymous object types
		// get an implicit index signature. That makes `t.capture(console, 'log')` an
		// error. `intercept`, declared right beside it, already says `object`.
		// Remove this once a tape with the widened `capture` is released.
		capture(
			this: void | Test,
			obj: Record<PropertyKey, unknown> | object,
			method: PropertyKey,
			implementation?: import('tape').Callback,
		): import('tape').WrapResults;
	}
}
