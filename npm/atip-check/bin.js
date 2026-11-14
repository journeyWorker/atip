#!/usr/bin/env node
// `@journeykit/atip-check`: runs the `atip` binary of the platform package installed next to it (an optional dependency,
// one per platform), with this process's arguments and stdio, and ends with the binary's exit status, or as close to
// its signal as Node allows. The checker's own output, exit statuses and refusals are the binary's; this file only
// finds it.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCOPE = "@journeykit/";
// `${process.platform}-${process.arch}` → the package that carries the binary for it (npm/atip-check-<platform>/).
const PLATFORMS = {
  "darwin-arm64": `${SCOPE}atip-check-darwin-arm64`,
  "linux-x64": `${SCOPE}atip-check-linux-x64`,
  "linux-arm64": `${SCOPE}atip-check-linux-arm64`,
};
const FROM_SOURCE = "build it from source with `cargo install atip-check`";

function fail(message) {
  process.stderr.write(`atip (npm launcher): ${message}\n`);
  process.exit(2);
}

// The installed platform package, else its sibling directory in the repository's npm/ (a checkout, or CI before
// publishing), where each package directory is the package name without the scope.
function binaryPath(pkg) {
  try {
    const manifest = createRequire(import.meta.url).resolve(`${pkg}/package.json`);
    return join(dirname(manifest), "bin", "atip");
  } catch {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, "..", pkg.slice(SCOPE.length), "bin", "atip");
  }
}

const platform = `${process.platform}-${process.arch}`;
const pkg = PLATFORMS[platform];
if (pkg === undefined) {
  fail(`no prebuilt binary for ${platform} (there are ${Object.keys(PLATFORMS).join(", ")}); on another unix, ${FROM_SOURCE}`);
}
const bin = binaryPath(pkg);
if (!existsSync(bin)) {
  fail(`${pkg} is not installed, so there is no ${bin}; install again without omitting optional dependencies, or ${FROM_SOURCE}`);
}

const run = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
if (run.error) {
  const libc = process.platform === "linux" ? " (the Linux binaries need glibc)" : "";
  fail(`could not run ${bin}: ${run.error.message}${libc}; ${FROM_SOURCE}`);
}
if (run.signal !== null) {
  // End by the same signal. Node ignores some (SIGPIPE), so fall back to the shell's status for a signal.
  process.kill(process.pid, run.signal);
  process.exit(128 + (constants.signals[run.signal] ?? 0));
}
process.exit(run.status ?? 1);
