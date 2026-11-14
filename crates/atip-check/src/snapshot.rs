//! The files under a directory, before and after an invocation.
//!
//! A snapshot lists every file under a root by its path relative to the
//! root, by size and SHA-256, and every symlink by its target. A bare
//! directory is not an entry: a directory made to hold an allowed file is
//! not an effect (checker.md 1.3.1 section 4). Two snapshots differ in
//! exactly the paths that were created, removed or changed (spec 8.2: a
//! refusal changes nothing).
//!
//! A copy of the template is measured without reading every file of it again. A file of the copy still holds what the
//! template's file at the same path holds when its size and modification time are that file's, and neither it nor any
//! directory above it has changed since the copy was made: the status-change time of each is older than that moment. No
//! process can set a status-change time back, and a write, a rename, a link, a mode change or an entry added to or
//! removed from a directory each sets it to the present. Such a file takes the template's hash; every other file is read.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use sha2::{Digest, Sha256};

/// One entry of a snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    File { size: u64, sha256: [u8; 32] },
    Symlink(String),
}

/// The entries under a root, keyed by their path relative to it.
pub type Snapshot = BTreeMap<String, Entry>;

/// A time as the file system keeps it: seconds and nanoseconds since the epoch.
pub type Time = (i64, i64);

/// The size and modification time of a file.
type Stamp = (u64, Time);

/// The status-change time of a file or directory.
pub fn changed_at(metadata: &fs::Metadata) -> Time {
    (metadata.ctime(), metadata.ctime_nsec())
}

fn stamp_of(metadata: &fs::Metadata) -> Stamp {
    (metadata.size(), (metadata.mtime(), metadata.mtime_nsec()))
}

/// The snapshot of the template, with the size and modification time each of its files had then.
#[derive(Debug, Default)]
pub struct Template {
    pub files: Snapshot,
    stamps: BTreeMap<String, Stamp>,
}

impl Template {
    /// Every entry under each root (which must exist), keyed `<label>/<path relative to the root>`.
    pub fn take(roots: &[(&Path, &str)]) -> io::Result<Self> {
        let mut template = Self::default();
        for (root, label) in roots {
            walk(
                root,
                label,
                Look::Read,
                Some(&mut template.stamps),
                &mut template.files,
            )?;
        }
        Ok(template)
    }
}

/// Where the files under a root came from, which says which of them have to be read.
#[derive(Debug, Clone, Copy)]
pub enum Source<'a> {
    /// Anywhere: every file is read.
    Unknown,
    /// A copy of `template` made at `made` (a time of the file system's clock): what has not changed since keeps the template's hash.
    Copy { template: &'a Template, made: Time },
}

/// How a walk treats the files of one directory.
#[derive(Clone, Copy)]
enum Look<'a> {
    /// Every file is read.
    Read,
    /// The directory is in a copy of `template` made at `made`; `intact` when neither it nor any directory above it has changed since.
    Copy {
        template: &'a Template,
        made: Time,
        intact: bool,
    },
}

impl<'a> Look<'a> {
    /// The same for the directory `entry` inside this one.
    fn inside(self, entry: &fs::DirEntry) -> io::Result<Self> {
        Ok(match self {
            Self::Copy {
                template,
                made,
                intact: true,
            } => Self::Copy {
                template,
                made,
                intact: changed_at(&entry.metadata()?) < made,
            },
            other => other,
        })
    }

    /// The template's entry for the file `entry` at `relative`, when the copy vouches that it holds the same.
    fn kept(self, relative: &str, entry: &fs::DirEntry) -> io::Result<Option<&'a Entry>> {
        let Self::Copy {
            template,
            made,
            intact: true,
        } = self
        else {
            return Ok(None);
        };
        let metadata = entry.metadata()?;
        Ok((changed_at(&metadata) < made
            && template.stamps.get(relative) == Some(&stamp_of(&metadata)))
        .then(|| template.files.get(relative))
        .flatten())
    }
}

/// Adds every entry under `root` (which must exist) to `snapshot`, keyed `<label>/<path relative to root>`; links are recorded, never followed.
pub fn take(
    root: &Path,
    label: &str,
    source: Source<'_>,
    snapshot: &mut Snapshot,
) -> io::Result<()> {
    let look = match source {
        Source::Unknown => Look::Read,
        Source::Copy { template, made } => Look::Copy {
            template,
            made,
            intact: changed_at(&fs::symlink_metadata(root)?) < made,
        },
    };
    walk(root, label, look, None, snapshot)
}

fn walk(
    dir: &Path,
    prefix: &str,
    look: Look<'_>,
    mut stamps: Option<&mut BTreeMap<String, Stamp>>,
    snapshot: &mut Snapshot,
) -> io::Result<()> {
    let mut names: Vec<_> = fs::read_dir(dir)?.collect::<io::Result<Vec<_>>>()?;
    names.sort_by_key(fs::DirEntry::file_name);
    for entry in names {
        let relative = format!("{prefix}/{}", entry.file_name().to_string_lossy());
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            snapshot.insert(
                relative,
                Entry::Symlink(fs::read_link(entry.path())?.to_string_lossy().into_owned()),
            );
        } else if kind.is_dir() {
            walk(
                &entry.path(),
                &relative,
                look.inside(&entry)?,
                stamps.as_deref_mut(),
                snapshot,
            )?;
        } else {
            if let Some(stamps) = stamps.as_deref_mut() {
                stamps.insert(relative.clone(), stamp_of(&entry.metadata()?));
            }
            let file = match look.kept(&relative, &entry)? {
                Some(file) => file.clone(),
                None => read(&entry.path())?,
            };
            snapshot.insert(relative, file);
        }
    }
    Ok(())
}

/// The entry of the file at `path`, read whole.
fn read(path: &Path) -> io::Result<Entry> {
    let bytes = fs::read(path)?;
    Ok(Entry::File {
        size: bytes.len() as u64,
        sha256: Sha256::digest(&bytes).into(),
    })
}

/// The paths created, removed or changed between `before` and `after`, in path order.
pub fn changed(before: &Snapshot, after: &Snapshot) -> Vec<String> {
    let mut paths: Vec<&String> = before.keys().chain(after.keys()).collect();
    paths.sort();
    paths.dedup();
    paths
        .into_iter()
        .filter(|path| before.get(*path) != after.get(*path))
        .map(|path| path.trim_start_matches('/').to_string())
        .collect()
}

/// Makes `to`, which must not exist (its parent must), a copy of the tree at `from`, keeping links as links and permission bits.
///
/// On macOS the whole tree is one `clonefile(2)` while `clone` holds: the copy shares the template's blocks until either is
/// written, and costs one system call, not several per entry. Where that fails (a file system without clones, another
/// volume, any error) `clone` is cleared, so that the rest of the run does not ask again, and the tree is copied entry by
/// entry, as on every other system. A link is never made: a tool that writes a file in place would write the template.
pub fn copy_or_clone(from: &Path, to: &Path, clone: &mut bool) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    if *clone {
        match clone_tree(from, to) {
            Ok(()) => return Ok(()),
            Err(error) => {
                *clone = false;
                if error.kind() != io::ErrorKind::AlreadyExists {
                    // What a failed clone may have left is not the copy.
                    match fs::remove_dir_all(to) {
                        Err(gone) if gone.kind() == io::ErrorKind::NotFound => {}
                        other => other?,
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = clone;
    copy_tree(from, to)
}

/// `clonefile(2)` of the tree at `from` as `to`, links not followed and the files owned by this process, as a copy's are.
#[cfg(target_os = "macos")]
#[expect(
    unsafe_code,
    reason = "clonefile(2) is an FFI call with no std or nix equivalent"
)]
fn clone_tree(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    // <sys/clonefile.h>; the libc crate does not define them.
    const CLONE_NOFOLLOW: u32 = 0x0001;
    const CLONE_NOOWNERCOPY: u32 = 0x0002;
    let from = CString::new(from.as_os_str().as_bytes())?;
    let to = CString::new(to.as_os_str().as_bytes())?;
    // SAFETY: both arguments are NUL-terminated strings that outlive the call, which only reads them.
    let done = unsafe {
        libc::clonefile(
            from.as_ptr(),
            to.as_ptr(),
            CLONE_NOFOLLOW | CLONE_NOOWNERCOPY,
        )
    };
    if done == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// Copies the tree at `from` to `to` (created), keeping links as links and permission bits.
pub fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            std::os::unix::fs::symlink(fs::read_link(entry.path())?, &target)?;
        } else if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
            fs::set_permissions(&target, fs::metadata(entry.path())?.permissions())?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime};

    use super::{changed, changed_at, copy_or_clone, take, Snapshot, Source, Template, Time};

    fn plain(root: &Path) -> Snapshot {
        let mut snapshot = Snapshot::new();
        take(root, "", Source::Unknown, &mut snapshot).expect("snapshot");
        snapshot
    }

    fn set_modified(path: &Path, time: SystemTime) {
        fs::File::options()
            .write(true)
            .open(path)
            .expect("open")
            .set_modified(time)
            .expect("mtime");
    }

    fn files_under(dir: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        for entry in fs::read_dir(dir).expect("read_dir") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                files.extend(files_under(&path));
            } else {
                files.push(path);
            }
        }
        files
    }

    #[test]
    fn atip_check_30_a_snapshot_names_what_was_created_changed_and_removed() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("kept"), "a").expect("write");
        fs::write(dir.path().join("edited"), "a").expect("write");
        fs::write(dir.path().join("gone"), "a").expect("write");
        let before = plain(dir.path());
        fs::write(dir.path().join("edited"), "b").expect("write");
        fs::remove_file(dir.path().join("gone")).expect("remove");
        fs::create_dir(dir.path().join("made")).expect("mkdir");
        fs::write(dir.path().join("made").join("inside"), "").expect("write");
        fs::create_dir(dir.path().join("bare")).expect("mkdir");
        let after = plain(dir.path());
        assert_eq!(changed(&before, &after), ["edited", "gone", "made/inside"]);
        assert!(changed(&after, &after).is_empty());
    }

    #[test]
    fn atip_check_24_a_copy_is_independent_of_its_source() {
        let from = tempfile::tempdir().expect("tempdir");
        let to = tempfile::tempdir().expect("tempdir");
        fs::create_dir(from.path().join("sub")).expect("mkdir");
        fs::write(from.path().join("sub").join("file"), "x").expect("write");
        std::os::unix::fs::symlink("sub/file", from.path().join("link")).expect("symlink");
        // A clone where the system has one, and a copy entry by entry.
        for clone in [true, false] {
            let copy = to.path().join(format!("copy-{clone}"));
            let mut cloning = clone;
            copy_or_clone(from.path(), &copy, &mut cloning).expect("copy");
            assert_eq!(cloning, clone, "the clone did not fail");
            assert!(changed(&plain(from.path()), &plain(&copy)).is_empty());
            assert!(
                fs::symlink_metadata(copy.join("link"))
                    .expect("link")
                    .file_type()
                    .is_symlink(),
                "a link stays a link"
            );
            fs::write(copy.join("sub").join("file"), "y").expect("write");
            assert_eq!(
                fs::read_to_string(from.path().join("sub").join("file")).expect("read"),
                "x"
            );
        }
    }

    #[test]
    fn atip_check_24_a_clone_that_fails_falls_back_to_a_copy_and_is_not_tried_again() {
        let from = tempfile::tempdir().expect("tempdir");
        fs::write(from.path().join("file"), "x").expect("write");
        // The target exists already: the clone is refused (EEXIST) and the copy is made into it.
        let to = tempfile::tempdir().expect("tempdir");
        let mut clone = true;
        copy_or_clone(from.path(), to.path(), &mut clone).expect("copy");
        assert_eq!(
            clone,
            !cfg!(target_os = "macos"),
            "a clone that failed is not tried again"
        );
        assert_eq!(
            fs::read_to_string(to.path().join("file")).expect("read"),
            "x"
        );
    }

    /// The file system's clock now: the status-change time of a file just touched.
    fn now_on_disk(dir: &Path) -> Time {
        let clock = fs::File::create(dir.join("clock")).expect("clock");
        clock.set_modified(SystemTime::now()).expect("touch");
        changed_at(&clock.metadata().expect("stat"))
    }

    #[test]
    fn atip_check_30_a_copy_measured_against_the_template_names_every_change_a_full_read_names() {
        let dir = tempfile::tempdir().expect("tempdir");
        let template = dir.path().join("template");
        for sub in ["x", "y", "z/deep"] {
            fs::create_dir_all(template.join(sub)).expect("mkdir");
        }
        for (path, text) in [
            ("same-size", "aaaa"),
            ("kept", "kk"),
            ("gone", "g"),
            ("chmod", "m"),
            ("x/one", "1111"),
            ("y/one", "2222"),
            ("z/deep/file", "d"),
        ] {
            fs::write(template.join(path), text).expect("write");
        }
        // Two files of one size and one modification time, in two directories that get swapped.
        let stamp = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        for path in ["x/one", "y/one"] {
            set_modified(&template.join(path), stamp);
        }
        let taken = Template::take(&[(&template, "")]).expect("template");
        // A copy as the runner makes one, with the template's modification times: a clone keeps them, and a copy is
        // given them here so that the same files are vouched for on every system.
        let copy = dir.path().join("copy");
        let mut clone = true;
        copy_or_clone(&template, &copy, &mut clone).expect("copy");
        for file in files_under(&template) {
            let modified = fs::metadata(&file)
                .expect("stat")
                .modified()
                .expect("mtime");
            set_modified(
                &copy.join(file.strip_prefix(&template).expect("inside")),
                modified,
            );
        }
        std::thread::sleep(Duration::from_millis(20));
        let made = now_on_disk(dir.path());
        std::thread::sleep(Duration::from_millis(20));
        let source = Source::Copy {
            template: &taken,
            made,
        };
        let measure = |root: &Path| {
            let mut snapshot = Snapshot::new();
            take(root, "", source, &mut snapshot).expect("snapshot");
            snapshot
        };
        assert_eq!(
            measure(&copy),
            taken.files,
            "an untouched copy is the template"
        );
        // Rewritten at the same size, its modification time set back.
        let original = fs::metadata(copy.join("same-size"))
            .expect("stat")
            .modified()
            .expect("mtime");
        fs::write(copy.join("same-size"), "bbbb").expect("write");
        set_modified(&copy.join("same-size"), original);
        // Two directories swapped: each file keeps its size, its times and its status-change time.
        fs::rename(copy.join("x"), copy.join("swap")).expect("rename");
        fs::rename(copy.join("y"), copy.join("x")).expect("rename");
        fs::rename(copy.join("swap"), copy.join("y")).expect("rename");
        // A mode change alone changes no content.
        let mut permissions = fs::metadata(copy.join("chmod"))
            .expect("stat")
            .permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o600);
        fs::set_permissions(copy.join("chmod"), permissions).expect("chmod");
        fs::remove_file(copy.join("gone")).expect("remove");
        let after = measure(&copy);
        assert_eq!(after, plain(&copy), "the same as a full read");
        assert_eq!(
            changed(&taken.files, &after),
            ["gone", "same-size", "x/one", "y/one"]
        );
        // Untouched files below a directory that did not change keep the template's hash without being read.
        fs::write(copy.join("z").join("deep").join("file"), "e").expect("write");
        assert_eq!(
            changed(&taken.files, &measure(&copy)),
            ["gone", "same-size", "x/one", "y/one", "z/deep/file"]
        );
    }
}
