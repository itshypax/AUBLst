// Aufzeichnender 2D-Context für Tests: merkt sich jede Methode mit Argumenten.
export function recordingContext() {
  const calls: string[] = [];
  const handler: ProxyHandler<object> = {
    get: (_target, key) => {
      if (typeof key !== 'string') return undefined;
      return (...args: unknown[]) => {
        calls.push(`${key}(${args.map((a) => (typeof a === 'object' ? 'obj' : String(a))).join(',')})`);
      };
    },
    set: () => true,
  };
  return { ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D, calls };
}
