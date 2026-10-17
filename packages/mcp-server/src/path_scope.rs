//! Optional allowed-roots scope for every path-based tool.
//!
//! Tool arguments come from an AI agent, and an agent can be steered by the
//! content of the documents it reads. Without a scope the server opens any
//! readable regular file it is given. When roots are configured (the
//! `--allowed-root` CLI flag or the `OOXML_MCP_ALLOWED_ROOTS` environment
//! variable), a requested path is canonicalized first — resolving `..`
//! components and every symlink — and must then lie inside one of the
//! canonicalized roots. Anything else is rejected before the file is opened.
//!
//! The rejection message is identical for a path outside the roots and for a
//! path that cannot be resolved at all, so the scope never reveals whether a
//! file exists outside it.
//!
//! Limitation: the check and the later open are separate system calls. The
//! scope stops an agent from being steered to other files; it is not a
//! defence against a concurrent local process that can rewrite directories
//! inside a root between the check and the open.
//!
//! Without configuration the scope is off, preserving the behaviour of
//! standalone installations that rely on reading any local path.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Environment variable holding allowed roots, separated like `PATH`
/// (`:` on Unix, `;` on Windows).
pub const ALLOWED_ROOTS_ENV: &str = "OOXML_MCP_ALLOWED_ROOTS";

/// Canonicalized allowed roots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathScope {
    roots: Vec<PathBuf>,
}

/// A request rejected by a configured [`PathScope`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutsideAllowedRoots {
    pub path: String,
}

impl fmt::Display for OutsideAllowedRoots {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Cannot read '{}': path_outside_allowed_roots: the path does not exist or is outside the allowed roots configured for this server",
            self.path
        )
    }
}

impl std::error::Error for OutsideAllowedRoots {}

impl PathScope {
    /// Canonicalize each root. A root that cannot be resolved is skipped and
    /// reported in the returned warnings; the scope stays in force, so a
    /// scope whose every root is invalid denies every request.
    pub fn new<I, P>(roots: I) -> (Self, Vec<String>)
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        let mut canonical = Vec::new();
        let mut warnings = Vec::new();
        for root in roots {
            let root = root.as_ref();
            // A relative root would silently depend on the launcher's working
            // directory, so only absolute roots are accepted.
            if !root.is_absolute() {
                warnings.push(format!(
                    "ignoring allowed root '{}': not an absolute path",
                    root.display()
                ));
                continue;
            }
            match fs::canonicalize(root) {
                Ok(path) => {
                    if !canonical.contains(&path) {
                        canonical.push(path);
                    }
                }
                Err(error) => warnings.push(format!(
                    "ignoring allowed root '{}': {}",
                    root.display(),
                    error
                )),
            }
        }
        (Self { roots: canonical }, warnings)
    }

    /// Resolve `requested` to its canonical path when it lies inside a root.
    pub fn resolve(&self, requested: &str) -> Result<PathBuf, OutsideAllowedRoots> {
        let denied = || OutsideAllowedRoots {
            path: requested.to_string(),
        };
        let canonical = fs::canonicalize(requested).map_err(|_| denied())?;
        // `Path::starts_with` compares whole components, so a sibling such as
        // `/data/project-other` is not inside the root `/data/project`.
        if self.roots.iter().any(|root| canonical.starts_with(root)) {
            Ok(canonical)
        } else {
            Err(denied())
        }
    }
}

static SCOPE: OnceLock<Option<PathScope>> = OnceLock::new();

/// Install the process-wide scope. Called once from `main` before serving.
pub fn install(scope: Option<PathScope>) {
    let _ = SCOPE.set(scope);
}

/// Canonicalize a tool's path argument, enforcing the configured scope.
pub fn canonicalize(requested: &str) -> Result<PathBuf, String> {
    match SCOPE.get_or_init(|| None) {
        Some(scope) => scope.resolve(requested).map_err(|error| error.to_string()),
        None => fs::canonicalize(requested)
            .map_err(|error| format!("Cannot read '{}': {}", requested, error)),
    }
}

/// Allowed roots requested by the environment variable, if it is set and not
/// empty. Empty entries (for example a trailing separator) are ignored.
pub fn roots_from_env(value: Option<&OsStr>) -> Option<Vec<PathBuf>> {
    let value = value.filter(|value| !value.is_empty())?;
    Some(
        std::env::split_paths(value)
            .filter(|path| !path.as_os_str().is_empty())
            .collect(),
    )
}

/// Build the scope from CLI roots plus the environment variable. Returns
/// `None` when neither supplies a root, which leaves the scope off.
pub fn from_config(
    cli_roots: Vec<OsString>,
    env_value: Option<&OsStr>,
) -> Option<(PathScope, Vec<String>)> {
    let env_roots = roots_from_env(env_value);
    if cli_roots.is_empty() && env_roots.is_none() {
        return None;
    }
    let roots = cli_roots
        .into_iter()
        .map(PathBuf::from)
        .chain(env_roots.unwrap_or_default());
    Some(PathScope::new(roots))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    struct TempTree(PathBuf);

    impl TempTree {
        fn new(tag: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "ooxml-mcp-scope-{tag}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(root.join("allowed/nested")).unwrap();
            fs::create_dir_all(root.join("allowed-sibling")).unwrap();
            fs::create_dir_all(root.join("outside")).unwrap();
            fs::write(root.join("allowed/nested/inside.docx"), b"inside").unwrap();
            fs::write(root.join("allowed-sibling/sibling.docx"), b"sibling").unwrap();
            fs::write(root.join("outside/secret.docx"), b"secret").unwrap();
            Self(root)
        }

        fn path(&self, relative: &str) -> String {
            self.0.join(relative).to_str().unwrap().to_string()
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn scope(tree: &TempTree) -> PathScope {
        let (scope, warnings) = PathScope::new([tree.0.join("allowed")]);
        assert!(warnings.is_empty());
        scope
    }

    #[test]
    fn accepts_a_file_inside_a_root_and_returns_its_canonical_path() {
        let tree = TempTree::new("inside");
        let resolved = scope(&tree)
            .resolve(&tree.path("allowed/nested/inside.docx"))
            .unwrap();
        assert_eq!(
            resolved,
            fs::canonicalize(tree.0.join("allowed/nested/inside.docx")).unwrap()
        );
        // `..` that stays inside the root is fine.
        assert!(scope(&tree)
            .resolve(&tree.path("allowed/nested/../nested/inside.docx"))
            .is_ok());
    }

    #[test]
    fn rejects_outside_paths_traversal_and_component_prefix_siblings() {
        let tree = TempTree::new("outside");
        let scope = scope(&tree);
        for requested in [
            tree.path("outside/secret.docx"),
            tree.path("allowed/../outside/secret.docx"),
            tree.path("allowed/nested/../../outside/secret.docx"),
            tree.path("allowed-sibling/sibling.docx"),
        ] {
            let error = scope.resolve(&requested).unwrap_err();
            assert_eq!(error.path, requested);
            assert!(error.to_string().contains("path_outside_allowed_roots"));
        }
    }

    #[test]
    fn denial_does_not_reveal_whether_an_outside_path_exists() {
        let tree = TempTree::new("oracle");
        let scope = scope(&tree);
        let existing = scope
            .resolve(&tree.path("outside/secret.docx"))
            .unwrap_err()
            .to_string();
        let missing = scope
            .resolve(&tree.path("outside/missing.docx"))
            .unwrap_err()
            .to_string();
        assert_eq!(
            existing.replace("secret", "X"),
            missing.replace("missing", "X")
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_escape_the_root_and_accepts_ones_that_stay_inside() {
        use std::os::unix::fs::symlink;
        let tree = TempTree::new("symlink");
        symlink(
            tree.0.join("outside/secret.docx"),
            tree.0.join("allowed/link.docx"),
        )
        .unwrap();
        symlink(tree.0.join("outside"), tree.0.join("allowed/dir-link")).unwrap();
        symlink(
            tree.0.join("allowed/nested/inside.docx"),
            tree.0.join("allowed/inner-link.docx"),
        )
        .unwrap();
        let scope = scope(&tree);
        assert!(scope.resolve(&tree.path("allowed/link.docx")).is_err());
        assert!(scope
            .resolve(&tree.path("allowed/dir-link/secret.docx"))
            .is_err());
        assert_eq!(
            scope
                .resolve(&tree.path("allowed/inner-link.docx"))
                .unwrap(),
            fs::canonicalize(tree.0.join("allowed/nested/inside.docx")).unwrap()
        );
    }

    #[test]
    fn configuration_is_opt_in_and_invalid_roots_fail_closed() {
        assert_eq!(from_config(Vec::new(), None), None);
        assert_eq!(from_config(Vec::new(), Some(OsStr::new(""))), None);

        let tree = TempTree::new("config");
        let env = std::env::join_paths([tree.0.join("allowed"), tree.0.join("missing")]).unwrap();
        let (scope, warnings) = from_config(Vec::new(), Some(&env)).unwrap();
        assert_eq!(warnings.len(), 1);
        assert!(scope
            .resolve(&tree.path("allowed/nested/inside.docx"))
            .is_ok());
        assert!(scope.resolve(&tree.path("outside/secret.docx")).is_err());

        let (scope, warnings) = from_config(
            vec![tree.0.join("missing").into_os_string(), "allowed".into()],
            None,
        )
        .unwrap();
        assert_eq!(warnings.len(), 2);
        assert!(scope
            .resolve(&tree.path("allowed/nested/inside.docx"))
            .is_err());
    }
}
