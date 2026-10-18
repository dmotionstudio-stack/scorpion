// A small, safe math evaluator for the calculator tool (no eval()).
// Supports + - * / % ^, parentheses, unary minus, constants and common functions.
const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS = { pi: Math.PI, e: Math.E };

export function evaluate(expression) {
  const src = String(expression).replace(/×/g, '*').replace(/÷/g, '/').replace(/,(?=\d{3}\b)/g, '');
  const tokens = src.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-z_]+|\*\*|[-+*/%^(),]/gi);
  if (!tokens || tokens.join('') !== src.replace(/\s+/g, '')) throw new Error(`Cannot parse "${expression}"`);
  let i = 0;
  const peek = () => tokens[i];
  const take = (t) => { if (t && tokens[i] !== t) throw new Error(`Expected "${t}"`); return tokens[i++]; };

  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term();
    return v;
  }
  function term() {
    let v = power();
    while (['*', '/', '%'].includes(peek())) {
      const op = take();
      const r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function power() {
    const base = unary();
    if (peek() === '^' || peek() === '**') { take(); return base ** power(); }
    return base;
  }
  function unary() {
    if (peek() === '-') { take(); return -unary(); }
    if (peek() === '+') { take(); return unary(); }
    return primary();
  }
  function primary() {
    const t = take();
    if (t === undefined) throw new Error('Unexpected end of expression');
    if (t === '(') { const v = expr(); take(')'); return v; }
    if (/^[\d.]/.test(t)) return Number(t);
    const name = t.toLowerCase();
    if (name in CONSTS) return CONSTS[name];
    if (name in FUNCS) {
      take('(');
      const args = [expr()];
      while (peek() === ',') { take(); args.push(expr()); }
      take(')');
      return FUNCS[name](...args);
    }
    throw new Error(`Unknown name "${t}"`);
  }

  const value = expr();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}"`);
  return value;
}
