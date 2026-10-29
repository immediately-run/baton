// ontology-asp-grammar.ts — the strict-syntax test's parser (R-BTN-175, B-104): written from
// the ASP-Core-2 grammar for exactly the productions R-BTN-175's fragment admits — ground
// facts, normal rules, integrity constraints, the comparison built-ins, default negation, and
// R-BTN-177's generated choice rule and weak constraints — so a production outside the fragment
// (disjunction, an aggregate the fragment lacks, a function symbol) fails it. The conformance
// suite parses every program `toAsp` emits with this; nothing else imports it.
//
// The productions (ASP-Core-2 §4, restricted):
//   program   ::= statement*
//   statement ::= fact | rule | constraint | choice | weak
//   fact      ::= atom '.'
//   rule      ::= atom ':-' naf_literals '.'
//   constraint ::= ':-' naf_literals '.'
//   choice    ::= bound '<=' '{' aggregate '}' '<=' bound ':-' naf_literals '.'   (the encoding's)
//   weak      ::= ':~' naf_literals '.' '[' term '@' level (',' term)* ']'
//   naf_literal ::= atom | 'not' atom | term op term
//   atom      ::= IDENT ('(' term (',' term)* ')')?
//   term      ::= '"' string '"' | INTEGER | variable        — never a function symbol
//   variable  ::= 'V_' IDENT                                   — the translator's $x form

/** A parser over a cursor; every throw is a refusal, which the strict-syntax test counts. */
class Cursor {
  constructor(readonly s: string, public i = 0) {}
  ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
  eat(lit: string): boolean {
    this.ws();
    if (this.s.startsWith(lit, this.i)) {
      this.i += lit.length;
      return true;
    }
    return false;
  }
  expect(lit: string): void {
    if (!this.eat(lit)) throw new Error(`expected "${lit}" at ${this.i}: ${this.s.slice(this.i, this.i + 20)}`);
  }
  ident(): string {
    this.ws();
    const m = /^[a-z][A-Za-z0-9_]*/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`expected an identifier at ${this.i}`);
    this.i += m[0].length;
    return m[0];
  }
  term(): string {
    this.ws();
    const rest = this.s.slice(this.i);
    if (rest.startsWith('"')) {
      const end = rest.indexOf('"', 1);
      if (end < 1 || /[\n\r]/.test(rest.slice(1, end))) throw new Error('an unterminated string');
      if (/["\\]/.test(rest.slice(1, end))) throw new Error('an escaped character: the fragment quotes plainly');
      this.i += end + 1;
      return 'const';
    }
    if (/^V_[a-z][a-z0-9_]*/.test(rest)) {
      const m = /^V_[a-z][a-z0-9_]*/.exec(rest)!;
      this.i += m[0].length;
      return 'var';
    }
    if (/^-?\d+/.test(rest)) {
      const m = /^-?\d+/.exec(rest)!;
      this.i += m[0].length;
      return 'int';
    }
    throw new Error(`expected a term at ${this.i}: ${rest.slice(0, 20)}`);
  }
  atom(): { pred: string } {
    const pred = this.ident();
    if (this.eat('(')) {
      for (;;) {
        this.term();
        if (this.eat(',')) continue;
        break;
      }
      this.expect(')');
    }
    return { pred };
  }
  nafLiteral(): void {
    if (this.eat('not')) {
      this.ws();
      this.atom();
      return;
    }
    // A comparison (term op term) starts where a term can: a quoted string, a V_ variable or
    // an integer. An identifier starts an atom.
    this.ws();
    const c = this.s[this.i];
    if (c === '"' || c === '-' || (c != null && /[0-9]/.test(c))) {
      this.term();
      this.ws();
      const op = /^(<=|>=|!=|<|>|=)/.exec(this.s.slice(this.i));
      if (!op) throw new Error(`a term opens a comparison at ${this.i}`);
      this.i += op[0].length;
      this.term();
      return;
    }
    if (this.s.startsWith('V_', this.i)) {
      this.term();
      this.ws();
      const op = /^(<=|>=|!=|<|>|=)/.exec(this.s.slice(this.i));
      if (!op) throw new Error(`a variable opens a comparison at ${this.i}`);
      this.i += op[0].length;
      this.term();
      return;
    }
    this.atom();
  }
  nafBody(): void {
    for (;;) {
      this.nafLiteral();
      if (this.eat(';')) continue;
      break;
    }
  }
  statement(): void {
    if (this.eat(':-')) {
      this.nafBody();
      this.expect('.');
      return;
    }
    if (this.eat(':~')) {
      this.nafBody();
      this.expect('.');
      this.expect('[');
      this.term();
      this.expect('@');
      this.term();
      while (this.eat(',')) this.term();
      this.expect(']');
      return;
    }
    // The encoding's bounded choice rule: `1 <= { route(C,A) : available(C,A) } <= 1 :- …`.
    const save = this.i;
    const n1 = this.maybeInteger();
    if (n1 != null) {
      this.expect('<=');
      this.expect('{');
      this.atom();
      if (this.eat(':')) this.atom();
      this.expect('}');
      this.expect('<=');
      const n2 = this.maybeInteger();
      if (n2 == null) throw new Error('a choice rule\'s upper bound is an integer');
      this.expect(':-');
      this.nafBody();
      this.expect('.');
      return;
    }
    this.i = save;
    this.atom();
    if (this.eat(':-')) this.nafBody();
    this.expect('.');
  }
  maybeInteger(): number | null {
    this.ws();
    const m = /^\d+/.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return Number(m[0]);
  }
}

/** Parse a program the translator may emit, strictly: every statement is a production of
 * R-BTN-175's fragment, and nothing outside it parses. Returns the statement count. */
export function parseAsp(text: string): number {
  const c = new Cursor(text, 0);
  let n = 0;
  for (;;) {
    c.ws();
    if (c.i >= c.s.length) break;
    c.statement();
    n++;
  }
  return n;
}
