/**
 * The form of a domain `pattern` (Annex V2): `^`, an I-Regexp (RFC 9485) body, `$`, with the restrictions that make the
 * ECMAScript (`u` flag) and Rust `regex` readings agree: no `|` outside parentheses, no `.`, `^` or `$` outside a
 * character class, no `\-` outside a character class, and no `&&` or `~~` inside one. A tool that declares 1.5 or later
 * may also write the property `\p{White_Space}` and its complement `\P{White_Space}` (spec 15.9); `\s` stays out. The
 * checker's L1.patterns also compiles each pattern with the Rust crate's size limits, which this module cannot see: keep
 * counted repetitions of large classes short and put lengths in `maxLength`.
 */
import { Result } from "effect";
import { type ContractMinor, declaresAtLeast } from "./envelope.ts";

const SINGLE_ESCAPES = new Set([
  "(",
  ")",
  "*",
  "+",
  "-",
  ".",
  "?",
  "[",
  "\\",
  "]",
  "^",
  "n",
  "r",
  "t",
  "{",
  "|",
  "}",
]);
/** The general categories I-Regexp names (RFC 9485). */
const CATEGORY = /^(L[lmotu]?|M[cen]?|N[dlo]?|P[cdefios]?|Z[lps]?|S[ckmo]?|C[cfno]?)$/;
/** The one binary property a 1.5 pattern may name (Annex V2). */
const WHITE_SPACE = "White_Space";
const DIGIT = /^[0-9]$/;

/** A recursive-descent reading of one body; the first problem stops it. */
class Reader {
  private at = 0;
  problem: string | undefined;
  private readonly points: ReadonlyArray<string>;

  constructor(
    body: string,
    private readonly whiteSpace: boolean,
  ) {
    // code points, not graphemes: a pattern is read one code point at a time, as the u flag reads it
    this.points = Array.from(body);
  }

  private peek(offset = 0): string | undefined {
    return this.points[this.at + offset];
  }

  private fail(what: string): false {
    this.problem ??= `${what} at offset ${this.at}`;
    return false;
  }

  private isCategory(): boolean {
    return this.peek() === "\\" && (this.peek(1) === "p" || this.peek(1) === "P");
  }

  private escape(inClass: boolean): boolean {
    if (this.isCategory()) {
      if (this.peek(2) !== "{") return this.fail("\\p without {");
      const end = this.points.indexOf("}", this.at + 3);
      if (end < 0) return this.fail("unclosed \\p{");
      const name = this.points.slice(this.at + 3, end).join("");
      if (name === WHITE_SPACE && !this.whiteSpace)
        return this.fail(`\\p{${WHITE_SPACE}} is since 1.5`);
      if (name !== WHITE_SPACE && !CATEGORY.test(name))
        return this.fail(`unknown category ${name}`);
      this.at = end + 1;
      return true;
    }
    const next = this.peek(1);
    if (next === undefined || !SINGLE_ESCAPES.has(next))
      return this.fail(`escape \\${next ?? ""} is not I-Regexp`);
    if (next === "-" && !inClass) return this.fail("\\- outside a character class");
    this.at += 2;
    return true;
  }

  /** One character of a class; undefined when the next point is none (it ends or opens a range). */
  private classChar(): boolean | undefined {
    const point = this.peek();
    if (point === "\\") return this.escape(true);
    if (point === undefined || point === "-" || point === "[" || point === "]") return undefined;
    if ((point === "&" || point === "~") && this.peek(1) === point)
      return this.fail(`${point}${point} in a character class (a set operation in Rust)`);
    this.at++;
    return true;
  }

  private charClass(): boolean {
    this.at++;
    if (this.peek() === "^") this.at++;
    let items = 0;
    if (this.peek() === "-") {
      this.at++;
      items++;
    }
    while (this.peek() !== "]") {
      if (this.peek() === undefined) return this.fail("unclosed [");
      if (this.isCategory()) {
        if (!this.escape(true)) return false;
      } else if (this.peek() === "-" && this.peek(1) === "]") this.at++;
      else {
        const one = this.classChar();
        if (one === undefined) return this.fail(`${this.peek() ?? ""} in a character class`);
        if (!one) return false;
        if (this.peek() === "-" && this.peek(1) !== "]") {
          this.at++;
          if (this.isCategory()) return this.fail("bad range");
          const end = this.classChar();
          if (end === undefined) return this.fail("bad range");
          if (!end) return false;
        }
      }
      items++;
    }
    if (items === 0) return this.fail("empty character class");
    this.at++;
    return true;
  }

  private digits(): boolean {
    if (!DIGIT.test(this.peek() ?? "")) return this.fail("quantifier without digits");
    while (DIGIT.test(this.peek() ?? "")) this.at++;
    return true;
  }

  private quantifier(): boolean {
    const point = this.peek();
    if (point === "*" || point === "+" || point === "?") this.at++;
    else if (point === "{") {
      this.at++;
      if (!this.digits()) return false;
      if (this.peek() === ",") {
        this.at++;
        if (DIGIT.test(this.peek() ?? "") && !this.digits()) return false;
      }
      if (this.peek() !== "}") return this.fail("unclosed {");
      this.at++;
    }
    return true;
  }

  private atom(depth: number): boolean {
    const point = this.peek() ?? "";
    if (point === "(") {
      this.at++;
      if (!this.alternatives(depth + 1)) return false;
      if (this.peek() !== ")") return this.fail("unclosed (");
      this.at++;
      return true;
    }
    if (point === "[") return this.charClass();
    if (point === "\\") return this.escape(false);
    if (point === ".") return this.fail(". outside a character class");
    if (point === "^" || point === "$") return this.fail(`${point} outside a character class`);
    if ("*+?{}]".includes(point)) return this.fail(`${point} without an atom`);
    this.at++;
    return true;
  }

  private branch(depth: number): boolean {
    while (this.at < this.points.length && this.peek() !== "|" && this.peek() !== ")")
      if (!this.atom(depth) || !this.quantifier()) return false;
    return true;
  }

  alternatives(depth: number): boolean {
    if (!this.branch(depth)) return false;
    while (this.peek() === "|") {
      if (depth === 0) return this.fail("| outside parentheses");
      this.at++;
      if (!this.branch(depth)) return false;
    }
    return true;
  }

  whole(): boolean {
    if (!this.alternatives(0)) return false;
    return this.at < this.points.length ? this.fail(`unmatched ${this.peek() ?? ""}`) : true;
  }
}

/**
 * Why a domain pattern is not of the Annex V2 form for a tool that declares `minor` (undefined: it is). Below 1.5
 * `\p{White_Space}` and `\P{White_Space}` are refused.
 */
export const patternProblem = (pattern: string, minor: ContractMinor): string | undefined => {
  if (!(pattern.length >= 2 && pattern.startsWith("^") && pattern.endsWith("$")))
    return "is not ^…$";
  const reader = new Reader(pattern.slice(1, -1), declaresAtLeast(minor, "1.5"));
  if (!reader.whole()) return reader.problem;
  // the I-Regexp reading admits only patterns ECMAScript compiles with `u`; the constructor still has the last word
  return Result.isSuccess(Result.try(() => new RegExp(pattern, "u")))
    ? undefined
    : "does not compile as an ECMAScript pattern with the u flag";
};

/**
 * Whether a domain pattern of the Annex V2 form can match a value holding a comma (Annex S2 rule 18), read as atip's
 * `scripts/check.ts` reads it so the two agree: some atom of the pattern (a literal, an escape, a property, a class)
 * matches `,` by itself. A pattern a comma list may take keeps `,` out of every atom (`^[a-z0-9-]+$`, `^[^,]+$`).
 */
export const patternAdmitsComma = (pattern: string): boolean => {
  const points = Array.from(pattern.replace(/^\^/, "").replace(/\$$/, ""));
  const atoms: Array<string> = [];
  for (let at = 0; at < points.length; at++) {
    const point = points[at] ?? "";
    if (point === "\\") {
      const next = points[at + 1];
      if (next === "p" || next === "P") {
        const end = points.indexOf("}", at);
        atoms.push(points.slice(at, end + 1).join(""));
        at = end;
      } else {
        atoms.push(points.slice(at, at + 2).join(""));
        at++;
      }
    } else if (point === "[") {
      let end = at + 1;
      while (end < points.length && points[end] !== "]") end += points[end] === "\\" ? 2 : 1;
      atoms.push(points.slice(at, end + 1).join(""));
      at = end;
    } else if (point === "{") at = points.indexOf("}", at);
    else if (!"()|*+?".includes(point)) atoms.push(point);
  }
  return atoms.some((atom) => new RegExp(`^(?:${atom})$`, "u").test(","));
};

/**
 * A RegExp's `source` as the pattern it means: ECMAScript escapes every slash in `source` (`new RegExp("a/b").source`
 * is backslash-slash), and a backslash-slash is no I-Regexp escape (RFC 9485), so the escape `source` adds is dropped.
 * An escaped backslash is kept as it is.
 */
export const patternOfSource = (source: string): string => {
  let pattern = "";
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (char === "\\") {
      const next = source[at + 1];
      if (next === "/") {
        pattern += "/";
      } else {
        pattern += `${char}${next ?? ""}`;
      }
      at++;
      continue;
    }
    pattern += char ?? "";
  }
  return pattern;
};
