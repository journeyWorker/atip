//! Everything in the fake tool that depends on the operating system, kept in this one module: its home directory, a
//! terminal put in raw mode, and the signals of the seeded violations. The rest of the fake tool is portable `std`.

use std::io::Stdin;
use std::path::PathBuf;

/// The home directory the tool writes to (`refusalWritesHome`): `HOME`, which the checker points into the copy of the state.
pub fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Puts the terminal on `stdin` in raw mode; on a stdin that is no terminal, nothing happens.
pub fn raw_mode(stdin: &Stdin) {
    use nix::sys::termios::{cfmakeraw, tcgetattr, tcsetattr, SetArg};
    if let Ok(mut settings) = tcgetattr(stdin) {
        cfmakeraw(&mut settings);
        tcsetattr(stdin, SetArg::TCSANOW, &settings).unwrap_or_default();
    }
}

/// Ignores SIGTERM: the seeded violation of a server that does not end when it is asked to.
#[expect(
    unsafe_code,
    reason = "libc::signal is an unsafe FFI call; the seeded violation is a server that ignores SIGTERM"
)]
pub fn ignore_sigterm() {
    // SAFETY: sets the disposition of SIGTERM of this process to ignore; nothing else touches signals.
    unsafe {
        libc::signal(libc::SIGTERM, libc::SIG_IGN);
    }
}

/// Ends this process by SIGTERM: the seeded violation of a tool that dies by a signal.
#[expect(
    unsafe_code,
    reason = "libc::raise is an unsafe FFI call; the seeded violation is a tool that dies by a signal"
)]
pub fn die_by_sigterm() {
    // SAFETY: raises SIGTERM on this process; nothing else runs afterwards.
    unsafe {
        libc::raise(libc::SIGTERM);
    }
}
