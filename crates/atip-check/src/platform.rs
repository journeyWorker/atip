//! Everything in the checker that depends on the operating system, kept in this one module: signal dispositions,
//! process groups, waiting for a child without reaping it, pseudo-terminals, file times and permission bits, links, and
//! the copy-on-write clone of a tree. `atip check` runs on macOS and Linux; the rest of the crate is portable `std` and
//! names none of `std::os::unix`, `libc` or `nix`.

#[cfg(not(unix))]
compile_error!("atip check runs on macOS and Linux: it needs a pseudo-terminal and process groups");

use std::fs::Metadata;
use std::io;
use std::os::fd::{AsFd, OwnedFd};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::Path;
use std::process::{Child, Command, ExitStatus};

use nix::sys::signal::{killpg, Signal};
use nix::unistd::Pid;

/// The `PATH` of a child when the checker's own environment has none.
pub(crate) const FALLBACK_PATH: &str = "/usr/bin:/bin";

/// Rust starts with SIGPIPE ignored, so printing to a closed stdout panics (exit 101). `atip` restores the default
/// action once the run is over and before it prints: a closed stdout ends it by the signal (spec 8.4), as `canon` does, and exit 101
/// never appears (spec 8.6). During the run SIGPIPE stays ignored ([`ignore_sigpipe`]): a document written to the stdin of a tool
/// that has already exited is an `EPIPE` the checker ignores, not a signal that ends the checker.
#[expect(
    unsafe_code,
    reason = "libc::signal is an unsafe FFI call with no safe std equivalent for restoring SIGPIPE"
)]
pub(crate) fn restore_sigpipe() {
    // SAFETY: it only changes the process's SIGPIPE action, and is called after the last call of the run, when nothing writes to a pipe of a child.
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_DFL);
    }
}

/// A document is written to the stdin of a tool that may have exited already (it refused the call without reading it): the write must fail with
/// `EPIPE`, not end the checker by SIGPIPE. Rust starts a process with SIGPIPE ignored, and a runner makes sure it still is, whoever restored the
/// default before (`app::main` does, once the run is over, so that a closed stdout ends `atip` by the signal).
#[expect(
    unsafe_code,
    reason = "libc::signal is an unsafe FFI call with no safe std equivalent for ignoring SIGPIPE"
)]
pub(crate) fn ignore_sigpipe() {
    // SAFETY: it only changes the process's SIGPIPE action, to the one Rust starts every process with.
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
    }
}

/// Whether a file with `metadata` has an execute bit set.
pub(crate) fn is_executable(metadata: &Metadata) -> bool {
    metadata.permissions().mode() & 0o111 != 0
}

/// Starts the child of `command` in a process group of its own, whose id is the child's, so that what it leaves running can be
/// signalled with it.
pub(crate) fn in_own_group(command: &mut Command) -> &mut Command {
    command.process_group(0)
}

/// The signal that ended a process, when a signal did.
pub(crate) fn signal_of(status: ExitStatus) -> Option<i32> {
    status.signal()
}

fn signal_group(child: &Child, signal: Signal) {
    if let Ok(pid) = i32::try_from(child.id()) {
        // ESRCH is the usual answer: the group is already gone.
        let _gone = killpg(Pid::from_raw(pid), signal);
    }
}

/// Asks the process group of `child` to end (SIGTERM).
pub(crate) fn terminate_group(child: &Child) {
    signal_group(child, Signal::SIGTERM);
}

/// Ends the process group of `child` (SIGKILL).
pub(crate) fn kill_group(child: &Child) {
    signal_group(child, Signal::SIGKILL);
}

/// Returns once the child `pid` has exited, leaving it to be reaped by its [`Child`] (or at once, when it has been reaped).
#[expect(
    unsafe_code,
    reason = "waitid(2) with WNOWAIT has no std equivalent, nor a nix one on macOS"
)]
pub(crate) fn wait_for_exit(pid: u32) {
    loop {
        // SAFETY: `siginfo_t` is plain data, for which all zeroes is a valid value.
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        // SAFETY: waitid only writes to `info`, which outlives the call.
        let done = unsafe {
            libc::waitid(
                libc::P_PID,
                libc::id_t::from(pid),
                &raw mut info,
                libc::WEXITED | libc::WNOWAIT,
            )
        };
        if done == 0 || io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
            return;
        }
    }
}

/// The two ends of a pseudo-terminal.
#[derive(Debug)]
pub(crate) struct Pty {
    pub(crate) master: OwnedFd,
    pub(crate) slave: OwnedFd,
}

/// A pseudo-terminal in raw mode: no line translation (`\n` stays `\n`), no echo.
pub(crate) fn raw_terminal() -> io::Result<Pty> {
    let pty = nix::pty::openpty(None, None).map_err(io::Error::from)?;
    let mut settings = nix::sys::termios::tcgetattr(&pty.slave).map_err(io::Error::from)?;
    nix::sys::termios::cfmakeraw(&mut settings);
    nix::sys::termios::tcsetattr(&pty.slave, nix::sys::termios::SetArg::TCSANOW, &settings)
        .map_err(io::Error::from)?;
    Ok(Pty {
        master: pty.master,
        slave: pty.slave,
    })
}

/// A pseudo-terminal as an interactive session has it: input in canonical mode (`ICANON`) with echo off, so that the
/// end-of-file character written at the start of a line makes a reader's `read` return 0; output untranslated
/// (`OPOST` off, so a `\n` the tool writes arrives as `\n`, not `\r\n`). The byte is that end-of-file character.
pub(crate) fn canonical_terminal() -> io::Result<(Pty, u8)> {
    use nix::sys::termios::{
        tcgetattr, tcsetattr, InputFlags, LocalFlags, OutputFlags, SetArg, SpecialCharacterIndices,
    };
    let pty = nix::pty::openpty(None, None).map_err(io::Error::from)?;
    let mut settings = tcgetattr(&pty.slave).map_err(io::Error::from)?;
    settings.local_flags.insert(LocalFlags::ICANON);
    settings
        .local_flags
        .remove(LocalFlags::ECHO | LocalFlags::ECHOE | LocalFlags::ECHOK | LocalFlags::ECHONL);
    settings.output_flags.remove(OutputFlags::OPOST);
    settings
        .input_flags
        .remove(InputFlags::ICRNL | InputFlags::INLCR | InputFlags::IGNCR);
    tcsetattr(&pty.slave, SetArg::TCSANOW, &settings).map_err(io::Error::from)?;
    let end_of_file = settings.control_chars[SpecialCharacterIndices::VEOF as usize];
    Ok((
        Pty {
            master: pty.master,
            slave: pty.slave,
        },
        end_of_file,
    ))
}

/// Waits until `first` or `second` has something to read or has hung up (or, when `block` is false, only looks), and says
/// which. An interrupted wait is waited again.
pub(crate) fn readable(
    first: &impl AsFd,
    second: &impl AsFd,
    block: bool,
) -> io::Result<(bool, bool)> {
    use nix::poll::{poll, PollFd, PollFlags, PollTimeout};
    loop {
        let mut fds = [
            PollFd::new(first.as_fd(), PollFlags::POLLIN),
            PollFd::new(second.as_fd(), PollFlags::POLLIN),
        ];
        let timeout = if block {
            PollTimeout::NONE
        } else {
            PollTimeout::ZERO
        };
        match poll(&mut fds, timeout) {
            Ok(_) => {}
            Err(nix::errno::Errno::EINTR) => continue,
            Err(error) => return Err(io::Error::from(error)),
        }
        let ready = |fd: &PollFd<'_>| fd.revents().is_some_and(|events| !events.is_empty());
        return Ok((ready(&fds[0]), ready(&fds[1])));
    }
}

/// The status-change time of a file or directory: seconds and nanoseconds since the epoch.
pub(crate) fn changed_at(metadata: &Metadata) -> (i64, i64) {
    (metadata.ctime(), metadata.ctime_nsec())
}

/// The modification time of a file: seconds and nanoseconds since the epoch.
pub(crate) fn modified_at(metadata: &Metadata) -> (i64, i64) {
    (metadata.mtime(), metadata.mtime_nsec())
}

/// Makes `link` a symbolic link to `target`.
pub(crate) fn symlink(target: &Path, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

/// `clonefile(2)` of the tree at `from` as `to`, links not followed and the files owned by this process, as a copy's are; `None`
/// where the system has no clone of a tree (every system but macOS).
#[cfg(target_os = "macos")]
#[expect(
    unsafe_code,
    reason = "clonefile(2) is an FFI call with no std or nix equivalent"
)]
pub(crate) fn clone_tree(from: &Path, to: &Path) -> Option<io::Result<()>> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    // <sys/clonefile.h>; the libc crate does not define them.
    const CLONE_NOFOLLOW: u32 = 0x0001;
    const CLONE_NOOWNERCOPY: u32 = 0x0002;
    let paths = CString::new(from.as_os_str().as_bytes())
        .and_then(|from| Ok((from, CString::new(to.as_os_str().as_bytes())?)));
    let (from, to) = match paths {
        Ok(paths) => paths,
        Err(error) => return Some(Err(io::Error::from(error))),
    };
    // SAFETY: both arguments are NUL-terminated strings that outlive the call, which only reads them.
    let done = unsafe {
        libc::clonefile(
            from.as_ptr(),
            to.as_ptr(),
            CLONE_NOFOLLOW | CLONE_NOOWNERCOPY,
        )
    };
    Some(if done == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    })
}

/// No clone of a tree on this system: `None`, and the caller copies.
#[cfg(not(target_os = "macos"))]
pub(crate) fn clone_tree(_from: &Path, _to: &Path) -> Option<io::Result<()>> {
    None
}
