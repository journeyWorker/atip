//! The pieces of the L1 checks that are not a check themselves: the typed documents of a `schema` answer, the
//! reading of a documented invocation, the rules of spec 10.13, field projection, the two regular-expression
//! engines, and the generation of the invocations that probe a declared constraint or domain.
//!
//! The checks themselves (`L1.tree` ... `L1.fields`) are in `checks/l1.rs`; they read the log of invocations the
//! run made, and these modules for everything that is a rule about a document.
//!
//! A 1.4 self-description lists less than a command accepts, so the rules read it through [`view`] (the full command,
//! built from the tree's shared options and the command's `--schemas` answer) and [`form`] judges what it lists (Annex S2
//! rules 16 and 17); a document of an earlier minor is read as it is printed.

pub mod form;
pub mod invocation;
pub mod model;
pub mod project;
pub mod regex;
pub mod rules;
pub mod view;
pub mod witness;
